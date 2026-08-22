import { describe, expect, test } from 'vitest'
import {
  archetypeOf,
  canSquadAccept,
  findReinforceRecipe,
  looseRoster,
  planAutoRefill,
  applyReinforcement,
  refillSquads,
  forecastRefills,
  refillBlocker,
  squadSizePoints,
} from '../services/squadReinforce.js'
import { catalogFixture } from './fixtures/catalog.js'
import {
  SQUAD_ARCHETYPES,
  SQUAD_REINFORCE_POOL,
  SQUAD_UPGRADE_POOL,
  SQUAD_TROOP_BUDGET,
  SQUAD_CHARACTER_RESERVE,
  STARTING_SQUADS,
} from '../utils/campaignConfig.js'

// Squad reinforcement — slice 3's gates, driven by 13-2's automatic refill.
// This is the pure layer: the recipe table, the per-type headroom, the pooled
// intake, the size-budget gate, and the end-of-turn pass that now decides for
// itself what each charter takes on. The end-day wiring is covered in
// campaigns.test.js.
//
// THE GATES ARE THE SAME; WHAT CHANGED IS WHAT THEY DO. Slice 3 refused an
// over-request so the player could ask again for less. Nobody asks any more, so
// every gate is a ceiling and the refill takes what fits under all of them —
// which is why almost every test here reads "takes N" where it used to read
// "refuses".

const sizeOf = new Map(catalogFixture.units.map((u) => [u.name, u.size]))

// A plain-object stand-in for a squad subdocument. The service reads Maps and
// plain objects alike (mongoose Maps ARE Maps) so the pure tests need no DB.
const squad = (overrides = {}) => ({
  id: 1,
  name: 'Test Cohort',
  archetype: 'line',
  composition: { Soldier: 40 },
  prestige: 0,
  ...overrides,
})

const richEnough = { gold: 1000, materials: 1000, horses: 100, food: 1000 }
const looseEnough = { Soldier: 100, Archer: 100, Militia: 100, Pikeman: 100, Cavalry: 100, LightCavalry: 100 }

describe('the recipe table', () => {
  // Inputs and outputs are UNCONNECTED (decision A): one application destroys
  // everything in `inputs` and creates output.count of output.type. Today
  // every row happens to be 1:1 and no code path may assume it.
  test('every row names an output type, a count, inputs and a cost', () => {
    for (const recipe of SQUAD_REINFORCE_POOL) {
      expect(recipe.output.count).toBeGreaterThan(0)
      expect(Object.keys(recipe.inputs).length).toBeGreaterThan(0)
      expect(typeof recipe.id).toBe('string')
      expect(Object.values(recipe.cost).every((n) => n > 0)).toBe(true)
    }
  })

  test('lookup is by OUTPUT type, and an unknown type has no recipe', () => {
    expect(findReinforceRecipe('Cavalry').output.type).toBe('Cavalry')
    expect(findReinforceRecipe('Dragon')).toBeUndefined()
  })

  test('one recipe per output type — a second row would make the lookup a coin toss', () => {
    const outputs = SQUAD_REINFORCE_POOL.map((r) => r.output.type)
    expect(new Set(outputs).size).toBe(outputs.length)
  })

  // Config invariant (decision B): the archetype owns the FENCE, the recipe
  // owns the TRANSFORMATION — but a capped type with no recipe is a type the
  // charter may hold and can never replace, which reads as a silent bug rather
  // than a design choice.
  //
  // A type an UPGRADE can put in a charter counts as capped: since 4d a
  // type-swap row rewrites which type a cap is for, and the swapped-in type is
  // exactly the one whose replacements must exist — it is the only channel by
  // which the type is obtainable at all.
  test('every type any archetype caps can actually be reinforced', () => {
    const capped = new Set(Object.values(SQUAD_ARCHETYPES).flatMap((a) => Object.keys(a.caps)))
    for (const row of SQUAD_UPGRADE_POOL)
      for (const e of row.effects) if (e.kind === 'typeSwap') capped.add(e.to)
    const missing = [...capped].filter((type) => !findReinforceRecipe(type))
    expect(missing, 'capped types with no SQUAD_REINFORCE_POOL row').toEqual([])
  })
})

describe('archetype invariants', () => {
  // Slice 2 shipped the archetypes with no invariant test (a chosen trade —
  // nothing could add troops yet). Slice 3 is where a starting composition
  // over its own caps would first bite, so the guard lands with the teeth.
  test('every starting squad names a real archetype and sits within its caps', () => {
    for (const s of STARTING_SQUADS) {
      const archetype = SQUAD_ARCHETYPES[s.archetype]
      expect(archetype, `${s.name} has no archetype row`).toBeDefined()
      for (const [type, count] of Object.entries(s.composition)) {
        expect(archetype.caps[type], `${s.name} holds unpermitted ${type}`).toBeDefined()
        expect(count).toBeLessThanOrEqual(archetype.caps[type])
      }
    }
  })

  // The size-budget invariant over the real engine sizes lives in
  // engine.integration.test.js — only a run against the binary can see both
  // the caps and what a body actually occupies.
  test('every archetype admits at least one type and absorbs at least one body a turn', () => {
    for (const [id, archetype] of Object.entries(SQUAD_ARCHETYPES)) {
      expect(Object.keys(archetype.caps).length, `${id} permits nothing`).toBeGreaterThan(0)
      expect(archetype.intake, `${id} can never refill`).toBeGreaterThan(0)
    }
  })
})

describe('canSquadAccept', () => {
  test('headroom is the cap minus what is already there', () => {
    expect(canSquadAccept(squad({ composition: { Soldier: 35 } }), 'Soldier')).toBe(5)
    expect(canSquadAccept(squad({ composition: {} }), 'Soldier')).toBe(40)
  })

  // Over-CAP is INERT, never an error (decision F): the user is content for
  // squads to run over-strength, so an over-full squad simply offers no room
  // in that type and shrinks back under the cap through casualties.
  test('an over-strength squad offers no room, rather than a negative one', () => {
    expect(canSquadAccept(squad({ composition: { Soldier: 55 } }), 'Soldier')).toBe(0)
  })

  test('a type the archetype does not permit can never be reinforced', () => {
    expect(canSquadAccept(squad(), 'Archer')).toBe(0)
    // …and it keeps fighting: nothing here removes it, it just cannot grow.
    expect(canSquadAccept(squad({ composition: { Soldier: 40, Archer: 3 } }), 'Archer')).toBe(0)
  })

  test('a squad with no archetype accepts nothing at all', () => {
    expect(archetypeOf(squad({ archetype: undefined }))).toBeNull()
    expect(canSquadAccept(squad({ archetype: undefined }), 'Soldier')).toBe(0)
    expect(canSquadAccept(squad({ archetype: 'phalanx_of_atlantis' }), 'Soldier')).toBe(0)
  })
})

describe('planAutoRefill', () => {
  const refill = (overrides = {}) =>
    planAutoRefill({
      squad: squad({ composition: { Soldier: 30 } }),
      sizeOf,
      loose: looseEnough,
      resources: richEnough,
      ...overrides,
    })

  test('takes a full intake when pool, purse and caps all allow it', () => {
    const soldier = findReinforceRecipe('Soldier')
    const result = refill()
    expect(result.outputs).toEqual({ Soldier: SQUAD_ARCHETYPES.line.intake })
    expect(result.inputs).toEqual({ Soldier: SQUAD_ARCHETYPES.line.intake })
    expect(result.bodies).toBe(SQUAD_ARCHETYPES.line.intake)
    expect(result.cost).toEqual({
      gold: SQUAD_ARCHETYPES.line.intake * soldier.cost.gold,
      materials: SQUAD_ARCHETYPES.line.intake * soldier.cost.materials,
    })
  })

  // The clamp that replaces slice 3's "there is room for 2, not 5" refusal.
  // Pikemen at cap in these fixtures on purpose: with room left in the second
  // type the refill would spill into it (which is 13-5 working), and the point
  // here is what the FIRST type's cap does.
  test('the per-type cap clamps the fill instead of refusing it', () => {
    expect(refill({ squad: squad({ composition: { Soldier: 38, Pikeman: 10 } }) }).outputs)
      .toEqual({ Soldier: 2 })
  })

  test('a charter at full strength takes nothing at all', () => {
    expect(refill({ squad: squad({ composition: { Soldier: 40, Pikeman: 10 } }) })).toBeNull()
  })

  test('a charter with no archetype can never be refilled', () => {
    expect(refill({ squad: squad({ archetype: undefined }) })).toBeNull()
  })

  // 13-5: the caps table is written primary-type-first, so a line charter fills
  // soldiers to their cap before it touches pikemen — and the intake left over
  // spills into the next type rather than going unused.
  test('types fill in the caps table order, and the remainder spills onward', () => {
    const result = refill({ squad: squad({ composition: { Soldier: 35 } }) })
    expect(result.outputs).toEqual({ Soldier: 5, Pikeman: 5 })
    expect(Object.keys(result.outputs)).toEqual(['Soldier', 'Pikeman'])
    expect(result.bodies).toBe(SQUAD_ARCHETYPES.line.intake)
  })

  // Pooled on the OUTPUT side (decision C), so vanguard's intake of 2 is two
  // BODIES across every type it admits — not two per type.
  test('the pooled intake is spent across types, not per type', () => {
    const result = refill({ squad: squad({ archetype: 'vanguard', composition: {} }) })
    expect(result.bodies).toBe(SQUAD_ARCHETYPES.vanguard.intake)
    // Cavalry is written first, so it takes the whole allowance.
    expect(result.outputs).toEqual({ Cavalry: 2 })
  })

  test('the loose pool is a ceiling — a thin pool fills what it can', () => {
    expect(refill({ loose: { Soldier: 3 } }).outputs).toEqual({ Soldier: 3 })
    expect(refill({ loose: {} })).toBeNull()
  })

  // 13-3: the price survives automation, so the treasury is the last ceiling.
  test('the purse is a ceiling — the refill stops when the money does', () => {
    // 2 gold a body: five gold buys two and leaves one unspendable.
    expect(refill({ resources: { gold: 5, materials: 1000 } }).outputs).toEqual({ Soldier: 2 })
    expect(refill({ resources: { gold: 0, materials: 1000 } })).toBeNull()
  })

  test('a resource the recipe needs and the stores lack stops that type', () => {
    // Horses price cavalry and nothing else; without them the vanguard stands.
    const broke = refill({
      squad: squad({ archetype: 'vanguard', composition: {} }),
      resources: { gold: 1000, materials: 1000, horses: 0 },
    })
    expect(broke).toBeNull()
  })

  // The SIZE BUDGET stays an INDEPENDENT gate (decision G): over-cap is a design
  // knob, over-hex is a bug. It clamps like the rest now.
  test('the hex budget clamps a fill the cap alone would allow', () => {
    // 55 Soldiers occupy 550 of the 560 points left once the character reserve
    // is set aside, so exactly one more size-10 body fits — though the Pikeman
    // cap would happily take ten.
    const swollen = squad({ composition: { Soldier: 55 } })
    expect(canSquadAccept(swollen, 'Pikeman')).toBe(10)
    expect(refill({ squad: swollen }).outputs).toEqual({ Pikeman: 1 })
  })

  test('a squad already over its hex takes nothing rather than throwing', () => {
    expect(refill({ squad: squad({ composition: { Soldier: 60 } }) })).toBeNull()
  })

  test('a type the catalog does not know THROWS — a data bug, not a quiet skip', () => {
    expect(() => refill({ sizeOf: new Map() })).toThrow(/Soldier/)
  })
})

describe('looseRoster', () => {
  // The invariant the whole campaign layer rests on: loose = roster − Σ
  // squads.composition. Reinforcement is the first thing that moves a body
  // ACROSS that line rather than adding to both sides.
  test('is the roster minus every squad’s committed bodies', () => {
    const campaign = {
      roster: new Map([['Soldier', 100], ['Archer', 40], ['Militia', 5]]),
      squads: [
        { composition: new Map([['Soldier', 40]]) },
        { composition: new Map([['Soldier', 10], ['Archer', 30]]) },
      ],
    }
    expect(looseRoster(campaign)).toEqual({ Soldier: 50, Archer: 10, Militia: 5 })
  })
})

describe('applyReinforcement', () => {
  const campaignDoc = () => ({
    day: 4,
    resources: { gold: 100, materials: 100, horses: 10, food: 1000 },
    roster: new Map([['Soldier', 100]]),
    squads: [{ id: 1, name: '1st Cohort', archetype: 'line', composition: new Map([['Soldier', 30]]) }],
  })

  test('destroys the inputs, creates the outputs, charges the cost', () => {
    const campaign = campaignDoc()
    const target = campaign.squads[0]
    const plan = planAutoRefill({
      squad: target,
      sizeOf,
      loose: looseRoster(campaign),
      resources: campaign.resources,
    })
    const log = applyReinforcement(campaign, target, plan)

    // 1:1 today: ten loose bodies destroyed, ten created inside the charter,
    // so the roster total is unchanged and only the LOOSE count moved.
    expect(campaign.roster.get('Soldier')).toBe(100)
    expect(target.composition.get('Soldier')).toBe(40)
    expect(looseRoster(campaign).Soldier).toBe(60)
    expect(campaign.resources.gold).toBe(100 - plan.cost.gold)
    expect(campaign.resources.materials).toBe(100 - plan.cost.materials)
    expect(log.join(' ')).toMatch(/1st Cohort/)
  })

  // Inputs and outputs are unconnected, so the roster is NOT conserved in
  // general — a many-to-one recipe really does shrink the army. The apply step
  // must move both sides independently rather than assuming a swap.
  test('a many-to-one recipe destroys more bodies than it creates', () => {
    const campaign = campaignDoc()
    const target = campaign.squads[0]
    applyReinforcement(campaign, target, {
      inputs: { Soldier: 4 },
      outputs: { Soldier: 1 },
      cost: { gold: 2 },
      bodies: 1,
    })
    expect(campaign.roster.get('Soldier')).toBe(97)
    expect(target.composition.get('Soldier')).toBe(31)
    expect(campaign.resources.gold).toBe(98)
  })
})

// ── Formation Fighters: the packing size and its price (slice 4c) ────────────
//
// The upgrade reaches this layer twice: the hex budget measures the room a
// squad takes (which drill shrinks), and the reinforcement bill carries the
// surcharge the ROW bundles with the ability.
describe('a drilled squad packs tighter and pays more', () => {
  const drilled = (overrides = {}) => squad({ upgrades: ['formation_fighters'], ...overrides })

  test('the budget measures PACKING points, so drill leaves room behind it', () => {
    // 40 size-10 Soldiers occupy 400 points; drilled, they pack at 8 → 320.
    expect(squadSizePoints({ Soldier: 40 }, sizeOf)).toBe(400)
    expect(squadSizePoints({ Soldier: 40 }, sizeOf, 2)).toBe(320)
  })

  // The engine floors a body's packing size at 1 (AUnit::getPackingSize). This
  // layer must floor identically or the two disagree about what fits a hex —
  // this one measures the same hex the engine will.
  test('a body never packs below 1 point, however hard it is drilled', () => {
    expect(squadSizePoints({ Soldier: 3 }, sizeOf, 100)).toBe(3)
  })

  // The payoff on the campaign side: the same request the hex refuses for an
  // undrilled squad fits once the squad packs tighter.
  test('the hex budget lets a drilled squad take on what it otherwise could not', () => {
    const composition = { Soldier: 55 }
    const args = { sizeOf, loose: looseEnough, resources: richEnough }
    // Undrilled: 550 points of the 560 available, so one size-10 body fits.
    expect(planAutoRefill({ squad: squad({ composition }), ...args }).outputs).toEqual({ Pikeman: 1 })
    // Drilled, the same 55 pack into 440 — room enough that the CAP and the
    // intake become the binding constraints instead of the hex.
    expect(planAutoRefill({ squad: drilled({ composition }), ...args }).outputs)
      .toEqual({ Pikeman: SQUAD_ARCHETYPES.line.caps.Pikeman })
  })

  // The price rides the ROW, not the ability (user, 2026-08-18): +1 gold per
  // BODY brought in, on top of whatever the recipe costs.
  test('the surcharge is added per body, on top of the recipe', () => {
    // Room for exactly five, so both squads take the same five bodies and the
    // only difference in the bill is the row itself.
    const composition = { Soldier: 35, Pikeman: 10 }
    const args = { sizeOf, loose: looseEnough, resources: richEnough }
    const plain = planAutoRefill({ squad: squad({ composition }), ...args })
    const paid = planAutoRefill({ squad: drilled({ composition }), ...args })
    expect(plain.bodies).toBe(5)
    expect(paid.bodies).toBe(5)
    expect(paid.cost.gold).toBe(plain.cost.gold + 5)
    // Only the resources the row names — the rest of the bill is untouched.
    expect(paid.cost.materials).toBe(plain.cost.materials)
  })

  test('a squad without the row pays exactly what it did before', () => {
    const args = { sizeOf, loose: looseEnough, resources: richEnough }
    const before = planAutoRefill({ squad: squad({ composition: { Soldier: 35, Pikeman: 10 } }), ...args })
    expect(before.cost).toEqual({ gold: 10, materials: 10 })
  })
})

// ── A converted guard squad pays for its own standard (slice 4d) ────────────
//
// This is where the Royal Guard's price actually lands. The pick itself is free
// — reaching the rank and spending two of a campaign's three slots is the whole
// purchase — and the ONGOING cost is reinforcement: the charter no longer takes
// Soldiers at all, so every replacement is trained up out of one at 2.5× a
// soldier's rate.
describe('the guard squad pays a dearer rate for its replacements', () => {
  const guard = (overrides = {}) =>
    squad({ upgrades: ['royal_guard'], composition: { RoyalGuard: 30 }, ...overrides })
  const args = { sizeOf, loose: looseEnough, resources: richEnough }

  test('a replacement is trained OUT of a loose Soldier, not out of a guard', () => {
    const result = planAutoRefill({ squad: guard({ composition: { RoyalGuard: 36, Pikeman: 10 } }), ...args })
    // There are never loose Royal Guards to draw on — the upgrade is the only
    // thing that makes one — so the Soldier pipeline stays load-bearing.
    expect(result.inputs).toEqual({ Soldier: 4 })
    expect(result.outputs).toEqual({ RoyalGuard: 4 })
  })

  test('the rate is 2.5× a Soldier’s, and costs no food', () => {
    const soldier = findReinforceRecipe('Soldier')
    const royal = findReinforceRecipe('RoyalGuard')
    expect(royal.cost).toEqual({ gold: 5, materials: 4 })
    expect(royal.cost.gold / soldier.cost.gold).toBe(2.5)
    // A 1:1 recipe destroys a body and creates one, so the army gains no new
    // mouth — the rule every row in this table follows.
    expect(royal.cost.food).toBeUndefined()
  })

  // No surcharge on top: unlike Formation Fighters, the dearer RECIPE is the
  // price of this row, and stacking one would charge the same trade twice.
  test('the recipe IS the price — no upgrade surcharge on top', () => {
    const result = planAutoRefill({ squad: guard({ composition: { RoyalGuard: 38, Pikeman: 10 } }), ...args })
    expect(result.outputs).toEqual({ RoyalGuard: 2 })
    expect(result.cost).toEqual({ gold: 10, materials: 8 })
  })

  // The whole point of Soldier LEAVING the charter: a guard squad cannot quietly
  // refill with the cheap bodies it used to hold.
  // The whole point of Soldier LEAVING the charter, and it is sharper now than
  // it was: the refill picks the types itself, so if the swap had not taken
  // Soldier off the caps table this charter would quietly refill with cheap
  // bodies every turn and nobody would ever see the dearer recipe.
  test('the refill never brings an ordinary Soldier into a converted charter', () => {
    const result = planAutoRefill({ squad: guard({ composition: { RoyalGuard: 20 } }), ...args })
    expect(result.outputs.Soldier).toBeUndefined()
    expect(Object.keys(result.outputs)).toEqual(['RoyalGuard'])
  })

  test('the loose Soldiers on hand are the ceiling on new guards', () => {
    const result = planAutoRefill({
      squad: guard(),
      sizeOf,
      loose: { Soldier: 2 },
      resources: richEnough,
    })
    expect(result.outputs).toEqual({ RoyalGuard: 2 })
    expect(result.inputs).toEqual({ Soldier: 2 })
  })

  test('a converted squad measures against the hex exactly as it did before', () => {
    // Same size body, so the fence sees no change — 4d deliberately buys no hex
    // headroom and risks no new invariant.
    expect(squadSizePoints({ RoyalGuard: 40, Pikeman: 10 }, sizeOf))
      .toBe(squadSizePoints({ Soldier: 40, Pikeman: 10 }, sizeOf))
  })

  test('applying it moves guards into the squad and destroys the Soldiers', () => {
    const campaign = {
      day: 6,
      resources: { gold: 100, materials: 100 },
      roster: new Map([['Soldier', 10], ['RoyalGuard', 30]]),
    }
    const s = { ...guard(), composition: new Map([['RoyalGuard', 38], ['Pikeman', 10]]) }
    const plan = planAutoRefill({ squad: s, ...args })
    applyReinforcement(campaign, s, plan)
    expect(s.composition.get('RoyalGuard')).toBe(40)
    expect(campaign.roster.get('RoyalGuard')).toBe(32)
    expect(campaign.roster.get('Soldier')).toBe(8)
    expect(campaign.resources).toEqual({ gold: 90, materials: 92 })
  })
})

// ── The end-of-turn pass (13-2/13-4) ────────────────────────────────────────
//
// One charter at a time, in roll order, each priced against what the ones
// before it left behind. These are the tests that would catch a refill that
// looked right per squad and double-spent across the army.
describe('refillSquads', () => {
  const army = (squads, { roster, ...resources } = {}) => ({
    day: 4,
    resources: { gold: 1000, materials: 1000, horses: 100, ...resources },
    roster: new Map(Object.entries(roster ?? { Soldier: 200, Archer: 200 })),
    squads,
  })
  const charter = (id, name, overrides = {}) => ({
    id,
    name,
    archetype: 'line',
    composition: new Map([['Soldier', 30], ['Pikeman', 10]]),
    ...overrides,
  })

  test('every charter under strength takes on bodies, and says so in the log', () => {
    const campaign = army([charter(1, '1st Cohort'), charter(2, '2nd Cohort')])
    const entries = refillSquads(campaign, sizeOf)
    expect(campaign.squads[0].composition.get('Soldier')).toBe(40)
    expect(campaign.squads[1].composition.get('Soldier')).toBe(40)
    expect(entries).toHaveLength(2)
    expect(entries.join(' ')).toMatch(/1st Cohort/)
    expect(entries.join(' ')).toMatch(/2nd Cohort/)
  })

  test('a charter with nothing to take is silent — no empty log line', () => {
    const full = charter(1, 'Full Cohort', { composition: new Map([['Soldier', 40], ['Pikeman', 10]]) })
    expect(refillSquads(army([full]), sizeOf)).toEqual([])
  })

  // 13-4: flat roll order, oldest first, and the shortfall lands on whoever is
  // last. The pool is re-read per charter — whatever the first took is simply
  // not there for the second, which is the whole ordering rule.
  test('a thin loose pool is spent in roll order, and the last charter goes short', () => {
    const campaign = army(
      [charter(1, '1st Cohort'), charter(2, '2nd Cohort')],
      { roster: { Soldier: 66, Pikeman: 20 } }, // 60 committed + 10 committed = 6 loose
    )
    refillSquads(campaign, sizeOf)
    expect(campaign.squads[0].composition.get('Soldier')).toBe(36)
    expect(campaign.squads[1].composition.get('Soldier')).toBe(30)
  })

  // The same story for 13-3's money: one treasury, spent down the roll.
  test('the purse is shared, so an empty treasury strands the later charters', () => {
    const campaign = army(
      [charter(1, '1st Cohort'), charter(2, '2nd Cohort')],
      { gold: 12, materials: 1000 },
    )
    refillSquads(campaign, sizeOf)
    // 2 gold a body: six bodies is the whole purse, and it goes to the first.
    expect(campaign.squads[0].composition.get('Soldier')).toBe(36)
    expect(campaign.squads[1].composition.get('Soldier')).toBe(30)
    expect(campaign.resources.gold).toBe(0)
  })

  // Decision 14: a wiped charter stays on the rolls at composition {} and
  // refills through this ordinary intake — there is no rebuild cost and no
  // special state, so nothing here needs to know it was ever wiped.
  test('a wiped charter rebuilds through the ordinary intake', () => {
    const campaign = army([charter(1, 'Ghost Cohort', { composition: new Map() })])
    refillSquads(campaign, sizeOf)
    expect(campaign.squads[0].composition.get('Soldier')).toBe(SQUAD_ARCHETYPES.line.intake)
  })

  test('an army with no squads at all is a no-op', () => {
    expect(refillSquads(army([]), sizeOf)).toEqual([])
    expect(refillSquads({ ...army([]), squads: undefined }, sizeOf)).toEqual([])
  })
})

// ── The forecast (13-6) ─────────────────────────────────────────────────────
//
// What the squad screen shows BEFORE the turn ends. The load-bearing property
// is not any single number but the agreement: the forecast is the same walk as
// the pass, with the spending simulated instead of done. If those two ever
// disagree the screen promises bodies the turn does not deliver, which is the
// one failure mode this whole split exists to prevent.
describe('forecastRefills', () => {
  const army = (squads, { roster, ...resources } = {}) => ({
    day: 4,
    resources: { gold: 1000, materials: 1000, horses: 100, ...resources },
    roster: new Map(Object.entries(roster ?? { Soldier: 200, Archer: 200 })),
    squads,
  })
  const charter = (id, name, overrides = {}) => ({
    id,
    name,
    archetype: 'line',
    composition: new Map([['Soldier', 30], ['Pikeman', 10]]),
    ...overrides,
  })

  // The twin test. Every scenario the pass is covered for above is forecast
  // first and applied second, and the two must name the same bodies.
  const agrees = (campaign) => {
    const forecast = forecastRefills(campaign, sizeOf)
    const before = campaign.squads.map((s) => new Map(s.composition))
    refillSquads(campaign, sizeOf)
    campaign.squads.forEach((squad, i) => {
      const joined = {}
      for (const [type, count] of squad.composition) {
        const gained = count - (before[i].get(type) ?? 0)
        if (gained > 0) joined[type] = gained
      }
      expect(forecast.get(squad.id).plan?.outputs ?? {}, `${squad.name}'s forecast`).toEqual(joined)
    })
  }

  test('it names exactly the bodies the end-of-turn pass then takes on', () => {
    agrees(army([charter(1, '1st Cohort'), charter(2, '2nd Cohort')]))
  })

  test('it goes short on the same charter the thin pool strands', () => {
    agrees(army([charter(1, '1st'), charter(2, '2nd')], { roster: { Soldier: 66, Pikeman: 20 } }))
  })

  test('it strands the same charter the empty treasury does', () => {
    agrees(army([charter(1, '1st'), charter(2, '2nd')], { gold: 12, materials: 1000 }))
  })

  test('it forecasts the rebuild of a wiped charter', () => {
    agrees(army([charter(1, 'Ghost', { composition: new Map() })]))
  })

  // Pure: reading the forecast must not cost the player a body or a coin —
  // this is the thing that would turn a screen visit into a mutation.
  test('it spends nothing — the campaign is untouched', () => {
    const campaign = army([charter(1, '1st Cohort')])
    forecastRefills(campaign, sizeOf)
    expect(campaign.squads[0].composition.get('Soldier')).toBe(30)
    expect(campaign.roster.get('Soldier')).toBe(200)
    expect(campaign.resources.gold).toBe(1000)
  })

  test('it prices what joins, so the screen can say what tonight costs', () => {
    const forecast = forecastRefills(army([charter(1, '1st Cohort')]), sizeOf)
    const { plan, blocked } = forecast.get(1)
    expect(plan.outputs).toEqual({ Soldier: SQUAD_ARCHETYPES.line.intake })
    expect(plan.cost.gold).toBeGreaterThan(0)
    expect(blocked).toBeNull()
  })

  // 13-6's other half: "nothing: the loose pool is empty" needs a REASON, and
  // a null plan cannot carry one — it clamps at every gate at once.
  test('a charter that takes nobody says which gate closed', () => {
    const full = charter(1, 'Full', { composition: new Map([['Soldier', 40], ['Pikeman', 10]]) })
    expect(forecastRefills(army([full]), sizeOf).get(1)).toEqual({ plan: null, blocked: 'full' })

    const starved = army([charter(1, 'Thin')], { roster: { Soldier: 30, Pikeman: 10 } })
    expect(forecastRefills(starved, sizeOf).get(1).blocked).toBe('pool')

    const broke = army([charter(1, 'Broke')], { gold: 0 })
    expect(forecastRefills(broke, sizeOf).get(1).blocked).toBe('cost')
  })

  // The pool is spent down the roll in the forecast too, so the second charter
  // is told the truth rather than each being forecast in isolation.
  test('the later charter is forecast against what the earlier one will take', () => {
    const campaign = army(
      [charter(1, '1st'), charter(2, '2nd')],
      { roster: { Soldier: 66, Pikeman: 20 } }, // 6 loose Soldiers, and the 1st takes them
    )
    const forecast = forecastRefills(campaign, sizeOf)
    expect(forecast.get(1).plan.outputs).toEqual({ Soldier: 6 })
    expect(forecast.get(2).plan).toBeNull()
    expect(forecast.get(2).blocked).toBe('pool')
  })

  test('a charter with no archetype is outside the system, not at full strength', () => {
    const stray = charter(1, 'Stray', { archetype: undefined })
    expect(forecastRefills(army([stray]), sizeOf).get(1).blocked).toBe('none')
  })
})

describe('refillBlocker', () => {
  // The hex fence is the one gate no amount of money or bodies lifts, so the
  // screen must be able to tell it apart from the ones the player can act on.
  // Today's caps all fit inside the budget, so this is reached the way the
  // fence itself could be — by the catalog growing a body: a size-20 Soldier
  // puts 30 of them over the troop budget while the cap still says 40.
  test('a squad that has outgrown its hex is blocked on space, not on stores', () => {
    const heavy = new Map([...sizeOf.entries(), ['Soldier', 20]])
    const squad = { id: 1, name: 'Overfull', archetype: 'line', composition: { Soldier: 30 } }
    expect(squadSizePoints(squad.composition, heavy))
      .toBeGreaterThan(SQUAD_TROOP_BUDGET - SQUAD_CHARACTER_RESERVE)
    expect(refillBlocker({ squad, sizeOf: heavy, loose: looseEnough, resources: richEnough }))
      .toBe('space')
  })

  // Two types blocked for two different reasons: the one the player has most
  // room to fill is the one the screen talks about. A line cohort short of
  // soldiers it cannot pay for, holding no pikemen at all, is a money problem.
  test('the type with the most room to fill decides the reason', () => {
    const squad = { id: 1, name: 'Mauled', archetype: 'line', composition: { Soldier: 25 } }
    // Soldiers: 15 of room, bodies in the pool, no gold. Pikemen: 10 of room and
    // none anywhere to draw on.
    const loose = { Soldier: 100, Pikeman: 0 }
    expect(refillBlocker({ squad, sizeOf, loose, resources: { gold: 0, materials: 100 } })).toBe('cost')
    // Take the soldiers' own room away and the pikemen's reason is all that is
    // left to report.
    const full = { ...squad, composition: { Soldier: 40 } }
    expect(refillBlocker({ squad: full, sizeOf, loose, resources: { gold: 0, materials: 100 } })).toBe('pool')
  })

  // …and with room on the hex, the same squad is blocked by nothing at all —
  // the gate above is the only thing the stretched size changed.
  test('the same squad at ordinary sizes is not blocked on space', () => {
    const squad = { id: 1, name: 'Ordinary', archetype: 'line', composition: { Soldier: 30 } }
    expect(refillBlocker({ squad, sizeOf, loose: looseEnough, resources: richEnough }))
      .not.toBe('space')
  })
})
