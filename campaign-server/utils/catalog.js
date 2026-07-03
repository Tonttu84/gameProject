import UnitType from '../models/unitType.js'

// Module-level cache of the unit catalog as a Map name → unit type document.
// The catalog is synced once at boot (index.js) and never changes while the
// server runs, so campaign math (food needs, forage values, clash strengths)
// reads this instead of hitting Mongo on every request. Tests re-seed the
// collection per test and must clearCatalogCache() alongside.
let cache = null

export async function getCatalog() {
  if (!cache) {
    const types = await UnitType.find({})
    cache = new Map(types.map((t) => [t.name, t]))
  }
  return cache
}

export const clearCatalogCache = () => { cache = null }
