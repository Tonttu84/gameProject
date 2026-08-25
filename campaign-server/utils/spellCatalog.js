// The engine's spell roster, held in memory for the life of the process.
//
// The twin of utils/catalog.js, and deliberately NOT its copy: unit types live
// in Mongo because campaign math queries them and documents reference them by
// name, while nothing whatsoever refers to a spell — the roster is read-only
// reference data that only ever gets rendered. So this is a plain module cache,
// filled once at boot (index.js) from `./game dump-spells`, and slice 3 needs no
// schema and no collection to put The Study on screen.
//
// Filled at boot rather than lazily, for the same reason the unit catalog is:
// a wedged engine subprocess should stop the boot loudly, not surface as an
// empty screen on somebody's first turn.
let cache = null

// Degrades to an EMPTY roster rather than throwing when nothing has been loaded.
// That is what lets the structural tests — which mock services/engine.js whole
// and never boot — sweep campaignView without each of them having to know that
// spells exist. In a real process boot has always filled it, and a boot that
// could not fill it never reached listen().
export const getSpellCatalog = () => cache ?? []

// Boot calls this with the engine's export; tests call it with a fixture.
export const setSpellCatalog = (spells) => {
  cache = Array.isArray(spells?.spells) ? spells.spells : (spells ?? [])
}

export const clearSpellCatalogCache = () => { cache = null }
