import { describe, expect, test } from 'vitest'
import { findOverstackedHex } from '../services/placementCapacity.js'

// Pure hex-capacity math — the guard that stops a battle from being sent to
// the engine with more troops crammed onto one hex than it can hold. The
// engine silently drops overflow units rather than rejecting the battle, so
// this check must run BEFORE the battle, not be inferred from its result.

const catalog = new Map([
  ['Soldier', { size: 10 }],
  ['Archer', { size: 10 }],
  ['Cavalry', { size: 20 }],
])

describe('findOverstackedHex', () => {
  test('within capacity on every hex → null', () => {
    const placement = [
      { unit_type: 'Soldier', q: 1, r: 1 },
      { unit_type: 'Soldier', q: 1, r: 1 },
      { unit_type: 'Archer', q: 2, r: 2 },
    ]
    expect(findOverstackedHex(placement, catalog, 640)).toBeNull()
  })

  test('exactly at capacity is allowed, not flagged', () => {
    const placement = Array.from({ length: 64 }, () => ({ unit_type: 'Soldier', q: 1, r: 1 }))
    expect(findOverstackedHex(placement, catalog, 640)).toBeNull() // 64 * 10 == 640
  })

  test('one unit over capacity on a single hex is flagged', () => {
    const placement = Array.from({ length: 65 }, () => ({ unit_type: 'Soldier', q: 1, r: 1 }))
    const result = findOverstackedHex(placement, catalog, 640)
    expect(result).toEqual({ q: 1, r: 1, used: 650, hexCapacity: 640 })
  })

  test('loose entries AND squad-tagged entries on the same hex share one budget', () => {
    // Mirrors the real bug: a squad's members plus loose troops on one hex.
    const placement = [
      ...Array.from({ length: 40 }, () => ({ unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 })), // 400
      ...Array.from({ length: 30 }, () => ({ unit_type: 'Archer', q: 4, r: 4, squad_id: 2 })),  // 300
      ...Array.from({ length: 12 }, () => ({ unit_type: 'Cavalry', q: 4, r: 4, squad_id: 3 })), // 240
      // 940 already over 640 before any loose troops are even added.
    ]
    const result = findOverstackedHex(placement, catalog, 640)
    expect(result).not.toBeNull()
    expect(result.q).toBe(4)
    expect(result.r).toBe(4)
  })

  test('capacity is tracked per hex independently — full on one, fine on another', () => {
    const placement = [
      ...Array.from({ length: 65 }, () => ({ unit_type: 'Soldier', q: 1, r: 1 })), // over
      { unit_type: 'Soldier', q: 2, r: 2 }, // fine
    ]
    const result = findOverstackedHex(placement, catalog, 640)
    expect(result.q).toBe(1)
    expect(result.r).toBe(1)
  })

  test('an unknown unit_type is skipped, not counted or thrown on', () => {
    const placement = [{ unit_type: 'Dragon', q: 1, r: 1 }]
    expect(() => findOverstackedHex(placement, catalog, 640)).not.toThrow()
    expect(findOverstackedHex(placement, catalog, 640)).toBeNull()
  })

  test('reports the FIRST hex to overflow in entry order', () => {
    const placement = [
      ...Array.from({ length: 65 }, () => ({ unit_type: 'Soldier', q: 5, r: 5 })),
      ...Array.from({ length: 65 }, () => ({ unit_type: 'Soldier', q: 6, r: 6 })),
    ]
    const result = findOverstackedHex(placement, catalog, 640)
    expect(result.q).toBe(5)
    expect(result.r).toBe(5)
  })
})
