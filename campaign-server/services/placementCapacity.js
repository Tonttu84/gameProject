// Guards a player_placement array against overstacking a hex beyond the
// engine's real capacity (Hex::CAPACITY, exposed as info.grid.hexCapacity).
//
// The engine's buildArmyFromPlacement (UnitRegistry.cpp) silently DROPS
// units past a hex's capacity rather than rejecting the whole battle — but
// the campaign battle route debits the roster for what the CLIENT sent, not
// what the engine actually placed (see routes/campaigns.js's `placed` map).
// So a placement that overflows a hex would quietly cost the player those
// units with no combat ever fought for them. This must be checked BEFORE
// the battle runs, not inferred from the result afterward.
//
// Squad-tagged and loose entries share the same hex budget — a squad
// occupies real space on the hex exactly like loose troops; this function
// doesn't distinguish between them (mirrors the engine's own accounting).

// Returns the first hex whose combined entries exceed capacity —
// {q, r, used, hexCapacity} — or null if every hex is within budget.
// `catalog` is a Map name -> {size}, the same shape utils/catalog.js's
// getCatalog() returns.
export function findOverstackedHex(placement, catalog, hexCapacity) {
  const used = new Map() // "q,r" -> size total so far
  for (const entry of placement) {
    const size = catalog.get(entry.unit_type)?.size
    if (!size) continue // unknown type — buildArmyFromPlacement would skip it too
    const key = `${entry.q},${entry.r}`
    const total = (used.get(key) ?? 0) + size
    used.set(key, total)
    if (total > hexCapacity) {
      const [q, r] = key.split(',').map(Number)
      return { q, r, used: total, hexCapacity }
    }
  }
  return null
}
