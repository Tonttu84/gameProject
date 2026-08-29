/**
 * THE BATTLE LAB — the HTTP + persistence half (docs/CAMPAIGN_PLAN.md,
 * "TEST / SANDBOX MODE", slice S1).
 *
 * What is actually under test here is the three things the lab adds on top of
 * a pipeline that already existed: the free-standing launch (SB-1 — no campaign
 * document anywhere in the call), the per-launch retention (SB-12 — the bug the
 * design would otherwise have shipped, since sweepOldBattles can never reach a
 * battle that belongs to no campaign), and the guards SB-2 owes for making a
 * subprocess-spawning route player-facing.
 *
 * The engine is stubbed, as in battles.test.js: this suite is about the route
 * and the DB, and the binary has its own Catch2 suite plus an integration test.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
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
const { default: Battle } = await import('../models/battle.js')
const { default: Tick } = await import('../models/tick.js')
const { default: UnitType } = await import('../models/unitType.js')
const { SANDBOX_MAX_UNITS_PER_SIDE } = await import('../utils/campaignConfig.js')

const api = supertest(app)

// The engine's own zones, as `./game info` reports them.
const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
}

let token, userId

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  await UnitType.insertMany(catalogFixture.units)
  engine.getInfo.mockResolvedValue(info)
  ;({ token, userId } = await createUserAndToken(api))
})

const launch = (body) =>
  api.post('/api/sandbox/battles').set('Authorization', `Bearer ${token}`).send(body)

const oneOfEach = {
  player_placement: [{ unit_type: 'Soldier', q: 4, r: 4 }],
  enemy_placement: [{ unit_type: 'Soldier', q: 4, r: 25 }],
}

const stubEngine = () => engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))

describe('POST /api/sandbox/battles', () => {
  test('runs a battle from hand-composed placements and stores it, campaign-free', async () => {
    stubEngine()
    const res = await launch(oneOfEach)

    expect(res.status).toBe(201)
    expect(res.body.winner).toBe('blue')
    expect(res.body.tickCount).toBe(3)

    const stored = await Battle.findById(res.body.id)
    expect(stored.sandbox).toBe(true)
    // No campaign, so no turn — and `day: null` is what keeps the CAMPAIGN
    // sweep away from a battle it has no business judging.
    expect(stored.day).toBe(null)
    expect(String(stored.user)).toBe(String(userId))
    expect(await Tick.countDocuments({ battle: stored._id })).toBe(3)
  })

  test('stamps the map itself rather than taking one from the body', async () => {
    stubEngine()
    await launch({ ...oneOfEach, map: '../../etc/passwd' })

    expect(engine.runBattle).toHaveBeenCalledWith(
      expect.objectContaining({ map: 'sample_battle' }),
    )
  })

  test('rebuilds each entry from a whitelist, dropping campaign-only fields', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 7, character_id: 3, hold_turns: 9 },
      ],
      enemy_placement: [],
    })

    const [input] = engine.runBattle.mock.calls[0]
    expect(input.player_placement).toEqual([{ unit_type: 'Soldier', q: 4, r: 4 }])
  })

  test('one side may be empty — both may not', async () => {
    stubEngine()
    expect((await launch({ player_placement: oneOfEach.player_placement, enemy_placement: [] })).status).toBe(201)

    const res = await launch({ player_placement: [], enemy_placement: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least one unit/i)
    expect(await Battle.countDocuments({ sandbox: true })).toBe(1)
  })

  test('refuses an unknown unit type', async () => {
    const res = await launch({ player_placement: [{ unit_type: 'Dragon', q: 4, r: 4 }], enemy_placement: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Dragon/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('caps the army size per side (SB-2), before any subprocess is spawned', async () => {
    const horde = Array.from({ length: SANDBOX_MAX_UNITS_PER_SIDE + 1 }, () => ({
      unit_type: 'Soldier', q: 4, r: 4,
    }))
    const res = await launch({ player_placement: horde, enemy_placement: [] })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too many units/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('requires a login', async () => {
    const res = await api.post('/api/sandbox/battles').send(oneOfEach)
    expect(res.status).toBe(401)
  })

  test('surfaces an engine rejection as a 400 and stores nothing', async () => {
    engine.runBattle.mockResolvedValue({ error: 'no such map' })
    const res = await launch(oneOfEach)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no such map')
    expect(await Battle.countDocuments({})).toBe(0)
  })
})

describe('lab retention (SB-12)', () => {
  test('each launch deletes the previous lab battle AND its ticks', async () => {
    stubEngine()
    const first = (await launch(oneOfEach)).body
    const second = (await launch(oneOfEach)).body

    expect(await Battle.findById(first.id)).toBe(null)
    expect(await Tick.countDocuments({ battle: first.id })).toBe(0)
    expect(await Battle.findById(second.id)).not.toBe(null)
    expect(await Tick.countDocuments({ battle: second.id })).toBe(3)
  })

  test('leaves campaign battles and the ownerless demo alone', async () => {
    const campaignBattle = await Battle.create({
      map: 'sample_battle', winner: 'blue', tickCount: 1, day: 3, user: userId,
    })
    const demo = await Battle.create({ map: 'sample_battle', winner: 'red', tickCount: 1 })

    stubEngine()
    await launch(oneOfEach)
    await launch(oneOfEach)

    expect(await Battle.findById(campaignBattle._id)).not.toBe(null)
    expect(await Battle.findById(demo._id)).not.toBe(null)
  })

  test("does not touch another user's lab battle", async () => {
    stubEngine()
    const mine = (await launch(oneOfEach)).body

    const other = await createUserAndToken(api, 'otherlab', 'sekret')
    await api
      .post('/api/sandbox/battles')
      .set('Authorization', `Bearer ${other.token}`)
      .send(oneOfEach)

    expect(await Battle.findById(mine.id)).not.toBe(null)
    expect(await Battle.countDocuments({ sandbox: true })).toBe(2)
  })
})

describe('POST /api/sandbox/auto-place', () => {
  const autoPlace = (body) =>
    api.post('/api/sandbox/auto-place').set('Authorization', `Bearer ${token}`).send(body)

  // Offset row from an axial pair, the inverse the frontend uses: r IS the row.
  const rowsOf = (placement) => placement.map((p) => p.r)

  test('spreads a blue army over the player zone, one entry per body', async () => {
    const res = await autoPlace({ side: 'blue', army: { Soldier: 12, Archer: 3 } })

    expect(res.status).toBe(200)
    expect(res.body.placement).toHaveLength(15)
    expect(res.body.placement.filter((p) => p.unit_type === 'Archer')).toHaveLength(3)
    for (const row of rowsOf(res.body.placement)) {
      expect(row).toBeGreaterThanOrEqual(info.playerZone.rowMin)
      expect(row).toBeLessThanOrEqual(info.playerZone.rowMax)
    }
  })

  test('places a red army in the enemy zone instead', async () => {
    const res = await autoPlace({ side: 'red', army: { Soldier: 8 } })

    for (const row of rowsOf(res.body.placement)) {
      expect(row).toBeGreaterThanOrEqual(info.enemyZone.rowMin)
      expect(row).toBeLessThanOrEqual(info.enemyZone.rowMax)
    }
  })

  test('composes from the FULL catalog, not just the placeable types (SB-1)', async () => {
    const res = await autoPlace({ side: 'red', army: { Zombie: 4 } })

    expect(res.status).toBe(200)
    expect(res.body.placement).toHaveLength(4)
  })

  test('refuses an unknown type, a bad count, and an over-cap army', async () => {
    expect((await autoPlace({ side: 'blue', army: { Dragon: 1 } })).status).toBe(400)
    expect((await autoPlace({ side: 'blue', army: { Soldier: -2 } })).status).toBe(400)
    expect((await autoPlace({ side: 'blue', army: { Soldier: 'lots' } })).status).toBe(400)
    expect((await autoPlace({ side: 'blue', army: [] })).status).toBe(400)

    const over = await autoPlace({ side: 'blue', army: { Soldier: SANDBOX_MAX_UNITS_PER_SIDE + 1 } })
    expect(over.status).toBe(400)
    expect(over.body.error).toMatch(/too many units/i)
  })

  test('requires a login', async () => {
    const res = await api.post('/api/sandbox/auto-place').send({ side: 'blue', army: { Soldier: 1 } })
    expect(res.status).toBe(401)
  })
})
