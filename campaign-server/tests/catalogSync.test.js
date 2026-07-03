import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import UnitType from '../models/unitType.js'
import { syncCatalog } from '../services/catalogSync.js'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { catalogFixture } from './fixtures/catalog.js'

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(clearDb)

describe('catalog sync (dump-units → DB)', () => {
  test('imports every catalog entry', async () => {
    await syncCatalog(catalogFixture)
    const all = await UnitType.find({})
    expect(all.map((u) => u.name).sort()).toEqual(
      catalogFixture.units.map((u) => u.name).sort(),
    )
  })

  test('is idempotent — syncing twice leaves one doc per type', async () => {
    await syncCatalog(catalogFixture)
    await syncCatalog(catalogFixture)
    expect(await UnitType.countDocuments()).toBe(catalogFixture.units.length)
  })

  test('a changed stat in the export updates the stored doc', async () => {
    await syncCatalog(catalogFixture)
    const changed = structuredClone(catalogFixture)
    changed.units[0].size = 12
    changed.units[0].stats.maxHP = 99
    await syncCatalog(changed)
    const soldier = await UnitType.findOne({ name: 'Soldier' })
    expect(soldier.size).toBe(12)
    expect(soldier.stats.maxHP).toBe(99)
  })

  test('types removed from the export are removed from the DB', async () => {
    await syncCatalog(catalogFixture)
    const smaller = { units: catalogFixture.units.slice(0, 1) }
    await syncCatalog(smaller)
    const all = await UnitType.find({})
    expect(all.map((u) => u.name)).toEqual(['Soldier'])
  })

  test('an invalid entry fails the sync loudly (schema enforcement)', async () => {
    const bad = structuredClone(catalogFixture)
    delete bad.units[1].stats
    await expect(syncCatalog(bad)).rejects.toThrow()
  })

  test('rejects an export without a units array', async () => {
    await expect(syncCatalog({})).rejects.toThrow()
  })
})
