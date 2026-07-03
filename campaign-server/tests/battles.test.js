import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'

// Stub the engine service — these tests cover the HTTP + persistence layer,
// not the C++ binary (that has its own Catch2 suite and an integration test).
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
const { default: Battle } = await import('../models/battle.js')
const { default: Tick } = await import('../models/tick.js')
const { default: User } = await import('../models/user.js')
const { default: config } = await import('../utils/config.js')

const api = supertest(app)

// POST /api/battles requires a login; recreated per test because clearDb()
// wipes the users collection too.
let token, userId

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  ;({ token, userId } = await createUserAndToken(api))
})

const runFixtureBattle = async () => {
  engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
  return api
    .post('/api/battles')
    .set('Authorization', `Bearer ${token}`)
    .send({ map: 'sample_battle', player_placement: [{ unit_type: 'Soldier', q: 4, r: 4 }] })
}

describe('POST /api/battles', () => {
  test('runs the engine, stores battle + one tick doc per turn, returns summary', async () => {
    const res = await runFixtureBattle()
    expect(res.status).toBe(201)
    expect(res.body.winner).toBe('blue')
    expect(res.body.blue_survivors).toEqual({ Soldier: 2 })
    expect(res.body.tickCount).toBe(3)
    expect(res.body.id).toBeDefined()

    expect(engine.runBattle).toHaveBeenCalledWith(
      expect.objectContaining({ map: 'sample_battle' }),
    )

    expect(await Battle.countDocuments()).toBe(1)
    const ticks = await Tick.find({}).sort({ index: 1 })
    expect(ticks.length).toBe(3)
    expect(ticks.map((t) => t.index)).toEqual([0, 1, 2])
    expect(ticks[0].units.length).toBe(3)
    expect(ticks[2].log).toEqual(['Zombie (red) fell'])
  })

  test('replay is not echoed back in the response (fetched separately)', async () => {
    const res = await runFixtureBattle()
    expect(res.body.replay).toBeUndefined()
  })

  test('an engine-level error becomes 400 and stores nothing', async () => {
    engine.runBattle.mockResolvedValue({ error: 'invalid map name' })
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${token}`)
      .send({ map: 'bad' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid map name')
    expect(await Battle.countDocuments()).toBe(0)
  })

  test('an engine process failure becomes 502', async () => {
    engine.runBattle.mockRejectedValue(new engine.EngineProcessError('spawn failed'))
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(502)
  })

  test('malformed engine output becomes 500', async () => {
    engine.runBattle.mockRejectedValue(new engine.EngineOutputError('not json'))
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(500)
  })
})

describe('POST /api/battles auth', () => {
  test('401 without a token; engine never runs, nothing stored', async () => {
    const res = await api.post('/api/battles').send({ map: 'sample_battle' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token missing')
    expect(engine.runBattle).not.toHaveBeenCalled()
    expect(await Battle.countDocuments()).toBe(0)
  })

  test('401 for a garbage token', async () => {
    const res = await api
      .post('/api/battles')
      .set('Authorization', 'Bearer nonsense')
      .send({ map: 'sample_battle' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token invalid')
  })

  test('401 for a token signed with the wrong secret', async () => {
    const forged = jwt.sign({ username: 'tester', id: userId }, 'not-the-secret')
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${forged}`)
      .send({ map: 'sample_battle' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token invalid')
  })

  test('401 for an expired token', async () => {
    const expired = jwt.sign({ username: 'tester', id: userId }, config.SECRET, {
      expiresIn: '0s',
    })
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${expired}`)
      .send({ map: 'sample_battle' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('token expired')
  })

  test('401 when the token is valid but the user was deleted', async () => {
    await User.deleteMany({})
    const res = await api
      .post('/api/battles')
      .set('Authorization', `Bearer ${token}`)
      .send({ map: 'sample_battle' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('user not found')
  })

  test('a stored battle is stamped with the authenticated user', async () => {
    const { body } = await runFixtureBattle()
    const stored = await Battle.findById(body.id)
    expect(stored.user.toString()).toBe(userId)
  })
})

describe('GET /api/battles/:id', () => {
  test('returns the stored battle', async () => {
    const { body } = await runFixtureBattle()
    const res = await api.get(`/api/battles/${body.id}`)
    expect(res.status).toBe(200)
    expect(res.body.winner).toBe('blue')
    expect(res.body.tickCount).toBe(3)
    expect(res.body.map).toBe('sample_battle')
  })

  test('404 for an unknown id, 400 for a malformed id', async () => {
    const missing = new mongoose.Types.ObjectId().toString()
    expect((await api.get(`/api/battles/${missing}`)).status).toBe(404)
    expect((await api.get('/api/battles/not-an-id')).status).toBe(400)
  })
})

describe('GET /api/battles/:id/ticks', () => {
  test('returns the requested ordered range', async () => {
    const { body } = await runFixtureBattle()
    const res = await api.get(`/api/battles/${body.id}/ticks?from=1&to=2`)
    expect(res.status).toBe(200)
    expect(res.body.map((t) => t.index)).toEqual([1, 2])
    expect(res.body[0].units[0]).toMatchObject({ id: 0, type: 'Zombie', team: 'red' })
  })

  test('defaults to the whole replay from tick 0', async () => {
    const { body } = await runFixtureBattle()
    const res = await api.get(`/api/battles/${body.id}/ticks`)
    expect(res.body.map((t) => t.index)).toEqual([0, 1, 2])
  })
})
