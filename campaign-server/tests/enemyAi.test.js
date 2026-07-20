import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearRolls } from '../utils/dice.js'

// The enemy stance machine (services/enemyAi.js) + the withdrawal win in
// services/dayResolution.js step 6 — driven through the real end-day route
// against the real DB. Everything here is deterministic: the player never
// forages (so no clash rolls), pinned QUIET fates keep events out of the
// math, and the enemy state is steered by writing the doc directly (the same
// pinning convention as campaigns.test.js / raid.test.js).
//
// The fixed arithmetic all of it leans on (fixture catalog == engine-pinned
// sizes/speeds):
// - enemy food need/turn: (540 Soldier + 150 Archer + 11 Necromancer) × 28 kg
//   + 20 LightCavalry × 112 kg = 19,628 + 2,240 = 21,868 kg
// - enemy forage plan: 0.4 × (701 × 2 + 20 × 5.6 forage pts) × 15 kg
//   = 0.4 × 22,710 = 9,084 kg, of which floor(0.8 × 9,084) = 7,267 kg is
//   food for the supply train (the rest is the materials share)
// - so an untouched host nets 7,267 − 21,868 = −14,601 kg of supplies/turn.
//
// Stance thresholds (utils/campaignConfig.js): withdraw below 0.2 × initial
// strength, battle offer below 25,000 kg supplies or every 5th turn, shadow
// from turn 3.

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

let token

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  engine.getInfo.mockResolvedValue(infoFixture)
  await UnitType.insertMany(catalogFixture.units)
  ;({ token } = await createUserAndToken(api))
})
afterEach(clearRolls)

const auth = (req) => req.set('Authorization', `Bearer ${token}`)
const createCampaign = () => auth(api.post('/api/campaigns')).send({})
const endDay = (id) => auth(api.post(`/api/campaigns/${id}/end-day`)).send({})

// The hidden-information discipline, same boundary campaigns.test.js pins:
// no response may carry the enemy composition, plan, or augury internals,
// and the enemy view's keys are exactly what the scouting band licenses.
const ENEMY_KEYS_BY_BAND = {
  Blind: ['battleOffer', 'stance'],
  Outmatched: ['battleOffer', 'stance', 'strength', 'supplies'],
  Contested: ['battleOffer', 'stance', 'strength', 'supplies'],
  Superior: ['battleOffer', 'composition', 'stance', 'strength', 'supplies'],
  Overwhelming: ['battleOffer', 'composition', 'placements', 'stance', 'strength', 'supplies', 'units'],
}

const expectNoHiddenInfo = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('plannedPlacement')
  expect(raw).not.toContain('initialStrength')
  expect(raw).not.toContain('enemyPlan')
  expect(raw).not.toContain('"trueEvent"')
  expect(raw).not.toContain('"falseEvent"')
  expect(raw).not.toContain('"shownTrue"')
  expect(raw).not.toContain('"targetForce"')
  expect(raw).not.toContain('"coverage"')
  expect(raw).not.toContain('"ratio"')
  for (const c of [body, body.campaign, body.report]) {
    if (!c?.enemy) continue
    expect(c.enemy.army).toBeUndefined()
    const allowed = c.enemy.revealed
      ? [...ENEMY_KEYS_BY_BAND.Overwhelming, 'revealed'].sort()
      : c.scouting
        ? ENEMY_KEYS_BY_BAND[c.scouting.band]
        : ['battleOffer', 'stance']
    expect(Object.keys(c.enemy).sort()).toEqual(allowed)
  }
  for (const c of [body, body.campaign]) {
    if (!c?.meter) continue
    expect(Object.keys(c.meter).sort()).toEqual(['band', 'revealed', 'value'])
    if (!c.meter.revealed) expect(c.meter.value).toBeNull()
  }
}

// A no-op truth in every slot keeps events out of the supply/stance math
// (same pin as raid.test.js). Re-pinned before EVERY end-day: each new turn
// draws random fates, and a random enemy_losses / enemy_advance rung would
// corrupt the arithmetic under test.
const QUIET = {
  id: 'quiet', title: 'A Quiet Fortnight', description: 'Nothing stirs.',
  severity: 1, effect: { type: 'none' },
}
const pinAugury = async (id) => {
  const doc = await Campaign.findById(id)
  doc.augury.slots = doc.augury.slots.map(() => ({
    trueEvent: QUIET,
    falseEvent: QUIET,
    odds: null,
    shownTrue: null,
  }))
  await doc.save()
}

const pinEnemy = async (id, { army, supplies } = {}) => {
  const doc = await Campaign.findById(id)
  if (army) doc.enemy.army = army
  if (supplies !== undefined) doc.enemy.supplies = supplies
  await doc.save()
}

const pinMeter = async (id, value) => {
  const doc = await Campaign.findById(id)
  doc.meter.value = value
  await doc.save()
}

describe('enemy supply depletion', () => {
  test('the host eats size²-scale food and forages 40% of its capacity — net −14,601 kg/turn', async () => {
    const { body: c } = await createCampaign()

    await pinAugury(c.id)
    await endDay(c.id)
    let doc = await Campaign.findById(c.id)
    // 90,000 + 7,267 forage − 21,868 upkeep = 75,399.
    expect(doc.enemy.supplies).toBe(75399)
    // Tomorrow's forage plan is recomputed from the (unchanged) host: 9,084.
    expect(doc.forage.enemyPlan).toBe(9084)

    await pinAugury(c.id)
    await endDay(c.id)
    doc = await Campaign.findById(c.id)
    // Ring 0 still covers the plan (20,000 − 9,084 = 10,916 left), so the
    // same net: 75,399 − 14,601 = 60,798.
    expect(doc.enemy.supplies).toBe(60798)
  })
})

// The boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop") now
// drives stance instead of the old ENEMY_OFFER_EVERY/ENEMY_LOW_SUPPLIES
// thresholds: calm ⇒ camp, restless/imminent ⇒ shadowing, bossFightDue (meter
// crosses BOSS_FIGHT_METER_THRESHOLD=1000) ⇒ offering_battle. A fresh
// campaign never forages or raids in these tests, so troopsInCamp == the
// whole roster every turn — meterFillAmount is pinned at the FLOOR (50)/turn,
// which these tests use to predict the post-end-day value from a pinned
// starting one.
describe('the boss-fight meter drives stance', () => {
  test('an idle army fills the meter by the floor amount (50) each end-day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)

    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ stance: 'camp', battleOffer: false })
    expect(res.body.campaign.meter).toEqual({ band: 'calm', revealed: false, value: null })
    expect(res.body.campaign.bossFightDue).toBe(false)
    expect((await Campaign.findById(c.id)).meter.value).toBe(50)
  })

  test('calm (< 334) stays camp, restless (>= 334) tips to shadowing', async () => {
    const { body: c } = await createCampaign()

    await pinAugury(c.id)
    await pinMeter(c.id, 250) // + 50 floor fill = 300, still calm
    let res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ stance: 'camp', battleOffer: false })

    await pinAugury(c.id)
    await pinMeter(c.id, 300) // + 50 = 350, restless
    res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ stance: 'shadowing', battleOffer: false })
  })

  test('crossing 1000 sets bossFightDue and the enemy offers battle that same day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinMeter(c.id, 949) // + 50 floor fill = 999, just under the threshold

    let res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ stance: 'shadowing', battleOffer: false })
    expect(res.body.campaign.bossFightDue).toBe(false)
    expect((await Campaign.findById(c.id)).meter.value).toBe(999)

    await pinAugury(c.id) // second end-day: 999 + 50 = 1049, crosses 1000
    res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ stance: 'offering_battle', battleOffer: true })
    expect(res.body.report.entries).toContain(
      'Enemy banners form up in the plain — they are offering battle.',
    )
    expect(res.body.campaign.bossFightDue).toBe(true)
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.stance).toBe('offering_battle')
    expect(doc.bossFightDue).toBe(true)
    expect(doc.meter.value).toBe(1049)
  })
})

describe('the withdraw threshold and the withdrawal win', () => {
  // Creation initialStrength is the full 721-strong host; the withdraw line
  // is 0.2 × 721 = 144.2 — so 145 survivors stand and 144 melt away.
  test('one man above the threshold, the beaten host still stands', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinEnemy(c.id, { army: { Soldier: 145 }, supplies: 90000 })

    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy.stance).toBe('camp') // turn 2: not withdrawing
    expect(res.body.report.status).toBe('active')
    expect(res.body.report.newDay).toBe(2)
  })

  test('below the threshold the stance flips to withdrawing — and that wins the campaign', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinEnemy(c.id, { army: { Soldier: 144 }, supplies: 90000 })

    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    expect(res.body.report.enemy).toEqual({ stance: 'withdrawing', battleOffer: false })
    expect(res.body.report.status).toBe('won')
    expect(res.body.campaign.status).toBe('won')
    // The war ends where it stands: step 7 (new turn) never runs.
    expect(res.body.report.newDay).toBe(1)
    expect(res.body.report.entries).toContain(
      'The enemy host is melting away down the road it came by.',
    )
    expect(res.body.report.entries).toContain(
      'The enemy has abandoned the campaign. The country is yours.',
    )

    const doc = await Campaign.findById(c.id)
    expect(doc.status).toBe('won')
    expect(doc.enemy.stance).toBe('withdrawing')
    expect(doc.day).toBe(1)

    // A finished campaign refuses further actions.
    expect((await endDay(c.id)).status).toBe(400)
  })
})
