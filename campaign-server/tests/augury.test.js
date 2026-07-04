import { afterEach, describe, expect, test } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  drawAugury,
  consultAugury,
  rerollAugury,
  auguryReveal,
  mageBonus,
} from '../services/augury.js'
import { EVENT_POOL } from '../services/events.js'
import {
  AUGURY_THRESHOLD,
  AUGURY_REROLLS_PER_DAY,
} from '../utils/campaignConfig.js'

// Pure-service tests on a plain campaign-shaped object (the service only
// touches augury/roster/character, all mutated in place like the Mongoose
// doc). Dice are queue-driven for exact determinism, including the exploding
// chain the JS dice port pins against the C++ engine ([4,6,3,2] → 7).

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

const makeCampaign = ({ mages = 0, character = null } = {}) => ({
  roster: new Map(mages > 0 ? [['Mage', mages]] : []),
  character,
  augury: {
    trueEvent: { ...DOOMED },
    decoyEvent: { ...DECOY },
    prediction: null,
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

describe('drawAugury', () => {
  test('true and decoy events are always distinct pool entries', () => {
    for (let i = 0; i < 200; i++) {
      const a = drawAugury()
      expect(a.trueEvent.id).not.toBe(a.decoyEvent.id)
      expect(EVENT_POOL.some((e) => e.id === a.trueEvent.id)).toBe(true)
      expect(EVENT_POOL.some((e) => e.id === a.decoyEvent.id)).toBe(true)
    }
  })

  test('starts unconsulted with the configured rerolls', () => {
    const a = drawAugury()
    expect(a).toMatchObject({
      prediction: null,
      consulted: false,
      rerollsRemaining: AUGURY_REROLLS_PER_DAY,
    })
  })
})

describe('consultAugury', () => {
  test('exploding chain [4,6,3,2] → roll 7; bonuses push it to accurate', () => {
    // DOOMED baseAccuracy 0, 3 mages → +1: total 8 ≥ 7 → the truth is shown.
    const c = makeCampaign({ mages: 3 })
    pushRoll(4); pushRoll(6); pushRoll(3); pushRoll(2)
    const shown = consultAugury(c)
    expect(shown.id).toBe('doomed_omen')
    expect(c.augury.prediction).toEqual({
      eventId: 'doomed_omen',
      roll: 7,
      total: 8,
      threshold: AUGURY_THRESHOLD,
      accurate: true,
    })
    expect(c.augury.consulted).toBe(true)
  })

  test('a total exactly at the threshold reads true', () => {
    // Roll 6 (no explosion: second draw 1) + baseAccuracy 0 + mage 1 = 7.
    const c = makeCampaign({ mages: 3 })
    pushRoll(6); pushRoll(1)
    consultAugury(c)
    expect(c.augury.prediction.accurate).toBe(true)
  })

  test('character auguryBonus counts', () => {
    // Roll 4 + base 0 + mages 0 + character 3 = 7 → accurate.
    const c = makeCampaign({ character: { auguryBonus: 3 } })
    pushRoll(4); pushRoll(1)
    consultAugury(c)
    expect(c.augury.prediction).toMatchObject({ total: 7, accurate: true })
  })

  test('a failed reading shows either event at even odds — forced to the decoy', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1) // roll 1, total 1 < 7 → inaccurate
    pushRoll(2) // the false vision picks the decoy
    const shown = consultAugury(c)
    expect(shown.id).toBe('supply')
    expect(c.augury.prediction).toMatchObject({ eventId: 'supply', roll: 1, accurate: false })
  })

  test('a failed reading can STILL happen to show the truth (the lucky liar)', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1) // inaccurate
    pushRoll(1) // ...but the false vision lands on the true event anyway
    const shown = consultAugury(c)
    expect(shown.id).toBe('doomed_omen')
    expect(c.augury.prediction.accurate).toBe(false)
  })
})

describe('rerollAugury', () => {
  test('replaces fate: both events redrawn, the old truth can never fire', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1); pushRoll(1)
    consultAugury(c)
    expect(c.augury.trueEvent.id).toBe('doomed_omen')

    pushRoll(6); pushRoll(1) // fresh reading for the fresh pair
    rerollAugury(c)
    // DOOMED is not a pool event, so a redraw cannot reproduce it: the old
    // fate is gone for good, not merely re-rolled.
    expect(c.augury.trueEvent.id).not.toBe('doomed_omen')
    expect(c.augury.decoyEvent.id).not.toBe('doomed_omen')
    expect(c.augury.rerollsRemaining).toBe(AUGURY_REROLLS_PER_DAY - 1)
    expect(c.augury.consulted).toBe(true)
    expect(c.augury.prediction.eventId).not.toBe('doomed_omen')
  })
})

describe('auguryReveal', () => {
  test('unconsulted: no prediction, the truth still revealed', () => {
    const c = makeCampaign()
    expect(auguryReveal(c)).toEqual({
      predicted: null,
      actual: { id: 'doomed_omen', title: 'Doom', description: DOOMED.description, severity: 3 },
      wasAccurate: null,
    })
  })

  test('wasAccurate compares the SHOWN card to the truth, not the roll', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1); pushRoll(1) // failed reading that shows the truth
    consultAugury(c)
    const reveal = auguryReveal(c)
    expect(reveal.predicted.id).toBe('doomed_omen')
    expect(reveal.wasAccurate).toBe(true) // lucky, but right is right
    // The reveal card never carries the hidden legibility bonus or the effect
    // machinery — display fields only.
    expect(reveal.actual.baseAccuracy).toBeUndefined()
  })

  test('a wrong prophecy is revealed as wrong', () => {
    const c = makeCampaign()
    pushRoll(1); pushRoll(1); pushRoll(2) // failed reading showing the decoy
    consultAugury(c)
    const reveal = auguryReveal(c)
    expect(reveal.predicted.id).toBe('supply')
    expect(reveal.actual.id).toBe('doomed_omen')
    expect(reveal.wasAccurate).toBe(false)
  })
})
