import app, { apiRoutes } from './app.js'
import config from './utils/config.js'
import { connectDb } from './utils/db.js'
import { dumpSpells, dumpUnits, getInfo } from './services/engine.js'
import { syncCatalog } from './services/catalogSync.js'
import { getSpellCatalog, setSpellCatalog } from './utils/spellCatalog.js'
import { seedDevUser, devLoginAvailable } from './services/devSeed.js'

// Boot: DB up → catalog synced from the engine (single source of truth) →
// spell roster read from the same binary → info cache warmed → listen. A failed catalog sync aborts the boot on
// purpose: serving stale/invalid unit data would be worse than being down.
// Each phase logs BEFORE it runs so a hung boot (unreachable Mongo, wedged
// engine subprocess) shows where it stopped instead of sitting silent.
const start = async () => {
  console.log(`boot: connecting to MongoDB (${config.MONGODB_URI ? 'external' : 'embedded'})...`)
  await connectDb()
  console.log('boot: syncing unit catalog from the engine...')
  const count = await syncCatalog(await dumpUnits())
  console.log(`unit catalog synced (${count} types)`)
  // The spell roster (slice 3), read from the same binary and held in memory
  // rather than in Mongo — nothing queries a spell, so it needs no collection.
  // A failure here aborts the boot like the catalog sync above it: The Study
  // with an empty roster would read as "your mages know nothing" rather than as
  // the outage it actually is.
  console.log('boot: reading the spell roster from the engine...')
  setSpellCatalog(await dumpSpells())
  console.log(`spell roster loaded (${getSpellCatalog().length} forms)`)
  if (await seedDevUser())
    console.log(`dev user seeded (${config.DEV_USER}/${config.DEV_PASSWORD})`)
  await getInfo()

  // The success banner prints ONLY from the listen callback, and the route
  // list is the same array app.js mounts from — it cannot drift. The pid is
  // there so a port squatter can be told apart from this instance.
  const server = app.listen(config.PORT, () => {
    console.log(`campaign server on http://localhost:${config.PORT} (pid ${process.pid})`)
    console.log(`  mounted: ${apiRoutes.map(([route]) => route).join('  ')}`)
    console.log('  (endpoint details: API.md)')
    // Point at where the GAME actually is: this server serves the UI only
    // when FRONTEND_DIST is set (container). In native dev the UI is the Vite
    // dev server on its default port 5173 (vite.config.js sets only the proxy).
    if (devLoginAvailable()) {
      const gameUrl = config.FRONTEND_DIST
        ? `http://localhost:${config.PORT}`
        : 'http://localhost:5173 (the Vite dev server — this port is the API only)'
      console.log(`\nReady: open ${gameUrl} and log in as ${config.DEV_USER} / ${config.DEV_PASSWORD}`)
    }
  })
  // A failed bind must kill the boot loudly. Without this, EADDRINUSE leaves
  // a lame-duck process that logs nothing and serves nothing while another
  // (possibly stale) instance answers the port — that exact scenario burned a
  // debugging session: a root-owned server from an old checkout answered 3001
  // with pre-sample-battle routes while the fresh boot sat silent beside it.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `boot failed: port ${config.PORT} is already in use — another campaign-server instance?\n` +
        `  find it with: ss -tlnp | grep ${config.PORT}   (root-owned? sudo ss -tlnp)`)
    } else {
      console.error('boot failed:', err)
    }
    process.exit(1)
  })
}

start().catch((err) => {
  console.error('boot failed:', err)
  process.exit(1)
})
