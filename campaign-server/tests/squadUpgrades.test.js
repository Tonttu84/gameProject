import { describe, expect, test, beforeEach } from 'vitest'
import {
  findUpgrade,
  squadUpgrades,
  slotsFor,
  picksAvailable,
  hasBanner,
  eligibleUpgrades,
  drawUpgradeOffer,
  planUpgrade,
  applyUpgrade,
  capsBonus,
  intakeBonus,
  raidCostFactor,
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
  test('Seasoned grants no extra slot — it grants the banner instead', () => {
    expect(slotsFor(squad({ prestige: prestigeFor('Seasoned') }))).toBe(
      slotsFor(squad({ prestige: prestigeFor('Blooded') })),
    )
    expect(hasBanner(squad({ prestige: prestigeFor('Blooded') }))).toBe(false)
    expect(hasBanner(squad({ prestige: prestigeFor('Seasoned') }))).toBe(true)
  })

  test('the banner stays granted at every rank above Seasoned', () => {
    expect(hasBanner(squad({ prestige: prestigeFor('Renowned') }))).toBe(true)
    expect(hasBanner(squad({ prestige: prestigeFor('Legendary') }))).toBe(true)
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
    expect(hasBanner({})).toBe(false)
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

  // The draw never pads: there is no filler row, and inventing one would put a
  // choice in front of the player that the catalog does not contain.
  test('fewer eligible rows than the draw size means a shorter offer', () => {
    const all = SQUAD_UPGRADE_POOL.filter((r) => r.archetypes.includes('line')).map((r) => r.id)
    const nearlyDone = squad({ prestige: prestigeFor('Legendary'), upgrades: all.slice(0, -1) })
    const offer = drawUpgradeOffer(nearlyDone)
    expect(offer.options).toEqual(all.slice(-1))
  })

  test('nothing left to offer reads as no offer at all', () => {
    const all = SQUAD_UPGRADE_POOL.filter((r) => r.archetypes.includes('line')).map((r) => r.id)
    expect(drawUpgradeOffer(squad({ prestige: prestigeFor('Legendary'), upgrades: all }))).toBeNull()
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
    // No such row today (4d adds it); the unknown-id guard covers it either
    // way, so this asserts the refusal rather than the message.
    expect(planUpgrade(wrong, 'royal_guard').error).toBeDefined()
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
    const bonus = findUpgrade('deeper_ranks').effect.bonus
    const upgraded = squadCaps(squad({ upgrades: ['deeper_ranks'] }))
    expect(Object.keys(upgraded)).toEqual(Object.keys(SQUAD_ARCHETYPES.line.caps))
    for (const [type, cap] of Object.entries(SQUAD_ARCHETYPES.line.caps))
      expect(upgraded[type]).toBe(cap + bonus)
  })

  test('an intake row raises the pooled intake', () => {
    const bonus = findUpgrade('standing_drafts').effect.bonus
    expect(squadIntake(squad({ upgrades: ['standing_drafts'] }))).toBe(SQUAD_ARCHETYPES.line.intake + bonus)
  })

  test('a raid-cost row discounts, and never reaches free', () => {
    const factor = findUpgrade('light_baggage').effect.factor
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
  test('no archetype at full upgraded strength outgrows the budget', () => {
    const sizeOf = new Map(catalogFixture.units.map((u) => [u.name, u.size]))
    const capsRows = SQUAD_UPGRADE_POOL.filter((r) => r.effect.kind === 'caps')
    for (const [id, archetype] of Object.entries(SQUAD_ARCHETYPES)) {
      const bonus = capsRows
        .filter((r) => r.archetypes.includes(id))
        .reduce((sum, r) => sum + r.effect.bonus, 0)
      const points = Object.entries(archetype.caps).reduce((sum, [type, cap]) => {
        const size = sizeOf.get(type)
        expect(size, `${id} caps ${type}, which the catalog does not know`).toBeDefined()
        return sum + size * (cap + bonus)
      }, 0)
      expect(
        points + SQUAD_CHARACTER_RESERVE,
        `archetype ${id} with every caps upgrade does not fit SQUAD_TROOP_BUDGET`,
      ).toBeLessThanOrEqual(SQUAD_TROOP_BUDGET)
    }
  })

  test('the slot ladder names every rank, so no rung silently grants zero', () => {
    for (const { label } of SQUAD_RANKS)
      expect(SQUAD_UPGRADE_SLOTS_BY_RANK[label], `${label} has no slot count`).toBeDefined()
  })
})
