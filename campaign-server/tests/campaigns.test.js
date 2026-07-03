import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'

// Stub the engine service — these tests cover the campaign layer, not the
// C++ binary. getInfo feeds buildEnemyPlacement's zone geometry.
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
const { default: Campaign } = await import('../models/campaign.js')
const { default: UnitType } = await import('../models/unitType.js')

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
  engine.getInfo.mockResolvedValue(infoFixture)
  await UnitType.insertMany(catalogFixture.units)
  ;({ token, userId } = await createUserAndToken(api))
})

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const createCampaign = () => auth(api.post('/api/campaigns')).send({})

// The hidden-information discipline: NO campaign response may ever contain
// the enemy army composition, the planned enemy placement, or event truth
// flags. Checked on every response the tests receive.
const expectNoHiddenInfo = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('isReal')
  expect(raw).not.toContain('plannedPlacement')
  expect(raw).not.toContain('initialStrength')
  if (body.campaign?.enemy) expect(body.campaign.enemy.army).toBeUndefined()
  if (body.enemy) expect(body.enemy.army).toBeUndefined()
}

describe('POST /api/campaigns', () => {
  test('creates a campaign with starting state and day-1 events', async () => {
    const res = await createCampaign()
    expect(res.status).toBe(201)
    expect(res.body.day).toBe(1)
    expect(res.body.status).toBe('active')
    expect(res.body.resources.food).toBe(100)
    expect(res.body.roster.Soldier).toBe(300)
    expect(res.body.roster.LightCavalry).toBe(12)
    expect(res.body.events).toHaveLength(3)
    expect(res.body.enemy.stance).toBe('camp')
    expectNoHiddenInfo(res.body)
  })

  test('hidden state exists in the DB but never in the response', async () => {
    const res = await createCampaign()
    const doc = await Campaign.findById(res.body.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540)
    expect(doc.events.drawn.some((e) => e.isReal)).toBe(true)
    // Placement only covers types present in the (test) catalog, but it must
    // exist and be axial-shaped.
    expect(Array.isArray(doc.enemy.plannedPlacement)).toBe(true)
    for (const p of doc.enemy.plannedPlacement)
      expect(p).toMatchObject({ unit_type: expect.any(String), q: expect.any(Number), r: expect.any(Number) })
  })

  test('401 without a token', async () => {
    expect((await api.post('/api/campaigns').send({})).status).toBe(401)
  })
})

describe('GET /api/campaigns', () => {
  test("lists only the caller's campaigns; foreign ids 404", async () => {
    const { body: mine } = await createCampaign()

    const other = await createUserAndToken(api, 'rival', 'sekret2')
    const otherRes = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${other.token}`)
      .send({})

    const list = await auth(api.get('/api/campaigns'))
    expect(list.body.map((c) => c.id)).toEqual([mine.id])

    expect((await auth(api.get(`/api/campaigns/${otherRes.body.id}`))).status).toBe(404)
    const missing = new mongoose.Types.ObjectId().toString()
    expect((await auth(api.get(`/api/campaigns/${missing}`))).status).toBe(404)
  })
})

describe('POST /api/campaigns/:id/events/pick', () => {
  test('applies the picked effect once; second pick is rejected', async () => {
    const { body: c } = await createCampaign()
    const pick = await auth(api.post(`/api/campaigns/${c.id}/events/pick`)).send({
      eventId: c.events[0].id,
    })
    expect(pick.status).toBe(200)
    expect(pick.body.events).toEqual([]) // consumed for today
    expectNoHiddenInfo(pick.body)

    const again = await auth(api.post(`/api/campaigns/${c.id}/events/pick`)).send({
      eventId: c.events[0].id,
    })
    expect(again.status).toBe(400)
  })

  test('unknown event id is rejected', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/events/pick`)).send({
      eventId: 'nonsense',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/campaigns/:id/battles', () => {
  const fightSoldiers = (id, n = 1) =>
    auth(api.post(`/api/campaigns/${id}/battles`)).send({
      player_placement: Array.from({ length: n }, () => ({ unit_type: 'Soldier', q: 4, r: 4 })),
    })

  test('injects the hidden enemy placement, updates rosters from survivors', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)

    const res = await fightSoldiers(c.id)
    expect(res.status).toBe(201)
    expect(res.body.winner).toBe('blue')
    expectNoHiddenInfo(res.body)

    // The engine got the campaign's own hidden placement, not a client value.
    const input = engine.runBattle.mock.calls[0][0]
    expect(input.map).toBe('sample_battle')
    expect(input.enemy_placement).toEqual(
      doc.enemy.plannedPlacement.map((p) => expect.objectContaining(p)),
    )

    // 1 of 300 Soldiers fielded, 2 came back (fixture): 299 in camp + 2.
    expect(res.body.campaign.roster.Soldier).toBe(301)
    expect(res.body.campaign.battleFoughtToday).toBe(true)

    // Enemy host is now exactly the red survivors.
    const after = await Campaign.findById(c.id)
    expect(Object.fromEntries(after.enemy.army)).toEqual(
      battleResultFixture.red_survivors ?? {},
    )
  })

  test('one battle per day', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await fightSoldiers(c.id)
    expect((await fightSoldiers(c.id)).status).toBe(400)
  })

  test('cannot field more units than the roster owns', async () => {
    const { body: c } = await createCampaign()
    const res = await fightSoldiers(c.id, 301)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not enough Soldier/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('cannot field non-placeable types', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
      player_placement: [{ unit_type: 'Zombie', q: 4, r: 4 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a placeable/)
  })
})

describe('POST /api/campaigns/:id/end-day', () => {
  test('advances the day: upkeep, fresh events, report', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // 378 units → ceil(37.8) = 38 food upkeep.
    expect(res.body.report.upkeep.foodConsumed).toBe(38)
    expect(res.body.campaign.day).toBe(2)
    expect(res.body.campaign.resources.food).toBe(62)
    expect(res.body.campaign.events).toHaveLength(3)
    expect(res.body.campaign.battleFoughtToday).toBe(false)
  })

  test('starvation causes desertion', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.resources.food = 5 // upkeep will floor it to 0 → 10% desert
    await doc.save()

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.body.report.upkeep.deserters).toBeGreaterThan(0)
    expect(res.body.campaign.roster.Soldier).toBe(270)
  })

  test('enemy annihilation wins the campaign', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.enemy.army = {}
    await doc.save()

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.body.campaign.status).toBe('won')

    // A finished campaign refuses further actions.
    expect((await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})).status).toBe(400)
  })
})
