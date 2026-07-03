import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { catalogFixture } from './fixtures/catalog.js'

vi.mock('../services/engine.js', () => ({
  runBattle: vi.fn(),
  getInfo: vi.fn(),
  dumpUnits: vi.fn(),
  EngineProcessError: class EngineProcessError extends Error {
    name = 'EngineProcessError'
  },
  EngineOutputError: class EngineOutputError extends Error {
    name = 'EngineOutputError'
  },
}))

const engine = await import('../services/engine.js')
const { default: app } = await import('../app.js')
const { syncCatalog } = await import('../services/catalogSync.js')

const api = supertest(app)

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
})

describe('GET /api/units', () => {
  test('returns the synced catalog', async () => {
    await syncCatalog(catalogFixture)
    const res = await api.get('/api/units')
    expect(res.status).toBe(200)
    expect(res.body.length).toBe(catalogFixture.units.length)
    const soldier = res.body.find((u) => u.name === 'Soldier')
    expect(soldier).toMatchObject({
      symbol: 'X',
      size: 10,
      placeable: true,
      forbiddenTerrain: [],
    })
    expect(soldier.stats.maxHP).toBe(10)
  })
})

describe('GET /api/info', () => {
  test('returns the cached engine info', async () => {
    engine.getInfo.mockResolvedValue({ grid: { width: 16, height: 30 }, units: [] })
    const res = await api.get('/api/info')
    expect(res.status).toBe(200)
    expect(res.body.grid.width).toBe(16)
  })
})

describe('GET /api/map', () => {
  test('rejects path-traversal names', async () => {
    for (const name of ['../secret', 'a/b', 'a\\b', ''])
      expect((await api.get('/api/map').query({ name })).status).toBe(400)
  })

  test('404 for a well-formed but missing map', async () => {
    const res = await api.get('/api/map?name=no_such_map_xyz')
    expect(res.status).toBe(404)
  })
})
