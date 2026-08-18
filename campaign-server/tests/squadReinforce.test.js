import { describe, expect, test } from 'vitest'
import {
  archetypeOf,
  canSquadAccept,
  findReinforceRecipe,
  looseRoster,
  planReinforcement,
  applyReinforcement,
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

// Squad reinforcement — the squad overhaul's slice 3 (docs/CAMPAIGN_PLAN.md
// "SLICE 3 — reinforcement"). This is the pure layer: the recipe table, the
// per-type headroom, the pooled intake, the size-budget gate and the atomic
// plan/apply pair. The route wiring is covered in campaigns.test.js.

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

describe('planReinforcement', () => {
  const plan = (overrides = {}) =>
    planReinforcement({
      squad: squad({ composition: { Soldier: 30 } }),
      request: { Soldier: 5 },
      sizeOf,
      loose: looseEnough,
      resources: richEnough,
      ...overrides,
    })

  test('prices the whole request: inputs destroyed, outputs created, cost summed', () => {
    const soldier = findReinforceRecipe('Soldier')
    const result = plan()
    expect(result.error).toBeUndefined()
    expect(result.outputs).toEqual({ Soldier: 5 })
    expect(result.inputs).toEqual({ Soldier: 5 * soldier.inputs.Soldier })
    expect(result.cost).toEqual({
      gold: 5 * soldier.cost.gold,
      materials: 5 * soldier.cost.materials,
    })
    expect(result.bodies).toBe(5)
  })

  // A MAP applied ATOMICALLY (decision I): "once per turn per squad" stays
  // literally true while a mixed archetype still splits its intake across its
  // types — which vanguard (intake 2, two permitted types) needs on day one.
  test('a mixed request sums both sides across types', () => {
    const result = plan({
      squad: squad({ archetype: 'vanguard', composition: { Cavalry: 5, LightCavalry: 5 } }),
      request: { Cavalry: 1, LightCavalry: 1 },
    })
    expect(result.error).toBeUndefined()
    expect(result.outputs).toEqual({ Cavalry: 1, LightCavalry: 1 })
    expect(result.cost).toEqual({ gold: 9, materials: 7, horses: 2 })
  })

  test('a type with no recipe is refused, naming it', () => {
    expect(plan({ request: { Dragon: 1 } }).error).toMatch(/Dragon/)
  })

  // At the ROUTE an over-request is a refusal with nothing spent, never a
  // silent clamp — a clamp would leave the UI's arithmetic and the server's
  // disagreeing with nobody noticing.
  test('asking for more than fits is refused, not clamped', () => {
    const result = plan({ squad: squad({ composition: { Soldier: 38 } }), request: { Soldier: 5 } })
    expect(result.error).toMatch(/room for 2/)
    expect(result.cost).toBeUndefined()
  })

  test('a type outside the archetype is refused even when the squad already holds some', () => {
    expect(plan({ request: { Archer: 1 } }).error).toMatch(/Archer/)
  })

  // Intake is a POOLED per-squad budget metered on the OUTPUT side (decision
  // C): vanguard's `intake: 2` means at most 2 bodies JOIN this turn, however
  // many were destroyed to make them.
  test('the pooled intake caps the bodies that may JOIN this turn', () => {
    const vanguard = squad({ archetype: 'vanguard', composition: {} })
    expect(plan({ squad: vanguard, request: { Cavalry: 2 } }).error).toBeUndefined()
    expect(plan({ squad: vanguard, request: { Cavalry: 3 } }).error).toMatch(/2 replacements/)
    // Pooled, not per type: 2 of each is 4 bodies and blows the same budget.
    expect(plan({ squad: vanguard, request: { Cavalry: 2, LightCavalry: 2 } }).error).toMatch(/2 replacements/)
  })

  test('a full-intake line refill is within the allowance', () => {
    const line = squad({ composition: { Soldier: 25 } })
    expect(plan({ squad: line, request: { Soldier: SQUAD_ARCHETYPES.line.intake } }).error).toBeUndefined()
  })

  // The SIZE BUDGET is a second, INDEPENDENT gate (decision G): over-cap is a
  // design knob, over-hex is a bug — the engine drops or scatters units that
  // outgrow a hex, and a squad must always be one formation on one hex.
  test('the hex budget refuses a reinforcement the cap alone would allow', () => {
    // An over-strength squad — 60 Soldier where the cap is 40, which decision F
    // allows an event to produce — still has Pikeman headroom, so the per-type
    // cap would wave this through. The hex will not: 65 bodies × size 10 = 650,
    // plus the 40 reserved for characters, against a 600-point budget.
    const swollen = squad({ composition: { Soldier: 60 } })
    expect(canSquadAccept(swollen, 'Pikeman')).toBe(10) // the cap is happy
    const overBudget = plan({ squad: swollen, request: { Pikeman: 5 } })
    expect(overBudget.error).toMatch(/hex|room|budget/i)
    // …and the same squad at a size the hex can hold is fine.
    expect(plan({ squad: squad({ composition: { Soldier: 30 } }), request: { Pikeman: 5 } }).error)
      .toBeUndefined()
  })

  test('the character reserve is part of the budget, not spare room beside it', () => {
    const bodies = (SQUAD_TROOP_BUDGET - SQUAD_CHARACTER_RESERVE) / 10
    expect(squadSizePoints({ Soldier: bodies }, sizeOf)).toBe(SQUAD_TROOP_BUDGET - SQUAD_CHARACTER_RESERVE)
    expect(squadSizePoints({ Cavalry: 6, LightCavalry: 6 }, sizeOf)).toBe(240)
  })

  test('a type the catalog does not know THROWS — a data bug, not a 400', () => {
    expect(() =>
      planReinforcement({
        squad: squad({ composition: { Soldier: 30 } }),
        request: { Soldier: 1 },
        sizeOf: new Map(),
        loose: looseEnough,
        resources: richEnough,
      }),
    ).toThrow(/Soldier/)
  })

  test('the loose pool must actually hold the bodies being destroyed', () => {
    const result = plan({ loose: { Soldier: 2 } })
    expect(result.error).toMatch(/unassigned|loose/i)
  })

  test('the stores must cover the whole request, summed', () => {
    expect(plan({ resources: { gold: 4, materials: 1000 } }).error).toMatch(/gold/)
    expect(
      plan({
        squad: squad({ archetype: 'vanguard', composition: {} }),
        request: { Cavalry: 1 },
        resources: { gold: 100, materials: 100, horses: 0 },
      }).error,
    ).toMatch(/horses/)
  })

  test('an empty or malformed request is refused', () => {
    expect(plan({ request: {} }).error).toBeTruthy()
    expect(plan({ request: undefined }).error).toBeTruthy()
    expect(plan({ request: { Soldier: 0 } }).error).toBeTruthy()
    expect(plan({ request: { Soldier: -2 } }).error).toBeTruthy()
    expect(plan({ request: { Soldier: 1.5 } }).error).toBeTruthy()
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

  test('destroys the inputs, creates the outputs, charges the cost, stamps the day', () => {
    const campaign = campaignDoc()
    const target = campaign.squads[0]
    const plan = planReinforcement({
      squad: target,
      request: { Soldier: 5 },
      sizeOf,
      loose: looseRoster(campaign),
      resources: campaign.resources,
    })
    const log = applyReinforcement(campaign, target, plan)

    // 1:1 today: five loose bodies destroyed, five created inside the charter,
    // so the roster total is unchanged and only the LOOSE count moved.
    expect(campaign.roster.get('Soldier')).toBe(100)
    expect(target.composition.get('Soldier')).toBe(35)
    expect(looseRoster(campaign).Soldier).toBe(65)
    expect(campaign.resources.gold).toBe(100 - plan.cost.gold)
    expect(campaign.resources.materials).toBe(100 - plan.cost.materials)
    expect(target.reinforcedDay).toBe(campaign.day)
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
  test('the hex budget lets a drilled squad hold what it would otherwise refuse', () => {
    const composition = { Soldier: 55 }
    const request = { Pikeman: 5 }
    const args = { request, sizeOf, loose: looseEnough, resources: richEnough }
    // 60 bodies × 10 = 600, + 40 reserve = 640 > 600.
    expect(planReinforcement({ squad: squad({ composition }), ...args }).error).toMatch(/hex/i)
    // Drilled: 60 × 8 = 480, + 40 = 520, which fits.
    expect(planReinforcement({ squad: drilled({ composition }), ...args }).error).toBeUndefined()
  })

  // The price rides the ROW, not the ability (user, 2026-08-18): +1 gold per
  // BODY brought in, on top of whatever the recipe costs.
  test('the surcharge is added per body, on top of the recipe', () => {
    const composition = { Soldier: 30 }
    const args = { request: { Soldier: 5 }, sizeOf, loose: looseEnough, resources: richEnough }
    const plain = planReinforcement({ squad: squad({ composition }), ...args })
    const paid = planReinforcement({ squad: drilled({ composition }), ...args })
    expect(paid.cost.gold).toBe(plain.cost.gold + 5)
    // Only the resources the row names — the rest of the bill is untouched.
    expect(paid.cost.materials).toBe(plain.cost.materials)
  })

  test('a squad without the row pays exactly what it did before', () => {
    const composition = { Soldier: 30 }
    const args = { request: { Soldier: 5 }, sizeOf, loose: looseEnough, resources: richEnough }
    const before = planReinforcement({ squad: squad({ composition }), ...args })
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
    const result = planReinforcement({ squad: guard(), request: { RoyalGuard: 4 }, ...args })
    expect(result.error).toBeUndefined()
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
    const result = planReinforcement({ squad: guard(), request: { RoyalGuard: 2 }, ...args })
    expect(result.cost).toEqual({ gold: 10, materials: 8 })
  })

  // The whole point of Soldier LEAVING the charter: a guard squad cannot quietly
  // refill with the cheap bodies it used to hold.
  test('the converted charter refuses ordinary Soldiers outright', () => {
    const result = planReinforcement({ squad: guard(), request: { Soldier: 1 }, ...args })
    expect(result.error).toMatch(/does not take Soldier/)
  })

  test('the loose pool must hold the Soldiers the training destroys', () => {
    const result = planReinforcement({
      squad: guard(),
      request: { RoyalGuard: 3 },
      sizeOf,
      loose: { Soldier: 2 },
      resources: richEnough,
    })
    expect(result.error).toMatch(/only 2 unassigned Soldier/)
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
    const s = { ...guard(), composition: new Map([['RoyalGuard', 30]]) }
    const plan = planReinforcement({ squad: s, request: { RoyalGuard: 2 }, ...args })
    applyReinforcement(campaign, s, plan)
    expect(s.composition.get('RoyalGuard')).toBe(32)
    expect(campaign.roster.get('RoyalGuard')).toBe(32)
    expect(campaign.roster.get('Soldier')).toBe(8)
    expect(campaign.resources).toEqual({ gold: 90, materials: 92 })
  })
})
