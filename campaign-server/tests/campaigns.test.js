import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { fortifiedSidesFor } from '../services/fortification.js'
import { EVENT_POOL } from '../services/events.js'
import { RECON_LEVEL_THRESHOLDS } from '../utils/campaignConfig.js'

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
// What the enemy view may expose at each scouting band (Stage 4 1b). Keys
// accumulate as the band climbs and NOTHING beyond the band's set may appear;
// day-report enemy summaries (no scouting sibling) stay stance-only.
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
  expect(raw).not.toContain('"baseAccuracy"')
  // The enemy view never carries the raw army, and its keys are pinned to
  // exactly what the current scouting band licenses.
  for (const c of [body, body.campaign, body.report]) {
    if (!c?.enemy) continue
    expect(c.enemy.army).toBeUndefined()
    // A free reveal (Stage 4 1c, anticipated Night Raid) may exceed the band
    // for one turn — flagged by `revealed`, opening exactly the Overwhelming
    // set and nothing more.
    const allowed = c.enemy.revealed
      ? [...ENEMY_KEYS_BY_BAND.Overwhelming, 'revealed'].sort()
      : c.scouting
        ? ENEMY_KEYS_BY_BAND[c.scouting.band]
        : ['battleOffer', 'stance']
    expect(Object.keys(c.enemy).sort()).toEqual(allowed)
  }
  // Events with choices: a pending decision crosses as display fields plus
  // option cards only — never the branch effects (the pool's `choices`
  // entries), the pool id, or the rung that fired.
  expect(raw).not.toContain('"choices"')
  expect(raw).not.toContain('"eventId"')
  for (const c of [body, body.campaign]) {
    for (const p of c?.pendingChoices ?? []) {
      expect(Object.keys(p).sort()).toEqual(['description', 'options', 'slot', 'title'])
      for (const o of p.options)
        expect(Object.keys(o).sort()).toEqual(['description', 'id', 'label'])
    }
  }
  for (const slot of body.report?.augury ?? [])
    for (const o of slot.pendingChoice?.options ?? [])
      expect(Object.keys(o).sort()).toEqual(['description', 'id', 'label'])
  // Scouting crosses the boundary as the banded label ONLY — a raw coverage
  // or ratio number would let the client solve for the enemy composition.
  expect(raw).not.toContain('"coverage"')
  expect(raw).not.toContain('"ratio"')
  for (const scouting of [body.scouting, body.campaign?.scouting])
    if (scouting) expect(Object.keys(scouting)).toEqual(['band'])
  // Boss-fight meter: banded phrase only pre-reveal — the exact value stays
  // null until bought (meter.revealed, a later stage).
  for (const c of [body, body.campaign]) {
    if (!c?.meter) continue
    expect(Object.keys(c.meter).sort()).toEqual(['band', 'revealed', 'value'])
    if (!c.meter.revealed) expect(c.meter.value).toBeNull()
  }
  // Raid opportunities (Stage 4 Part 2 + the 2.5 scouting mini-game): the raw
  // hidden target-slice Map (`targetForce`) never crosses — the wire carries
  // per-type ranges under `enemy`/`reward` instead — and each opportunity's
  // key set is pinned exactly.
  expect(raw).not.toContain('"targetForce"')
  for (const c of [body, body.campaign]) {
    for (const o of c?.raid?.opportunities ?? [])
      expect(Object.keys(o).sort()).toEqual([
        'capacity', 'description', 'enemy', 'enemyReveal', 'id', 'outcome',
        'resolved', 'reward', 'rewardReveal', 'source', 'strengthBand', 'title', 'type',
      ])
  }
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
    expect(res.body.augury).toEqual({ consulted: false, accepted: false, rerollsRemaining: 1, visions: null })
    expect(res.body.enemy.stance).toBe('camp')
    // Fresh land: three untouched rings, nobody assigned to forage yet.
    expect(res.body.forage.rings).toEqual([
      { ring: 0, richness: 20000, initialRichness: 20000 },
      { ring: 1, richness: 35000, initialRichness: 35000 },
      { ring: 2, richness: 55000, initialRichness: 55000 },
    ])
    expect(res.body.forage.assignment).toEqual({})
    expect(res.body.forage.capacityKg).toBe(0)
    // A fresh campaign has done no recon yet (0 points) → Blind, whose 0.7
    // forage posture already scales the preview: round(30 × 0.7), round(84 × 0.7).
    expect(res.body.forage.kgPerUnit.Soldier).toBe(21)
    expect(res.body.forage.kgPerUnit.LightCavalry).toBe(59)
    expect(res.body.scouting).toEqual({ band: 'Blind' })
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
    expect(doc.forage.enemyPlan).toBe(9084)
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

// ── Stage 4 (1b): scouting-graduated enemy reveal ────────────────────────────
// The scouting band decides how much of the hidden enemy crosses the boundary;
// campaignView stays the single gate. Armies are pinned straight on the doc to
// force each band (fixture-catalog coverages; the default player roster sits
// at 1494/4000 ≈ 0.374).
const pinArmies = async (id, { roster, enemyArmy, enemySupplies } = {}) => {
  const doc = await Campaign.findById(id)
  if (roster) doc.roster = new Map(Object.entries(roster))
  if (enemyArmy) doc.enemy.army = new Map(Object.entries(enemyArmy))
  if (enemySupplies !== undefined) doc.enemy.supplies = enemySupplies
  await doc.save()
}

// Recon rework: the scouting band now comes from accumulated recon points, not
// troop coverage. Pin the campaign to the minimum points that land in `band`
// (Blind = 0, then each RECON_LEVEL_THRESHOLD). A fresh campaign starts Blind.
const RECON_BANDS = ['Blind', 'Outmatched', 'Contested', 'Superior', 'Overwhelming']
const pinBand = async (id, band) => {
  const idx = RECON_BANDS.indexOf(band)
  const points = idx <= 0 ? 0 : RECON_LEVEL_THRESHOLDS[idx - 1]
  const doc = await Campaign.findById(id)
  doc.recon.points = points
  // Zero the leftover scouting-points pool too, so an intervening end-day's
  // recon accrual (step 7) doesn't drift the band off the pinned value.
  doc.raid.scoutingPoints = 0
  await doc.save()
}

const getView = async (id) => {
  const res = await auth(api.get(`/api/campaigns/${id}`))
  expect(res.status).toBe(200)
  expectNoHiddenInfo(res.body)
  return res.body
}

describe('scouting-graduated enemy reveal (Stage 4 1b, recon-driven)', () => {
  test('Blind (a fresh campaign, 0 recon points): stance only', async () => {
    const { body } = await createCampaign()
    // No recon yet → Blind, the enemy is unread.
    await pinArmies(body.id, { enemyArmy: { LightCavalry: 50 } })
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Blind')
    expect(view.enemy).toEqual({ stance: 'camp', battleOffer: false })
  })

  test('Outmatched: adds the strength phrase and supply state, nothing more', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { LightCavalry: 50 } })
    await pinBand(body.id, 'Outmatched')
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Outmatched')
    // 50 riders → 'a modest company'; 90,000 kg over 5,600 kg/turn ≈ 16 turns.
    expect(view.enemy.strength).toBe('a modest company')
    expect(view.enemy.supplies).toBe('well-provisioned')
    expect(view.enemy.composition).toBeUndefined()
    expect(view.enemy.units).toBeUndefined()
    expect(view.enemy.placements).toBeUndefined()
  })

  test('Contested: strength + supplies, nothing finer', async () => {
    const { body } = await createCampaign()
    await pinBand(body.id, 'Contested')
    const view = await getView(body.id)
    // Default ENEMY_ARMY armyTotal 721 → 'a large host'.
    expect(view.scouting.band).toBe('Contested')
    expect(view.enemy).toEqual({
      stance: 'camp',
      battleOffer: false,
      strength: 'a large host',
      supplies: 'well-provisioned',
    })
  })

  test('supply state degrades as the enemy stores run out', async () => {
    const { body } = await createCampaign()
    // Supplies only cross the wire at Outmatched+; pin a band that shows them.
    await pinArmies(body.id, { enemySupplies: 25000 })
    await pinBand(body.id, 'Contested')
    const view = await getView(body.id)
    // 25,000 kg over 21,868 kg/turn ≈ 1.1 turns → the host is nearly starving.
    expect(view.enemy.supplies).toBe('near starving')
  })

  test('Superior: adds composition by category percent', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Soldier: 400, Zombie: 200 } })
    await pinBand(body.id, 'Superior')
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Superior')
    expect(view.enemy.strength).toBe('a large host') // 600 is the band's lower edge
    expect(view.enemy.composition).toEqual({ Foot: 100 })
    expect(view.enemy.units).toBeUndefined()
    expect(view.enemy.placements).toBeUndefined()
  })

  test('Overwhelming: exact counts and the real planned placement', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Zombie: 450, LightCavalry: 10 } })
    await pinBand(body.id, 'Overwhelming')
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Overwhelming')
    expect(view.enemy.units).toEqual({ Zombie: 450, LightCavalry: 10 })
    expect(view.enemy.composition).toEqual({ Foot: 98, Mounted: 2 })
    // The reveal is the REAL hidden plan the engine will receive — aggregated
    // per hex for the placement grid, never a guess.
    const doc = await Campaign.findById(body.id)
    const agg = {}
    for (const p of doc.enemy.plannedPlacement) {
      const k = `${p.unit_type}|${p.q}|${p.r}`
      agg[k] = (agg[k] ?? 0) + 1
    }
    expect(view.enemy.placements.length).toBeGreaterThan(0)
    expect(
      Object.fromEntries(view.enemy.placements.map((p) => [`${p.type}|${p.q}|${p.r}`, p.count])),
    ).toEqual(agg)
  })
})

// ── Stage 4 (1c): recon-sensitive event rungs ────────────────────────────────
// The scouting band picks which rung of a recon-sensitive fate actually lands:
// Blind → the full event; Outmatched/Contested → warned (lesser blow);
// Superior/Overwhelming → anticipated (neutral or reversed). The augur always
// foretells the Blind rung — prophecy says what's coming, scouting decides
// whether it lands — and the day report names the FIRED rung plus the scouts'
// hand, so a mitigated threat reads as the same event downgraded, never a
// silent swap. `pinBand` sets the recon level exactly as in the 1b describe above.
describe('recon-sensitive event rungs (Stage 4 1c)', () => {
  const NIGHT_RAID = EVENT_POOL.find((e) => e.id === 'night_raid')
  const AMBUSH = EVENT_POOL.find((e) => e.id === 'ambush')

  test('Contested: the warned rung fires and is named in the report', async () => {
    const { body: c } = await createCampaign()
    await pinBand(c.id, 'Contested')
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // Warned Night Raid: −500 kg per slot instead of the blind rung's
    // −2,000 kg − 2% Soldier desertion; the ranks hold.
    expect(res.body.campaign.resources.food).toBe(50000 - 3 * 500 - 12432)
    expect(res.body.campaign.roster.Soldier).toBe(300)
    for (const slot of res.body.report.augury) {
      expect(slot.actual.id).toBe('night_raid') // the fate as foretold (Blind rung)
      expect(slot.fired.rung).toBe('warned')
      expect(slot.fired.title).toBe(NIGHT_RAID.rungs.warned.title)
      expect(slot.scoutsIntervened).toBe(true)
    }
    expect(res.body.report.entries).toContain('Your scouts saw it coming.')
  })

  test('Blind: the full event lands and no intervention is flagged', async () => {
    const { body: c } = await createCampaign()
    // A fresh campaign is Blind (0 recon); the Priest roster just sets upkeep.
    await pinArmies(c.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 50 } })
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expectNoHiddenInfo(res.body)

    // Blind rung, 3 slots: 3 × −2,000 kg; upkeep for 100 Priests is 2,800 kg.
    // (The desertion part hits the empty Soldier line — nothing to take.)
    expect(res.body.campaign.resources.food).toBe(50000 - 3 * 2000 - 2800)
    for (const slot of res.body.report.augury) {
      expect(slot.fired.rung).toBe('blind')
      expect(slot.fired.title).toBe('Night Raid')
      expect(slot.scoutsIntervened).toBe(false)
    }
    expect(res.body.report.entries).not.toContain('Your scouts saw it coming.')
  })

  test('a plain event carries no rung machinery in the report', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // QUIET — not recon-sensitive
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    for (const slot of res.body.report.augury) {
      expect(slot.fired).toBeUndefined()
      expect(slot.scoutsIntervened).toBeUndefined()
    }
  })

  test('Superior: the anticipated Counter-Ambush reverses the fate onto the enemy', async () => {
    const { body: c } = await createCampaign()
    await pinArmies(c.id, { enemyArmy: { Soldier: 400, Zombie: 200 } })
    await pinBand(c.id, 'Superior')
    await pinAugury(c.id, AMBUSH, QUIET)
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expectNoHiddenInfo(res.body)

    // The blind rung would have set the host on the camp; anticipated must not.
    expect(res.body.campaign.enemy.stance).not.toBe('offering_battle')
    for (const slot of res.body.report.augury) {
      expect(slot.fired.rung).toBe('anticipated')
      expect(slot.fired.title).toBe(AMBUSH.rungs.anticipated.title)
      expect(slot.scoutsIntervened).toBe(true)
    }
    // Three ×0.93 floors on every hidden enemy line — in the DB, never the response.
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(320) // 400 → 372 → 345 → 320
    expect(doc.enemy.army.get('Zombie')).toBe(159) // 200 → 186 → 172 → 159
  })

  test('anticipated Night Raid: prisoners lay the enemy bare for exactly one turn', async () => {
    const { body: c } = await createCampaign()
    await pinArmies(c.id, { enemyArmy: { Soldier: 400, Zombie: 200 } })
    await pinBand(c.id, 'Superior')
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expectNoHiddenInfo(res.body)

    // Superior alone licenses composition at most — the reveal opens the
    // Overwhelming-tier facts (exact counts + the real placement) for the turn.
    expect(res.body.campaign.scouting.band).toBe('Superior')
    expect(res.body.campaign.enemy.revealed).toBe(true)
    expect(res.body.campaign.enemy.units).toEqual({ Soldier: 400, Zombie: 200 })
    expect(res.body.campaign.enemy.placements.length).toBeGreaterThan(0)

    // A plain GET during the revealed turn sees the same open book.
    const view = await getView(c.id)
    expect(view.enemy.revealed).toBe(true)

    // The next end-day expires it: back to what the band licenses. Re-pin the
    // band (end-day 1 refilled the scouting pool, which would otherwise accrue
    // and lift the band to Overwhelming).
    await pinBand(c.id, 'Superior')
    await pinAugury(c.id) // quiet fates so nothing re-reveals
    const next = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expectNoHiddenInfo(next.body)
    expect(next.body.campaign.enemy.revealed).toBeUndefined()
    expect(next.body.campaign.enemy.units).toBeUndefined()
  })

  test('the augur foretells the Blind rung even when the scouts will intervene', async () => {
    const { body: c } = await createCampaign()
    await pinBand(c.id, 'Superior') // scouts WILL intervene at end-day — prophecy still shows Blind
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    // [4,1] readings: (4 + base 2 + mage 1 + pool-2 legibility 1) × 0.05 =
    // 0.40 → threshold 400; a 400 vision roll shows the truth.
    pushRoll(4); pushRoll(1); pushRoll(400)
    pushRoll(4); pushRoll(1); pushRoll(400)
    pushRoll(4); pushRoll(1); pushRoll(400)
    const res = await auth(api.post(`/api/campaigns/${c.id}/augury/consult`)).send({})
    expect(res.status).toBe(200)
    for (const vision of res.body.augury.visions) {
      expect(vision.id).toBe('night_raid')
      expect(vision.title).toBe('Night Raid') // the fate if the scouts do nothing
      expect(vision.valence).toBe('bad')
    }
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
    await pinBand(c.id, 'Contested') // neutral posture (×1) — this tests raw capacity, not scouting scaling

    const res = await assign(c.id, { Soldier: 100, LightCavalry: 5 })
    expect(res.status).toBe(200)
    expect(res.body.forage.assignment).toEqual({ Soldier: 100, LightCavalry: 5 })
    expect(res.body.forage.capacityKg).toBe(100 * 30 + 5 * 84)
    expectNoHiddenInfo(res.body)

    const replaced = await assign(c.id, { Cavalry: 4 })
    expect(replaced.body.forage.assignment).toEqual({ Cavalry: 4 })
    expect(replaced.body.forage.capacityKg).toBe(4 * 84) // speed 28 → 5.6 pts × 15 kg
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

  // Stage 4 1d: the scouting band sets the forage posture. The view's preview
  // values (kgPerUnit, capacityKg) carry the same multiplier the resolution
  // applies, so what the panel promises is what end-day delivers.
  test('Blind posture scales the forage preview the player plans against', async () => {
    const { body: c } = await createCampaign()
    // A fresh campaign is Blind (0 recon); the Priest roster sets the forage math.
    await pinArmies(c.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 50 } })
    const view = await getView(c.id)
    expect(view.scouting.band).toBe('Blind')
    expect(view.forage.kgPerUnit.Priest).toBe(21) // round(30 × 0.7)
    const res = await assign(c.id, { Priest: 40 })
    expect(res.body.forage.capacityKg).toBe(840) // floor(40 × 30 × 0.7)
    expectNoHiddenInfo(res.body)
  })

  test('end-day forages at that posture and the report names it', async () => {
    const { body: c } = await createCampaign()
    await pinArmies(c.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 50 } })
    await pinAugury(c.id) // QUIET ±0 keeps the food math exact
    const doc = await Campaign.findById(c.id)
    doc.forage.assignment = new Map([['Priest', 100]])
    doc.forage.enemyPlan = 0 // uncontested rings → no clash roll → deterministic
    await doc.save()

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expect(res.body.report.forage.posture).toBe('Blind')
    expect(res.body.report.forage.capacity).toBe(2100) // floor(100 × 30 × 0.7)
    expect(res.body.report.forage.harvested).toEqual({ food: 1680, materials: 420 })
    expectNoHiddenInfo(res.body)

    // 50,000 + 1,680 forage − 2,800 upkeep (100 Priests at 28 kg/turn).
    expect(res.body.campaign.resources.food).toBe(48880)
    expect(res.body.campaign.resources.materials).toBe(620) // 200 + 420
  })

  test('foragers are unavailable for the battle line', async () => {
    const { body: c } = await createCampaign()
    await Campaign.updateOne({ _id: c.id }, { $set: { bossFightDue: true } }) // reach the battle (Stage B gate)
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

  // Stage B: POST /:id/battles is the boss fight — it only fires while
  // campaign.bossFightDue. Every case that actually reaches the battle sets
  // the flag (the gate itself is covered by its own test below).
  const dueBossFight = (id) =>
    Campaign.updateOne({ _id: id }, { $set: { bossFightDue: true } })

  // Battle commits the whole army, so these tests shrink the roster to
  // exactly what they field — and mark the boss fight due so it's reachable.
  const shrinkRoster = async (id, roster) => {
    const doc = await Campaign.findById(id)
    doc.roster = roster
    doc.bossFightDue = true
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
    await dueBossFight(c.id)
    const res = await fightSoldiers(c.id, 1) // 377 units still in camp
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/whole army/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('cannot field more units than the roster owns', async () => {
    const { body: c } = await createCampaign()
    await dueBossFight(c.id)
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
    doc.bossFightDue = true
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
    doc.bossFightDue = true
    await doc.save()

    const res = await fightSoldiers(c.id, 5)
    expect(res.body.campaign.status).toBe('lost')
  })

  test('cannot field non-placeable types', async () => {
    const { body: c } = await createCampaign()
    await dueBossFight(c.id)
    const res = await auth(api.post(`/api/campaigns/${c.id}/battles`)).send({
      player_placement: [{ unit_type: 'Zombie', q: 4, r: 4 }],
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not a placeable/)
  })

  // ── Stage B: the boss fight (docs/CAMPAIGN_PLAN.md) ────────────────────
  test('no battle is offered before the meter marks the boss fight due', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    // Shrink the roster to a fieldable size but leave bossFightDue false — the
    // gate must fire before any placement validation.
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 1 }
    await doc.save()

    const res = await fightSoldiers(c.id)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no battle is offered/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('a unit committed to a raid this turn cannot also be placed into the boss battle', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 2 }
    doc.raid.assignment = new Map([['Soldier', 1]]) // 1 out raiding, 1 in camp
    doc.bossFightDue = true
    await doc.save()

    // Fielding both over-commits the raided Soldier.
    const res = await fightSoldiers(c.id, 2)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/out raiding/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('a raided unit is carved out of the whole-army-in-camp check', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 2 }
    doc.raid.assignment = new Map([['Soldier', 1]]) // 1 raiding, 1 in camp
    doc.bossFightDue = true
    await doc.save()

    // Fielding just the in-camp Soldier satisfies the whole-army rule — the
    // raided one is away, not "still in camp".
    const res = await fightSoldiers(c.id, 1)
    expect(res.status).toBe(201)
    expect(engine.runBattle).toHaveBeenCalled()
  })

  test('the boss fight is decisive: a blue win takes the country even with enemy survivors', async () => {
    // Pre-Stage-B this needed enemy.army at exactly 0 (checkAnnihilation); the
    // boss fight is now decisive on the winner alone.
    const result = structuredClone(battleResultFixture)
    result.winner = 'blue'
    result.red_survivors = { Zombie: 3 } // enemy NOT annihilated
    result.blue_survivors = { Soldier: 1 }
    engine.runBattle.mockResolvedValue(result)

    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 1 })
    const res = await fightSoldiers(c.id)
    expect(res.status).toBe(201)
    expect(res.body.campaign.status).toBe('won')
    // bossFightDue is cleared once the fight resolves, win or lose.
    const after = await Campaign.findById(c.id)
    expect(after.bossFightDue).toBe(false)
  })

  test('the boss fight is decisive: a red win loses the campaign even with surviving troops', async () => {
    const result = structuredClone(battleResultFixture)
    result.winner = 'red'
    result.red_survivors = { Zombie: 3 }
    result.blue_survivors = { Soldier: 1 } // player NOT wiped
    engine.runBattle.mockResolvedValue(result)

    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 1 })
    const res = await fightSoldiers(c.id)
    expect(res.status).toBe(201)
    expect(res.body.campaign.status).toBe('lost')
  })

  describe('squads (playtest item 1)', () => {
    const setSquads = async (id, squads, roster) => {
      const doc = await Campaign.findById(id)
      doc.squads = squads
      if (roster) doc.roster = roster
      doc.bossFightDue = true // reach the boss fight (Stage B gate)
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

  test('militia buys real Militia (not Soldiers) for food+materials, capped per turn', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 10 }
    doc.resources = { food: 1000, materials: 1000 }
    await doc.save()

    const res = await spend(c.id, { action: 'militia', count: 10 })
    expect(res.status).toBe(200)
    expect(res.body.roster.Soldier).toBe(10) // untouched — militia is its own type now
    expect(res.body.roster.Militia).toBe(10)
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

  test('militia workers leave the pool entirely — total shrinks, used does not', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 10 }
    doc.resources = { food: 1000, materials: 1000 }
    doc.workers = { total: 2000, used: 1995 } // only 5 free
    await doc.save()

    const ok = await spend(c.id, { action: 'militia', count: 5 })
    expect(ok.status).toBe(200)
    // Those 5 workers became roster soldiers — total drops, used is untouched
    // (fort labour is the only thing that should ever raise `used`).
    expect(ok.body.workers).toEqual({ total: 1995, used: 1995, available: 0 })

    // No workers left → even an affordable-in-stores purchase is rejected.
    const rej = await spend(c.id, { action: 'militia', count: 1 })
    expect(rej.status).toBe(400)
    expect(rej.body.error).toMatch(/workers|workforce/i)
  })

  test('militia and fort labour are tracked independently: total shrinks for one, used rises for the other', async () => {
    const { body: c } = await createCampaign()
    await setMaterials(c.id, 1000)
    await setWorkers(c.id, 2000)
    const doc = await Campaign.findById(c.id)
    doc.resources.food = 1000
    await doc.save()

    const militia = await spend(c.id, { action: 'militia', count: 10 }) // 10 workers cost
    expect(militia.status).toBe(200)
    expect(militia.body.workers).toEqual({ total: 1990, used: 0, available: 1990 })

    const fort = await spend(c.id, { action: 'fortify' }) // 500 workers cost (L0→1)
    expect(fort.status).toBe(200)
    expect(fort.body.workers).toEqual({ total: 1990, used: 500, available: 1490 })
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
        countered: false, // no counter_event raid unmade this fate
      })),
    )
    expect(res.body.campaign.augury).toEqual({
      consulted: false,
      accepted: false,
      rerollsRemaining: 1,
      visions: null,
    })

    // The enemy foraged the near ring even though we sent nobody out.
    expect(res.body.report.forage.harvested).toEqual({ food: 0, materials: 0 })
    expect(res.body.report.forage.rings[0].richness).toBe(20000 - 9084)
    expect(res.body.report.forage.clashes).toEqual([])
  })

  // ── Recon rework: leftover scouting points accrue into the scouting level ──
  test('unspent scouting points accrue into recon at end-of-turn and lift the band (fresh = Blind)', async () => {
    const { body: c } = await createCampaign()
    expect(c.scouting.band).toBe('Blind') // no recon done yet
    await pinAugury(c.id) // QUIET keeps it a clean, side-effect-free turn
    const before = await Campaign.findById(c.id)
    const leftover = before.raid.scoutingPoints // this turn's pool, all unspent
    expect(leftover).toBeGreaterThan(0)
    expect(before.recon.points).toBe(0)

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    const after = await Campaign.findById(c.id)
    // Accrued from 0 by exactly the leftover, BEFORE the pool refilled.
    expect(after.recon.points).toBeCloseTo(leftover, 5)
    expect(after.raid.scoutingPoints).toBeGreaterThan(0) // pool refilled for the new turn
    // That accrual lifted the scouting level off Blind.
    expect(res.body.campaign.scouting.band).not.toBe('Blind')
  })

  // ── Stage B: the boss fight is mandatory once due ─────────────────────
  test('cannot end the day while the boss fight is due and not yet fought', async () => {
    const { body: c } = await createCampaign()
    await Campaign.updateOne({ _id: c.id }, { $set: { bossFightDue: true } })
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/take the field/)
  })

  test('the other screens are NOT locked out on a boss-fight-due day — only End Turn is', async () => {
    // The player may still forage/scout/etc; they simply can't skip the fight.
    // (Raid launch lives on its own route with no bossFightDue gate, so it is
    // structurally unaffected — forage here stands in for "screens still open".)
    const { body: c } = await createCampaign()
    await Campaign.updateOne({ _id: c.id }, { $set: { bossFightDue: true } })

    const forageRes = await auth(api.post(`/api/campaigns/${c.id}/forage`))
      .send({ assignment: { Soldier: 1 } })
    expect(forageRes.status).toBe(200)

    const consultRes = await auth(api.post(`/api/campaigns/${c.id}/augury/consult`)).send({})
    expect(consultRes.status).toBe(200)

    // But End Turn is still barred until the fight happens.
    const endRes = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(endRes.status).toBe(400)
    expect(endRes.body.error).toMatch(/take the field/)
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
    await pinBand(c.id, 'Contested') // neutral posture (×1) — this tests harvest math, not scouting scaling
    await pinAugury(c.id) // keep the food math free of event noise
    await auth(api.post(`/api/campaigns/${c.id}/forage`)).send({
      assignment: { Soldier: 100 }, // capacity 3000 kg
    })
    pushRoll(1000) // near ring is contested with the enemy — force no clash

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    expect(res.body.report.forage.harvested).toEqual({ food: 2400, materials: 600 })
    expect(res.body.report.forage.rings[0].richness).toBe(20000 - 3000 - 9084)
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

// ── Augury acceptance: fates come to pass at the tent ────────────────────────
// After consulting (rerolled or not), POST /:id/augury/accept seals and
// REVEALS the fates mid-turn: plain effects apply immediately; a fate targeted
// by a still-unresolved counter_event raid is DEFERRED (rung recorded on the
// slot, applied at end-day unless the raid unmakes it first) — apply straight
// away by default, later only with a reason (user design, 2026-07-18). The
// never-accepted path keeps the old end-day resolution verbatim.
describe('augury acceptance (fates at the tent)', () => {
  const NIGHT_RAID = EVENT_POOL.find((e) => e.id === 'night_raid')
  const REFUGEES = EVENT_POOL.find((e) => e.id === 'refugees')
  const PLAGUE = EVENT_POOL.find((e) => e.id === 'plague')

  const accept = (id) => auth(api.post(`/api/campaigns/${id}/augury/accept`)).send({})
  const endDayReq = (id) => auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
  const choose = (id, slot, choice) =>
    auth(api.post(`/api/campaigns/${id}/choices/${slot}`)).send({ choice })

  const setConsulted = async (id) => {
    const doc = await Campaign.findById(id)
    doc.augury.consulted = true
    await doc.save()
  }
  const counterOpportunity = (slot) => ({
    id: 'd1-0',
    type: 'counter_event',
    title: 'Scattered Muster',
    description: 'A hostile muster forms in the hills.',
    targetForce: { Soldier: 5 },
    strengthBand: 'a handful',
    capacity: 100,
    reward: { slot },
    resolved: false,
    outcome: null,
  })
  const pinCounterRaid = async (id, slot) => {
    const doc = await Campaign.findById(id)
    doc.raid.opportunities = [counterOpportunity(slot)]
    await doc.save()
  }
  // Campaign creation deals RANDOM day-1 opportunities — a stray counter_event
  // would defer a slot and skew any "applies immediately" arithmetic.
  const clearRaids = async (id) => {
    const doc = await Campaign.findById(id)
    doc.raid.opportunities = []
    await doc.save()
  }

  test('accept applies plain fates immediately and returns the reveal', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET)
    await setConsulted(c.id)
    await clearRaids(c.id)

    const res = await accept(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // Three −999 kg dooms land NOW — no upkeep, no forage (the day goes on).
    expect(res.body.campaign.resources.food).toBe(50000 - 3 * 999)
    expect(res.body.campaign.augury.accepted).toBe(true)
    expect(res.body.report.augury.map((s) => s.actual.id)).toEqual(
      Array(3).fill('doomed_omen'),
    )
    expect(res.body.report.entries.join(' ')).toMatch(/Came to pass/)
    const doc = await Campaign.findById(c.id)
    expect(doc.resources.food).toBe(50000 - 3 * 999)
    expect(doc.augury.slots.map((s) => s.firedRungName)).toEqual([null, null, null])
  })

  test('guards: no accept before consult, no double accept, no reroll after', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id)
    expect((await accept(c.id)).status).toBe(400) // unconsulted

    await setConsulted(c.id)
    expect((await accept(c.id)).status).toBe(200)
    expect((await accept(c.id)).status).toBe(400) // fates already sealed
    const reroll = await auth(api.post(`/api/campaigns/${c.id}/augury/reroll`)).send({ slot: 0 })
    expect(reroll.status).toBe(400) // rerolling a sealed fate is meaningless
  })

  test('a counter-raid-targeted fate defers: recorded at accept, lands at end-day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET)
    await setConsulted(c.id)
    await pinCounterRaid(c.id, 1)

    const res = await accept(c.id)
    expect(res.status).toBe(200)
    // Slots 0 and 2 land now; slot 1 waits for the raid or the day's end.
    expect(res.body.campaign.resources.food).toBe(50000 - 2 * 999)
    expect(res.body.report.augury[1].deferred).toBe(true)
    expect(res.body.report.augury[0].deferred).toBeUndefined()
    // The tent shows the deferred slot as a pending THREAT only — its outcome
    // (`actual`) is withheld until it actually resolves (2026-07-18 fix).
    expect(res.body.report.augury[1].actual).toBeUndefined()
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots.map((s) => s.firedRungName)).toEqual([null, 'blind', null])

    // Nobody raided: the deferred blow lands with the day's end — and NOW the
    // report reveals its outcome (the tent only showed the pending threat).
    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)
    const revealed = end.body.report.augury.find((s) => s.fate === 1)
    expect(revealed.actual.id).toBe('doomed_omen')
    expect(end.body.report.entries.join(' ')).toMatch(/Came to pass/)
    expect(end.body.campaign.resources.food).toBe(50000 - 2 * 999 - 999 - 12432)
  })

  test('a deferred recon-sensitive fate hides its verdict at the tent, reveals it at end-day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    await setConsulted(c.id)
    await pinCounterRaid(c.id, 0)
    await pinBand(c.id, 'Contested') // warned rung recorded at accept-time band

    const res = await accept(c.id)
    expect(res.status).toBe(200)
    // Tent: the deferred slot is a pending threat — no came-to-pass verdict,
    // no fired rung, no "scouts turned it" line on the card.
    const tent = res.body.report.augury[0]
    expect(tent.deferred).toBe(true)
    expect(tent.actual).toBeUndefined()
    expect(tent.fired).toBeUndefined()
    expect(tent.scoutsIntervened).toBeUndefined()

    // End-day (after the raid phase): the fate resolves and the fired rung,
    // with the scouts' hand in it, is revealed here.
    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)
    const revealed = end.body.report.augury.find((s) => s.fate === 0)
    expect(revealed.fired.rung).toBe('warned')
    expect(revealed.scoutsIntervened).toBe(true)
  })

  test('the recorded rung applies even if the scouting band shifts after acceptance', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    await setConsulted(c.id)
    await pinCounterRaid(c.id, 0)
    await pinBand(c.id, 'Contested')

    // Contested at accept → the warned rung (−500 kg) is what's recorded.
    const res = await accept(c.id)
    expect(res.status).toBe(200)
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[0].firedRungName).toBe('warned')

    // Recon jumps to Superior before nightfall — the recorded warned rung
    // still applies, NOT the anticipated one the new band would pick.
    await pinBand(c.id, 'Superior')
    const end = await endDayReq(c.id)
    const after = await Campaign.findById(c.id)
    // Slots 1–2 applied −500 each at accept; slot 0's deferred warned rung
    // adds its −500 at end-day (no anticipated enemy_reveal fired).
    expect(after.enemy.revealedUntilDay ?? 0).toBe(0)
    expect(end.body.campaign.enemy.revealed).toBeUndefined()
  })

  test('a raid win between accept and end-day still unmakes the deferred fate', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET)
    await setConsulted(c.id)
    await pinCounterRaid(c.id, 2)

    const res = await accept(c.id)
    expect(res.body.campaign.resources.food).toBe(50000 - 2 * 999)

    const raid = await auth(
      api.post(`/api/campaigns/${c.id}/raids/launch`),
    ).send({ parties: { 'd1-0': { Soldier: 10 } } })
    expect(raid.status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[2].countered).toBe(true)

    const end = await endDayReq(c.id)
    // The deferred −999 never lands; food only moves by upkeep (roster is
    // 300−10+2 survivors of the raid + the rest, recompute via the report).
    expect(end.body.report.entries.join(' ')).toMatch(/Averted/)
    // The reveal reaches the report as a countered card (the raid unmade it).
    expect(end.body.report.augury.find((s) => s.fate === 2).countered).toBe(true)
    const finalDoc = await Campaign.findById(c.id)
    expect(finalDoc.resources.food).toBe(
      50000 - 2 * 999 - end.body.report.upkeep.foodConsumed,
    )
  })

  test('choice fates: immediate ones apply on pick, deferred ones on end-day', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    await setConsulted(c.id)
    await pinCounterRaid(c.id, 0) // slot 0's choice defers; slots 1–2 are immediate

    const res = await accept(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.campaign.pendingChoices.map((p) => p.slot)).toEqual([0, 1, 2])
    // The battle stays gated until every decision is made (machinery unchanged).
    expect((await endDayReq(c.id)).status).toBe(409)

    // Immediate pick applies now…
    await choose(c.id, 1, 'take_in')
    let doc = await Campaign.findById(c.id)
    expect(doc.roster.get('Militia')).toBe(20)
    // …a deferred pick only records.
    await choose(c.id, 0, 'take_in')
    doc = await Campaign.findById(c.id)
    expect(doc.roster.get('Militia')).toBe(20)
    expect(doc.augury.slots[0].chosenChoice).toBe('take_in')

    await choose(c.id, 2, 'turn_away')
    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)
    // The deferred take_in lands at end-day: +20 more Militia.
    const after = await Campaign.findById(c.id)
    expect(after.roster.get('Militia')).toBe(40)
  })

  test('an accepted fate can end the campaign on the spot', async () => {
    const { body: c } = await createCampaign()
    await pinArmies(c.id, { roster: { Soldier: 1 } })
    await pinAugury(c.id, PLAGUE, QUIET) // all_roster ×0.95 floors the last man away
    await setConsulted(c.id)
    await clearRaids(c.id)

    const res = await accept(c.id)
    expect(res.status).toBe(200)
    expect(res.body.campaign.status).toBe('lost')
    expect(res.body.campaign.pendingChoices).toEqual([])
  })
})

// ── Events with choices (resolve-then-choose) ────────────────────────────────
// A fired choice-fate's effect is NOT applied at end-day: the decision is
// persisted on the doc (`pendingChoices`, minimal `{slot, eventId, rung, day}`
// — options come from EVENT_POOL at view/choose time, the sealed-fate rule)
// and every other mutating action 409s until the player has chosen. The
// choose route applies the picked branch and re-checks annihilation.
describe('events with choices', () => {
  const REFUGEES = EVENT_POOL.find((e) => e.id === 'refugees')
  const BAGGAGE_PLAGUE = EVENT_POOL.find((e) => e.id === 'baggage_plague')

  const endDayReq = (id) => auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
  const choose = (id, slot, choice) =>
    auth(api.post(`/api/campaigns/${id}/choices/${slot}`)).send({ choice })

  test('the authored choice events exist with the expected branches', () => {
    expect(REFUGEES.choices.map((c) => c.id).sort()).toEqual(['take_in', 'turn_away'])
    expect(BAGGAGE_PLAGUE.choices.map((c) => c.id).sort()).toEqual(['march_on', 'quarantine'])
    expect(BAGGAGE_PLAGUE.valence).toBe('bad')
  })

  test('a fired choice event applies nothing and pends the decision', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    const res = await endDayReq(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    // No branch applied: taking the refugees in would have mustered Militia.
    expect(res.body.campaign.roster.Militia).toBeUndefined()
    // All three slots pend, each report slot carries its option cards.
    expect(res.body.campaign.pendingChoices.map((p) => p.slot)).toEqual([0, 1, 2])
    for (const [i, slot] of res.body.report.augury.entries()) {
      expect(slot.pendingChoice.options.map((o) => o.id).sort()).toEqual(['take_in', 'turn_away'])
      expect(res.body.campaign.pendingChoices[i].title).toBe(REFUGEES.title)
    }
    expect(res.body.report.entries.join(' ')).toMatch(/decision/i)
  })

  test('every mutating action 409s while a decision is pending; reads stay open', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    await endDayReq(c.id)

    const blocked = [
      ['end-day', {}],
      ['augury/consult', {}],
      ['augury/reroll', { slot: 0 }],
      ['spend', { action: 'fortify' }],
      ['battles', { placement: [] }],
      ['raids/launch', { parties: {} }],
    ]
    for (const [path, payload] of blocked) {
      const res = await auth(api.post(`/api/campaigns/${c.id}/${path}`)).send(payload)
      expect(res.status, path).toBe(409)
      expect(res.body.error).toMatch(/decision/)
    }
    const view = await getView(c.id)
    expect(view.pendingChoices).toHaveLength(3)
  })

  test('choosing applies that branch, clears the entry, and lifts the gate after the last one', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    await endDayReq(c.id)
    const before = await getView(c.id)

    const res = await choose(c.id, 0, 'take_in')
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.resolved).toEqual({ slot: 0, choice: 'take_in', label: expect.any(String) })
    // Take them in: −3 t of food, +20 Militia.
    expect(res.body.campaign.roster.Militia).toBe(20)
    expect(res.body.campaign.resources.food).toBe(before.resources.food - 3000)
    expect(res.body.campaign.pendingChoices.map((p) => p.slot)).toEqual([1, 2])

    // Turn them away: a genuine no-op.
    const res2 = await choose(c.id, 1, 'turn_away')
    expect(res2.body.campaign.roster.Militia).toBe(20)
    expect(res2.body.campaign.resources.food).toBe(before.resources.food - 3000)

    await choose(c.id, 2, 'turn_away')
    // All decisions made: the campaign moves again.
    expect((await endDayReq(c.id)).status).toBe(200)
  })

  test('an unknown option or a slot with nothing pending rejects', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    await endDayReq(c.id)

    expect((await choose(c.id, 0, 'bribe_them')).status).toBe(400)
    expect((await choose(c.id, 7, 'take_in')).status).toBe(404)
    // The pending entry survived both rejections.
    const view = await getView(c.id)
    expect(view.pendingChoices).toHaveLength(3)
  })

  test('a countered choice-fate never pends — the raid already unmade it', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    const doc = await Campaign.findById(c.id)
    doc.augury.slots.forEach((s) => { s.countered = true })
    await doc.save()

    const res = await endDayReq(c.id)
    expect(res.body.campaign.pendingChoices).toEqual([])
    expect((await endDayReq(c.id)).status).toBe(200) // no gate left behind
  })

  test('a campaign that ends the same turn clears its pending decisions', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    const doc = await Campaign.findById(c.id)
    doc.enemy.army = {}
    await doc.save()

    const res = await endDayReq(c.id)
    expect(res.body.campaign.status).toBe('won')
    // Game over outranks an owed decision — nothing left to strand the client.
    expect(res.body.campaign.pendingChoices).toEqual([])
  })

  test('a choice can end the campaign — annihilation is re-checked at choose time', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, BAGGAGE_PLAGUE)
    await pinArmies(c.id, { roster: { Soldier: 1 } })
    await endDayReq(c.id)

    // March on with a single soldier: ×0.98 floors the last man away.
    const res = await choose(c.id, 0, 'march_on')
    expect(res.status).toBe(200)
    expect(res.body.campaign.status).toBe('lost')
    // The remaining decisions die with the campaign.
    expect(res.body.campaign.pendingChoices).toEqual([])
  })
})
