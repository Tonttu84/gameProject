import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import jwt from 'jsonwebtoken'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'

// The engine service sits in app.js's import chain (via routes/battles.js);
// stub it like every other HTTP-layer suite so no C++ binary is needed.
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

const { default: app } = await import('../app.js')
const { default: User } = await import('../models/user.js')
const { default: config } = await import('../utils/config.js')

const api = supertest(app)

beforeAll(async () => {
  await startTestDb()
  // clearDb() only deletes documents, so the unique index survives between
  // tests — but index creation is async, so force it before the first
  // duplicate-username assertion.
  await User.init()
})
afterAll(stopTestDb)
beforeEach(clearDb)

const newUser = { username: 'tonttu', name: 'Tonttu T', password: 'salainen' }

describe('POST /api/users', () => {
  test('creates a user; response has id/username but never the hash', async () => {
    const res = await api.post('/api/users').send(newUser)
    expect(res.status).toBe(201)
    expect(res.body.username).toBe('tonttu')
    expect(res.body.name).toBe('Tonttu T')
    expect(res.body.id).toBeDefined()
    expect(res.body._id).toBeUndefined()
    expect(res.body.passwordHash).toBeUndefined()
    expect(await User.countDocuments()).toBe(1)
  })

  test('400 when username is missing or too short', async () => {
    const missing = await api.post('/api/users').send({ password: 'salainen' })
    expect(missing.status).toBe(400)

    const short = await api.post('/api/users').send({ username: 'ab', password: 'salainen' })
    expect(short.status).toBe(400)
    expect(short.body.error).toMatch(/username/)

    expect(await User.countDocuments()).toBe(0)
  })

  test('400 when password is missing or too short', async () => {
    const missing = await api.post('/api/users').send({ username: 'tonttu' })
    expect(missing.status).toBe(400)
    expect(missing.body.error).toBe('password must be at least 3 characters long')

    const short = await api.post('/api/users').send({ username: 'tonttu', password: 'ab' })
    expect(short.status).toBe(400)

    expect(await User.countDocuments()).toBe(0)
  })

  test('400 on duplicate username, count stays at one', async () => {
    await api.post('/api/users').send(newUser)
    const dup = await api.post('/api/users').send(newUser)
    expect(dup.status).toBe(400)
    expect(dup.body.error).toBe('expected `username` to be unique')
    expect(await User.countDocuments()).toBe(1)
  })
})

describe('POST /api/login', () => {
  beforeEach(async () => {
    await api.post('/api/users').send(newUser)
  })

  test('returns a verifiable token carrying the user id', async () => {
    const res = await api.post('/api/login').send({ username: 'tonttu', password: 'salainen' })
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('tonttu')

    const decoded = jwt.verify(res.body.token, config.SECRET)
    const stored = await User.findOne({ username: 'tonttu' })
    expect(decoded.id).toBe(stored._id.toString())
  })

  test('401 with the same message for wrong password and unknown user', async () => {
    const wrongPw = await api.post('/api/login').send({ username: 'tonttu', password: 'nope' })
    expect(wrongPw.status).toBe(401)
    expect(wrongPw.body.error).toBe('invalid username or password')

    const unknown = await api.post('/api/login').send({ username: 'nobody', password: 'salainen' })
    expect(unknown.status).toBe(401)
    expect(unknown.body.error).toBe('invalid username or password')
  })
})
