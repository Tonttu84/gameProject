import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { battleResultFixture } from './fixtures/battleResult.js'

// Stub the engine service — the sample route is about the HTTP + persistence
// pipeline, not the C++ binary. runSample() stands in for `./game sample`.
vi.mock('../services/engine.js', () => ({
  runBattle: vi.fn(),
  runSample: vi.fn(),
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
const { default: Battle } = await import('../models/battle.js')
const { default: Tick } = await import('../models/tick.js')

const api = supertest(app)

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
})

describe('POST /api/sample-battle', () => {
  test('needs no login: runs the scenario, stores it, returns a summary', async () => {
    engine.runSample.mockResolvedValue(structuredClone(battleResultFixture))

    // No Authorization header — the login screen calls this before signing in.
    const res = await api.post('/api/sample-battle')

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.winner).toBe('blue')
    expect(res.body.tickCount).toBe(3)
    expect(engine.runSample).toHaveBeenCalledOnce()
  })

  test('persists Battle + one Tick doc per turn, ownerless, so ReplayView can render from the DB', async () => {
    engine.runSample.mockResolvedValue(structuredClone(battleResultFixture))
    const { body } = await api.post('/api/sample-battle')

    expect(await Battle.countDocuments()).toBe(1)
    const battle = await Battle.findById(body.id)
    expect(battle.user).toBeNull() // demo battle has no owner
    expect(battle.map).toBe('sample_battle')

    const ticks = await Tick.find({}).sort({ index: 1 })
    expect(ticks.map((t) => t.index)).toEqual([0, 1, 2])
    // The engine's layout offsets must survive persistence — the DB is the
    // render interface (same guarantee battles.test pins for real battles).
    expect(ticks[0].units[0].ox).toBe(0)
    expect(ticks[0].units[0].sz).toBe(0.2)
    expect(ticks[1].units[1].side).toBe(1)
  })

  test('the stored ticks are then fetchable through the public battles route (the render path)', async () => {
    engine.runSample.mockResolvedValue(structuredClone(battleResultFixture))
    const { body } = await api.post('/api/sample-battle')

    // ReplayView(battleId) fetches ticks here — no auth, same as a real battle.
    const res = await api.get(`/api/battles/${body.id}/ticks`)
    expect(res.status).toBe(200)
    expect(res.body.map((t) => t.index)).toEqual([0, 1, 2])
  })

  test('the replay blob is not echoed in the response (fetched tick-by-tick instead)', async () => {
    engine.runSample.mockResolvedValue(structuredClone(battleResultFixture))
    const res = await api.post('/api/sample-battle')
    expect(res.body.replay).toBeUndefined()
  })

  test('an engine process failure becomes 502 and stores nothing', async () => {
    engine.runSample.mockRejectedValue(new engine.EngineProcessError('spawn failed'))
    const res = await api.post('/api/sample-battle')
    expect(res.status).toBe(502)
    expect(await Battle.countDocuments()).toBe(0)
  })
})
