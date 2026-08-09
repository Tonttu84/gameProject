import { describe, it, expect } from 'vitest'
import {
  forageCapacityKg,
  forageYieldMultiplier,
  allocateNearFirst,
  resolveForaging,
} from '../services/forage.js'
import { SCOUTING_BANDS } from '../utils/capabilities.js'
import { FORAGE_YIELD_BY_BAND, FORAGE_KG_PER_POINT, FORAGE_RING_YIELD } from '../utils/campaignConfig.js'

// Pure campaign math — no DB, no engine, no catalog needed (S2 "effort
// slider": foraging works off the pre-derived pool/share, not per-unit
// assignment, so these tests no longer need a catalog fixture at all).

const makeCampaign = ({ pool = 0, share = 0, enemyDrainKg = 0, rings }) => ({
  resources: { food: 0, materials: 0 },
  forage: {
    rings: rings.map((richness, ring) => ({ ring, richness, initialRichness: richness })),
    pool,
    share,
    enemyDrainKg,
  },
})

describe('forage capacity and allocation', () => {
  it('capacity is points × FORAGE_KG_PER_POINT, floored', () => {
    expect(forageCapacityKg(100, undefined)).toBe(100 * FORAGE_KG_PER_POINT)
    expect(forageCapacityKg(0, undefined)).toBe(0)
    expect(forageCapacityKg(-5, undefined)).toBe(0) // never negative
  })

  it('fills the near ring first and spills outward', () => {
    expect(allocateNearFirst(25000, [20000, 35000, 55000])).toEqual([20000, 5000, 0])
    expect(allocateNearFirst(0, [20000, 35000, 55000])).toEqual([0, 0, 0])
    // More capacity than land: everything is taken, the excess is idle hands.
    expect(allocateNearFirst(999999, [100, 200, 300])).toEqual([100, 200, 300])
  })
})

describe('resolveForaging', () => {
  it('uncontested harvest splits into food and materials at the ring yield', () => {
    // pool 1000 × share 0.5 = 500 points × 16 kg/pt = 8000 kg capacity, all
    // from the near ring (yield ×1.0 — no penalty).
    const c = makeCampaign({ pool: 1000, share: 0.5, rings: [20000, 35000, 55000] })
    const { forage } = resolveForaging(c, null)

    expect(forage.capacity).toBe(8000)
    expect(c.resources.food).toBe(6400) // 0.8 × 8000
    expect(c.resources.materials).toBe(1600) // 0.2 × 8000
    expect(forage.rings[0].richness).toBe(12000)
  })

  it('spillover into a farther ring costs the same kg but credits less (ring-distance yield)', () => {
    // pool 2000 × share 1 = 2000 points × 16 = 32000 kg capacity: strips the
    // near ring (20000, yield ×1.0) and 12000 kg of the mid ring (yield ×0.8).
    const c = makeCampaign({ pool: 2000, share: 1, rings: [20000, 35000, 55000] })
    const { forage } = resolveForaging(c, null)

    expect(forage.capacity).toBe(32000)
    expect(forage.rings[0].richness).toBe(0)
    expect(forage.rings[1].richness).toBe(23000) // 35000 − 12000
    const credited = 20000 * FORAGE_RING_YIELD[0] + 12000 * FORAGE_RING_YIELD[1] // 20000 + 9600
    expect(c.resources.food).toBe(Math.floor(credited * 0.8))
    expect(c.resources.materials).toBe(Math.floor(credited * 0.2))
  })

  it('a zero share forages nothing, regardless of the pool', () => {
    const c = makeCampaign({ pool: 5000, share: 0, rings: [20000, 35000, 55000] })
    const { forage } = resolveForaging(c, null)
    expect(forage.capacity).toBe(0)
    expect(c.resources.food).toBe(0)
    expect(forage.rings[0].richness).toBe(20000)
  })

  it('the enemy drains what the player leaves, near-first, and gets no credit', () => {
    const c = makeCampaign({ pool: 1000, share: 0.5, enemyDrainKg: 5000, rings: [10000, 35000, 55000] })
    // Player capacity 8000 kg: entirely within the near ring (10000 → 2000).
    // The enemy's 5000 kg then eats what's left near-first: 2000 empties the
    // near ring, the remaining 3000 comes out of the mid ring.
    const { forage } = resolveForaging(c, null)
    expect(forage.capacity).toBe(8000)
    expect(forage.rings[0].richness).toBe(0)
    expect(forage.rings[1].richness).toBe(35000 - 3000)
    expect(forage.rings[2].richness).toBe(55000)
    // Player is credited only for what IT swept (8000 kg at the near ring's
    // ×1.0 yield), never for the enemy's drain.
    expect(c.resources.food).toBe(Math.floor(8000 * FORAGE_RING_YIELD[0] * 0.8))
    expect(c.resources.materials).toBe(Math.floor(8000 * FORAGE_RING_YIELD[0] * 0.2))
  })
})

// ── Stage 4 (1d): forage posture ─────────────────────────────────────────────
// The scouting band sets HOW MUCH GROUND a given share sweeps: dispersed
// efficient sweeps when your riders own the field (higher yield), clumped
// defensive columns when theirs do (lower yield). One passive multiplier on
// the existing math — the player never micro-manages group size.
describe('forage posture (Stage 4 1d)', () => {
  it('carries exactly the five bands; Contested is neutral; unknown degrades to ×1', () => {
    expect(Object.keys(FORAGE_YIELD_BY_BAND).sort()).toEqual([...SCOUTING_BANDS].sort())
    expect(FORAGE_YIELD_BY_BAND.Contested).toBe(1)
    expect(forageYieldMultiplier(undefined)).toBe(1)
    expect(forageYieldMultiplier('NoSuchBand')).toBe(1)
  })

  it('yield multiplier scales capacity, harvest, and depletion: Blind ×0.7, Overwhelming ×1.25', () => {
    const blind = makeCampaign({ pool: 1000, share: 1, rings: [20000, 35000, 55000] })
    const b = resolveForaging(blind, 'Blind')
    expect(b.forage.capacity).toBe(Math.floor(1000 * FORAGE_KG_PER_POINT * 0.7))
    expect(b.forage.posture).toBe('Blind')

    const over = makeCampaign({ pool: 1000, share: 1, rings: [20000, 35000, 55000] })
    const o = resolveForaging(over, 'Overwhelming')
    expect(o.forage.capacity).toBe(Math.floor(1000 * FORAGE_KG_PER_POINT * 1.25))
  })
})
