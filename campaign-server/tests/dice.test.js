import { describe, it, expect, afterEach } from 'vitest'
import { throwDice, getRandom, chanceRoll, pushRoll, clearRolls } from '../utils/dice.js'

afterEach(clearRolls)

// The JS dice must mirror backend/engine/src/Utility.cpp exactly: a value d6
// plus a SEPARATE explosion d6, recursing on an explosion 6. This shared
// vector pins the two implementations together — if either side changes its
// draw order, this test (or the C++ twin) breaks.
describe('exploding dice (C++ Utility::throwDice mirror)', () => {
  it('queue [4,6,3,2] → 4 explodes into 3 → 7', () => {
    pushRoll(4)
    pushRoll(6)
    pushRoll(3)
    pushRoll(2)
    expect(throwDice()).toBe(7)
  })

  it('a plain roll consumes exactly two draws', () => {
    pushRoll(5)
    pushRoll(1)
    expect(throwDice()).toBe(5)
  })

  it('chains multiple explosions', () => {
    // 2 (explode) + 6 (explode) + 1 (stop) = 9
    for (const v of [2, 6, 6, 6, 1, 1]) pushRoll(v)
    expect(throwDice()).toBe(9)
  })

  it('getRandom falls back to real randomness inside bounds when the queue is empty', () => {
    for (let i = 0; i < 50; i++) {
      const v = getRandom(1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('chanceRoll compares one d1000 draw against the probability', () => {
    pushRoll(120)
    expect(chanceRoll(0.12)).toBe(true)
    pushRoll(121)
    expect(chanceRoll(0.12)).toBe(false)
  })
})
