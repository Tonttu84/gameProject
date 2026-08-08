import { describe, expect, test } from 'vitest'
import { makeZonePlacer, spreadPlacement } from '../services/enemyPlacement.js'
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

// addBlock is the squad path: the engine groups placement entries into
// formations by (hex, squad_id), so a raid party only fights as squads if every
// member of a squad lands on the SAME hex. These tests pin that — a scattered
// squad is the bug they exist to catch.
describe('makeZonePlacer.addBlock', () => {
  const hexesOf = (placement) => new Set(placement.map((p) => `${p.q}|${p.r}`))

  test('a whole squad lands on one hex, and each squad gets its own', () => {
    const zone = { rowMin: 0, rowMax: 3, width: 4, hexCapacity: 640 }
    for (let run = 0; run < RUNS; run++) {
      const placer = makeZonePlacer(zone, sizeOf)
      placer.addBlock({ Soldier: 20, Archer: 10 }, { squad_id: 1, squad_name: '1st Cohort' })
      placer.addBlock({ Cavalry: 5 }, { squad_id: 2, squad_name: 'Outriders' })
      const placement = placer.result()
      expect(placement).toHaveLength(35)
      expectNoOverstack(placement, zone.hexCapacity)

      const first = placement.filter((p) => p.squad_id === 1)
      const second = placement.filter((p) => p.squad_id === 2)
      expect(hexesOf(first).size).toBe(1)
      expect(hexesOf(second).size).toBe(1)
      expect([...hexesOf(first)]).not.toEqual([...hexesOf(second)])
      // The mixed squad keeps both unit types together on its single hex.
      expect(first.filter((p) => p.unit_type === 'Archer')).toHaveLength(10)
      expect(first.every((p) => p.squad_name === '1st Cohort')).toBe(true)
    }
  })

  test('a squad shares a hex only when the zone has no empty one left', () => {
    // One hex, capacity 640: two 100-point squads have nowhere else to go, so
    // they stack — still two formations to the engine (distinct squad_id).
    const zone = { rowMin: 0, rowMax: 0, width: 1, hexCapacity: 640 }
    const placer = makeZonePlacer(zone, sizeOf)
    placer.addBlock({ Soldier: 10 }, { squad_id: 1 })
    placer.addBlock({ Soldier: 10 }, { squad_id: 2 })
    const placement = placer.result()
    expect(placement).toHaveLength(20)
    expect(hexesOf(placement).size).toBe(1)
    expectNoOverstack(placement, zone.hexCapacity)
  })

  test('a squad bigger than one hex packs into as few hexes as it can', () => {
    // 10 Soldiers (100 points) into 30-capacity hexes: no single hex can hold
    // the squad, so it fills 3 per hex — 4 hexes, the minimum — rather than
    // scattering one per hex.
    const zone = { rowMin: 0, rowMax: 1, width: 4, hexCapacity: 30 }
    for (let run = 0; run < RUNS; run++) {
      const placer = makeZonePlacer(zone, sizeOf)
      placer.addBlock({ Soldier: 10 }, { squad_id: 7 })
      const placement = placer.result()
      expect(placement).toHaveLength(10)
      expect(hexesOf(placement).size).toBe(4)
      expectNoOverstack(placement, zone.hexCapacity)
    }
  })

  test('a block that outgrows the zone leaves the remainder off the field', () => {
    const zone = { rowMin: 0, rowMax: 0, width: 2, hexCapacity: 15 }
    const placer = makeZonePlacer(zone, sizeOf)
    placer.addBlock({ Soldier: 5 }, { squad_id: 1 })
    const placement = placer.result()
    expect(placement).toHaveLength(2)
    expectNoOverstack(placement, zone.hexCapacity)
  })

  test('unknown types are skipped; an all-unknown block places nothing', () => {
    const zone = { rowMin: 0, rowMax: 0, width: 4, hexCapacity: 640 }
    const placer = makeZonePlacer(zone, sizeOf)
    placer.addBlock({ Dragon: 3, Soldier: 2 }, { squad_id: 1 })
    placer.addBlock({ Dragon: 2 }, { squad_id: 2 })
    const placement = placer.result()
    expect(placement).toHaveLength(2)
    expect(placement.every((p) => p.unit_type === 'Soldier' && p.squad_id === 1)).toBe(true)
  })

  test('add and addBlock share the pool without overstacking', () => {
    // A 30-capacity hex holds 3 Soldiers. The loose spread goes first, one per
    // hex, leaving 20 free everywhere; the block must fit itself into what's
    // left and still keep to a single hex.
    const zone = { rowMin: 0, rowMax: 0, width: 3, hexCapacity: 30 }
    for (let run = 0; run < RUNS; run++) {
      const placer = makeZonePlacer(zone, sizeOf)
      placer.add({ Soldier: 3 })
      placer.addBlock({ Soldier: 2 }, { squad_id: 1 })
      const placement = placer.result()
      expect(placement).toHaveLength(5)
      expectNoOverstack(placement, zone.hexCapacity)
      expect(hexesOf(placement.filter((p) => p.squad_id === 1)).size).toBe(1)
    }
  })
})
