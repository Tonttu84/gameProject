import { getInfo } from './engine.js'
import UnitType from '../models/unitType.js'

// Capacity-aware random spread of an army over a deployment zone — the shared
// auto-placement core (Stage 4 Part 2 extraction): the enemy's daily plan and
// BOTH sides of a raid use this one function, so auto-placement can't drift
// between them. `army` is {type: count} (object or Map); `zone` carries
// {rowMin, rowMax, width, hexCapacity}; `sizeOf` is a Map name → size.
//
// Placement entries are AXIAL {unit_type, q, r} — same convention the
// frontend uses: q = col - floor(row / 2).
//
// A zone placer is a stateful spread over ONE shuffled hex pool: `add(army)`
// may be called repeatedly and the shared cursor/used tracking carries across
// calls, so several armies (e.g. one raid party's squads) fill the same zone
// without overstacking each other. `extra` is merged onto every entry — this
// is how squad members carry `squad_id` into the engine's placement JSON so a
// raid returns a per-squad survivor breakdown (`blue_squads`), the same as the
// main battle route.
export function makeZonePlacer({ rowMin, rowMax, width, hexCapacity }, sizeOf) {
  // Candidate hexes with remaining capacity, shuffled once for this placer.
  const cells = []
  for (let row = rowMin; row <= rowMax; row++)
    for (let col = 0; col < width; col++)
      cells.push({ q: col - Math.floor(row / 2), r: row, used: 0 })
  const shuffled = cells.sort(() => Math.random() - 0.5)

  const placement = []
  let cursor = 0
  const add = (army, extra = {}) => {
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
        placement.push({ unit_type: type, q: cell.q, r: cell.r, ...extra })
        cursor++
      }
    }
  }
  return { add, result: () => placement }
}

// One-shot spread of a single army over a zone (the enemy's daily plan and the
// enemy side of a raid): a placer used once.
export function spreadPlacement(army, zone, sizeOf) {
  const placer = makeZonePlacer(zone, sizeOf)
  placer.add(army)
  return placer.result()
}

// Build a concrete enemy_placement array from the campaign's hidden enemy
// army: a random spread over the enemy zone. Stored on the campaign (HIDDEN)
// so that (a) the engine receives exactly it, and (b) a scouting reveal can
// show the player the truth rather than a guess.
export async function buildEnemyPlacement(army) {
  const info = await getInfo()

  // Sizes for ALL types (info.units only lists placeable ones; the enemy
  // fields spawnable-only types like Necromancer too).
  const types = await UnitType.find({})
  const sizeOf = new Map(types.map((t) => [t.name, t.size]))

  return spreadPlacement(
    army,
    { ...info.enemyZone, width: info.grid.width, hexCapacity: info.grid.hexCapacity },
    sizeOf,
  )
}
