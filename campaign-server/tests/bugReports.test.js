import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { pushRoll, clearRolls } from '../utils/dice.js'

// Bug reports don't touch the engine, but campaign creation (used by the
// enrichment test) does, via buildEnemyPlacement's zone geometry.
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
const { default: BugReport } = await import('../models/bugReport.js')
const { default: UnitType } = await import('../models/unitType.js')
const { CAMPAIGN_SCHEMA_VERSION } = await import('../models/campaign.js')
const { MAX_MESSAGE_LENGTH } = await import('../models/bugReport.js')
const { default: config } = await import('../utils/config.js')

const api = supertest(app)

const infoFixture = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  units: [],
  terrain: [],
}

let token, userId

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  clearRolls()
  engine.getInfo.mockResolvedValue(infoFixture)
  await UnitType.insertMany(catalogFixture.units)
  ;({ token, userId } = await createUserAndToken(api))
})

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const submit = (body) => auth(api.post('/api/bug-reports')).send(body)

describe('POST /api/bug-reports', () => {
  test('requires a login', async () => {
    const res = await api.post('/api/bug-reports').send({ message: 'anonymous' })
    expect(res.status).toBe(401)
    expect(await BugReport.countDocuments()).toBe(0)
  })

  test('stores a valid report owned by the caller', async () => {
    const res = await submit({ message: '  the forage panel froze  ', screen: 'setup' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()

    const stored = await BugReport.findById(res.body.id)
    expect(stored.user.toString()).toBe(userId)
    // Trimmed on the way in.
    expect(stored.message).toBe('the forage panel froze')
    expect(stored.status).toBe('new')
    expect(stored.context.screen).toBe('setup')
    expect(stored.context.schemaVersion).toBe(CAMPAIGN_SCHEMA_VERSION)
    // Pinned to the running build, stamped server-side.
    expect(stored.context.appVersion).toBe(config.APP_VERSION)
    expect(stored.context.appVersion).toBeTruthy()
  })

  test('does not echo the report text back in the response', async () => {
    const res = await submit({ message: 'secret repro steps', screen: 'setup' })
    expect(JSON.stringify(res.body)).not.toContain('secret repro steps')
  })

  test('rejects a missing or empty message', async () => {
    expect((await submit({ screen: 'setup' })).status).toBe(400)
    expect((await submit({ message: '   ' })).status).toBe(400)
    expect((await submit({ message: 42 })).status).toBe(400)
    expect(await BugReport.countDocuments()).toBe(0)
  })

  test('caps message length', async () => {
    const res = await submit({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })
    expect(res.status).toBe(400)
    expect(await BugReport.countDocuments()).toBe(0)
  })

  test('rejects unknown fields rather than storing them', async () => {
    const res = await submit({ message: 'hi', status: 'fixed', user: 'someoneelse' })
    expect(res.status).toBe(400)
    expect(await BugReport.countDocuments()).toBe(0)
  })

  test('coerces an out-of-enum screen to "unknown"', async () => {
    const res = await submit({ message: 'weird', screen: 'not-a-real-screen' })
    expect(res.status).toBe(201)
    const stored = await BugReport.findById(res.body.id)
    expect(stored.context.screen).toBe('unknown')
  })

  test('rate-limits per user (5 per hour)', async () => {
    for (let i = 0; i < 5; i++)
      expect((await submit({ message: `report ${i}` })).status).toBe(201)
    const sixth = await submit({ message: 'one too many' })
    expect(sixth.status).toBe(429)
    expect(await BugReport.countDocuments()).toBe(5)
  })

  test('the rate window ROLLS: reports older than an hour stop counting', async () => {
    // Pins "5 per hour" against silently regressing to "5 per lifetime" —
    // the route must count createdAt >= now − 1 h, not all of the user's
    // reports ever.
    for (let i = 0; i < 5; i++)
      expect((await submit({ message: `report ${i}` })).status).toBe(201)
    expect((await submit({ message: 'still inside the window' })).status).toBe(429)

    // Age all five past the window with a raw driver op (the schema's
    // timestamps are Mongoose-managed, so the update must bypass the model —
    // same convention as campaigns.test.js's makeLegacy).
    const overAnHourAgo = new Date(Date.now() - 61 * 60 * 1000)
    await BugReport.collection.updateMany({}, { $set: { createdAt: overAnHourAgo } })

    const sixth = await submit({ message: 'the window has rolled past the old five' })
    expect(sixth.status).toBe(201)
    expect(await BugReport.countDocuments()).toBe(6)
  })

  test('stamps the trusted active-campaign context server-side', async () => {
    // Campaign creation consumes augury dice; pin a reading so create() is
    // deterministic (same pattern as campaigns.test.js).
    pushRoll(4)
    pushRoll(6)
    pushRoll(3)
    pushRoll(2)
    const campaignRes = await auth(api.post('/api/campaigns')).send({})
    expect(campaignRes.status).toBe(201)
    const campaignId = campaignRes.body.id

    const res = await submit({ message: 'bug during the council', screen: 'setup' })
    expect(res.status).toBe(201)

    const stored = await BugReport.findById(res.body.id)
    expect(stored.context.campaign.toString()).toBe(campaignId)
    expect(stored.context.day).toBe(campaignRes.body.day)
  })

  test('never attaches another user\'s campaign', async () => {
    // A second user's active campaign must not leak into this user's report.
    const other = await createUserAndToken(api, 'otheruser', 'sekret2')
    pushRoll(4)
    pushRoll(6)
    pushRoll(3)
    pushRoll(2)
    await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${other.token}`)
      .send({})

    const res = await submit({ message: 'no campaign of my own', screen: 'start' })
    expect(res.status).toBe(201)
    const stored = await BugReport.findById(res.body.id)
    expect(stored.context.campaign).toBeNull()
    expect(stored.context.day).toBeNull()
  })
})
