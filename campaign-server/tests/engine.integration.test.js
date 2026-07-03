import fs from 'node:fs'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import config from '../utils/config.js'
import { dumpUnits, getInfo } from '../services/engine.js'
import { syncCatalog } from '../services/catalogSync.js'
import UnitType from '../models/unitType.js'
import { startTestDb, stopTestDb } from './helpers/db.js'

// Contract test against the real C++ binary: what dump-units emits must pass
// the Mongoose schema unchanged, so the DB can never silently drift from the
// engine. Skipped when ./game hasn't been built (e.g. plain `npm test` on a
// fresh checkout).
const hasEngine = fs.existsSync(config.ENGINE_BIN)

describe.skipIf(!hasEngine)('real engine contract', () => {
  beforeAll(startTestDb)
  afterAll(stopTestDb)

  test('dump-units output passes schema validation and syncs 1:1 into the DB', async () => {
    const catalog = await dumpUnits()
    expect(catalog.units.length).toBeGreaterThanOrEqual(10)

    await syncCatalog(catalog)

    const stored = await UnitType.find({})
    expect(stored.map((u) => u.name).sort()).toEqual(
      catalog.units.map((u) => u.name).sort(),
    )
    for (const unit of catalog.units) {
      const doc = stored.find((d) => d.name === unit.name)
      expect(doc.size).toBe(unit.size)
      expect(doc.symbol).toBe(unit.symbol)
      expect([...doc.forbiddenTerrain]).toEqual(unit.forbiddenTerrain)
    }
  }, 30000)

  test('info output has the grid/units shape the frontend relies on', async () => {
    const info = await getInfo()
    expect(info.grid.width).toBeGreaterThan(0)
    // info.units is exactly the placeable subset of the catalog — pin it to
    // dump-units instead of a count so adding a unit type can't silently
    // desync the two engine exports.
    const catalog = await dumpUnits()
    const placeable = catalog.units.filter((u) => u.placeable).map((u) => u.name).sort()
    expect(info.units.map((u) => u.type).sort()).toEqual(placeable)
    for (const u of info.units)
      expect(u).toMatchObject({ type: expect.any(String), placementSize: expect.any(Number) })
  }, 30000)
})
