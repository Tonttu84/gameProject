import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearRolls } from '../utils/dice.js'

// Enemy per-turn upkeep (services/enemyAi.js) + the near-annihilation
// withdrawal win in services/dayResolution.js step 6 — driven through the real
// end-day route against the real DB. Everything here is deterministic: the
// player never forages (so no clash rolls), pinned QUIET fates keep events out
// of the math, and the enemy state is steered by writing the doc directly (the
// same pinning convention as campaigns.test.js / raid.test.js).
//
// The standalone enemy "stance" was retired (docs/CAMPAIGN_PLAN.md): the
// boss-fight meter band (+ bossFightDue) is the single signal for the enemy's
// disposition, and the day report exposes it as { band, bossFightDue }.
//
// The fixed arithmetic all of it leans on (fixture catalog == engine-pinned
// sizes/speeds):
// - enemy food need/turn: (540 Soldier + 150 Archer + 11 Necromancer) × 28 kg
//   + 20 LightCavalry × 112 kg = 19,628 + 2,240 = 21,868 kg
// - S2 "effort slider" (docs/CAMPAIGN_PLAN.md, decision 4): the enemy no
//   longer plans a forage detachment off its army, and its flat abstract
//   ring drain (ENEMY_DRAIN_KG_PER_TURN) earns it NO credit at all — only
//   upkeep moves its supplies now, so an untouched host nets a flat
//   −21,868 kg of supplies/turn.
//
// Near-annihilation win (utils/campaignConfig.js): the host melts away once it
// drops below ENEMY_WITHDRAW_FRACTION (0.2) × its initial strength.

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

// Ending the fortnight is the LAST phase's act: the route refuses a turn that
// hasn't been seen through (routes' rejectIfPhaseBefore), which is what makes a
// double submit impossible. A test that resolves a turn without walking the
// screens stamps the phase first — the same state Recruiting leaves behind.
const endTurn = async (id) => {
  await Campaign.findByIdAndUpdate(id, { phase: 'recruit' })
  return auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
}
const createCampaign = () => auth(api.post('/api/campaigns')).send({})
const endDay = (id) => endTurn(id)

// The hidden-information discipline, same boundary campaigns.test.js pins:
// no response may carry the enemy composition, plan, or augury internals,
// and the enemy view's keys are exactly what the scouting band licenses.
const ENEMY_KEYS_BY_BAND = {
  Blind: [],
  Outmatched: ['count', 'supplies'],
  Contested: ['count', 'supplies'],
  Superior: ['composition', 'count', 'supplies'],
  Overwhelming: ['composition', 'count', 'placements', 'supplies', 'units'],
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
        : ['band', 'bossFightDue'] // the day report's enemy summary (no scouting sibling)
    expect(Object.keys(c.enemy).sort()).toEqual(allowed)
  }
  for (const c of [body, body.campaign]) {
    if (!c?.meter) continue
    expect(Object.keys(c.meter).sort()).toEqual(['band', 'estimate'])
    const level0 = !c.scouting || c.scouting.band === 'Blind'
    if (level0) expect(c.meter.estimate).toBeNull()
  }
}

// A no-op truth in every slot keeps events out of the supply/stance math
// (same pin as raid.test.js). Re-pinned before EVERY end-day: each new turn
// draws random fates, and a random enemy_losses / roster rung would
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

const pinResolve = async (id, resolve) => {
  const doc = await Campaign.findById(id)
  doc.garrison.resolve = resolve
  await doc.save()
}

describe('enemy supply depletion', () => {
  test('the host eats size²-scale food and gets no credit for its abstract ring drain', async () => {
    const { body: c } = await createCampaign()

    await pinAugury(c.id)
    await endDay(c.id)
    let doc = await Campaign.findById(c.id)
    // 90,000 − 21,868 upkeep = 68,132. The enemy's drain on the shared rings
    // (ENEMY_DRAIN_KG_PER_TURN, flat) earns it nothing (S2 decision 4) — only
    // upkeep moves its supplies.
    expect(doc.enemy.supplies).toBe(68132)

    await pinAugury(c.id)
    await endDay(c.id)
    doc = await Campaign.findById(c.id)
    expect(doc.enemy.supplies).toBe(68132 - 21868) // 46264
  })
})

// The boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop") is the
// single signal for the enemy's disposition now that stance is retired. The day
// report's enemy summary is { band, bossFightDue } — the meter band (intact/
// damaged/breached) plus whether crossing BOSS_FIGHT_METER_THRESHOLD=1000 has
// set bossFightDue. A fresh campaign never forages or raids in these tests, so
// troopsInCamp == the whole roster every turn — meterFillAmount is pinned at the
// FLOOR (50)/turn. Garrison Resolve slice 2 then SLOWS that fill by the starting
// garrison's wallSlowFactor(45) = 0.18 (S5 start 45), so a fresh campaign's idle
// end-day fill is round(50 x 0.82) = 41/turn — the value these tests use to
// predict the post-end-day meter from a pinned starting one.
describe('the boss-fight meter is the enemy-disposition signal', () => {
  test('a fresh (resolve-45) idle army fills the meter by 41 each end-day (floor slowed by the garrison)', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)

    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ band: 'intact', bossFightDue: false })
    // meter.value 41 → 'intact' band. (The end-day accrued this fresh army's
    // scouting pool into recon, so the level climbed and a numeric estimate now
    // shows — recon R2; the exact bracket carries jitter, so just its shape.)
    expect(res.body.campaign.meter.band).toBe('intact')
    expect(res.body.campaign.meter.estimate).toMatchObject({
      low: expect.any(Number),
      high: expect.any(Number),
    })
    expect(res.body.campaign.bossFightDue).toBe(false)
    expect((await Campaign.findById(c.id)).meter.value).toBe(41)
  })

  test('the report band tracks the meter: intact (< 334) then damaged (>= 334)', async () => {
    const { body: c } = await createCampaign()

    await pinAugury(c.id)
    await pinMeter(c.id, 250) // + 41 slowed fill = 291, still intact
    let res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ band: 'intact', bossFightDue: false })

    await pinAugury(c.id)
    await pinMeter(c.id, 300) // + 41 = 341, damaged (and this cross decays resolve)
    res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ band: 'damaged', bossFightDue: false })
  })

  test('crossing 1000 sets bossFightDue and the enemy offers battle that same day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinMeter(c.id, 950) // + 41 slowed fill = 991, just under the threshold

    let res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    // 991 >= 667 -> 'breached', but still not due.
    expect(res.body.report.enemy).toEqual({ band: 'breached', bossFightDue: false })
    expect(res.body.campaign.bossFightDue).toBe(false)
    expect((await Campaign.findById(c.id)).meter.value).toBe(991)

    await pinAugury(c.id) // second end-day: 991 + 41 = 1032, crosses 1000
    res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.enemy).toEqual({ band: 'breached', bossFightDue: true })
    expect(res.body.campaign.bossFightDue).toBe(true)
    const doc = await Campaign.findById(c.id)
    expect(doc.bossFightDue).toBe(true)
    expect(doc.meter.value).toBe(1032)
  })
})

// Garrison Resolve slice 2 — the passive wall-slow + band-cross decay, seen end
// to end through the real end-day route. A heartened garrison (higher resolve)
// slows the walls' fall (a smaller meter fill); battering the walls into a
// worse band saps resolve. An idle army pins meterFillAmount at the FLOOR (50),
// so the whole slow is legible: fill = round(50 x (1 - 0.4 x resolve/100)).
describe('the garrison slows the walls (resolve wall-slow + band-cross decay)', () => {
  test('a devoted garrison (100) slows the floor fill to 30; a broken one (0) leaves it at the full 50', async () => {
    const { body: hi } = await createCampaign()
    await pinAugury(hi.id)
    await pinResolve(hi.id, 100) // wallSlowFactor 0.4 -> round(50 x 0.6) = 30
    await endDay(hi.id)
    expect((await Campaign.findById(hi.id)).meter.value).toBe(30)

    const { body: lo } = await createCampaign()
    await pinAugury(lo.id)
    await pinResolve(lo.id, 0) // no slow -> the full floor
    await endDay(lo.id)
    expect((await Campaign.findById(lo.id)).meter.value).toBe(50)
  })

  test('battering the walls into a worse band decays resolve by a step; staying in-band leaves it untouched', async () => {
    // Cross intact -> damaged: resolve 50 slips to 40. The fill uses the
    // pre-decay resolve (50 -> slow 0.2 -> round(50 x 0.8) = 40): 300 + 40 = 340.
    const { body: cross } = await createCampaign()
    await pinAugury(cross.id)
    await pinResolve(cross.id, 50)
    await pinMeter(cross.id, 300)
    await endDay(cross.id)
    let doc = await Campaign.findById(cross.id)
    expect(doc.meter.value).toBe(340)
    expect(doc.garrison.resolve).toBe(40)

    // No cross (stays intact): resolve holds. 100 + 40 = 140, still intact.
    const { body: same } = await createCampaign()
    await pinAugury(same.id)
    await pinResolve(same.id, 50)
    await pinMeter(same.id, 100)
    await endDay(same.id)
    doc = await Campaign.findById(same.id)
    expect(doc.meter.value).toBe(140)
    expect(doc.garrison.resolve).toBe(50)
  })

  test('the decay never drops resolve below the floor (0)', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinResolve(c.id, 5) // slow ~0.02 -> round(50 x 0.98) = 49; 320 + 49 = 369 crosses
    await pinMeter(c.id, 320)
    await endDay(c.id)
    expect((await Campaign.findById(c.id)).garrison.resolve).toBe(0)
  })
})

// Garrison surrender (S5) — the second loss clock. Resolve reaching the floor at
// end-of-day ends the campaign, regardless of the walls meter: the garrison
// opens Karrowgate's gates. Checked in dayResolution step 6, after the turn's
// resolve moves (here the band-cross decay) settle.
describe('the garrison surrenders when resolve reaches the floor', () => {
  test('a band-cross decay to 0 loses the campaign — the garrison opens the gates', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    // resolve 8 -> a wall band-cross decays it by 10 -> clamps to 0 -> surrender.
    await pinResolve(c.id, 8)
    await pinMeter(c.id, 320) // fills across intact->damaged, triggering the decay
    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.report.status).toBe('lost')
    expect(res.body.campaign.status).toBe('lost')
    expect(res.body.report.entries.some((e) => /opens? .*gates|throws open its gates/i.test(e))).toBe(true)
    // The war ends where it stands: step 7 (new turn) never runs.
    expect(res.body.report.newDay).toBe(1)
    const doc = await Campaign.findById(c.id)
    expect(doc.status).toBe('lost')
    expect(doc.day).toBe(1)
  })

  test('a garrison above the floor does NOT surrender', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinResolve(c.id, 30) // a band-cross decay leaves 20 > floor
    await pinMeter(c.id, 320)
    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expect(res.body.report.status).toBe('active')
    expect(res.body.report.newDay).toBe(2)
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
    expect(res.body.report.status).toBe('active') // above the line: not withdrawing
    expect(res.body.report.newDay).toBe(2)
  })

  test('below the threshold the host withdraws — and that wins the campaign', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    await pinEnemy(c.id, { army: { Soldier: 144 }, supplies: 90000 })

    const res = await endDay(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // The meter still filled (step 4 runs before the end check), so the report
    // band is 'intact'; the win comes from the direct near-annihilation check.
    expect(res.body.report.enemy).toEqual({ band: 'intact', bossFightDue: false })
    expect(res.body.report.status).toBe('won')
    expect(res.body.campaign.status).toBe('won')
    // The war ends where it stands: step 7 (new turn) never runs.
    expect(res.body.report.newDay).toBe(1)
    expect(res.body.report.entries).toContain(
      'The enemy host is melting away down the road it came by. The country is yours.',
    )

    const doc = await Campaign.findById(c.id)
    expect(doc.status).toBe('won')
    expect(doc.day).toBe(1)

    // A finished campaign refuses further actions.
    expect((await endDay(c.id)).status).toBe(400)
  })
})
