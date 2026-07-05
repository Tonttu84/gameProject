import { afterEach, describe, expect, test } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  drawAugury,
  consultAugury,
  rerollAugurySlot,
  auguryReveal,
  auguryOdds,
  mageBonus,
} from '../services/augury.js'
import { EVENT_POOL } from '../services/events.js'
import {
  AUGURY_SLOTS,
  AUGURY_BASE_ODDS,
  AUGURY_ODDS_PER_POINT,
  AUGURY_MAX_ODDS,
  AUGURY_REROLLS_PER_DAY,
} from '../utils/campaignConfig.js'

// Pure-service tests on a plain campaign-shaped object (the service only
// touches augury/roster/character, all mutated in place like the Mongoose
// doc). Vision rolls are queue-driven: consult resolves the slots in order,
// one chanceRoll (a single d1000 draw) each — a queued value at or below
// odds×1000 forces a true vision, above it a false one.

afterEach(clearRolls)

// A truth that is NOT in EVENT_POOL, so a redraw can never reproduce it —
// that's what makes "the old fate never fires" assertable.
const DOOMED = {
  id: 'doomed_omen',
  title: 'Doom',
  description: 'A fate that must never come to pass.',
  severity: 3,
  baseAccuracy: 0,
  effect: { type: 'food', delta: -999 },
}
const DECOY = { ...EVENT_POOL.find((e) => e.id === 'supply') }

// All slots pinned to the same DOOMED/DECOY pair; no mages, no character →
// odds per slot = AUGURY_BASE_ODDS (0.4) → d1000 threshold 400.
const makeCampaign = ({ mages = 0, character = null } = {}) => ({
  roster: new Map(mages > 0 ? [['Mage', mages]] : []),
  character,
  augury: {
    slots: Array.from({ length: AUGURY_SLOTS }, () => ({
      trueEvent: { ...DOOMED },
      falseEvent: { ...DECOY },
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

describe('auguryOdds', () => {
  test('base odds for an illegible omen with no help', () => {
    expect(auguryOdds(makeCampaign(), DOOMED)).toBe(AUGURY_BASE_ODDS)
  })

  test('legibility, mages and character each add per-point odds', () => {
    const legible = { ...DOOMED, baseAccuracy: 3 }
    expect(auguryOdds(makeCampaign(), legible)).toBeCloseTo(
      AUGURY_BASE_ODDS + 3 * AUGURY_ODDS_PER_POINT,
    )
    expect(auguryOdds(makeCampaign({ mages: 9 }), DOOMED)).toBeCloseTo(
      AUGURY_BASE_ODDS + 3 * AUGURY_ODDS_PER_POINT,
    )
    expect(auguryOdds(makeCampaign({ character: { auguryBonus: 2 } }), DOOMED)).toBeCloseTo(
      AUGURY_BASE_ODDS + 2 * AUGURY_ODDS_PER_POINT,
    )
  })

  test('odds are capped', () => {
    const c = makeCampaign({ mages: 100, character: { auguryBonus: 50 } })
    expect(auguryOdds(c, { ...DOOMED, baseAccuracy: 3 })).toBe(AUGURY_MAX_ODDS)
  })
})

describe('drawAugury', () => {
  test('draws the configured number of unresolved slots', () => {
    const a = drawAugury()
    expect(a.slots).toHaveLength(AUGURY_SLOTS)
    for (const slot of a.slots) expect(slot.shownTrue).toBeNull()
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
  test('resolves each slot in order: random ≤ odds×1000 shows the truth', () => {
    const c = makeCampaign() // odds 0.4 → threshold 400 per slot
    pushRoll(400) // slot 0: exactly at the line → true
    pushRoll(401) // slot 1: just over → false
    pushRoll(1000) // slot 2: false
    const shown = consultAugury(c)
    expect(c.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
    expect(shown.map((e) => e.id)).toEqual(['doomed_omen', 'supply', 'supply'])
    expect(c.augury.consulted).toBe(true)
  })

  test('mages raise every slot\'s odds', () => {
    const c = makeCampaign({ mages: 9 }) // +3 points → odds 0.64 → threshold 640
    pushRoll(640); pushRoll(640); pushRoll(640)
    consultAugury(c)
    expect(c.augury.slots.every((s) => s.shownTrue)).toBe(true)
  })
})

describe('rerollAugurySlot', () => {
  test('replaces exactly one fate; the other slots stay sealed', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1000); pushRoll(1) // visions: true, false, true
    consultAugury(c)

    pushRoll(1) // the fresh slot's reading
    const shown = rerollAugurySlot(c, 1)

    // Slot 1 is a fresh pool pair — DOOMED is not in the pool, so the old
    // fate is gone for good; slots 0 and 2 still hold their doom.
    expect(c.augury.slots[1].trueEvent.id).not.toBe('doomed_omen')
    expect(c.augury.slots[1].shownTrue).toBe(true)
    expect(shown.id).toBe(c.augury.slots[1].trueEvent.id)
    expect(c.augury.slots[0].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[2].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[0].shownTrue).toBe(true) // earlier readings untouched
    expect(c.augury.rerollsRemaining).toBe(AUGURY_REROLLS_PER_DAY - 1)
  })
})

describe('auguryReveal', () => {
  test('unconsulted: no predictions, every truth still revealed', () => {
    const reveal = auguryReveal(makeCampaign())
    expect(reveal).toHaveLength(AUGURY_SLOTS)
    for (const r of reveal) {
      expect(r.predicted).toBeNull()
      expect(r.wasAccurate).toBeNull()
      expect(r.actual).toEqual({
        id: 'doomed_omen',
        title: 'Doom',
        description: DOOMED.description,
        severity: 3,
      })
    }
  })

  test('per slot: predicted card vs the truth, wasAccurate per vision', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1000); pushRoll(1) // true, false, true
    consultAugury(c)
    const reveal = auguryReveal(c)
    expect(reveal.map((r) => r.wasAccurate)).toEqual([true, false, true])
    expect(reveal[0].predicted.id).toBe('doomed_omen')
    expect(reveal[1].predicted.id).toBe('supply') // the lie the player saw
    expect(reveal[1].actual.id).toBe('doomed_omen') // ...and what really came
    // The reveal card never carries the hidden legibility bonus or the effect
    // machinery — display fields only.
    expect(reveal[0].actual.baseAccuracy).toBeUndefined()
    expect(reveal[0].actual.effect).toBeUndefined()
  })
})
