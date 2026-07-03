import { getInfo } from './engine.js'
import UnitType from '../models/unitType.js'

// Build a concrete enemy_placement array from the campaign's hidden enemy
// army: a random spread over the enemy zone, capacity-aware so the engine
// never rejects it. Stored on the campaign (HIDDEN) so that (a) the engine
// receives exactly it, and (b) a scouting reveal can show the player the
// truth rather than a guess.
//
// Placement entries are AXIAL {unit_type, q, r} — same convention the
// frontend uses: q = col - floor(row / 2).
export async function buildEnemyPlacement(army) {
  const info = await getInfo()
  const { width } = info.grid
  const hexCapacity = info.grid.hexCapacity
  const { rowMin, rowMax } = info.enemyZone

  // Sizes for ALL types (info.units only lists placeable ones; the enemy
  // fields spawnable-only types like Necromancer too).
  const types = await UnitType.find({})
  const sizeOf = new Map(types.map((t) => [t.name, t.size]))

  // Candidate hexes with remaining capacity, shuffled per placement call.
  const cells = []
  for (let row = rowMin; row <= rowMax; row++)
    for (let col = 0; col < width; col++)
      cells.push({ q: col - Math.floor(row / 2), r: row, used: 0 })

  const shuffled = cells.sort(() => Math.random() - 0.5)

  const placement = []
  let cursor = 0
  const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
  for (const [type, count] of entries) {
    const size = sizeOf.get(type)
    if (!size) continue // unknown type — engine would reject it anyway
    for (let i = 0; i < count; i++) {
      // Advance past full hexes; wrap once. If the zone is truly full the
      // remaining units are left off the field (they guard the camp).
      let tries = 0
      while (tries < shuffled.length && shuffled[cursor % shuffled.length].used + size > hexCapacity) {
        cursor++
        tries++
      }
      const cell = shuffled[cursor % shuffled.length]
      if (cell.used + size > hexCapacity) break
      cell.used += size
      placement.push({ unit_type: type, q: cell.q, r: cell.r })
      cursor++
    }
  }
  return placement
}
