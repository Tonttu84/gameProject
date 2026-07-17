import { describe, expect, test } from 'vitest'
import { spreadPlacement } from '../services/enemyPlacement.js'
import { catalogFixture } from './fixtures/catalog.js'
import { ENEMY_ARMY } from '../utils/campaignConfig.js'

// Property tests for the shared auto-placement core (enemy daily plan + both
// sides of every raid). The engine silently DROPS per-hex overflow rather
// than rejecting the battle — the player's placement is guarded by
// findOverstackedHex at the route, but the ENEMY side goes straight from
// spreadPlacement into the battle input with no guard. So spreadPlacement
// itself must never emit an overstacked hex, and must field every unit when
// the zone has room — otherwise enemy troops silently vanish from battles.
//
// spreadPlacement shuffles its candidate hexes with Math.random (a per-call
// shuffle, deliberately not the dice queue), so each test runs the call many
// times and asserts properties that must hold for EVERY shuffle.

const sizeOf = new Map(catalogFixture.units.map((u) => [u.name, u.size]))
const RUNS = 25

// Σ size per hex, keyed "q|r".
const usedByHex = (placement) => {
  const used = new Map()
  for (const { unit_type, q, r } of placement) {
    const key = `${q}|${r}`
    used.set(key, (used.get(key) ?? 0) + sizeOf.get(unit_type))
  }
  return used
}

const expectNoOverstack = (placement, hexCapacity) => {
  for (const [hex, used] of usedByHex(placement))
    expect(used, `hex ${hex} overstacked: ${used}/${hexCapacity}`).toBeLessThanOrEqual(hexCapacity)
}

describe('spreadPlacement', () => {
  test('real enemy zone + full starting host: every unit placed, no hex over capacity, all inside the zone', () => {
    // The production geometry (maps/sample_battle.json via ./game info):
    // rows 22–29 × 16 cols = 128 hexes × 640 capacity = 81,920 size-points of
    // room. The full host needs (540+150+11)×10 + 20×20 = 7,410 — so a
    // dropped unit here is always an algorithm bug, never a full zone.
    const zone = { rowMin: 22, rowMax: 29, width: 16, hexCapacity: 640 }
    const total = Object.values(ENEMY_ARMY).reduce((a, b) => a + b, 0) // 721

    for (let run = 0; run < RUNS; run++) {
      const placement = spreadPlacement(ENEMY_ARMY, zone, sizeOf)
      expect(placement).toHaveLength(total)
      expectNoOverstack(placement, zone.hexCapacity)
      for (const { q, r } of placement) {
        expect(r).toBeGreaterThanOrEqual(zone.rowMin)
        expect(r).toBeLessThanOrEqual(zone.rowMax)
        // Axial q = col − floor(r/2): invert to the visual column and pin it
        // inside the grid.
        const col = q + Math.floor(r / 2)
        expect(col).toBeGreaterThanOrEqual(0)
        expect(col).toBeLessThan(zone.width)
      }
    }
  })

  test('an exactly-full zone is packed to the last size-point', () => {
    // 2 hexes × 20 capacity = 40 = 4 Soldiers × size 10: uniform sizes with
    // capacity a multiple of the size means a free slot always exists while
    // units remain, so all 4 must land — 2 per hex, both hexes at exactly 20.
    const zone = { rowMin: 0, rowMax: 0, width: 2, hexCapacity: 20 }
    for (let run = 0; run < RUNS; run++) {
      const placement = spreadPlacement({ Soldier: 4 }, zone, sizeOf)
      expect(placement).toHaveLength(4)
      const used = usedByHex(placement)
      expect([...used.values()]).toEqual([20, 20])
    }
  })

  test('overflow beyond the zone\'s room stays off the field — never overstacked', () => {
    // Capacity 15 holds ONE size-10 Soldier per hex (a second would make 20).
    // 5 Soldiers into 2 hexes: exactly 2 placed, 3 left behind ("they guard
    // the camp"), and no hex ever exceeds 15.
    const zone = { rowMin: 0, rowMax: 0, width: 2, hexCapacity: 15 }
    for (let run = 0; run < RUNS; run++) {
      const placement = spreadPlacement({ Soldier: 5 }, zone, sizeOf)
      expect(placement).toHaveLength(2)
      expectNoOverstack(placement, zone.hexCapacity)
      expect([...usedByHex(placement).values()]).toEqual([10, 10])
    }
  })

  test('mixed sizes pack around each other up to exact capacity', () => {
    // 3 hexes × 30 = 90 = 3 Cavalry (size 20) + 3 Soldiers (size 10). The
    // cursor advances per placement, so the cavalry spread over the three
    // hexes (20 each) and each soldier fits the 10 that remains — a
    // Cavalry-after-Soldier ordering can never overstack a 30-hex.
    const zone = { rowMin: 4, rowMax: 4, width: 3, hexCapacity: 30 }
    for (let run = 0; run < RUNS; run++) {
      const placement = spreadPlacement({ Cavalry: 3, Soldier: 3 }, zone, sizeOf)
      expect(placement).toHaveLength(6)
      expect([...usedByHex(placement).values()]).toEqual([30, 30, 30])
    }
  })

  test('unknown types are skipped; the rest still place', () => {
    const zone = { rowMin: 0, rowMax: 0, width: 4, hexCapacity: 640 }
    const placement = spreadPlacement({ Dragon: 3, Soldier: 2 }, zone, sizeOf)
    expect(placement).toHaveLength(2)
    expect(placement.every((p) => p.unit_type === 'Soldier')).toBe(true)
  })
})
