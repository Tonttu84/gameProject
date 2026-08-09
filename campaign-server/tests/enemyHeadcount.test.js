import { describe, it, expect } from 'vitest'
import { enemyTurn, armyTotal } from '../services/enemyHost.js'
import {
  ENEMY_ARMY,
  ENEMY_CONSUMPTION_KG_PER_TURN,
  ENEMY_REINFORCE_HEADCOUNT,
  ENEMY_DESERTION_HEADCOUNT,
} from '../utils/campaignConfig.js'

// The enemy host's per-turn headcount swing is a FIXED number of men, not a
// percentage of its current size (decision 2026-08-09, replacing the 3%/5%
// rates). No DB: enemyTurn takes a plain campaign object, so everything here is
// arithmetic — the DB-backed path lives in enemyHost.test.js.
//
// Why it matters enough to pin: under the old rates the swing scaled with the
// host, so a fed host grew faster the bigger it got (~+34% over ten turns) and
// a starving one bled slower the smaller it got. These tests exist to make that
// compounding impossible to reintroduce by accident.

// Income that lands the host in each supply band, expressed as a MULTIPLE of
// consumption so retuning the constants cannot silently break the band choice.
// These three ratios are not arbitrary — they are what the near/mid/far rings
// actually yield the host (9000 kg × 1.0/0.8/0.6 ÷ 7200), so each one stands in
// for "the player has stripped the countryside back to this ring".
const SURPLUS = ENEMY_CONSUMPTION_KG_PER_TURN * 1.25 // near ring → well-provisioned
const BREAK_EVEN = ENEMY_CONSUMPTION_KG_PER_TURN * 1.0 // mid ring  → steady
const STARVING = ENEMY_CONSUMPTION_KG_PER_TURN * 0.75 // far ring  → near starving

const makeCampaign = (army = ENEMY_ARMY) => {
  const map = new Map(Object.entries(army))
  return {
    enemy: {
      army: map,
      // Not broken: the withdraw check is size < initialStrength × 0.2, and
      // these tests are about the headcount arithmetic, not that gate.
      initialStrength: armyTotal(map),
    },
  }
}

const turn = (campaign, income) => enemyTurn(campaign, {}, income)

describe('a fed host recruits a fixed number of men', () => {
  it('gains exactly ENEMY_REINFORCE_HEADCOUNT', () => {
    const c = makeCampaign()
    const before = armyTotal(c.enemy.army)
    turn(c, SURPLUS)
    expect(armyTotal(c.enemy.army) - before).toBe(ENEMY_REINFORCE_HEADCOUNT)
  })

  it('gains the SAME number whatever its size — the swing does not scale', () => {
    // This is the whole point of the change. A host eight times the size of
    // another must still take on the same fixed draft.
    const small = makeCampaign({ Soldier: 80, Archer: 20 })
    const large = makeCampaign({ Soldier: 640, Archer: 160 })

    const smallBefore = armyTotal(small.enemy.army)
    const largeBefore = armyTotal(large.enemy.army)
    turn(small, SURPLUS)
    turn(large, SURPLUS)

    const smallGain = armyTotal(small.enemy.army) - smallBefore
    const largeGain = armyTotal(large.enemy.army) - largeBefore
    expect(smallGain).toBe(ENEMY_REINFORCE_HEADCOUNT)
    expect(largeGain).toBe(ENEMY_REINFORCE_HEADCOUNT)
    expect(smallGain).toBe(largeGain)
  })

  it('does NOT compound over consecutive fed turns', () => {
    const c = makeCampaign()
    const before = armyTotal(c.enemy.army)
    for (let i = 0; i < 5; i++) turn(c, SURPLUS)
    // Linear: five fed turns is five times one fed turn, exactly. Under the old
    // 3% rate this total came out strictly higher.
    expect(armyTotal(c.enemy.army) - before).toBe(ENEMY_REINFORCE_HEADCOUNT * 5)
  })

  it('splits the draft across types in proportion to the composition', () => {
    const c = makeCampaign()
    turn(c, SURPLUS)
    // 721 men, +5: Soldier is 74.9% of the host so it takes 3.74 → 3, and the
    // single rounding remainder goes to it as the largest fraction. Archer's
    // 1.04 → 1. The thin lines (Necromancer 0.08, LightCavalry 0.14) round to
    // nothing, which is the right answer for a draft this small.
    expect(c.enemy.army.get('Soldier')).toBe(544)
    expect(c.enemy.army.get('Archer')).toBe(151)
    expect(c.enemy.army.get('Necromancer')).toBe(11)
    expect(c.enemy.army.get('LightCavalry')).toBe(20)
  })
})

describe('a starving host bleeds a fixed number of men', () => {
  it('loses exactly ENEMY_DESERTION_HEADCOUNT', () => {
    const c = makeCampaign()
    const before = armyTotal(c.enemy.army)
    turn(c, STARVING)
    expect(before - armyTotal(c.enemy.army)).toBe(ENEMY_DESERTION_HEADCOUNT)
  })

  it('loses the SAME number whatever its size', () => {
    const small = makeCampaign({ Soldier: 200 })
    const large = makeCampaign({ Soldier: 1600 })
    turn(small, STARVING)
    turn(large, STARVING)
    expect(200 - armyTotal(small.enemy.army)).toBe(ENEMY_DESERTION_HEADCOUNT)
    expect(1600 - armyTotal(large.enemy.army)).toBe(ENEMY_DESERTION_HEADCOUNT)
  })

  it('cannot bleed a host past zero', () => {
    // Fewer men left than the fixed desertion figure: it empties, it does not
    // go negative and it does not wrap.
    const c = makeCampaign({ Soldier: 3, Archer: 2 })
    turn(c, STARVING)
    expect(armyTotal(c.enemy.army)).toBe(0)
    for (const n of c.enemy.army.values()) expect(n).toBeGreaterThanOrEqual(0)
  })
})

describe('a steady host holds', () => {
  it('is left untouched at break-even, to the man', () => {
    const c = makeCampaign()
    const before = new Map(c.enemy.army)
    turn(c, BREAK_EVEN)
    expect(c.enemy.army).toEqual(before)
  })
})
