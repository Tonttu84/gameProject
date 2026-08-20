import { describe, expect, test, beforeEach } from 'vitest'
import {
  findUpgrade,
  squadUpgrades,
  slotsFor,
  slotsUsed,
  upgradeSlotCost,
  picksAvailable,
  eligibleUpgrades,
  drawUpgradeOffer,
  planUpgrade,
  applyUpgrade,
  capsBonus,
  intakeBonus,
  raidCostFactor,
  statMods,
  formationFighter,
  reinforceSurcharge,
  typeSwaps,
} from '../services/squadUpgrades.js'
import { squadCaps, squadIntake } from '../services/squadReinforce.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  SQUAD_ARCHETYPES,
  SQUAD_UPGRADE_POOL,
  SQUAD_UPGRADE_SLOTS_BY_RANK,
  SQUAD_UPGRADE_DRAW,
  SQUAD_RANKS,
  SQUAD_TROOP_BUDGET,
  SQUAD_CHARACTER_RESERVE,
} from '../utils/campaignConfig.js'
import { catalogFixture } from './fixtures/catalog.js'

// Squad upgrades — the squad overhaul's slice 4a (docs/CAMPAIGN_PLAN.md
// "SLICE 4 — THE UPGRADE CATALOG"). The pure layer: the slot ladder, the
// draft, the permanence rule and the three effect readers. Route wiring is
// covered in campaigns.test.js.

const squad = (overrides = {}) => ({
  id: 1,
  name: '1st Cohort',
  archetype: 'line',
  prestige: 0,
  composition: { Soldier: 20 },
  upgrades: [],
  ...overrides,
})

// The prestige that just reaches a rank word, read off the live ladder so a
// retune moves the tests with it rather than stranding hardcoded numbers.
const prestigeFor = (label) => SQUAD_RANKS.find((r) => r.label === label).min

// A row is a BUNDLE of effects (4c), so a test that wants one asks by kind
// rather than assuming a row carries exactly one thing.
const effectOf = (id, kind) => findUpgrade(id).effects.find((e) => e.kind === kind)
const allEffects = () => SQUAD_UPGRADE_POOL.flatMap((row) => row.effects)

beforeEach(clearRolls)

describe('the slot ladder', () => {
  test('slots come from the rank word, and Untested has none', () => {
    expect(slotsFor(squad({ prestige: 0 }))).toBe(0)
    expect(slotsFor(squad({ prestige: prestigeFor('Blooded') }))).toBe(1)
    expect(slotsFor(squad({ prestige: prestigeFor('Renowned') }))).toBe(2)
    expect(slotsFor(squad({ prestige: prestigeFor('Legendary') }))).toBe(3)
  })

  // The interview's shape: Seasoned pays for the BANNER, not a pick, so it is
  // the one rung that grants no extra slot. A later reader "fixing" this to
  // 0/1/2/3/4 would silently hand out a fourth upgrade.
  // The banner half of this rung moved to tests/items.test.js in slice 6, with
  // hasBanner itself. What stays here is the slot arithmetic it is easy to
  // "fix" wrongly: a later reader renumbering the ladder to 0/1/2/3/4 would
  // silently hand out a fourth upgrade.
  test('Seasoned grants no extra slot — it grants the banner instead', () => {
    expect(slotsFor(squad({ prestige: prestigeFor('Seasoned') }))).toBe(
      slotsFor(squad({ prestige: prestigeFor('Blooded') })),
    )
  })

  test('picks are slots minus what is already held, never negative', () => {
    const legendary = prestigeFor('Legendary')
    expect(picksAvailable(squad({ prestige: legendary }))).toBe(3)
    expect(picksAvailable(squad({ prestige: legendary, upgrades: ['deeper_ranks'] }))).toBe(2)
    // More held than the rank allows — only reachable by retuning the ladder
    // under a live campaign. The squad is full, not owed a negative pick.
    expect(picksAvailable(squad({ prestige: 0, upgrades: ['deeper_ranks'] }))).toBe(0)
  })

  test('a charter written before the field existed reads as empty, not broken', () => {
    expect(slotsFor({})).toBe(0)
    expect(picksAvailable({})).toBe(0)
    expect(squadUpgrades({})).toEqual([])
  })
})

describe('eligibility', () => {
  test('a row is drawable only by the archetypes it names', () => {
    for (const row of SQUAD_UPGRADE_POOL)
      for (const id of Object.keys(SQUAD_ARCHETYPES)) {
        const eligible = eligibleUpgrades(squad({ archetype: id })).map((r) => r.id)
        expect(eligible.includes(row.id)).toBe(row.archetypes.includes(id))
      }
  })

  test('a squad with no archetype is eligible for nothing', () => {
    expect(eligibleUpgrades(squad({ archetype: undefined }))).toEqual([])
  })

  test('what is already held is never eligible again', () => {
    const held = SQUAD_UPGRADE_POOL[0].id
    expect(eligibleUpgrades(squad({ upgrades: [held] })).map((r) => r.id)).not.toContain(held)
  })
})

describe('the draft', () => {
  const blooded = () => squad({ prestige: prestigeFor('Blooded') })

  test('no offer without a free slot', () => {
    expect(drawUpgradeOffer(squad({ prestige: 0 }))).toBeNull()
  })

  test('an offer is drawn from the eligible rows and stamped with the rank', () => {
    const offer = drawUpgradeOffer(blooded())
    expect(offer.rank).toBe('Blooded')
    const eligible = eligibleUpgrades(blooded()).map((r) => r.id)
    for (const id of offer.options) expect(eligible).toContain(id)
  })

  test('the draw offers SQUAD_UPGRADE_DRAW rows, without duplicates', () => {
    const offer = drawUpgradeOffer(blooded())
    const eligible = eligibleUpgrades(blooded())
    expect(offer.options).toHaveLength(Math.min(SQUAD_UPGRADE_DRAW, eligible.length))
    expect(new Set(offer.options).size).toBe(offer.options.length)
  })

  // The draw never pads and never repeats: a held row is gone from every later
  // offer, and the draw shrinks to what is left rather than inventing filler.
  //
  // Since 4b widened the pool, a squad can no longer EXHAUST it through play —
  // the ladder grants 3 slots against 6-7 eligible rows per archetype — so the
  // shorter-offer branch is now defensive, for an archetype that ships with
  // fewer than SQUAD_UPGRADE_DRAW rows. What is still reachable, and what this
  // asserts, is that the remaining draw is drawn from the remainder.
  test('a held row never reappears, and the draw shrinks to what is left', () => {
    const lineRows = SQUAD_UPGRADE_POOL.filter((r) => r.archetypes.includes('line')).map((r) => r.id)
    const held = lineRows.slice(0, 2)
    const partway = squad({ prestige: prestigeFor('Legendary'), upgrades: held })
    const offer = drawUpgradeOffer(partway)
    const remaining = lineRows.filter((id) => !held.includes(id))
    expect(offer.options).toHaveLength(Math.min(SQUAD_UPGRADE_DRAW, remaining.length))
    for (const id of offer.options) {
      expect(remaining).toContain(id)
      expect(held).not.toContain(id)
    }
  })

  test('a squad with every slot filled is offered nothing', () => {
    const lineRows = SQUAD_UPGRADE_POOL.filter((r) => r.archetypes.includes('line')).map((r) => r.id)
    const slots = SQUAD_UPGRADE_SLOTS_BY_RANK.Legendary
    const full = squad({ prestige: prestigeFor('Legendary'), upgrades: lineRows.slice(0, slots) })
    expect(picksAvailable(full)).toBe(0)
    expect(drawUpgradeOffer(full)).toBeNull()
  })

  // The dice queue makes the "random" draw deterministic, so this pins WHICH
  // row a given roll picks — the splice-by-index idiom recruit.js uses.
  test('the roll picks the row at that index', () => {
    const eligible = eligibleUpgrades(blooded())
    pushRoll(0)
    pushRoll(0)
    pushRoll(0)
    const offer = drawUpgradeOffer(blooded())
    expect(offer.options[0]).toBe(eligible[0].id)
    expect(offer.options[1]).toBe(eligible[1].id)
  })
})

describe('taking one', () => {
  const offered = (options, overrides = {}) =>
    squad({ prestige: prestigeFor('Blooded'), upgradeOffer: { rank: 'Blooded', options }, ...overrides })

  test('a row from the offer is taken, and the offer is consumed', () => {
    const s = offered(['deeper_ranks', 'standing_drafts'])
    const plan = planUpgrade(s, 'deeper_ranks')
    expect(plan.error).toBeUndefined()
    const entries = applyUpgrade({ day: 3 }, s, plan)
    expect([...s.upgrades]).toEqual(['deeper_ranks'])
    expect(s.upgradeOffer).toBeUndefined()
    expect(entries[0]).toContain('Deeper Ranks')
  })

  test('a row that was not offered is refused', () => {
    expect(planUpgrade(offered(['standing_drafts']), 'deeper_ranks').error).toMatch(/not one of the upgrades on offer/)
  })

  test('an unknown id is refused rather than throwing', () => {
    expect(planUpgrade(offered(['deeper_ranks']), 'no_such_row').error).toBeDefined()
    expect(planUpgrade(offered(['deeper_ranks']), undefined).error).toBeDefined()
  })

  test('with no offer standing there is nothing to take', () => {
    expect(planUpgrade(squad({ prestige: prestigeFor('Blooded') }), 'deeper_ranks').error)
      .toMatch(/no upgrades on offer/)
  })

  test('a full squad cannot take another, even holding an offer', () => {
    const full = offered(['standing_drafts'], { upgrades: ['deeper_ranks'] })
    expect(planUpgrade(full, 'standing_drafts').error).toMatch(/no upgrade slot free/)
  })

  // Replaying a request against a stale offer must not stack the same row
  // twice — permanence means one of each, forever.
  test('a row already held cannot be taken a second time', () => {
    const stale = squad({
      prestige: prestigeFor('Renowned'),
      upgrades: ['deeper_ranks'],
      upgradeOffer: { rank: 'Blooded', options: ['deeper_ranks'] },
    })
    expect(planUpgrade(stale, 'deeper_ranks').error).toMatch(/already has/)
  })

  test('a row outside the squad archetype is refused even if offered', () => {
    const wrong = squad({
      archetype: 'vanguard',
      prestige: prestigeFor('Blooded'),
      upgradeOffer: { rank: 'Blooded', options: ['royal_guard'] },
    })
    // royal_guard is a LINE row (4d), so a vanguard charter holding a forged
    // offer is refused by the archetype fence rather than by the id lookup.
    expect(planUpgrade(wrong, 'royal_guard').error).toMatch(/cannot train for/)
  })
})

describe('what the upgrades do', () => {
  test('no upgrades means no change at all', () => {
    const plain = squad()
    expect(capsBonus(plain)).toBe(0)
    expect(intakeBonus(plain)).toBe(0)
    expect(raidCostFactor(plain)).toBe(1)
    expect(squadCaps(plain)).toEqual(SQUAD_ARCHETYPES.line.caps)
    expect(squadIntake(plain)).toBe(SQUAD_ARCHETYPES.line.intake)
  })

  test('a caps row raises every type the archetype names, and admits no new one', () => {
    const bonus = effectOf('deeper_ranks', 'caps').bonus
    const upgraded = squadCaps(squad({ upgrades: ['deeper_ranks'] }))
    expect(Object.keys(upgraded)).toEqual(Object.keys(SQUAD_ARCHETYPES.line.caps))
    for (const [type, cap] of Object.entries(SQUAD_ARCHETYPES.line.caps))
      expect(upgraded[type]).toBe(cap + bonus)
  })

  test('an intake row raises the pooled intake', () => {
    const bonus = effectOf('standing_drafts', 'intake').bonus
    expect(squadIntake(squad({ upgrades: ['standing_drafts'] }))).toBe(SQUAD_ARCHETYPES.line.intake + bonus)
  })

  test('a raid-cost row discounts, and never reaches free', () => {
    const factor = effectOf('light_baggage', 'raidCost').factor
    expect(raidCostFactor(squad({ upgrades: ['light_baggage'] }))).toBeCloseTo(factor)
    expect(raidCostFactor(squad({ upgrades: ['light_baggage'] }))).toBeGreaterThan(0)
  })

  // A charter with no archetype has nothing to reinforce INTO, so no upgrade
  // may lift it off the floor.
  test('upgrades cannot give an archetype-less charter caps or intake', () => {
    const orphan = squad({ archetype: undefined, upgrades: ['deeper_ranks', 'standing_drafts'] })
    expect(squadCaps(orphan)).toEqual({})
    expect(squadIntake(orphan)).toBe(0)
  })

  // 4b: the engine-side rows. These become the `squad_mods` object on each
  // placement entry, so the stat NAMES have to be the engine's own.
  test('a stat row becomes a flat modifier under the engine’s stat name', () => {
    expect(statMods(squad({ upgrades: ['honed_edge'] }))).toEqual({ attack: 1 })
    expect(statMods(squad({ upgrades: ['heavier_kit'] }))).toEqual({ armour: 1 })
    expect(statMods(squad({ archetype: 'skirmish', upgrades: ['marksmans_eye'] })))
      .toEqual({ ballisticSkill: 1 })
    expect(statMods(squad({ archetype: 'vanguard', upgrades: ['fresh_remounts'] })))
      .toEqual({ speed: 1 })
  })

  test('a squad with no stat rows sends no modifiers at all', () => {
    // An empty object is what the callers use to leave `squad_mods` off the
    // placement entry entirely, so an unupgraded army's JSON is unchanged.
    expect(statMods(squad())).toEqual({})
    expect(statMods(squad({ upgrades: ['deeper_ranks'] }))).toEqual({})
  })

  test('stat rows stack per stat rather than overwriting', () => {
    const both = squad({ upgrades: ['honed_edge', 'heavier_kit'] })
    expect(statMods(both)).toEqual({ attack: 1, armour: 1 })
  })

  // The engine only knows attack/armour/speed/ballisticSkill; a name outside
  // that set is inert at the far end, so a typo would cost a dead upgrade.
  // This pins every shipped row to a name the engine actually handles.
  test('every stat row names a stat the engine can apply', () => {
    const ENGINE_STATS = new Set(['attack', 'armour', 'speed', 'ballisticSkill'])
    for (const e of allEffects().filter((x) => x.kind === 'stat'))
      expect(ENGINE_STATS, `a stat row names ${e.stat}`).toContain(e.stat)
  })

  test('an id whose row has left the catalog is inert, not fatal', () => {
    const stale = squad({ upgrades: ['a_row_that_was_deleted'] })
    expect(squadUpgrades(stale)).toEqual([])
    expect(capsBonus(stale)).toBe(0)
    expect(squadCaps(stale)).toEqual(SQUAD_ARCHETYPES.line.caps)
  })
})

// THE fence the slice-4 spec names: a caps row must never promise a squad more
// bodies than its hex can hold. engine.integration.test.js runs the same check
// against the REAL engine catalog; this one runs on the fixture so it fails
// fast in the pure suite too.
describe('the hex budget survives the catalog', () => {
  // Priced through the REAL reader with every row the archetype may draw taken
  // at once, so a row that changes WHICH types a squad fields is measured too
  // (4d's type swap, whose RoyalGuard could have been a bigger body than the
  // Soldier it replaces). Summing every eligible row is deliberately the worst
  // case: the slot ladder makes some of these combinations unreachable, and a
  // fence that only checked reachable ones would have to be re-derived every
  // time the ladder moves.
  test('no archetype at full upgraded strength outgrows the budget', () => {
    const sizeOf = new Map(catalogFixture.units.map((u) => [u.name, u.size]))
    for (const id of Object.keys(SQUAD_ARCHETYPES)) {
      const everyRow = SQUAD_UPGRADE_POOL.filter((r) => r.archetypes.includes(id)).map((r) => r.id)
      const caps = squadCaps(squad({ archetype: id, upgrades: everyRow }))
      const points = Object.entries(caps).reduce((sum, [type, cap]) => {
        const size = sizeOf.get(type)
        expect(size, `${id} caps ${type}, which the catalog does not know`).toBeDefined()
        return sum + size * cap
      }, 0)
      expect(
        points + SQUAD_CHARACTER_RESERVE,
        `archetype ${id} with every upgrade does not fit SQUAD_TROOP_BUDGET`,
      ).toBeLessThanOrEqual(SQUAD_TROOP_BUDGET)
    }
  })

  test('the slot ladder names every rank, so no rung silently grants zero', () => {
    for (const { label } of SQUAD_RANKS)
      expect(SQUAD_UPGRADE_SLOTS_BY_RANK[label], `${label} has no slot count`).toBeDefined()
  })
})

// ── Formation Fighters — the first BUNDLED row (slice 4c) ────────────────────
//
// Two effects on one pick: the ability, and the price the CHOICE carries. The
// point of the bundle is that the two are independent — a later row could grant
// the same ability at another price, or none — so these pin that the readers
// stay separate and that one pick really does reach both.
describe('a row that does two things at once', () => {
  const drilled = squad({ upgrades: ['formation_fighters'] })

  test('one pick grants the ability AND raises the price', () => {
    expect(formationFighter(drilled)).toBe(2)
    expect(reinforceSurcharge(drilled)).toEqual({ gold: 1 })
  })

  test('a squad without the row has neither', () => {
    expect(formationFighter(squad())).toBe(0)
    expect(reinforceSurcharge(squad())).toEqual({})
    expect(reinforceSurcharge(squad({ upgrades: ['honed_edge'] }))).toEqual({})
  })

  // formationFighter is an ENGINE stat, so it rides the same squad_mods
  // transport as the 4b rows rather than getting a private channel — one thing
  // to attach at each battle route instead of two.
  test('the ability reaches the engine through squad_mods', () => {
    expect(statMods(drilled)).toEqual({ formationFighter: 2 })
    expect(statMods(squad({ upgrades: ['formation_fighters', 'honed_edge'] })))
      .toEqual({ formationFighter: 2, attack: 1 })
  })

  // The value is 2 rather than 1 for a reason the engine settles: an Open hex
  // side seats 40 size-points and the fit is STRICT, so four size-10 soldiers
  // fill it exactly and a packing size of 9 still seats only four (45 > 40).
  // test_engagements.cpp pins all three cases; this pins the number that makes
  // the campaign row worth taking.
  test('the value clears the frontage step it is sold on', () => {
    const SOLDIER_SIZE = 10
    const OPEN_FRONTAGE = 40
    const packed = SOLDIER_SIZE - effectOf('formation_fighters', 'formationFighter').value
    expect(Math.floor(OPEN_FRONTAGE / packed)).toBe(5)
    expect(Math.floor(OPEN_FRONTAGE / SOLDIER_SIZE)).toBe(4)
  })

  // LINE ONLY, and deliberately: a vanguard body packs 20 → 18 and still seats
  // two per side, so the row would spend one of a campaign's three permanent
  // picks on almost nothing.
  test('only a line charter may draw it', () => {
    expect(findUpgrade('formation_fighters').archetypes).toEqual(['line'])
    const vanguard = squad({ archetype: 'vanguard', prestige: prestigeFor('Blooded') })
    expect(eligibleUpgrades(vanguard).map((r) => r.id)).not.toContain('formation_fighters')
  })
})

// Every row in the catalog carries a LIST of effects, not one. A row that
// slipped back to the old singular shape would read as inert in every reader
// rather than failing loudly, so this is the check that keeps the bundle shape.
describe('the catalog shape', () => {
  test('every row carries a non-empty effects list, and no bare effect', () => {
    for (const row of SQUAD_UPGRADE_POOL) {
      expect(Array.isArray(row.effects), `${row.id} has an effects list`).toBe(true)
      expect(row.effects.length, `${row.id} does something`).toBeGreaterThan(0)
      expect(row.effect, `${row.id} does not carry a stale singular effect`).toBeUndefined()
      for (const e of row.effects) expect(typeof e.kind).toBe('string')
    }
  })
})

// ── A row that costs TWO slots (slice 4d) ────────────────────────────────────
//
// The Royal Guard is a whole new unit type rather than "+1 to one stat", so the
// user priced it at two of a campaign's three picks — one paid now, one BORROWED
// from the next rung. Waiting for two FREE slots at once would make the row
// unreachable for ever: trace the cumulative ladder (Blooded 1 · Seasoned banner
// · Renowned 2 · Legendary 3) and a squad never holds two free slots at any rung.
//
// So the whole rule is: a squad needs a pick in hand AND enough of its LADDER
// still unspent to cover the row. Both of the user's requirements fall out of
// that one line, which is why there is no stored `skipNextDraft` flag — derived
// state cannot drift out of step with a retuned ladder.
describe('a row that costs two slots', () => {
  const MAX_SLOTS = Math.max(...Object.values(SQUAD_UPGRADE_SLOTS_BY_RANK))

  test('a row costs one slot unless it says otherwise', () => {
    expect(upgradeSlotCost(findUpgrade('deeper_ranks'))).toBe(1)
    expect(upgradeSlotCost(findUpgrade('royal_guard'))).toBe(2)
    expect(findUpgrade('royal_guard').slots).toBe(2)
  })

  test('slots used is summed over the cost of what is held, not counted', () => {
    expect(slotsUsed(squad({ upgrades: [] }))).toBe(0)
    expect(slotsUsed(squad({ upgrades: ['deeper_ranks'] }))).toBe(1)
    expect(slotsUsed(squad({ upgrades: ['royal_guard'] }))).toBe(2)
    expect(slotsUsed(squad({ upgrades: ['royal_guard', 'deeper_ranks'] }))).toBe(3)
  })

  // Summed over the ID LIST rather than over resolved rows: a row that has left
  // the catalog still costs the slot it was taken with, so a catalog edit cannot
  // refund a pick into a campaign already in flight.
  test('an id whose row has left the catalog still costs its slot', () => {
    expect(slotsUsed(squad({ upgrades: ['a_row_that_was_deleted'] }))).toBe(1)
    expect(picksAvailable(squad({ prestige: prestigeFor('Blooded'), upgrades: ['a_row_that_was_deleted'] })))
      .toBe(0)
  })

  test('holding the guard spends two of the rank’s slots', () => {
    expect(picksAvailable(squad({ prestige: prestigeFor('Renowned'), upgrades: ['royal_guard'] }))).toBe(0)
    expect(picksAvailable(squad({ prestige: prestigeFor('Legendary'), upgrades: ['royal_guard'] }))).toBe(1)
  })

  // The fence is on the LADDER, not on free slots now: at Blooded a squad has
  // one slot in hand and books the second against Renowned.
  test('it is offered at Blooded, where only one slot is actually free', () => {
    expect(eligibleUpgrades(squad({ prestige: prestigeFor('Blooded') })).map((r) => r.id))
      .toContain('royal_guard')
  })

  // "It skips the next upgrade": take it at Blooded and Renowned deals nothing;
  // take it at Renowned and Legendary is silent.
  test('taking it consumes the next rung’s draft too', () => {
    const atRenowned = squad({ prestige: prestigeFor('Renowned'), upgrades: ['royal_guard'] })
    expect(drawUpgradeOffer(atRenowned)).toBeNull()
    const atLegendary = squad({ prestige: prestigeFor('Legendary'), upgrades: ['royal_guard', 'deeper_ranks'] })
    expect(drawUpgradeOffer(atLegendary)).toBeNull()
  })

  // And the same rule gives "never offered on the last pick" for free: at
  // Legendary with two slots already spent there is no future rung left to
  // borrow the second from.
  test('it is never offered on the last pick, with no rule of its own', () => {
    const lastPick = squad({
      prestige: prestigeFor('Legendary'),
      upgrades: ['deeper_ranks', 'standing_drafts'],
    })
    expect(picksAvailable(lastPick)).toBe(1)
    expect(eligibleUpgrades(lastPick).map((r) => r.id)).not.toContain('royal_guard')
    // A one-slot row is still perfectly drawable on that last pick.
    expect(eligibleUpgrades(lastPick).length).toBeGreaterThan(0)
  })

  // The ceiling is DERIVED from the ladder rather than written as 3, so
  // retuning SQUAD_UPGRADE_SLOTS_BY_RANK cannot strand the rule.
  test('the ceiling is the ladder’s top rung, not a literal', () => {
    expect(MAX_SLOTS).toBe(SQUAD_UPGRADE_SLOTS_BY_RANK.Legendary)
    // Every row must be affordable within a whole campaign's ladder, or it is
    // an unreachable entry in the catalog.
    for (const row of SQUAD_UPGRADE_POOL)
      expect(upgradeSlotCost(row), `${row.id} costs more slots than a campaign grants`)
        .toBeLessThanOrEqual(MAX_SLOTS)
  })

  // A replayed request against a stale offer must not slip past the fence the
  // draw applied — planUpgrade re-checks it rather than trusting the offer.
  test('a stale offer cannot smuggle it past the ladder', () => {
    const lastPick = squad({
      prestige: prestigeFor('Legendary'),
      upgrades: ['deeper_ranks', 'standing_drafts'],
      upgradeOffer: { rank: 'Legendary', options: ['royal_guard'] },
    })
    expect(planUpgrade(lastPick, 'royal_guard').error).toMatch(/costs 2 honours/)
  })
})

// ── The Royal Guard: the first row that changes WHAT a squad is (slice 4d) ───
//
// The pick CONVERTS the squad wholesale and free: the charter's Soldier cap
// becomes a RoyalGuard cap — Soldier LEAVES the charter entirely — and every
// Soldier body already in the ranks becomes a Royal Guard at pick time. Soldier
// leaving is load-bearing rather than tidiness: it is what makes the dearer
// replacement recipe unavoidable, and so what makes "the ongoing cost is
// reinforcement" true here. Restoring Soldier to the guard charter hollows the
// whole row out.
describe('the Royal Guard converts the squad', () => {
  const guard = (overrides = {}) => squad({ upgrades: ['royal_guard'], ...overrides })

  test('only a line charter may draw it', () => {
    expect(findUpgrade('royal_guard').archetypes).toEqual(['line'])
    // Structurally forced, not a preference: the row swaps a Soldier cap, and
    // neither skirmish nor vanguard has one to swap.
    for (const [id, archetype] of Object.entries(SQUAD_ARCHETYPES))
      if (id !== 'line') expect(Object.keys(archetype.caps)).not.toContain('Soldier')
  })

  test('the charter swaps Soldier for RoyalGuard, and leaves the rest alone', () => {
    const caps = squadCaps(guard())
    expect(caps.RoyalGuard).toBe(SQUAD_ARCHETYPES.line.caps.Soldier)
    expect(caps.Soldier).toBeUndefined()
    expect(caps.Pikeman).toBe(SQUAD_ARCHETYPES.line.caps.Pikeman)
  })

  test('the swap reads as a plain from→to map', () => {
    expect(typeSwaps(guard())).toEqual({ Soldier: 'RoyalGuard' })
    expect(typeSwaps(squad())).toEqual({})
  })

  // ORDER IS LOAD-BEARING: the swap applies BEFORE capsBonus, so a caps row
  // raises the RoyalGuard cap and not a Soldier cap that no longer exists.
  test('a caps row raises the guard cap, not the cap it replaced', () => {
    const bonus = effectOf('deeper_ranks', 'caps').bonus
    const caps = squadCaps(guard({ upgrades: ['royal_guard', 'deeper_ranks'] }))
    expect(caps.RoyalGuard).toBe(SQUAD_ARCHETYPES.line.caps.Soldier + bonus)
    expect(caps.Soldier).toBeUndefined()
  })

  test('the pick carries no reinforcement surcharge — the recipe is the price', () => {
    // Unlike Formation Fighters, the dearer RECIPE is where this row is paid
    // for; a surcharge on top would charge the same trade twice.
    expect(reinforceSurcharge(guard())).toEqual({})
    expect(statMods(guard())).toEqual({})
  })

  test('taking it converts every Soldier body, free, on both sides of the ledger', () => {
    const s = squad({
      prestige: prestigeFor('Blooded'),
      composition: { Soldier: 38, Pikeman: 9 },
      upgradeOffer: { rank: 'Blooded', options: ['royal_guard'] },
    })
    const campaign = { day: 4, roster: { Soldier: 50, Pikeman: 12, Archer: 20 } }
    const plan = planUpgrade(s, 'royal_guard')
    expect(plan.error).toBeUndefined()
    const entries = applyUpgrade(campaign, s, plan)

    // The squad: every Soldier is now a guard, and the rest is untouched.
    expect(s.composition.RoyalGuard).toBe(38)
    expect(s.composition.Soldier ?? 0).toBe(0)
    expect(s.composition.Pikeman).toBe(9)
    // The roster moves with it — the standing invariant is that a squad's
    // composition is always a subset already reflected in the roster, so
    // converting one side alone would send looseRoster negative.
    expect(campaign.roster.RoyalGuard).toBe(38)
    expect(campaign.roster.Soldier).toBe(12)
    expect(campaign.roster.Archer).toBe(20)
    expect(entries.join(' ')).toContain('38')
  })

  test('a wiped charter still swaps, with no bodies to carry over', () => {
    const s = squad({
      prestige: prestigeFor('Blooded'),
      composition: {},
      upgradeOffer: { rank: 'Blooded', options: ['royal_guard'] },
    })
    const campaign = { day: 4, roster: { Soldier: 5 } }
    applyUpgrade(campaign, s, planUpgrade(s, 'royal_guard'))
    expect([...s.upgrades]).toEqual(['royal_guard'])
    expect(campaign.roster.Soldier).toBe(5)
    expect(squadCaps(s).RoyalGuard).toBe(SQUAD_ARCHETYPES.line.caps.Soldier)
  })

  // The DB hands these in as mongoose Maps and the pure tests as plain objects;
  // one writer covers both, as everywhere else in this layer.
  test('the conversion writes Maps as readily as plain objects', () => {
    const s = squad({
      prestige: prestigeFor('Blooded'),
      composition: new Map([['Soldier', 6]]),
      upgradeOffer: { rank: 'Blooded', options: ['royal_guard'] },
    })
    const campaign = { day: 1, roster: new Map([['Soldier', 6]]) }
    applyUpgrade(campaign, s, planUpgrade(s, 'royal_guard'))
    expect(s.composition.get('RoyalGuard')).toBe(6)
    expect(s.composition.get('Soldier') ?? 0).toBe(0)
    expect(campaign.roster.get('RoyalGuard')).toBe(6)
    expect(campaign.roster.get('Soldier')).toBe(0)
  })

  // The hex is untouched by design (4d-6): a guard is the same size as the
  // soldier he replaces, so a converted squad measures exactly what it did.
  test('conversion does not change what the squad occupies', () => {
    const sizeOf = new Map(catalogFixture.units.map((u) => [u.name, u.size]))
    expect(sizeOf.get('RoyalGuard')).toBe(sizeOf.get('Soldier'))
  })
})
