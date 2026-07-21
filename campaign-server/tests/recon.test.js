import { describe, it, expect } from 'vitest'
import {
  computeBracket,
  displayBracket,
  bracketOnLevelUp,
  TOP_RECON_LEVEL,
} from '../services/recon.js'
import { RECON_BRACKET_MULTIPLIERS } from '../utils/campaignConfig.js'

// rand=()=>0 → no widening jitter, so the bracket is exactly the multiplier
// bracket; rand=()=>1 → maximum widening.
const noJitter = () => 0
const maxJitter = () => 1

describe('recon numeric brackets (R2)', () => {
  describe('computeBracket', () => {
    it('at level 1 sets offsets from the multipliers (no jitter), skewed high', () => {
      const [fMult, cMult] = RECON_BRACKET_MULTIPLIERS[1] // [0.6, 1.7]
      const b = computeBracket(100, 1, noJitter)
      expect(b).toEqual({
        atLevel: 1,
        floorOffset: Math.round(100 * (fMult - 1)), // -40
        ceilOffset: Math.round(100 * (cMult - 1)), // 70
      })
      expect(b.floorOffset).toBeLessThan(0)
      expect(b.ceilOffset).toBeGreaterThan(0)
    })

    it('jitter only WIDENS the bracket, never inverts an offset sign', () => {
      const base = computeBracket(100, 1, noJitter)
      const wide = computeBracket(100, 1, maxJitter)
      expect(wide.floorOffset).toBeLessThan(base.floorOffset) // pushed further down
      expect(wide.ceilOffset).toBeGreaterThan(base.ceilOffset) // pushed further up
      expect(wide.floorOffset).toBeLessThanOrEqual(0)
      expect(wide.ceilOffset).toBeGreaterThanOrEqual(0)
    })

    it('narrows as the level climbs (higher level ⇒ tighter offsets)', () => {
      const l1 = computeBracket(1000, 1, noJitter)
      const l2 = computeBracket(1000, 2, noJitter)
      const l3 = computeBracket(1000, 3, noJitter)
      const width = (b) => b.ceilOffset - b.floorOffset
      expect(width(l2)).toBeLessThan(width(l1))
      expect(width(l3)).toBeLessThan(width(l2))
    })

    it('is exact at the top level regardless of jitter', () => {
      expect(computeBracket(500, TOP_RECON_LEVEL, maxJitter)).toEqual({
        atLevel: TOP_RECON_LEVEL,
        floorOffset: 0,
        ceilOffset: 0,
      })
    })
  })

  describe('displayBracket', () => {
    it('is null at level 0 (nothing shown)', () => {
      expect(displayBracket({ floorOffset: -40, ceilOffset: 70 }, 100, 0)).toBeNull()
    })

    it('renders stored offsets against the live truth', () => {
      expect(displayBracket({ floorOffset: -40, ceilOffset: 70 }, 100, 1)).toEqual({
        low: 60,
        high: 170,
      })
    })

    it('slides the whole bracket DOWN by exactly the casualties, same width', () => {
      const stored = { floorOffset: -40, ceilOffset: 70 }
      const before = displayBracket(stored, 100, 1) // {60, 170}
      const after = displayBracket(stored, 80, 1) // 20 casualties
      expect(after).toEqual({ low: 40, high: 150 })
      expect(after.high - after.low).toBe(before.high - before.low) // width preserved
      expect(before.low - after.low).toBe(20) // slid down by the loss
      expect(before.high - after.high).toBe(20)
    })

    it('clamps the floor at 0 (never a negative count)', () => {
      expect(displayBracket({ floorOffset: -40, ceilOffset: 70 }, 30, 1)).toEqual({
        low: 0,
        high: 100,
      })
    })

    it('collapses to the exact value at the top level (zero offsets)', () => {
      const stored = computeBracket(500, TOP_RECON_LEVEL)
      expect(displayBracket(stored, 500, TOP_RECON_LEVEL)).toEqual({ low: 500, high: 500 })
    })
  })

  describe('bracketOnLevelUp', () => {
    it('re-rolls the bracket only when the level has climbed', () => {
      const at1 = { atLevel: 1, floorOffset: -40, ceilOffset: 70 }
      // same level → unchanged (stable across turns within a level)
      expect(bracketOnLevelUp(at1, 999, 1, noJitter)).toBe(at1)
      // higher level → fresh, tighter bracket set from the current truth
      const at2 = bracketOnLevelUp(at1, 200, 2, noJitter)
      expect(at2.atLevel).toBe(2)
      expect(at2).not.toBe(at1)
    })
  })
})
