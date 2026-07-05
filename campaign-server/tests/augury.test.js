import { afterEach, describe, expect, test } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  drawAugury,
  consultAugury,
  rerollAugurySlot,
  auguryReveal,
  rollAuguryOdds,
  mageBonus,
} from '../services/augury.js'
import { EVENT_POOL } from '../services/events.js'
import {
  AUGURY_SLOTS,
  AUGURY_ODDS_MAX,
  AUGURY_REROLLS_PER_DAY,
} from '../utils/campaignConfig.js'

// Pure-service tests on a plain campaign-shaped object (the service only
// touches augury/roster/character, all mutated in place like the Mongoose
// doc). Readings are queue-driven and consumed per slot in order: first the
// exploding throwDice chain (value die, explosion die, recursing on a 6 —
// the JS port pins [4,6,3,2] → 7 against the C++ engine), then one d1000
// chanceRoll deciding the vision against odds×1000.
//
// Odds math (campaignConfig): odds = clamp((roll + 2 base + mageBonus +
// characterBonus + trueEvent.baseAccuracy) × 0.05, 0.1, 0.9).

afterEach(clearRolls)

// A truth that is NOT in EVENT_POOL, so a redraw can never reproduce it —
// that's what makes "the old fate never fires" assertable. baseAccuracy 0:
// a dire fate is illegible.
const DOOMED = {
  id: 'doomed_omen',
  title: 'Doom',
  description: 'A fate that must never come to pass.',
  severity: 3,
  baseAccuracy: 0,
  effect: { type: 'food', delta: -999 },
}
const DECOY = { ...EVENT_POOL.find((e) => e.id === 'supply') }

// All slots pinned to the same unread DOOMED/DECOY pair. With no mages and
// no character, a queued [4,1] reading gives points 4+2+0+0+0 = 6 → odds 0.3
// → d1000 vision threshold 300.
const makeCampaign = ({ mages = 0, character = null } = {}) => ({
  roster: new Map(mages > 0 ? [['Mage', mages]] : []),
  character,
  augury: {
    slots: Array.from({ length: AUGURY_SLOTS }, () => ({
      trueEvent: { ...DOOMED },
      falseEvent: { ...DECOY },
      odds: null,
      shownTrue: null,
    })),
    consulted: false,
    rerollsRemaining: AUGURY_REROLLS_PER_DAY,
  },
})

describe('mageBonus', () => {
  test('floor(sqrt(mages)), capped at 3', () => {
    expect(mageBonus(new Map())).toBe(0)
    expect(mageBonus(new Map([['Mage', 3]]))).toBe(1)
    expect(mageBonus(new Map([['Mage', 9]]))).toBe(3)
    expect(mageBonus(new Map([['Mage', 100]]))).toBe(3) // capped
  })
})

describe('rollAuguryOdds', () => {
  test('exploding chain [4,6,3,2] → roll 7 → (7+2)×0.05 = 0.45 for a dire truth', () => {
    pushRoll(4); pushRoll(6); pushRoll(3); pushRoll(2)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBeCloseTo(0.45)
  })

  test('legibility, mages and character all add points', () => {
    // roll 4 + base 2 + mage 3 + character 2 + legibility 3 = 14 → 0.70
    const c = makeCampaign({ mages: 9, character: { auguryBonus: 2 } })
    pushRoll(4); pushRoll(1)
    expect(rollAuguryOdds(c, { ...DOOMED, baseAccuracy: 3 })).toBeCloseTo(0.7)
  })

  test('a monster roll is capped at the maximum', () => {
    // 6 → explode → 6 → explode → 6 (stop): roll 18 + base 2 = 20 → 1.0 → cap
    pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(1)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBe(AUGURY_ODDS_MAX)
  })

  test('the floor of the formula: a 1 with no help reads at 15%', () => {
    pushRoll(1); pushRoll(1)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBeCloseTo(0.15)
  })
})

describe('drawAugury', () => {
  test('draws the configured number of unread slots', () => {
    const a = drawAugury()
    expect(a.slots).toHaveLength(AUGURY_SLOTS)
    for (const slot of a.slots) {
      expect(slot.odds).toBeNull() // rolled at consult, not at draw
      expect(slot.shownTrue).toBeNull()
    }
    expect(a).toMatchObject({ consulted: false, rerollsRemaining: AUGURY_REROLLS_PER_DAY })
  })

  test("every slot's true and false events are distinct pool entries", () => {
    for (let i = 0; i < 100; i++) {
      for (const slot of drawAugury().slots) {
        expect(slot.trueEvent.id).not.toBe(slot.falseEvent.id)
        expect(EVENT_POOL.some((e) => e.id === slot.trueEvent.id)).toBe(true)
        expect(EVENT_POOL.some((e) => e.id === slot.falseEvent.id)).toBe(true)
      }
    }
  })
})

describe('consultAugury', () => {
  test('reads each slot in order: reading roll → odds, then the vision roll', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(300) // slot 0: odds 0.30, 300 ≤ 300 → truth
    pushRoll(4); pushRoll(1); pushRoll(301) // slot 1: odds 0.30, just over → lie
    pushRoll(1); pushRoll(1); pushRoll(1000) // slot 2: odds 0.15 → lie
    const shown = consultAugury(c)
    expect(c.augury.slots.map((s) => s.odds)).toEqual([0.3, 0.3, 0.15])
    expect(c.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
    expect(shown.map((e) => e.id)).toEqual(['doomed_omen', 'supply', 'supply'])
    expect(c.augury.consulted).toBe(true)
  })

  test('mages raise the odds of every reading', () => {
    const c = makeCampaign({ mages: 9 }) // +3 points
    pushRoll(4); pushRoll(1); pushRoll(450) // (4+2+3)×0.05 = 0.45 → truth at 450
    pushRoll(4); pushRoll(1); pushRoll(451) // → lie at 451
    pushRoll(4); pushRoll(1); pushRoll(1000)
    consultAugury(c)
    expect(c.augury.slots.map((s) => s.odds)).toEqual([0.45, 0.45, 0.45])
    expect(c.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
  })
})

describe('rerollAugurySlot', () => {
  test('replaces exactly one fate; the other slots stay sealed', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 0: truth
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 1: lie
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 2: truth
    consultAugury(c)

    pushRoll(4); pushRoll(1); pushRoll(1) // the fresh slot's reading: odds ≥ 0.3, vision true
    const shown = rerollAugurySlot(c, 1)

    // Slot 1 is a fresh pool pair — DOOMED is not in the pool, so the old
    // fate is gone for good; slots 0 and 2 still hold their doom.
    expect(c.augury.slots[1].trueEvent.id).not.toBe('doomed_omen')
    expect(c.augury.slots[1].shownTrue).toBe(true)
    expect(c.augury.slots[1].odds).toBeGreaterThanOrEqual(0.3) // fresh reading recorded
    expect(shown.id).toBe(c.augury.slots[1].trueEvent.id)
    expect(c.augury.slots[0].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[2].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[0].shownTrue).toBe(true) // earlier readings untouched
    expect(c.augury.slots[0].odds).toBeCloseTo(0.3)
    expect(c.augury.rerollsRemaining).toBe(AUGURY_REROLLS_PER_DAY - 1)
  })
})

describe('auguryReveal', () => {
  test('unconsulted: no predictions or odds, every truth still revealed', () => {
    const reveal = auguryReveal(makeCampaign())
    expect(reveal).toHaveLength(AUGURY_SLOTS)
    for (const r of reveal) {
      expect(r.predicted).toBeNull()
      expect(r.odds).toBeNull()
      expect(r.wasAccurate).toBeNull()
      expect(r.actual).toEqual({
        id: 'doomed_omen',
        title: 'Doom',
        description: DOOMED.description,
        severity: 3,
      })
    }
  })

  test('per slot: predicted card + odds vs the truth, wasAccurate per vision', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(1) // truth at odds 0.30
    pushRoll(4); pushRoll(1); pushRoll(1000) // lie
    pushRoll(4); pushRoll(1); pushRoll(1) // truth
    consultAugury(c)
    const reveal = auguryReveal(c)
    expect(reveal.map((r) => r.wasAccurate)).toEqual([true, false, true])
    expect(reveal[0].predicted.id).toBe('doomed_omen')
    expect(reveal[0].odds).toBeCloseTo(0.3)
    expect(reveal[1].predicted.id).toBe('supply') // the lie the player saw
    expect(reveal[1].actual.id).toBe('doomed_omen') // ...and what really came
    // The reveal card never carries the hidden legibility bonus or the effect
    // machinery — display fields only.
    expect(reveal[0].actual.baseAccuracy).toBeUndefined()
    expect(reveal[0].actual.effect).toBeUndefined()
  })
})
