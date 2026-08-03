// Recruit phase, Stage 1 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
// pure pool/eligibility/affordability/Fervor-roll/hire-resolution logic, with
// no route/day-resolution wiring yet (that's Stage 2). Pins the mechanic the
// design session locked down: a tiered troop lane (Militia -> Soldier/Archer
// -> Cavalry/LightCavalry, gated on owning the previous tier) and a gold-only
// caster lane (Mage/Priest), a Fervor stat that's a straight 1:1 percent
// chance of a boosted offer, and the two different meanings of "boosted"
// (double-count-if-affordable-else-discount for troops; bonus-second-hire-
// if-affordable-else-discount for casters).
import { describe, test, expect, afterEach } from 'vitest'
import {
  RECRUIT_POOL,
  FALLBACK_HIRE,
  findRecruitEntry,
  eligiblePool,
  affordablePool,
  canAfford,
  rollBoost,
  resolveHire,
  applyHire,
  pickDailyOptions,
  drawRecruitOffer,
  recruitCtx,
} from '../services/recruit.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { FREE_MILITIA_AMOUNT, RECRUIT_BOOST_DISCOUNT, RECRUITING_FERVOR_START } from '../utils/campaignConfig.js'

afterEach(clearRolls)

const poolEntry = (id) => RECRUIT_POOL.find((e) => e.id === id)

describe('RECRUIT_POOL shape', () => {
  test('every entry has a unit, lane, positive count, and a cost', () => {
    for (const e of RECRUIT_POOL) {
      expect(e.unit).toBeTruthy()
      expect(['troop', 'caster']).toContain(e.lane)
      expect(e.count).toBeGreaterThan(0)
      expect(e.cost).toBeTruthy()
    }
  })

  test('the troop tier chain gates on owning the previous tier', () => {
    expect(poolEntry('militia').requires).toBeUndefined()
    expect(poolEntry('soldier').requires).toEqual({ hasUnit: 'Militia' })
    expect(poolEntry('archer').requires).toEqual({ hasUnit: 'Militia' })
    expect(poolEntry('cavalry').requires).toEqual({ hasUnit: 'Soldier' })
    expect(poolEntry('light_cavalry').requires).toEqual({ hasUnit: 'Soldier' })
  })

  test('caster-lane entries cost only gold; troop-lane entries never cost gold', () => {
    for (const e of RECRUIT_POOL) {
      if (e.lane === 'caster') {
        expect(e.cost.gold).toBeGreaterThan(0)
        expect(e.cost.food ?? 0).toBe(0)
        expect(e.cost.materials ?? 0).toBe(0)
        expect(e.cost.workers ?? 0).toBe(0)
      } else {
        expect(e.cost.gold ?? 0).toBe(0)
      }
    }
  })

  test('only Cavalry/LightCavalry cost horses', () => {
    for (const e of RECRUIT_POOL) {
      const shouldCostHorses = e.id === 'cavalry' || e.id === 'light_cavalry'
      expect(!!e.cost.horses).toBe(shouldCostHorses)
    }
  })
})

describe('eligiblePool', () => {
  test('Militia and the whole caster lane are eligible with an empty roster; the tiered troops are not', () => {
    const ids = eligiblePool({ roster: new Map() }).map((e) => e.id)
    expect(ids).toEqual(expect.arrayContaining(['militia', 'mage', 'priest']))
    expect(ids).not.toContain('soldier')
    expect(ids).not.toContain('archer')
    expect(ids).not.toContain('cavalry')
    expect(ids).not.toContain('light_cavalry')
  })

  test('owning Militia unlocks Soldier/Archer but not Cavalry', () => {
    const ids = eligiblePool({ roster: new Map([['Militia', 1]]) }).map((e) => e.id)
    expect(ids).toContain('soldier')
    expect(ids).toContain('archer')
    expect(ids).not.toContain('cavalry')
    expect(ids).not.toContain('light_cavalry')
  })

  test('owning Soldier unlocks Cavalry/LightCavalry', () => {
    const ids = eligiblePool({ roster: new Map([['Soldier', 1]]) }).map((e) => e.id)
    expect(ids).toContain('cavalry')
    expect(ids).toContain('light_cavalry')
  })
})

describe('canAfford / affordablePool', () => {
  test('affordable when every cost key the entry has is covered', () => {
    const militia = poolEntry('militia')
    expect(canAfford(militia.cost, { food: 1000, materials: 1000 }, 1000)).toBe(true)
  })

  test('unaffordable if food, materials, workers, gold, or horses individually falls short', () => {
    const militia = poolEntry('militia')
    expect(canAfford(militia.cost, { food: 0, materials: 1000 }, 1000)).toBe(false)
    expect(canAfford(militia.cost, { food: 1000, materials: 0 }, 1000)).toBe(false)
    expect(canAfford(militia.cost, { food: 1000, materials: 1000 }, 0)).toBe(false)

    const mage = poolEntry('mage')
    expect(canAfford(mage.cost, { gold: 0 }, 0)).toBe(false)
    expect(canAfford(mage.cost, { gold: mage.cost.gold }, 0)).toBe(true)

    const cavalry = poolEntry('cavalry')
    expect(canAfford(cavalry.cost, { food: 1000, materials: 1000, horses: 0 }, 1000)).toBe(false)
  })

  test('affordablePool filters out entries that are eligible but not affordable', () => {
    // Owns Militia (unlocks Soldier) but can only pay for Militia's own cost.
    const ctx = {
      roster: new Map([['Militia', 1]]),
      resources: { food: 40, materials: 20, gold: 0, horses: 0 },
      workersFree: 20,
    }
    const ids = affordablePool(ctx).map((e) => e.id)
    expect(ids).toContain('militia')
    expect(ids).not.toContain('soldier')
  })
})

describe('rollBoost — Recruiting Fervor is 1:1 with percent chance', () => {
  test('fervor <= 0 never boosts, regardless of the roll', () => {
    pushRoll(1)
    expect(rollBoost(0)).toBe(false)
    pushRoll(1)
    expect(rollBoost(-50)).toBe(false)
  })

  test('fervor 25 boosts on a roll <= 250 out of 1000, and not just above it', () => {
    pushRoll(250)
    expect(rollBoost(25)).toBe(true)
    pushRoll(251)
    expect(rollBoost(25)).toBe(false)
  })

  test('fervor >= 100 always boosts — the percent chance clamps at 100, the stored value does not', () => {
    pushRoll(1000)
    expect(rollBoost(150)).toBe(true)
  })
})

describe('resolveHire — troop lane', () => {
  const ctx = { resources: { food: 1000, materials: 1000, gold: 0, horses: 0 }, workersFree: 1000 }

  test('not boosted: normal count at normal cost', () => {
    const militia = poolEntry('militia')
    expect(resolveHire(militia, false, ctx)).toEqual({
      count: militia.count,
      cost: militia.cost,
      secondUnit: null,
    })
  })

  test('boosted and the doubled cost is affordable: double count at double cost', () => {
    const militia = poolEntry('militia')
    const r = resolveHire(militia, true, ctx)
    expect(r.count).toBe(militia.count * 2)
    expect(r.cost).toEqual({
      food: militia.cost.food * 2,
      materials: militia.cost.materials * 2,
      workers: militia.cost.workers * 2,
    })
    expect(r.secondUnit).toBeNull()
  })

  test('boosted but the doubled cost is NOT affordable: normal count at a discount', () => {
    const militia = poolEntry('militia')
    // Affords the single hire but not the doubled one.
    const tight = { resources: { food: militia.cost.food + 5, materials: 1000, gold: 0, horses: 0 }, workersFree: 1000 }
    const r = resolveHire(militia, true, tight)
    expect(r.count).toBe(militia.count)
    expect(r.cost.food).toBe(Math.round(militia.cost.food * (1 - RECRUIT_BOOST_DISCOUNT)))
    expect(r.secondUnit).toBeNull()
  })
})

describe('resolveHire — caster lane', () => {
  test('boosted and the other caster is affordable too: bonus second hire, combined cost', () => {
    const mage = poolEntry('mage')
    const priest = poolEntry('priest')
    const ctx = { resources: { gold: mage.cost.gold + priest.cost.gold }, workersFree: 0 }
    const r = resolveHire(mage, true, ctx)
    expect(r.count).toBe(1)
    expect(r.secondUnit).toBe('Priest')
    expect(r.cost.gold).toBe(mage.cost.gold + priest.cost.gold)
  })

  test('boosted but cannot afford both: single hire at a discount, no second unit', () => {
    const mage = poolEntry('mage')
    const ctx = { resources: { gold: mage.cost.gold }, workersFree: 0 }
    const r = resolveHire(mage, true, ctx)
    expect(r.count).toBe(1)
    expect(r.secondUnit).toBeNull()
    expect(r.cost.gold).toBe(Math.round(mage.cost.gold * (1 - RECRUIT_BOOST_DISCOUNT)))
  })
})

describe('applyHire', () => {
  test('deducts the resolved cost (food/materials/workers) and grows the roster', () => {
    const militia = poolEntry('militia')
    const campaign = {
      roster: new Map(),
      resources: { food: 1000, materials: 1000, gold: 0, horses: 0 },
      workers: { total: 1000, used: 0 },
      recruit: { fervor: 0 },
    }
    applyHire(campaign, 'militia', false)
    expect(campaign.roster.get('Militia')).toBe(militia.count)
    expect(campaign.resources.food).toBe(1000 - militia.cost.food)
    expect(campaign.resources.materials).toBe(1000 - militia.cost.materials)
    expect(campaign.workers.total).toBe(1000 - militia.cost.workers)
    expect(campaign.workers.used).toBe(0) // hired troops leave the pool entirely, like militia purchase today
  })

  test('a boosted caster hire adds both units to the roster and spends the combined gold', () => {
    const mage = poolEntry('mage')
    const priest = poolEntry('priest')
    const campaign = {
      roster: new Map(),
      resources: { food: 0, materials: 0, gold: mage.cost.gold + priest.cost.gold, horses: 0 },
      workers: { total: 0, used: 0 },
      recruit: { fervor: 0 },
    }
    applyHire(campaign, 'mage', true)
    expect(campaign.roster.get('Mage')).toBe(1)
    expect(campaign.roster.get('Priest')).toBe(1)
    expect(campaign.resources.gold).toBe(0)
  })

  test('a Cavalry hire spends horses too', () => {
    const cavalry = poolEntry('cavalry')
    const campaign = {
      roster: new Map([['Soldier', 1]]),
      resources: { food: 1000, materials: 1000, gold: 0, horses: 1000 },
      workers: { total: 1000, used: 0 },
      recruit: { fervor: 0 },
    }
    applyHire(campaign, 'cavalry', false)
    expect(campaign.roster.get('Cavalry')).toBe(cavalry.count)
    expect(campaign.resources.horses).toBe(1000 - cavalry.cost.horses)
  })
})

// The Travellers card (grilled 2026-08-03): the always-legal play that makes
// hiring mandatory. It costs NOTHING, so it is affordable in every state the
// campaign can reach — which is what lets the hire be the only exit from the
// Recruit phase. It is deliberately NOT a RECRUIT_POOL row: it never competes
// for a slot against a real option, it only tops the day's offer up to two.
describe('FALLBACK_HIRE (Travellers)', () => {
  test('is a free, ungated troop-lane hire worth less than a real Militia purchase', () => {
    expect(FALLBACK_HIRE.id).toBe('travellers')
    expect(FALLBACK_HIRE.unit).toBe('Militia')
    expect(FALLBACK_HIRE.lane).toBe('troop')
    expect(FALLBACK_HIRE.count).toBe(FREE_MILITIA_AMOUNT)
    expect(FALLBACK_HIRE.cost).toEqual({})
    expect(FALLBACK_HIRE.requires).toBeUndefined()
    expect(FALLBACK_HIRE.count).toBeLessThan(poolEntry('militia').count)
  })

  test('is not in RECRUIT_POOL, so it never competes for a draw slot', () => {
    expect(RECRUIT_POOL.map((e) => e.id)).not.toContain('travellers')
  })

  test('is affordable with nothing at all in the stores', () => {
    expect(canAfford(FALLBACK_HIRE.cost, { food: 0, materials: 0, gold: 0, horses: 0 }, 0)).toBe(true)
  })
})

// One guarded lookup for both sources — the hire route and campaignView share
// it, so an id that has left the pool degrades to a 400 rather than throwing.
describe('findRecruitEntry', () => {
  test('finds pool entries and the fallback, and returns undefined for an unknown id', () => {
    expect(findRecruitEntry('militia')).toBe(poolEntry('militia'))
    expect(findRecruitEntry('travellers')).toBe(FALLBACK_HIRE)
    expect(findRecruitEntry('ghost')).toBeUndefined()
  })
})

describe('applyHire — Travellers', () => {
  test('grants the small Militia batch and touches no resources or workers', () => {
    const campaign = {
      roster: new Map(),
      resources: { food: 5, materials: 5, gold: 0, horses: 0 },
      workers: { total: 5, used: 0 },
      recruit: { fervor: 0 },
    }
    applyHire(campaign, 'travellers', false)
    expect(campaign.roster.get('Militia')).toBe(FREE_MILITIA_AMOUNT)
    expect(campaign.resources).toEqual({ food: 5, materials: 5, gold: 0, horses: 0 })
    expect(campaign.workers).toEqual({ total: 5, used: 0 })
  })

  test('boosts like any other troop-lane entry — double of nothing is still nothing', () => {
    const ctx = { resources: { food: 0, materials: 0, gold: 0, horses: 0 }, workersFree: 0 }
    expect(resolveHire(FALLBACK_HIRE, true, ctx)).toEqual({
      count: FREE_MILITIA_AMOUNT * 2,
      cost: {},
      secondUnit: null,
    })
  })
})

describe('pickDailyOptions — Travellers tops the offer up to two', () => {
  test('two or more affordable options crowd Travellers out entirely', () => {
    const ctx = {
      roster: new Map(),
      resources: { food: 1000, materials: 1000, gold: 1000, horses: 0 },
      workersFree: 1000,
      fervor: 0,
    }
    pushRoll(1000) // the day's boost roll — fervor 0 never boosts, whatever this is
    pushRoll(0) // pick index 0 of the affordable pool (militia/mage/priest with an empty roster)
    pushRoll(0) // pick index 0 of what's left
    const offer = pickDailyOptions(ctx)
    expect(offer.options).toHaveLength(2)
    expect(offer.boosted).toBe(false)
    expect(new Set(offer.options.map((o) => o.id)).size).toBe(2)
    expect(offer.options.map((o) => o.id)).not.toContain('travellers')
  })

  test('exactly one affordable option is padded with Travellers, appended last', () => {
    // Empty roster + food/materials/workers for Militia alone, no gold.
    const ctx = {
      roster: new Map(),
      resources: { food: 40, materials: 20, gold: 0, horses: 0 },
      workersFree: 20,
      fervor: 0,
    }
    pushRoll(1000) // boost roll
    pushRoll(0) // the single affordable entry
    const offer = pickDailyOptions(ctx)
    expect(offer.options.map((o) => o.id)).toEqual(['militia', 'travellers'])
  })

  test('an empty affordable pool offers Travellers alone — never an empty offer', () => {
    const ctx = {
      roster: new Map(),
      resources: { food: 0, materials: 0, gold: 0, horses: 0 },
      workersFree: 0,
      fervor: 0,
    }
    pushRoll(1000) // boost roll
    const offer = pickDailyOptions(ctx)
    expect(offer.options.map((o) => o.id)).toEqual(['travellers'])
  })
})

describe('drawRecruitOffer (campaign.recruit field shape)', () => {
  test('an empty affordable pool still yields a hireable day: Travellers, unresolved', () => {
    const ctx = { roster: new Map(), resources: { food: 0, materials: 0, gold: 0, horses: 0 }, workersFree: 0, fervor: 0 }
    pushRoll(1000) // boost roll
    const offer = drawRecruitOffer(ctx)
    expect(offer.dailyOptions).toEqual(['travellers'])
    expect(offer.boosted).toBe(false)
    expect(offer.hiredToday).toBe(false)
  })

  test('an affordable pool returns option IDS only (not resolved cost/count)', () => {
    const ctx = { roster: new Map(), resources: { food: 1000, materials: 1000, gold: 1000, horses: 0 }, workersFree: 1000, fervor: 0 }
    pushRoll(1000) // day's boost roll
    pushRoll(0)
    pushRoll(0)
    const offer = drawRecruitOffer(ctx)
    expect(offer.dailyOptions).toHaveLength(2)
    for (const id of offer.dailyOptions) expect(typeof id).toBe('string')
    expect(offer.boosted).toBe(false)
    expect(offer.hiredToday).toBe(false)
  })
})

describe('recruitCtx', () => {
  test('derives workersFree from workers.total - workers.used and defaults fervor', () => {
    const campaign = {
      roster: new Map([['Militia', 1]]),
      resources: { food: 10, materials: 10, gold: 10, horses: 10 },
      workers: { total: 100, used: 40 },
      recruit: { fervor: 25 },
    }
    expect(recruitCtx(campaign)).toEqual({
      roster: campaign.roster,
      resources: campaign.resources,
      workersFree: 60,
      fervor: 25,
    })
  })

  test('missing workers/recruit sub-docs default to 0 free workers and starting fervor', () => {
    const campaign = { roster: new Map(), resources: {} }
    expect(recruitCtx(campaign)).toEqual({
      roster: campaign.roster,
      resources: campaign.resources,
      workersFree: 0,
      fervor: RECRUITING_FERVOR_START,
    })
  })
})
