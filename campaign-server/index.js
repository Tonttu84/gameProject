import app from './app.js'
import config from './utils/config.js'
import { connectDb } from './utils/db.js'
import { dumpUnits, getInfo } from './services/engine.js'
import { syncCatalog } from './services/catalogSync.js'
import { seedDevUser, devLoginAvailable } from './services/devSeed.js'

// Boot: DB up → catalog synced from the engine (single source of truth) →
// info cache warmed → listen. A failed catalog sync aborts the boot on
// purpose: serving stale/invalid unit data would be worse than being down.
// Each phase logs BEFORE it runs so a hung boot (unreachable Mongo, wedged
// engine subprocess) shows where it stopped instead of sitting silent.
const start = async () => {
  console.log(`boot: connecting to MongoDB (${config.MONGODB_URI ? 'external' : 'embedded'})...`)
  await connectDb()
  console.log('boot: syncing unit catalog from the engine...')
  const count = await syncCatalog(await dumpUnits())
  console.log(`unit catalog synced (${count} types)`)
  if (await seedDevUser())
    console.log(`dev user seeded (${config.DEV_USER}/${config.DEV_PASSWORD})`)
  await getInfo()

  app.listen(config.PORT, () => {
    console.log(`campaign server on http://localhost:${config.PORT}`)
    console.log('  GET  /api/units             — unit catalog (from DB)')
    console.log('  GET  /api/info              — grid/placeable-unit info')
    console.log('  GET  /api/map[?name=]       — map JSON')
    console.log('  POST /api/battles           — run + store a sandbox battle')
    console.log('  GET  /api/battles/:id       — battle summary')
    console.log('  GET  /api/battles/:id/ticks — replay tick range')
    console.log('  POST /api/campaigns              — start a campaign')
    console.log('  GET  /api/campaigns[/:id]        — my campaigns / one view')
    console.log('  POST /api/campaigns/:id/augury/consult — read the turn\'s omen')
    console.log('  POST /api/campaigns/:id/augury/reroll  — recast fate (redraws both events)')
    console.log('  POST /api/campaigns/:id/forage   — assign foragers for the turn')
    console.log('  POST /api/campaigns/:id/battles  — fight the turn\'s battle')
    console.log('  POST /api/campaigns/:id/end-day  — resolve the turn (two weeks)')
    if (devLoginAvailable())
      console.log(`\nReady: open http://localhost:${config.PORT} and log in as ${config.DEV_USER} / ${config.DEV_PASSWORD}`)
  })
}

start().catch((err) => {
  console.error('boot failed:', err)
  process.exit(1)
})
