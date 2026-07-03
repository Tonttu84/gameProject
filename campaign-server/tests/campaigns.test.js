import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { pushRoll, clearRolls } from '../utils/dice.js'

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

afterEach(clearRolls)

// The hidden-information discipline: NO campaign response may ever contain
// the enemy army composition, the planned enemy placement, event truth
// flags, or the enemy's forage plan. Checked on every response the tests
// receive.
const expectNoHiddenInfo = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('isReal')
  expect(raw).not.toContain('plannedPlacement')
  expect(raw).not.toContain('initialStrength')
  expect(raw).not.toContain('enemyPlan')
  if (body.campaign?.enemy) expect(body.campaign.enemy.army).toBeUndefined()
  if (body.enemy) expect(body.enemy.army).toBeUndefined()
}

// Fixture-catalog campaign math, used by the expectations below:
// - player food need/turn: 300 Soldier×28 + 50 Archer×28 + 3 Mage×28 +
//   3 Priest×28 + 10 Cavalry×112 + 12 LightCavalry×112 = 12,432 kg
// - enemy forage plan: 0.4 × (540×2 + 150×2 + 11×2 + 20×6 points × 15 kg) = 9,132 kg

describe('POST /api/campaigns', () => {
  test('creates a campaign with starting state and turn-1 events', async () => {
    const res = await createCampaign()
    expect(res.status).toBe(201)
    expect(res.body.day).toBe(1)
    expect(res.body.status).toBe('active')
    expect(res.body.resources.food).toBe(50000)
    expect(res.body.resources.foodNeedPerTurn).toBe(12432)
    expect(res.body.roster.Soldier).toBe(300)
    expect(res.body.roster.LightCavalry).toBe(12)
    expect(res.body.events).toHaveLength(3)
    expect(res.body.enemy.stance).toBe('camp')
    // Fresh land: three untouched rings, nobody assigned to forage yet.
    expect(res.body.forage.rings).toEqual([
      { ring: 0, richness: 20000, initialRichness: 20000 },
      { ring: 1, richness: 35000, initialRichness: 35000 },
      { ring: 2, richness: 55000, initialRichness: 55000 },
    ])
    expect(res.body.forage.assignment).toEqual({})
    expect(res.body.forage.capacityKg).toBe(0)
    expect(res.body.forage.kgPerUnit.Soldier).toBe(30)
    expect(res.body.forage.kgPerUnit.LightCavalry).toBe(90)
    expectNoHiddenInfo(res.body)
  })

  test('hidden state exists in the DB but never in the response', async () => {
    const res = await createCampaign()
    const doc = await Campaign.findById(res.body.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540)
    expect(doc.events.drawn.some((e) => e.isReal)).toBe(true)
    expect(doc.forage.enemyPlan).toBe(9132)
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

describe('POST /api/campaigns/:id/forage', () => {
  const assign = (id, assignment) =>
    auth(api.post(`/api/campaigns/${id}/forage`)).send({ assignment })

  test('sets the assignment and reports capacity; re-issuing replaces it', async () => {
    const { body: c } = await createCampaign()

    const res = await assign(c.id, { Soldier: 100, LightCavalry: 5 })
    expect(res.status).toBe(200)
    expect(res.body.forage.assignment).toEqual({ Soldier: 100, LightCavalry: 5 })
    expect(res.body.forage.capacityKg).toBe(100 * 30 + 5 * 90)
    expectNoHiddenInfo(res.body)

    const replaced = await assign(c.id, { Cavalry: 4 })
    expect(replaced.body.forage.assignment).toEqual({ Cavalry: 4 })
    expect(replaced.body.forage.capacityKg).toBe(4 * 60) // speed 2 → 4 pts × 15 kg
  })

  test('rejects overdrafts, bad counts, and missing bodies', async () => {
    const { body: c } = await createCampaign()
    expect((await assign(c.id, { Soldier: 301 })).status).toBe(400)
    expect((await assign(c.id, { Soldier: -1 })).status).toBe(400)
    expect((await assign(c.id, { Soldier: 2.5 })).status).toBe(400)
    expect((await auth(api.post(`/api/campaigns/${c.id}/forage`)).send({})).status).toBe(400)
  })

  test('foragers are unavailable for the battle line', async () => {
    const { body: c } = await createCampaign()
    await assign(c.id, { Soldier: 300 })

    const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 4 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/out foraging/)
    expect(engine.runBattle).not.toHaveBeenCalled()
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
  test('advances the turn: upkeep, enemy foraging, fresh events, report', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // Two weeks of eating: 12,432 kg for the starting roster.
    expect(res.body.report.upkeep.foodConsumed).toBe(12432)
    expect(res.body.campaign.day).toBe(2)
    expect(res.body.campaign.resources.food).toBe(50000 - 12432)
    expect(res.body.campaign.events).toHaveLength(3)
    expect(res.body.campaign.battleFoughtToday).toBe(false)

    // The enemy foraged the near ring even though we sent nobody out.
    expect(res.body.report.forage.harvested).toEqual({ food: 0, materials: 0 })
    expect(res.body.report.forage.rings[0].richness).toBe(20000 - 9132)
    expect(res.body.report.forage.clashes).toEqual([])
  })

  test('foragers harvest at end of turn; the assignment clears for the new turn', async () => {
    const { body: c } = await createCampaign()
    await auth(api.post(`/api/campaigns/${c.id}/forage`)).send({
      assignment: { Soldier: 100 }, // capacity 3000 kg
    })
    pushRoll(1000) // near ring is contested with the enemy — force no clash

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    expect(res.body.report.forage.harvested).toEqual({ food: 2400, materials: 600 })
    expect(res.body.report.forage.rings[0].richness).toBe(20000 - 3000 - 9132)
    expect(res.body.campaign.resources.food).toBe(50000 + 2400 - 12432)
    expect(res.body.campaign.resources.materials).toBe(600)
    expect(res.body.campaign.forage.assignment).toEqual({})
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
