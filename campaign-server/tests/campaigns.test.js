import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { fortifiedSidesFor } from '../services/fortification.js'

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
const { default: Campaign, CAMPAIGN_SCHEMA_VERSION } = await import('../models/campaign.js')
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
// the enemy army composition, the planned enemy placement, the augury's
// true/false pairs or their outcomes (shownTrue, legibility bonus), or the
// enemy's forage plan. Checked on every response the tests receive. Keys are
// matched quoted so e.g. the day report's public `wasAccurate` reveal doesn't
// trip a hidden-key check.
const expectNoHiddenInfo = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('plannedPlacement')
  expect(raw).not.toContain('initialStrength')
  expect(raw).not.toContain('enemyPlan')
  expect(raw).not.toContain('"trueEvent"')
  expect(raw).not.toContain('"falseEvent"')
  expect(raw).not.toContain('"shownTrue"')
  expect(raw).not.toContain('"baseAccuracy"')
  if (body.campaign?.enemy) expect(body.campaign.enemy.army).toBeUndefined()
  if (body.enemy) expect(body.enemy.army).toBeUndefined()
  // Scouting crosses the boundary as the banded label ONLY — a raw coverage
  // or ratio number would let the client solve for the enemy composition.
  expect(raw).not.toContain('"coverage"')
  expect(raw).not.toContain('"ratio"')
  for (const scouting of [body.scouting, body.campaign?.scouting])
    if (scouting) expect(Object.keys(scouting)).toEqual(['band'])
}

// Pinned augury states for deterministic assertions. QUIET is a no-op truth
// (±0 food) so end-day resource math stays exact; DOOMED is NOT in
// EVENT_POOL, so after a reroll its reappearance is impossible — which is
// what makes "the old fate never fires" testable.
const QUIET = {
  id: 'quiet',
  title: 'Quiet Fortnight',
  description: 'Nothing stirs.',
  severity: 1,
  effect: { type: 'food', delta: 0 },
}
const DOOMED = {
  id: 'doomed_omen',
  title: 'Doom',
  description: 'A fate that must never come to pass.',
  severity: 3,
  effect: { type: 'food', delta: -999 },
}
// Pin EVERY slot to the same unread pair. Consulting reads each slot: the
// queued throwDice chain, then a d1000 vision roll against odds×1000, where
// odds = (roll + base 2 + mage 1 (starting roster has 3 Mages) +
// POOL_LEGIBILITY[severity]) × 0.05. A queued [4,1] reading (roll 4) gives:
// QUIET truth (minor pool, +2) → odds 0.45 → threshold 450; DOOMED truth
// (major pool, +0) → odds 0.35 → threshold 350.
const pinAugury = async (id, trueEvent = QUIET, falseEvent = DOOMED) => {
  const doc = await Campaign.findById(id)
  doc.augury.slots = doc.augury.slots.map(() => ({
    trueEvent,
    falseEvent,
    odds: null,
    shownTrue: null,
  }))
  await doc.save()
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
    // A fresh, unread augury: no prophecy yet, the reroll unspent.
    expect(res.body.augury).toEqual({ consulted: false, rerollsRemaining: 1, visions: null })
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
    // Fixture-catalog scouting coverages: player 1494/4000 ≈ 0.374 vs enemy
    // 2882/7410 ≈ 0.389 → ratio ≈ 0.96, squarely Contested from turn 1.
    expect(res.body.scouting).toEqual({ band: 'Contested' })
    expectNoHiddenInfo(res.body)
  })

  test('hidden state exists in the DB but never in the response', async () => {
    const res = await createCampaign()
    const doc = await Campaign.findById(res.body.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540)
    // The turn's fates are already sealed server-side: three unresolved slots,
    // each a distinct same-pool true/false pair.
    expect(doc.augury.slots).toHaveLength(3)
    for (const slot of doc.augury.slots) {
      expect(slot.trueEvent.id).toBeTruthy()
      expect(slot.falseEvent.id).toBeTruthy()
      expect(slot.trueEvent.id).not.toBe(slot.falseEvent.id)
      expect(slot.falseEvent.severity).toBe(slot.trueEvent.severity)
      expect(slot.shownTrue).toBeNull()
    }
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

// Playtest bug 2026-07-03: a campaign doc from before the forage fields
// rendered as nonsense (food frozen at the old starting 100 kg, "Land: 0%").
// Policy: no migrations — version-mismatched docs are DELETED on listing and
// invisible to every other route. The version check must hit the raw query
// (Mongoose fills schema defaults on hydration, masking missing fields).
describe('campaign schema versioning', () => {
  // Simulate a doc written by an older server: strip the version field with
  // a raw driver op so Mongoose defaulting can't repair it.
  const makeLegacy = (id) =>
    Campaign.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $unset: { schemaVersion: '' } },
    )

  test('a fresh campaign stores the current schema version', async () => {
    const { body: c } = await createCampaign()
    const [raw] = await Campaign.collection.find({}).toArray()
    expect(raw.schemaVersion).toBe(CAMPAIGN_SCHEMA_VERSION)
    expect(c.status).toBe('active')
  })

  test('pre-versioning docs are deleted on listing, never served', async () => {
    const { body: c } = await createCampaign()
    await makeLegacy(c.id)

    const list = await auth(api.get('/api/campaigns'))
    expect(list.status).toBe(200)
    expect(list.body).toEqual([])
    expect(await Campaign.collection.countDocuments({})).toBe(0)
  })

  test('version-mismatched docs are deleted on listing too', async () => {
    const { body: c } = await createCampaign()
    await Campaign.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(c.id) },
      { $set: { schemaVersion: CAMPAIGN_SCHEMA_VERSION + 1 } },
    )

    const list = await auth(api.get('/api/campaigns'))
    expect(list.body).toEqual([])
    expect(await Campaign.collection.countDocuments({})).toBe(0)
  })

  test('a save from another BUILD is deleted on listing and 404s directly', async () => {
    // Docker stamps a fresh build version on every changed image, so a
    // redeploy invalidates old saves even when the schema still matches —
    // a stale save is never worth the risk (user, 2026-07-05).
    const { body: c } = await createCampaign()
    await Campaign.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(c.id) },
      { $set: { buildVersion: 'some-older-build' } },
    )

    expect((await auth(api.get(`/api/campaigns/${c.id}`))).status).toBe(404)
    const list = await auth(api.get('/api/campaigns'))
    expect(list.body).toEqual([])
    expect(await Campaign.collection.countDocuments({})).toBe(0)
  })

  test('a legacy campaign 404s on direct access and on actions', async () => {
    const { body: c } = await createCampaign()
    await makeLegacy(c.id)

    expect((await auth(api.get(`/api/campaigns/${c.id}`))).status).toBe(404)
    expect(
      (await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})).status,
    ).toBe(404)
    expect(
      (
        await auth(api.post(`/api/campaigns/${c.id}/forage`)).send({
          assignment: { Soldier: 1 },
        })
      ).status,
    ).toBe(404)
  })

  test("purging is per-user: a rival's legacy doc survives my listing", async () => {
    const other = await createUserAndToken(api, 'rival', 'sekret2')
    const otherRes = await api
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${other.token}`)
      .send({})
    await makeLegacy(otherRes.body.id)

    await createCampaign()
    const list = await auth(api.get('/api/campaigns'))
    expect(list.body).toHaveLength(1)
    expect(await Campaign.collection.countDocuments({})).toBe(2)
  })
})

describe('POST /api/campaigns/:id/augury/consult', () => {
  const consult = (id) => auth(api.post(`/api/campaigns/${id}/augury/consult`)).send({})

  test('resolves every slot; the response carries the shown cards + odds only', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET) // [4,1] reading → odds 0.35 → threshold 350

    pushRoll(4); pushRoll(1); pushRoll(350) // slot 0: at the line → the truth
    pushRoll(4); pushRoll(1); pushRoll(351) // slot 1: just over → the lie
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 2: the lie
    const res = await consult(c.id)
    expect(res.status).toBe(200)
    expect(res.body.augury.consulted).toBe(true)
    expect(res.body.augury.rerollsRemaining).toBe(1)
    expect(res.body.augury.visions.map((v) => v.id)).toEqual([
      'doomed_omen',
      'quiet',
      'quiet',
    ])
    // The displayed odds are exactly what the vision was rolled against:
    // (roll 4 + base 2 + mage 1 + legibility 0) × 0.05.
    for (const v of res.body.augury.visions) expect(v.odds).toBeCloseTo(0.35)
    expect(res.body.augury.visions[0]).toMatchObject({
      id: 'doomed_omen',
      title: 'Doom',
      description: DOOMED.description,
      severity: 3,
      effect: DOOMED.effect,
    })
    // Truth reveal: with AUGURY_DEBUG_SHOW_TRUTH on (playtest debug) the
    // slot's true card rides along immediately; the final rule gates it on
    // the reroll being spent. Flipping the flag flips this expectation.
    expect(res.body.augury.visions.map((v) => v.truth.id)).toEqual(
      Array(3).fill('doomed_omen'),
    )
    expectNoHiddenInfo(res.body)

    // The DB knows which visions were true; no response ever does.
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
  })

  test('the augur speaks once per turn', async () => {
    const { body: c } = await createCampaign()
    expect((await consult(c.id)).status).toBe(200)
    expect((await consult(c.id)).status).toBe(400)
  })
})

describe('POST /api/campaigns/:id/augury/reroll', () => {
  const consult = (id) => auth(api.post(`/api/campaigns/${id}/augury/consult`)).send({})
  const reroll = (id, body = { slot: 0 }) =>
    auth(api.post(`/api/campaigns/${id}/augury/reroll`)).send(body)

  test('rejected before the augur has spoken', async () => {
    const { body: c } = await createCampaign()
    expect((await reroll(c.id)).status).toBe(400)
  })

  test('requires a valid slot index', async () => {
    const { body: c } = await createCampaign()
    await consult(c.id)
    expect((await reroll(c.id, {})).status).toBe(400)
    expect((await reroll(c.id, { slot: -1 })).status).toBe(400)
    expect((await reroll(c.id, { slot: 3 })).status).toBe(400)
    expect((await reroll(c.id, { slot: 1.5 })).status).toBe(400)
  })

  test('replaces one fate: the old truth never fires, the others stay sealed', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, QUIET, DOOMED)
    await consult(c.id)

    const res = await reroll(c.id, { slot: 1 })
    expect(res.status).toBe(200)
    expect(res.body.augury.rerollsRemaining).toBe(0)
    expect(res.body.augury.consulted).toBe(true)
    expect(res.body.augury.visions).toHaveLength(3)
    // The reroll is resolved → every vision now carries its slot's true card
    // (holds with or without the debug flag).
    expect(res.body.augury.visions.every((v) => v.truth?.id)).toBe(true)
    expectNoHiddenInfo(res.body)

    // DOOMED (the pinned false event) is not in EVENT_POOL: the rerolled
    // slot's fresh pair cannot contain it; the other slots keep theirs.
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[1].trueEvent.id).not.toBe('doomed_omen')
    expect(doc.augury.slots[1].falseEvent.id).not.toBe('doomed_omen')
    expect(doc.augury.slots[1].shownTrue).not.toBeNull() // read fresh
    expect(doc.augury.slots[0].trueEvent.id).toBe('quiet')
    expect(doc.augury.slots[2].falseEvent.id).toBe('doomed_omen')

    expect((await reroll(c.id)).status).toBe(400) // none left
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

  // Playtest bug 2026-07-03: the forage menu offered troop types the player
  // doesn't own. The view's kgPerUnit is the client's row source — pin it to
  // exactly the roster's types so catalog-only units never get a stepper.
  test('kgPerUnit covers exactly the roster types, nothing from the wider catalog', async () => {
    const { body: c } = await createCampaign()
    expect(Object.keys(c.forage.kgPerUnit).sort()).toEqual(Object.keys(c.roster).sort())
    expect(c.forage.kgPerUnit.Zombie).toBeUndefined()
    expect(c.forage.kgPerUnit.Necromancer).toBeUndefined()
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

  // Battle commits the whole army, so these tests shrink the roster to
  // exactly what they field.
  const shrinkRoster = async (id, roster) => {
    const doc = await Campaign.findById(id)
    doc.roster = roster
    await doc.save()
    return doc
  }

  test('injects the hidden enemy placement, updates rosters from survivors', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await shrinkRoster(c.id, { Soldier: 1 })

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

    // The whole 1-Soldier host fielded, 2 came back (fixture).
    expect(res.body.campaign.roster.Soldier).toBe(2)
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
    await shrinkRoster(c.id, { Soldier: 1 })
    await fightSoldiers(c.id)
    expect((await fightSoldiers(c.id)).status).toBe(400)
  })

  test('injects the campaign fortification level as battle-input fortified_sides', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await shrinkRoster(c.id, { Soldier: 1 })
    doc.fortificationLevel = 1
    await doc.save()

    await fightSoldiers(c.id)
    const input = engine.runBattle.mock.calls[0][0]
    expect(input.fortified_sides).toEqual(fortifiedSidesFor('sample_battle', 1))
    expect(input.fortified_sides.length).toBeGreaterThan(0)
    for (const s of input.fortified_sides)
      expect(s).toMatchObject({ q: expect.any(Number), r: expect.any(Number), dir: expect.any(String) })
  })

  test('no fortifications → empty fortified_sides', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 1 })
    await fightSoldiers(c.id)
    const input = engine.runBattle.mock.calls[0][0]
    expect(input.fortified_sides).toEqual([])
  })

  test('a partial deployment is rejected — the whole army takes the field', async () => {
    // Playtest 2026-07-05: 212 of 378 placed still offered Fight. The server
    // now rejects any placement that leaves non-foraging units in camp.
    const { body: c } = await createCampaign()
    const res = await fightSoldiers(c.id, 1) // 377 units still in camp
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/whole army/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('cannot field more units than the roster owns', async () => {
    const { body: c } = await createCampaign()
    const res = await fightSoldiers(c.id, 301)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not enough Soldier/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('a placement that overstacks one hex is rejected — the engine would otherwise silently drop the overflow', async () => {
    // Fixture catalog: Soldier size 10, hex capacity 640 -> 65 on one hex is
    // one unit over budget (650), while the roster has plenty (budget check
    // alone would pass this).
    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 65 })
    const res = await fightSoldiers(c.id, 65)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/overstacked/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('a battle that wipes the whole roster loses the campaign immediately', async () => {
    // Playtest bug 2026-07-05: an annihilated army left the campaign 'active'
    // with 0 soldiers — no defeat screen, no way to start a new campaign.
    const wiped = structuredClone(battleResultFixture)
    wiped.winner = 'red'
    wiped.blue_survivors = {}
    wiped.red_survivors = { Zombie: 1 }
    engine.runBattle.mockResolvedValue(wiped)

    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 5 } // field the entire host, nobody stays in camp
    await doc.save()

    const res = await fightSoldiers(c.id, 5)
    expect(res.status).toBe(201)
    expect(res.body.campaign.status).toBe('lost')
    // A finished campaign refuses further actions.
    expect((await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})).status).toBe(400)
  })

  test('destroying the enemy host in battle wins the campaign immediately', async () => {
    // The fixture's red_survivors is {} — total enemy annihilation.
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 1 })
    const res = await fightSoldiers(c.id)
    expect(res.body.campaign.status).toBe('won')
  })

  test('a battle both sides lose entirely is a loss, not a win', async () => {
    const wiped = structuredClone(battleResultFixture)
    wiped.winner = 'draw'
    wiped.blue_survivors = {}
    wiped.red_survivors = {}
    engine.runBattle.mockResolvedValue(wiped)

    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 5 }
    await doc.save()

    const res = await fightSoldiers(c.id, 5)
    expect(res.body.campaign.status).toBe('lost')
  })

  test('cannot field non-placeable types', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
      player_placement: [{ unit_type: 'Zombie', q: 4, r: 4 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a placeable/)
  })

  describe('squads (playtest item 1)', () => {
    const setSquads = async (id, squads, roster) => {
      const doc = await Campaign.findById(id)
      doc.squads = squads
      if (roster) doc.roster = roster
      await doc.save()
      return doc
    }
    const fieldSquad = (id, squad) =>
      auth(api.post(`/api/campaigns/${id}/battles`)).send({
        player_placement: Object.entries(squad.composition).flatMap(([unit_type, n]) =>
          Array.from({ length: n }, () => ({
            unit_type,
            q: 4,
            r: 4,
            squad_id: squad.id,
            squad_name: squad.name,
          })),
        ),
      })

    test('a fresh campaign seeds STARTING_SQUADS', async () => {
      const { body: c } = await createCampaign()
      expect(c.squads).toEqual([
        { id: 1, name: '1st Cohort', composition: { Soldier: 40 } },
        { id: 2, name: 'Skirmishers', composition: { Archer: 30 } },
        { id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 } },
      ])
    })

    test('fielding a squad regroups its battle survivors', async () => {
      const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
      const result = structuredClone(battleResultFixture)
      result.blue_squads = { 1: { survivors: { Soldier: 1 }, wiped: false } }
      engine.runBattle.mockResolvedValue(result)

      const { body: c } = await createCampaign()
      await setSquads(c.id, [squad], { Soldier: 2 })

      const res = await fieldSquad(c.id, squad)
      expect(res.status).toBe(201)
      expect(res.body.campaign.squads).toEqual([
        { id: 1, name: '1st Cohort', composition: { Soldier: 1 } },
      ])
    })

    test('a wiped squad is disbanded after battle', async () => {
      const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
      const result = structuredClone(battleResultFixture)
      // Both members broke and fled — stragglers, not a standing formation.
      result.blue_survivors = { Soldier: 2 }
      result.blue_squads = { 1: { survivors: { Soldier: 2 }, wiped: true } }
      engine.runBattle.mockResolvedValue(result)

      const { body: c } = await createCampaign()
      await setSquads(c.id, [squad], { Soldier: 2 })

      const res = await fieldSquad(c.id, squad)
      expect(res.status).toBe(201)
      expect(res.body.campaign.squads).toEqual([])
      // The stragglers still count toward the roster — only the squad's
      // organized identity is lost, not the troops themselves.
      expect(res.body.campaign.roster.Soldier).toBe(2)
    })

    test('a squad left in camp is untouched by a battle fielding a different squad', async () => {
      const fielded = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
      const inCamp = { id: 2, name: 'Skirmishers', composition: { Archer: 5 } }
      const result = structuredClone(battleResultFixture)
      result.blue_survivors = { Soldier: 2, Archer: 5 }
      result.blue_squads = { 1: { survivors: { Soldier: 2 }, wiped: false } }
      engine.runBattle.mockResolvedValue(result)

      const { body: c } = await createCampaign()
      await setSquads(c.id, [fielded, inCamp], { Soldier: 2, Archer: 5 })

      // Field the 1st Cohort AND the Skirmishers' units loose (so the whole
      // army rule is satisfied) — only 1st Cohort's placement carries its
      // squad_id, so Skirmishers stays a squad, untouched.
      const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
        player_placement: [
          { unit_type: 'Soldier', q: 4, r: 4, squad_id: 1, squad_name: '1st Cohort' },
          { unit_type: 'Soldier', q: 4, r: 4, squad_id: 1, squad_name: '1st Cohort' },
          ...Array.from({ length: 5 }, () => ({ unit_type: 'Archer', q: 5, r: 4 })),
        ],
      })
      expect(res.status).toBe(201)
      expect(res.body.campaign.squads).toEqual([
        { id: 1, name: '1st Cohort', composition: { Soldier: 2 } },
        { id: 2, name: 'Skirmishers', composition: { Archer: 5 } },
      ])
    })

    test('rejects a squad_id that is not one of the campaign\'s own squads', async () => {
      const { body: c } = await createCampaign()
      await shrinkRoster(c.id, { Soldier: 1 })
      const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
        player_placement: [{ unit_type: 'Soldier', q: 4, r: 4, squad_id: 999 }],
      })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/not one of your squads/)
      expect(engine.runBattle).not.toHaveBeenCalled()
    })

    test('red_squads is never exposed to the client', async () => {
      const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
      const result = structuredClone(battleResultFixture)
      result.blue_squads = { 1: { survivors: { Soldier: 2 }, wiped: false } }
      result.red_squads = { 5: { survivors: { Zombie: 3 }, wiped: false } } // engine-side, must not leak
      engine.runBattle.mockResolvedValue(result)

      const { body: c } = await createCampaign()
      await setSquads(c.id, [squad], { Soldier: 2 })

      const res = await fieldSquad(c.id, squad)
      expect(res.status).toBe(201)
      expect(JSON.stringify(res.body)).not.toContain('red_squads')
    })
  })
})

describe('POST /api/campaigns/:id/spend', () => {
  const spend = (id, body) => auth(api.post(`/api/campaigns/${id}/spend`)).send(body)
  const setMaterials = async (id, materials) => {
    const doc = await Campaign.findById(id)
    doc.resources.materials = materials
    await doc.save()
  }

  const setWorkers = async (id, total, used = 0) => {
    const doc = await Campaign.findById(id)
    doc.workers = { total, used }
    await doc.save()
  }

  test('fortify debits materials and raises the level; cost scales L0→1=50, L1→2=100', async () => {
    const { body: c } = await createCampaign()
    await setMaterials(c.id, 500)

    const first = await spend(c.id, { action: 'fortify' })
    expect(first.status).toBe(200)
    expect(first.body.fortification.level).toBe(1)
    expect(first.body.resources.materials).toBe(500 - 50)
    // The view now exposes the walled sides for the placement grid.
    expect(first.body.fortification.sides.length).toBeGreaterThan(0)
    expect(first.body.fortification.nextCost).toBe(100)
    expectNoHiddenInfo(first.body)

    const second = await spend(c.id, { action: 'fortify' })
    expect(second.body.fortification.level).toBe(2)
    expect(second.body.resources.materials).toBe(500 - 50 - 100)
    // At the cap: no further level, no next cost.
    expect(second.body.fortification.atCap).toBe(true)
    expect(second.body.fortification.nextCost).toBeNull()
  })

  test('fortify is rejected without enough materials and at the cap', async () => {
    const { body: c } = await createCampaign()
    await setMaterials(c.id, 40) // < 50
    expect((await spend(c.id, { action: 'fortify' })).status).toBe(400)

    // Jump to the cap and confirm a further fortify 400s.
    const doc = await Campaign.findById(c.id)
    doc.fortificationLevel = 2
    doc.resources.materials = 1000
    await doc.save()
    const capped = await spend(c.id, { action: 'fortify' })
    expect(capped.status).toBe(400)
    expect(capped.body.error).toMatch(/maximum/)
  })

  test('militia buys Soldiers for food+materials, capped per turn', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 10 }
    doc.resources = { food: 1000, materials: 1000 }
    await doc.save()

    const res = await spend(c.id, { action: 'militia', count: 10 })
    expect(res.status).toBe(200)
    expect(res.body.roster.Soldier).toBe(20)
    expect(res.body.resources.food).toBe(1000 - 10 * 2)
    expect(res.body.resources.materials).toBe(1000 - 10 * 1)

    // Over the per-turn cap (50) is rejected.
    expect((await spend(c.id, { action: 'militia', count: 41 })).status).toBe(400)
  })

  test('a new campaign starts with the full workforce, none used', async () => {
    const { body: c } = await createCampaign()
    expect(c.workers).toEqual({ total: 2000, used: 0, available: 2000 })
  })

  test('fortify also spends workers (500→1000) and rejects when the workforce is short', async () => {
    const { body: c } = await createCampaign()
    await setMaterials(c.id, 1000)
    await setWorkers(c.id, 2000)

    const first = await spend(c.id, { action: 'fortify' })
    expect(first.status).toBe(200)
    expect(first.body.workers).toEqual({ total: 2000, used: 500, available: 1500 })
    expect(first.body.fortification.nextWorkerCost).toBe(1000)

    const second = await spend(c.id, { action: 'fortify' })
    expect(second.status).toBe(200)
    expect(second.body.workers).toEqual({ total: 2000, used: 1500, available: 500 })
    expect(second.body.fortification.nextWorkerCost).toBeNull() // at cap

    // Plenty of materials but no workforce to spare → rejected, nothing spent.
    const { body: poor } = await createCampaign()
    await setMaterials(poor.id, 10000)
    await setWorkers(poor.id, 400) // < 500 needed for L0→1
    const rej = await spend(poor.id, { action: 'fortify' })
    expect(rej.status).toBe(400)
    expect(rej.body.error).toMatch(/workers|workforce/i)
    const reload = await auth(api.get(`/api/campaigns/${poor.id}`))
    expect(reload.body.fortification.level).toBe(0)
    expect(reload.body.workers.used).toBe(0)
  })

  test('militia also spends one worker each and rejects when the workforce is short', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 10 }
    doc.resources = { food: 1000, materials: 1000 }
    doc.workers = { total: 2000, used: 1995 } // only 5 free
    await doc.save()

    const ok = await spend(c.id, { action: 'militia', count: 5 })
    expect(ok.status).toBe(200)
    expect(ok.body.workers).toEqual({ total: 2000, used: 2000, available: 0 })

    // No workers left → even an affordable-in-stores purchase is rejected.
    const rej = await spend(c.id, { action: 'militia', count: 1 })
    expect(rej.status).toBe(400)
    expect(rej.body.error).toMatch(/workers|workforce/i)
  })

  test('bad actions and counts are rejected', async () => {
    const { body: c } = await createCampaign()
    expect((await spend(c.id, {})).status).toBe(400)
    expect((await spend(c.id, { action: 'bribe' })).status).toBe(400)
    expect((await spend(c.id, { action: 'militia', count: 0 })).status).toBe(400)
    expect((await spend(c.id, { action: 'militia', count: 1.5 })).status).toBe(400)
  })
})

describe('POST /api/campaigns/:id/end-day', () => {
  test('advances the turn: upkeep, enemy foraging, fresh augury, report', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // ±0-food truth keeps the resource math exact
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // Two weeks of eating: 12,432 kg for the starting roster.
    expect(res.body.report.upkeep.foodConsumed).toBe(12432)
    expect(res.body.campaign.day).toBe(2)
    expect(res.body.campaign.resources.food).toBe(50000 - 12432)
    expect(res.body.campaign.battleFoughtToday).toBe(false)

    // Every truth came to pass unconsulted; the reveal says so per slot, and
    // the new turn starts with a fresh, unread augury.
    expect(res.body.report.augury).toEqual(
      Array.from({ length: 3 }, () => ({
        predicted: null,
        odds: null,
        actual: { id: 'quiet', title: 'Quiet Fortnight', description: 'Nothing stirs.', severity: 1 },
        wasAccurate: null,
      })),
    )
    expect(res.body.campaign.augury).toEqual({
      consulted: false,
      rerollsRemaining: 1,
      visions: null,
    })

    // The enemy foraged the near ring even though we sent nobody out.
    expect(res.body.report.forage.harvested).toEqual({ food: 0, materials: 0 })
    expect(res.body.report.forage.rings[0].richness).toBe(20000 - 9132)
    expect(res.body.report.forage.clashes).toEqual([])
  })

  // Workers eating food is DEFERRED on purpose (docs/CAMPAIGN_PLAN.md
  // "Deferred design backlog" — at the 2000-pool starting size it would
  // dwarf the whole army's upkeep and instantly starve every campaign;
  // it's paired with worker replenishment, which doesn't exist yet
  // either). This pins that today's upkeep depends ONLY on the roster —
  // spending nearly the whole workforce (as militia/forts would) changes
  // nothing about food consumed. If this test ever needs updating, that's
  // the signal the deferred feature has been wired in for real.
  test('workers do not eat food — upkeep is unaffected by the workforce pool', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // ±0-food truth keeps the resource math exact

    const doc = await Campaign.findById(c.id)
    doc.workers.used = 1999 // almost the entire 2000-worker pool spent
    await doc.save()

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    // Same 12,432 kg as the plain starting-roster case (see the test
    // above) — workers.used had no effect on upkeep.
    expect(res.body.report.upkeep.foodConsumed).toBe(12432)
    expect(res.body.campaign.resources.food).toBe(50000 - 12432)
  })

  test('foragers harvest at end of turn; the assignment clears for the new turn', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // keep the food math free of event noise
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
    expect(res.body.campaign.resources.materials).toBe(200 + 600) // 200 starting + 0.2 × 3000 forage
    expect(res.body.campaign.forage.assignment).toEqual({})
  })

  test('the day report reveals predicted vs actual per slot — the augur can lie', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET) // [4,1] reading → odds 0.35 → threshold 350
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 0: lie
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 1: lie
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 2: truth
    await auth(api.post(`/api/campaigns/${c.id}/augury/consult`)).send({})

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expectNoHiddenInfo(res.body)
    expect(res.body.report.augury.map((r) => r.predicted.id)).toEqual([
      'quiet',
      'quiet',
      'doomed_omen',
    ])
    expect(res.body.report.augury.map((r) => r.actual.id)).toEqual(
      Array(3).fill('doomed_omen'),
    )
    expect(res.body.report.augury.map((r) => r.wasAccurate)).toEqual([false, false, true])
    // ALL three unforetold dooms really applied: 3 × -999 kg on top of upkeep.
    expect(res.body.campaign.resources.food).toBe(50000 - 3 * 999 - 12432)
  })

  test('starvation causes desertion', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // a roster/food event would skew the desertion math
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
