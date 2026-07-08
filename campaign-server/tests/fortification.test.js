import { describe, expect, test } from 'vitest'
import { fortifiedSidesFor, fortifyCost, atFortCap } from '../services/fortification.js'
import {
  MAP_NAME,
  FORTIFICATION_PRESETS,
  FORTIFICATION_MAX_LEVEL,
  FORTIFY_COST_BASE,
} from '../utils/campaignConfig.js'

// Pure fortification math — the level→hexsides mapping the battle route and the
// campaign view both read, plus the spend cost curve.

describe('fortifiedSidesFor', () => {
  const tier1 = FORTIFICATION_PRESETS[MAP_NAME].filter((p) => p.tier === 1)
  const tier2 = FORTIFICATION_PRESETS[MAP_NAME].filter((p) => p.tier === 2)

  test('level 0 walls nothing', () => {
    expect(fortifiedSidesFor(MAP_NAME, 0)).toEqual([])
  })

  test('level 1 activates exactly the tier-1 sides', () => {
    const sides = fortifiedSidesFor(MAP_NAME, 1)
    expect(sides).toHaveLength(tier1.length)
    expect(sides).toEqual(tier1.map(({ q, r, dir, durability }) => ({ q, r, dir, durability })))
  })

  test('level 2 activates tier-1 AND tier-2 sides', () => {
    const sides = fortifiedSidesFor(MAP_NAME, 2)
    expect(sides).toHaveLength(tier1.length + tier2.length)
  })

  test('entries carry only the engine-input shape {q,r,dir,durability} — no tier leaks', () => {
    for (const s of fortifiedSidesFor(MAP_NAME, FORTIFICATION_MAX_LEVEL)) {
      expect(Object.keys(s).sort()).toEqual(['dir', 'durability', 'q', 'r'])
      expect(['NE', 'E', 'SE', 'SW', 'W', 'NW']).toContain(s.dir)
    }
  })

  test('an unknown map walls nothing', () => {
    expect(fortifiedSidesFor('no_such_map', 2)).toEqual([])
  })
})

describe('fortifyCost / atFortCap', () => {
  test('cost is FORTIFY_COST_BASE × (level+1)', () => {
    expect(fortifyCost(0)).toBe(FORTIFY_COST_BASE) // L0→1
    expect(fortifyCost(1)).toBe(FORTIFY_COST_BASE * 2) // L1→2
  })

  test('atFortCap is true only at the max level', () => {
    expect(atFortCap(0)).toBe(false)
    expect(atFortCap(FORTIFICATION_MAX_LEVEL - 1)).toBe(false)
    expect(atFortCap(FORTIFICATION_MAX_LEVEL)).toBe(true)
  })
})
