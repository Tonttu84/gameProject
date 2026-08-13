import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import mongoose from 'mongoose'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { PUBLIC_OPPORTUNITY_KEYS } from './helpers/publicShape.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { fortifiedSidesFor } from '../services/fortification.js'
import { EVENT_POOL } from '../services/events.js'
import { RECRUIT_POOL } from '../services/recruit.js'
import {
  FREE_MILITIA_AMOUNT,
  RECON_LEVEL_THRESHOLDS,
  GARRISON_SALLY_TROOPS,
  GARRISON_SALLY_TICK,
  GARRISON_SALLY_TEAM,
  GARRISON_SALLY_UNIT,
  FORAGE_RINGS,
  ENEMY_DRAIN_KG_PER_TURN,
  SQUAD_RANKS,
  SQUAD_UPGRADE_POOL,
} from '../utils/campaignConfig.js'

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

// Ending the fortnight is the LAST phase's act: the route refuses a turn that
// hasn't been seen through (routes' rejectIfPhaseBefore), which is what makes a
// double submit impossible. A test that resolves a turn without walking the
// screens stamps the phase first — the same state Recruiting leaves behind.
const endTurn = async (id) => {
  await Campaign.findByIdAndUpdate(id, { phase: 'recruit' })
  return auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
}
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
// day-report enemy summaries (no scouting sibling) carry only { band,
// bossFightDue } — the retired stance's replacement.
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
        : ['band', 'bossFightDue'] // the day report's enemy summary
    expect(Object.keys(c.enemy).sort()).toEqual(allowed)
  }
  // Events with choices: a pending decision crosses as display fields plus
  // option cards only — never the branch effects (the pool's `choices`
  // entries), the pool id, or the rung that fired.
  //
  // `effectText` (2026-08-10) is a DELIBERATE widening and the reason `effect`
  // itself still must not cross: an option carried prose alone, so a decision
  // could only be made on tone. The formatted line obeys the disclosure rules
  // (describeEffect) — the raw effect would hand over every gate at once.
  const OPTION_KEYS = ['description', 'effectText', 'id', 'label']
  expect(raw).not.toContain('"choices"')
  expect(raw).not.toContain('"eventId"')
  for (const c of [body, body.campaign]) {
    for (const p of c?.pendingChoices ?? []) {
      expect(Object.keys(p).sort()).toEqual(['description', 'options', 'slot', 'title'])
      for (const o of p.options) expect(Object.keys(o).sort()).toEqual(OPTION_KEYS)
    }
  }
  for (const slot of body.report?.augury ?? [])
    for (const o of slot.pendingChoice?.options ?? [])
      expect(Object.keys(o).sort()).toEqual(OPTION_KEYS)
  // Scouting crosses the boundary as the banded label ONLY — a raw coverage
  // or ratio number would let the client solve for the enemy composition.
  expect(raw).not.toContain('"coverage"')
  expect(raw).not.toContain('"ratio"')
  for (const scouting of [body.scouting, body.campaign?.scouting])
    if (scouting) expect(Object.keys(scouting)).toEqual(['band'])
  // Boss-fight meter (recon R2): the banded phrase always, plus a numeric
  // `estimate` [low, high] that's null at recon level 0 and a bracket above it
  // (exact at the top), and `remaining` — the gap to the threshold, derived
  // FROM that estimate so it is gated by it rather than alongside it. No raw
  // value key, no `revealed` flag — recon drives it.
  for (const c of [body, body.campaign]) {
    if (!c?.meter) continue
    expect(Object.keys(c.meter).sort()).toEqual(['band', 'estimate', 'remaining'])
    // At level 0 (no scouting sibling / Blind) the estimate is withheld — and
    // `remaining` goes with it, or the gap alone would give the value back.
    const level0 = !c.scouting || c.scouting.band === 'Blind'
    if (level0) {
      expect(c.meter.estimate).toBeNull()
      expect(c.meter.remaining).toBeNull()
    } else {
      expect(c.meter.estimate).toMatchObject({ low: expect.any(Number), high: expect.any(Number) })
      expect(c.meter.remaining).toMatchObject({ low: expect.any(Number), high: expect.any(Number) })
    }
  }
  // Raid opportunities (Stage 4 Part 2 + the 2.5 scouting mini-game): the raw
  // hidden target-slice Map (`targetForce`) never crosses — the wire carries
  // per-type ranges under `enemy`/`reward` instead — and each opportunity's
  // key set is pinned exactly.
  expect(raw).not.toContain('"targetForce"')
  for (const c of [body, body.campaign]) {
    for (const o of c?.raid?.opportunities ?? [])
      expect(Object.keys(o).sort()).toEqual(PUBLIC_OPPORTUNITY_KEYS)
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
// - starting field-points pool (fieldPointsFor, S2 "effort slider"): 300×2 +
//   50×5 + 3×6 + 3×2 + 10×5.6 + 12×15.2 = 1112.4 pts, split 50/50
//   (DEFAULT_FORAGE_SHARE) between forage and the day-1 scouting-points pool
// - the enemy's drain is now a flat ENEMY_DRAIN_KG_PER_TURN (9,000 kg), not
//   derived from its army

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
    // Fresh campaign is Blind (recon 0): the enemy view is empty, and the
    // boss fight is not yet due (the retired stance is gone).
    expect(res.body.enemy).toEqual({})
    expect(res.body.bossFightDue).toBe(false)
    // Fresh land: three untouched rings. DEFAULT_FORAGE_SHARE is 0 (all
    // scouting) — the pre-slider default too (forage.assignment started
    // empty), so a fresh campaign forages nothing until the player commits.
    expect(res.body.forage.rings).toEqual([
      { ring: 0, richness: 80000, initialRichness: 80000 },
      { ring: 1, richness: 140000, initialRichness: 140000 },
      { ring: 2, richness: 220000, initialRichness: 220000 },
    ])
    expect(res.body.forage.pool).toBeCloseTo(1112.4)
    expect(res.body.forage.share).toBe(0)
    // A fresh campaign has done no recon yet (0 points) → Blind, whose 0.7
    // forage posture already scales the preview: 16 × 0.7 = 11.2 kg/point.
    expect(res.body.forage.kgPerPoint).toBeCloseTo(11.2)
    expect(res.body.forage.capacityKg).toBe(0) // share 0 → nothing forages yet
    // Blind is below the Outmatched recon gate — the enemy's drain is hidden.
    expect(res.body.forage.enemyDrainKg).toBeNull()
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
    expect(doc.forage.enemyDrainKg).toBe(9000) // ENEMY_DRAIN_KG_PER_TURN, flat since S2
    expect(doc.forage.pool).toBeCloseTo(1112.4)
    expect(doc.forage.share).toBe(0)
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
const pinArmies = async (id, { roster, enemyArmy, enemySupplyState, rings } = {}) => {
  const doc = await Campaign.findById(id)
  if (roster) doc.roster = new Map(Object.entries(roster))
  if (enemyArmy) doc.enemy.army = new Map(Object.entries(enemyArmy))
  // S4: the stockpile is gone — what the view reports is the stored per-turn
  // verdict, so pin the state itself rather than a kg figure.
  if (enemySupplyState !== undefined) doc.enemy.supplyState = enemySupplyState
  if (rings) doc.forage.rings.forEach((r, i) => { r.richness = rings[i] ?? r.richness })
  await doc.save()
}

// S4: end-day now grows a well-fed host and shrinks a starving one, so any test
// asserting an EXACT enemy count after a turn has to say which it is or it is
// really testing two mechanics at once. Emptying the near ring puts the host on
// the mid ring, which is break-even by construction — it holds its numbers, and
// the assertion measures only what the test is actually about.
const STEADY_RINGS = [0, 140000, 220000]

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
  test('Blind (a fresh campaign, 0 recon points): the enemy is unread', async () => {
    const { body } = await createCampaign()
    // No recon yet → Blind, the enemy is unread.
    await pinArmies(body.id, { enemyArmy: { LightCavalry: 50 } })
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Blind')
    expect(view.enemy).toEqual({})
  })

  test('Outmatched: adds the numeric count estimate and supply state, nothing more', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { LightCavalry: 50 } })
    await pinBand(body.id, 'Outmatched')
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Outmatched')
    // pinBand only raises the points — no level-up ran to widen a bracket, so the
    // stored offsets are 0 and the estimate reads exact (a real campaign reaches a
    // level THROUGH the accrual that also sets the bracket — see the R2 describe).
    expect(view.enemy.count).toEqual({ low: 50, high: 50 })
    expect(view.enemy.supplies).toBe('well-provisioned')
    expect(view.enemy.composition).toBeUndefined()
    expect(view.enemy.units).toBeUndefined()
    expect(view.enemy.placements).toBeUndefined()
  })

  test('Contested: count + supplies, nothing finer', async () => {
    const { body } = await createCampaign()
    await pinBand(body.id, 'Contested')
    const view = await getView(body.id)
    // Default ENEMY_ARMY armyTotal 721.
    expect(view.scouting.band).toBe('Contested')
    expect(view.enemy).toEqual({
      count: { low: 721, high: 721 },
      supplies: 'well-provisioned',
    })
  })

  test('the supply state crosses the wire exactly as stored — accurate, never fuzzed', async () => {
    const { body } = await createCampaign()
    // S4: the supply line is a per-turn verdict now, not turns-of-stockpile.
    // It only crosses at Outmatched+, so pin a band that shows it.
    await pinArmies(body.id, { enemySupplyState: 'near starving' })
    await pinBand(body.id, 'Contested')
    const view = await getView(body.id)
    // Unlike `count`, this is NOT bracketed by recon level — the gate decides
    // whether the player learns it at all, and above the gate it is the truth.
    expect(view.enemy.supplies).toBe('near starving')
  })

  test('the supply state is withheld entirely below the recon gate', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemySupplyState: 'near starving' })
    await pinBand(body.id, 'Blind')
    const view = await getView(body.id)
    expect(view.enemy.supplies).toBeUndefined()
  })

  test('Superior: adds composition by category percent', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Soldier: 400, Zombie: 200 } })
    await pinBand(body.id, 'Superior')
    const view = await getView(body.id)
    expect(view.scouting.band).toBe('Superior')
    expect(view.enemy.count).toEqual({ low: 600, high: 600 }) // exact under pinBand (no widening ran)
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

// ── Recon R2: graduated numeric brackets (enemy count + meter value) ──────────
describe('recon numeric brackets (R2)', () => {
  // Raw-set a subject's stored offsets (the widening a real level-up produces),
  // independent of the accrual RNG, so the DISPLAY math against live truth can be
  // asserted deterministically. Leaf writes so mongoose tracks the nested change.
  const pinBracket = async (id, subject, { atLevel, floorOffset, ceilOffset }) => {
    const doc = await Campaign.findById(id)
    const b = doc.recon.brackets[subject]
    b.atLevel = atLevel
    b.floorOffset = floorOffset
    b.ceilOffset = ceilOffset
    await doc.save()
  }

  test('enemy count = stored offsets against the live truth', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Soldier: 100 } }) // truth 100
    await pinBand(body.id, 'Contested')
    await pinBracket(body.id, 'enemyCount', { atLevel: 2, floorOffset: -30, ceilOffset: 50 })
    const view = await getView(body.id)
    expect(view.enemy.count).toEqual({ low: 70, high: 150 })
  })

  test('casualties slide the WHOLE bracket down by exactly the loss (same width)', async () => {
    // The delicate destroy_detachment interaction: the main host shrinks (a real
    // raid does the subtraction — see raid.test.js Stage D), and because the
    // estimate is stored offsets against LIVE truth, floor + ceiling + truth all
    // move together — no width change, nothing leaked across turns.
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Soldier: 100 } })
    await pinBand(body.id, 'Contested')
    await pinBracket(body.id, 'enemyCount', { atLevel: 2, floorOffset: -30, ceilOffset: 50 })
    const before = (await getView(body.id)).enemy.count // {70, 150}

    await pinArmies(body.id, { enemyArmy: { Soldier: 60 } }) // 40 casualties
    const after = (await getView(body.id)).enemy.count
    expect(after).toEqual({ low: 30, high: 110 })
    expect(after.high - after.low).toBe(before.high - before.low) // width preserved
    expect(before.low - after.low).toBe(40) // slid down by the casualties
    expect(before.high - after.high).toBe(40)
  })

  test('the floor never reads negative even when casualties exceed the low offset', async () => {
    const { body } = await createCampaign()
    await pinArmies(body.id, { enemyArmy: { Soldier: 20 } }) // truth 20 < |floorOffset|
    await pinBand(body.id, 'Contested')
    await pinBracket(body.id, 'enemyCount', { atLevel: 2, floorOffset: -30, ceilOffset: 50 })
    const view = await getView(body.id)
    expect(view.enemy.count).toEqual({ low: 0, high: 70 })
  })

  test('meter estimate is withheld at recon level 0 and a numeric bracket above it', async () => {
    const { body } = await createCampaign()
    // Fresh campaign is Blind (level 0): band phrase only, no numeric estimate.
    let view = await getView(body.id)
    expect(view.meter.estimate).toBeNull()
    expect(typeof view.meter.band).toBe('string')

    await pinBand(body.id, 'Contested')
    await pinBracket(body.id, 'meter', { atLevel: 2, floorOffset: -100, ceilOffset: 200 })
    const doc = await Campaign.findById(body.id)
    doc.meter.value = 400
    await doc.save()
    view = await getView(body.id)
    expect(view.meter.estimate).toEqual({ low: 300, high: 600 })
  })

  test('meter.remaining is the threshold gap of the ESTIMATE, inverted and gated with it', async () => {
    const { body } = await createCampaign()
    // Blind: no estimate, so no remainder either. The forage panel's
    // turns-to-breach readout falls back to its relative phrasing here.
    expect((await getView(body.id)).meter.remaining).toBeNull()

    await pinBand(body.id, 'Contested')
    await pinBracket(body.id, 'meter', { atLevel: 2, floorOffset: -100, ceilOffset: 200 })
    const doc = await Campaign.findById(body.id)
    doc.meter.value = 400
    await doc.save()
    const view = await getView(body.id)
    // estimate [300, 600] against the 1000 threshold. It INVERTS: the high
    // estimate is the LOW remainder (more meter = less wall left).
    expect(view.meter.estimate).toEqual({ low: 300, high: 600 })
    expect(view.meter.remaining).toEqual({ low: 400, high: 700 })
    // The truth (600 remaining) sits inside the bracket, and the bracket is no
    // narrower than the estimate's — nothing was leaked by the subtraction.
    expect(view.meter.remaining.high - view.meter.remaining.low)
      .toBe(view.meter.estimate.high - view.meter.estimate.low)
  })

  test('a bracket running past the threshold floors the remainder at 0, never negative', async () => {
    const { body } = await createCampaign()
    await pinBand(body.id, 'Contested')
    // Ceiling estimate 1100 > the 1000 threshold: the walls may already be down
    // as far as this player can tell. Turns-to-breach must not go negative.
    await pinBracket(body.id, 'meter', { atLevel: 2, floorOffset: -100, ceilOffset: 200 })
    const doc = await Campaign.findById(body.id)
    doc.meter.value = 900
    await doc.save()
    const view = await getView(body.id)
    expect(view.meter.estimate).toEqual({ low: 800, high: 1100 })
    expect(view.meter.remaining).toEqual({ low: 0, high: 200 })
  })

  test('an end-day level-up sets both brackets once, then holds within the level', async () => {
    const { body } = await createCampaign()
    // Seed just below the Contested threshold; the end-day accrual crosses it.
    const doc = await Campaign.findById(body.id)
    doc.recon.points = RECON_LEVEL_THRESHOLDS[1] - 1 // just under Contested
    await doc.save()
    await endTurn(body.id)

    const after = await Campaign.findById(body.id)
    // Level climbed to at least Contested (2): brackets stamped at that level,
    // straddling the truth (floor ≤ 0 ≤ ceil).
    expect(after.recon.brackets.enemyCount.atLevel).toBeGreaterThanOrEqual(2)
    expect(after.recon.brackets.enemyCount.floorOffset).toBeLessThanOrEqual(0)
    expect(after.recon.brackets.enemyCount.ceilOffset).toBeGreaterThanOrEqual(0)
    expect(after.recon.brackets.meter.atLevel).toBe(after.recon.brackets.enemyCount.atLevel)
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
  const FORAGE_RAIDERS = EVENT_POOL.find((e) => e.id === 'forage_raiders')

  test('Contested: the warned rung fires and is named in the report', async () => {
    const { body: c } = await createCampaign()
    await pinBand(c.id, 'Contested')
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    const res = await endTurn(c.id)
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
    const res = await endTurn(c.id)
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
    const res = await endTurn(c.id)
    for (const slot of res.body.report.augury) {
      expect(slot.fired).toBeUndefined()
      expect(slot.scoutsIntervened).toBeUndefined()
    }
  })

  test('Superior: the anticipated rung reverses the fate onto the enemy', async () => {
    const { body: c } = await createCampaign()
    // STEADY_RINGS so S4's supply swing cannot move these counts — the three
    // ×0.95 floors below must be the FATE's doing and nothing else.
    await pinArmies(c.id, { enemyArmy: { Soldier: 400, Zombie: 200 }, rings: STEADY_RINGS })
    await pinBand(c.id, 'Superior')
    await pinAugury(c.id, FORAGE_RAIDERS, QUIET)
    const res = await endTurn(c.id)
    expectNoHiddenInfo(res.body)

    // No fate — blind rung or reversal — may bring on the pitched battle; that
    // is the wall meter's alone (2026-08-08).
    expect(res.body.campaign.bossFightDue).toBe(false)
    for (const slot of res.body.report.augury) {
      expect(slot.fired.rung).toBe('anticipated')
      expect(slot.fired.title).toBe(FORAGE_RAIDERS.rungs.anticipated.title)
      expect(slot.scoutsIntervened).toBe(true)
    }
    // Three ×0.95 floors on every hidden enemy line — in the DB, never the response.
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(342) // 400 → 380 → 361 → 342
    expect(doc.enemy.army.get('Zombie')).toBe(171) // 200 → 190 → 180 → 171
  })

  test('anticipated Night Raid: prisoners lay the enemy bare for exactly one turn', async () => {
    const { body: c } = await createCampaign()
    // STEADY_RINGS: the reveal must show the host UNCHANGED, so S4's growth
    // must not be in the picture.
    await pinArmies(c.id, { enemyArmy: { Soldier: 400, Zombie: 200 }, rings: STEADY_RINGS })
    await pinBand(c.id, 'Superior')
    await pinAugury(c.id, NIGHT_RAID, QUIET)
    const res = await endTurn(c.id)
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
    const next = await endTurn(c.id)
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
      (await endTurn(c.id)).status,
    ).toBe(404)
    expect(
      (await auth(api.post(`/api/campaigns/${c.id}/effort`)).send({ share: 0.5 })).status,
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
    // Truth reveal: AUGURY_DEBUG_SHOW_TRUTH is OFF as of 2026-08-10, so this is
    // now the real rule — a fresh consult still holds a reroll, the decision the
    // uncertainty exists to price, so the true card is WITHHELD. It surfaces
    // when that decision ends: the reroll spent, or the fates accepted.
    expect(res.body.augury.visions.map((v) => v.truth)).toEqual(Array(3).fill(null))
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

describe('POST /api/campaigns/:id/effort', () => {
  const setEffort = (id, share) =>
    auth(api.post(`/api/campaigns/${id}/effort`)).send({ share })

  test('sets the share and reports the split preview; re-issuing replaces it', async () => {
    const { body: c } = await createCampaign()
    await pinBand(c.id, 'Contested') // neutral posture (×1) — this tests raw capacity, not scouting scaling

    const res = await setEffort(c.id, 0.7)
    expect(res.status).toBe(200)
    expect(res.body.forage.share).toBe(0.7)
    // pool 1112.4 × 0.7 × 16 kg/pt, floored
    expect(res.body.forage.capacityKg).toBe(12458)
    expect(res.body.raid.scoutingPoints).toBeCloseTo(1112.4 * 0.3)
    expectNoHiddenInfo(res.body)

    const replaced = await setEffort(c.id, 0.2)
    expect(replaced.body.forage.share).toBe(0.2)
    expect(replaced.body.forage.capacityKg).toBe(Math.floor(1112.4 * 0.2 * 16))
    expect(replaced.body.raid.scoutingPoints).toBeCloseTo(1112.4 * 0.8)
  })

  test('rejects out-of-range shares, non-numbers, and missing bodies', async () => {
    const { body: c } = await createCampaign()
    expect((await setEffort(c.id, 1.5)).status).toBe(400)
    expect((await setEffort(c.id, -0.1)).status).toBe(400)
    expect((await setEffort(c.id, 'half')).status).toBe(400)
    expect((await auth(api.post(`/api/campaigns/${c.id}/effort`)).send({})).status).toBe(400)
  })

  // Stage 4 1d: the scouting band sets the forage posture. The view's preview
  // (kgPerPoint, capacityKg) carries the same multiplier the resolution
  // applies, so what the panel promises is what end-day delivers.
  test('Blind posture scales the forage preview the player plans against', async () => {
    const { body: c } = await createCampaign()
    // A fresh campaign is Blind (0 recon). S2 snapshots the pool at newDay
    // rather than deriving it live from the roster, so pin it directly to
    // what a Priest-100 army's pool would be (100 × fieldPointValue(Priest)
    // = 100 × 2 = 200) instead of relying on pinArmies to move it.
    await pinArmies(c.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 50 } })
    const doc = await Campaign.findById(c.id)
    doc.forage.pool = 200
    doc.forage.share = 1
    await doc.save()

    const view = await getView(c.id)
    expect(view.scouting.band).toBe('Blind')
    expect(view.forage.kgPerPoint).toBeCloseTo(11.2) // 16 × 0.7
    expect(view.forage.capacityKg).toBe(2240) // floor(200 × 1 × 16 × 0.7)
  })

  test('end-day forages at that posture and the report names it', async () => {
    const { body: c } = await createCampaign()
    await pinArmies(c.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 50 } })
    await pinAugury(c.id) // QUIET ±0 keeps the food math exact
    const doc = await Campaign.findById(c.id)
    doc.forage.pool = 200 // 100 × fieldPointValue(Priest) = 100 × 2
    doc.forage.share = 1
    await doc.save()

    const res = await endTurn(c.id)
    expect(res.status).toBe(200)
    expect(res.body.report.forage.posture).toBe('Blind')
    expect(res.body.report.forage.capacity).toBe(2240) // floor(200 × 16 × 0.7)
    expect(res.body.report.forage.harvested).toEqual({ food: 1792, materials: 448 })
    expectNoHiddenInfo(res.body)

    // 50,000 + 1,792 forage − 2,800 upkeep (100 Priests at 28 kg/turn).
    expect(res.body.campaign.resources.food).toBe(48992)
    expect(res.body.campaign.resources.materials).toBe(648) // 200 + 448
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

  // Garrison Resolve payoff 2 — the sally (S7), GRADUATED by level. The garrison
  // commits men to the decisive battle as allied reinforcements storming the
  // enemy's rear (BattleInput `reinforcements`), NOT by pre-thinning the enemy:
  // determined sends more, normal some, low none. The enemy host is untouched
  // before the fight in every case now.
  const setupBossFight = async (resolve) => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 1 }
    doc.bossFightDue = true
    doc.garrison = { resolve }
    await doc.save()
    return { c, preLen: doc.enemy.plannedPlacement.length }
  }

  test('a determined garrison sends the larger reinforcement wave — enemy untouched', async () => {
    const { c, preLen } = await setupBossFight(80) // determined (≥ 67)
    await fightSoldiers(c.id)

    const input = engine.runBattle.mock.calls[0][0]
    expect(input.reinforcements).toEqual([{
      tick: GARRISON_SALLY_TICK,
      team: GARRISON_SALLY_TEAM,
      count: GARRISON_SALLY_TROOPS.determined,
      unit_type: GARRISON_SALLY_UNIT,
      message: expect.stringMatching(/garrison/i),
    }])
    // The enemy is no longer pre-thinned — its placement is the full plan.
    expect(input.enemy_placement.length).toBe(preLen)

    // ...and the sally is narrated in the decisive battle's log.
    const after = await Campaign.findById(c.id)
    expect(after.log.at(-1).entries.some((e) => /garrison sallies/i.test(e))).toBe(true)
  })

  test('a normal garrison sends the smaller reinforcement wave', async () => {
    const { c } = await setupBossFight(50) // normal (34..66)
    await fightSoldiers(c.id)

    const input = engine.runBattle.mock.calls[0][0]
    expect(input.reinforcements).toHaveLength(1)
    expect(input.reinforcements[0].count).toBe(GARRISON_SALLY_TROOPS.normal)

    const after = await Campaign.findById(c.id)
    expect(after.log.at(-1).entries.some((e) => /sallies/i.test(e))).toBe(true)
  })

  test('a low garrison sends no reinforcements and no sally is narrated', async () => {
    const { c, preLen } = await setupBossFight(20) // low (1..33)
    await fightSoldiers(c.id)

    const input = engine.runBattle.mock.calls[0][0]
    expect(input.reinforcements).toEqual([])
    expect(input.enemy_placement.length).toBe(preLen)

    const after = await Campaign.findById(c.id)
    expect(after.log.at(-1).entries.some((e) => /sallies/i.test(e))).toBe(false)
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
    expect((await endTurn(c.id)).status).toBe(400)
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
    // The charter facts these battle cases are about — id/name/composition and
    // the permanent record — without the archetype-derived fields campaignView
    // also ships (caps, intake, reinforcedToday), which have their own suite.
    const charterFacts = ({ id, name, composition, prestige, rank }) =>
      ({ id, name, composition, prestige, rank })
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
      // prestige/rank joined the wire shape in slice 1 — a fresh squad starts
      // at 0 and reads as the lowest rank. Slice 3 added the archetype and its
      // RESOLVED caps/intake (the document stores only the id), plus the
      // once-per-turn reinforcement stamp read against today. Slice 4a added
      // the upgrade fields: a fresh squad is Untested, so it has no slot, no
      // pick, no banner and no draft — every one of them derived from prestige
      // rather than stored, which is why they read as zero rather than absent.
      const fresh = {
        prestige: 0, rank: 'Untested', reinforcedToday: false,
        upgrades: [], upgradeSlots: 0, upgradePicks: 0, banner: false, upgradeOffer: null,
      }
      expect(c.squads).toEqual([
        {
          id: 1, name: '1st Cohort', composition: { Soldier: 40 }, ...fresh,
          archetype: 'line', caps: { Soldier: 40, Pikeman: 10 }, intake: 10,
        },
        {
          id: 2, name: 'Skirmishers', composition: { Archer: 30 }, ...fresh,
          archetype: 'skirmish', caps: { Archer: 30, Militia: 10 }, intake: 6,
        },
        {
          id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 }, ...fresh,
          archetype: 'vanguard', caps: { Cavalry: 6, LightCavalry: 6 }, intake: 2,
        },
      ])
    })

    // Slice 2 (docs/CAMPAIGN_PLAN.md, decisions 2-4): every charter carries an
    // archetype id naming its permitted types, per-type caps and intake rate.
    // The DOCUMENT stores the bare id and nothing else — slice 3 resolves the
    // caps and intake off it in campaignView (asserted above), so a rebalance
    // reaches campaigns already in flight.
    test('a fresh campaign stamps each squad with its archetype', async () => {
      const { body: c } = await createCampaign()
      const doc = await Campaign.findById(c.id)
      expect(doc.squads.map((s) => [s.id, s.archetype])).toEqual([
        [1, 'line'],
        [2, 'skirmish'],
        [3, 'vanguard'],
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
      // Narrowed to the charter facts under test: these ad-hoc squads carry no
      // archetype, and the caps/intake/reinforcedToday the view resolves off
      // one belong to the reinforcement tests, not to battle reconciliation.
      expect(res.body.campaign.squads.map(charterFacts)).toEqual([
        { id: 1, name: '1st Cohort', composition: { Soldier: 1 }, prestige: 0, rank: 'Untested' },
      ])
    })

    test('a broken squad keeps its charter and its stragglers rejoin it', async () => {
      const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
      const result = structuredClone(battleResultFixture)
      // Both members broke and fled — the FORMATION is gone, but the men lived.
      result.blue_survivors = { Soldier: 2 }
      result.blue_squads = { 1: { survivors: { Soldier: 2 }, wiped: true } }
      engine.runBattle.mockResolvedValue(result)

      const { body: c } = await createCampaign()
      await setSquads(c.id, [squad], { Soldier: 2 })

      const res = await fieldSquad(c.id, squad)
      expect(res.status).toBe(201)
      // CHANGED by slice 1 — this used to assert the squad was disbanded and
      // its stragglers scattered into the loose pool. The charter is permanent
      // now (decision 14) and broken-but-surviving troops rejoin it after the
      // battle (decision 7), which is what keeps squad-exclusive elite types
      // from leaking out of the squad that owns them.
      expect(res.body.campaign.squads).toHaveLength(1)
      expect(res.body.campaign.squads[0].composition).toEqual({ Soldier: 2 })
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
      expect(res.body.campaign.squads.map(charterFacts)).toEqual([
        { id: 1, name: '1st Cohort', composition: { Soldier: 2 }, prestige: 0, rank: 'Untested' },
        { id: 2, name: 'Skirmishers', composition: { Archer: 5 }, prestige: 0, rank: 'Untested' },
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

  // The ad-hoc militia purchase is GONE (docs/CAMPAIGN_PLAN.md "Recruit phase"
  // S4): Militia is now the base tier of RECRUIT_POOL, bought through the
  // Recruit phase like every other unit type, so /spend only fortifies.
  test('the old militia purchase action is no longer a spend action', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.roster = { Soldier: 10 }
    doc.resources = { food: 1000, materials: 1000, gold: 0, horses: 0 }
    await doc.save()

    const res = await spend(c.id, { action: 'militia', count: 10 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unknown spend action/i)

    // Nothing was bought and nothing was spent.
    const after = await Campaign.findById(c.id)
    expect(after.roster.get('Militia')).toBeUndefined()
    expect(after.resources.food).toBe(1000)
    expect(after.resources.materials).toBe(1000)
    expect(after.workers.total).toBe(2000)
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

  // Fort labour is now the ONLY thing that touches `used` — the other worker
  // sink (a Recruit hire, which shrinks `total` instead) is covered in the
  // Recruit phase describe below.
  test('fort labour raises `used` and leaves `total` alone', async () => {
    const { body: c } = await createCampaign()
    await setMaterials(c.id, 1000)
    await setWorkers(c.id, 2000)

    const fort = await spend(c.id, { action: 'fortify' }) // 500 workers cost (L0→1)
    expect(fort.status).toBe(200)
    expect(fort.body.workers).toEqual({ total: 2000, used: 500, available: 1500 })
  })

  test('bad actions are rejected', async () => {
    const { body: c } = await createCampaign()
    expect((await spend(c.id, {})).status).toBe(400)
    expect((await spend(c.id, { action: 'bribe' })).status).toBe(400)
  })
})

// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
// the day's offer is drawn LAZILY, when the phase is opened — never at
// creation or end-day, so gold won from this turn's raids is already in the
// stores when the affordable pool is computed. Opening the phase closes the
// camp for the day (the only action left is the hire), which is what makes the
// sealed offer safe: nothing can move resources between draw and hire.
// STARTING_ROSTER owns Soldier but no Militia, so day 1's affordable pool is
// Militia alone (no gold, no horses; Soldier/Archer gated on owning Militia)
// — one real option, topped up to two with Travellers.
describe('Recruit phase (docs/CAMPAIGN_PLAN.md)', () => {
  const openRecruit = (id) => auth(api.post(`/api/campaigns/${id}/recruit/open`)).send({})
  const hire = (id, body) => auth(api.post(`/api/campaigns/${id}/recruit/hire`)).send(body)
  const endDayReq = (id) => endTurn(id)
  const militia = RECRUIT_POOL.find((e) => e.id === 'militia')

  test('a fresh campaign has NO offer until the phase is opened', async () => {
    const { body: c } = await createCampaign()
    expectNoHiddenInfo(c)
    expect(c.recruit.fervor).toBe(0)
    expect(c.recruit.boosted).toBe(false)
    expect(c.recruit.hiredToday).toBe(false)
    expect(c.recruit.drawn).toBe(false)
    expect(c.recruit.options).toEqual([])
  })

  test('opening the phase draws the day-1 offer: Militia, padded with Travellers', async () => {
    const { body: c } = await createCampaign()
    const res = await openRecruit(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.recruit.drawn).toBe(true)
    expect(res.body.recruit.hiredToday).toBe(false)
    // `from` is null on both: Militia is the base rung, raised from the
    // workforce rather than promoted out of anything (the tiers above it carry
    // a unit name here — see the ladder in services/recruit.js).
    expect(res.body.recruit.options).toEqual([
      { id: 'militia', unit: 'Militia', lane: 'troop', from: null, count: militia.count, cost: militia.cost, secondUnit: null },
      { id: 'travellers', unit: 'Militia', lane: 'troop', from: null, count: FREE_MILITIA_AMOUNT, cost: {}, secondUnit: null },
    ])
  })

  test('opening again is idempotent — re-entering the phase is not a reroll', async () => {
    const { body: c } = await createCampaign()
    const first = await openRecruit(c.id)
    const second = await openRecruit(c.id)
    expect(second.status).toBe(200)
    expect(second.body.recruit.options).toEqual(first.body.recruit.options)
  })

  test('hiring the offered option debits its cost and grows the roster; the day is then spent', async () => {
    const { body: c } = await createCampaign()
    const before = await getView(c.id)
    await openRecruit(c.id)

    const res = await hire(c.id, { entryId: 'militia' })
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    expect(res.body.roster.Militia).toBe(militia.count)
    expect(res.body.resources.food).toBe(before.resources.food - militia.cost.food)
    expect(res.body.resources.materials).toBe(before.resources.materials - militia.cost.materials)
    expect(res.body.workers.total).toBe(before.workers.total - militia.cost.workers)
    expect(res.body.recruit.hiredToday).toBe(true)
    expect(res.body.recruit.options).toEqual([]) // cleared once the day's cadence is spent

    // The day's cadence is spent: a second hire attempt is rejected.
    const again = await hire(c.id, { entryId: 'militia' })
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/already resolved/)
  })

  test('hiring Travellers costs nothing and is always available as the day\'s legal play', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.resources.food = 0
    doc.resources.materials = 0
    await doc.save()

    const opened = await openRecruit(c.id)
    expect(opened.body.recruit.options.map((o) => o.id)).toEqual(['travellers'])

    const before = await getView(c.id)
    const res = await hire(c.id, { entryId: 'travellers' })
    expect(res.status).toBe(200)
    expect(res.body.roster.Militia).toBe(FREE_MILITIA_AMOUNT)
    // Every stored resource is untouched. (`resources` in the view also
    // carries the derived foodNeedPerTurn, which SHOULD move — 5 more mouths.)
    for (const key of ['food', 'materials', 'gold', 'horses'])
      expect(res.body.resources[key], key).toBe(before.resources[key])
    expect(res.body.workers.total).toBe(before.workers.total)
    expect(res.body.recruit.hiredToday).toBe(true)
  })

  test('an entryId not on today\'s offer is rejected', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    const res = await hire(c.id, { entryId: 'mage' }) // not affordable/offered on day 1
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not one of today/)
    expect((await getView(c.id)).recruit.hiredToday).toBe(false)
  })

  test('hiring before the phase is opened is rejected — there is no offer yet', async () => {
    const { body: c } = await createCampaign()
    const res = await hire(c.id, { entryId: 'militia' })
    expect(res.status).toBe(400)
    expect((await getView(c.id)).recruit.hiredToday).toBe(false)
  })

  test('skipping is gone — the hire is the only way the phase resolves', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    const res = await hire(c.id, { skip: true })
    expect(res.status).toBe(400)
    expect((await getView(c.id)).recruit.hiredToday).toBe(false)
  })

  test('an id sealed in the offer that has left the pool 400s rather than throwing a 500', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    const doc = await Campaign.findById(c.id)
    doc.recruit.dailyOptions = ['ghost'] // a mid-campaign pool edit
    await doc.save()

    const res = await hire(c.id, { entryId: 'ghost' })
    expect(res.status).toBe(400)
  })

  test('the affordability guard checks the BOOST-RESOLVED cost, not the undiscounted base', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    // A boosted day whose doubled cost is unaffordable resolves to a 30%
    // discount — which the view offers and the ledger charges, so the guard
    // must accept it too.
    const doc = await Campaign.findById(c.id)
    doc.recruit.boosted = true
    doc.resources.food = militia.cost.food - 4 // under base, over the discount
    doc.resources.materials = militia.cost.materials - 2
    await doc.save()

    const view = await getView(c.id)
    const offered = view.recruit.options.find((o) => o.id === 'militia')
    expect(offered.cost.food).toBeLessThanOrEqual(view.resources.food)

    const res = await hire(c.id, { entryId: 'militia' })
    expect(res.status).toBe(200)
    expect(res.body.resources.food).toBe(view.resources.food - offered.cost.food)
  })

  test('end-day clears the day-state without drawing tomorrow\'s offer in advance', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    await hire(c.id, { entryId: 'militia' })
    const dayReport = await endDayReq(c.id)
    expect(dayReport.status).toBe(200)
    const view = dayReport.body.campaign
    expect(view.recruit.hiredToday).toBe(false)
    expect(view.recruit.drawn).toBe(false)
    expect(view.recruit.options).toEqual([])
  })

  test('the new day draws a fresh offer when the phase is opened again', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // a choice-fate would gate the next open behind a 409
    await openRecruit(c.id)
    await hire(c.id, { entryId: 'militia' })
    await endDayReq(c.id)
    const res = await openRecruit(c.id)
    expect(res.status).toBe(200)
    expect(res.body.recruit.drawn).toBe(true)
    expect(res.body.recruit.options.length).toBeGreaterThan(0)
  })
})

// Opening the Recruit phase closes the camp for the day: the hire is the only
// action left. This is what makes the sealed offer honest — a raid launched
// after the draw would have made options appear that the offer can't contain
// (the original bug), and a fortify spend could strand a drawn option.
describe('Recruit phase locks the rest of the turn', () => {
  const openRecruit = (id) => auth(api.post(`/api/campaigns/${id}/recruit/open`)).send({})

  const lockedActions = [
    ['effort', { share: 0.5 }],
    ['augury/consult', {}],
    ['augury/reroll', { slot: 0 }],
    ['augury/accept', {}],
    ['raids/launch', { parties: {} }],
    ['raids/scout', { action: 'addTarget' }],
    ['spend', { action: 'fortify' }],
  ]

  test('camp actions succeed before the phase is opened', async () => {
    const { body: c } = await createCampaign()
    const res = await auth(api.post(`/api/campaigns/${c.id}/spend`)).send({ action: 'fortify' })
    expect(res.status).toBe(200)
  })

  // The ad-hoc recruit lock is gone: opening the phase just marches the turn
  // to 'recruit', and the general one-way guard (rejectIfPhasePassed) is what
  // closes every earlier screen — now a 409, like every other passed phase.
  test('every camp action 409s once recruiting has begun', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    for (const [path, payload] of lockedActions) {
      const res = await auth(api.post(`/api/campaigns/${c.id}/${path}`)).send(payload)
      expect(res.status, path).toBe(409)
      expect(res.body.error, path).toMatch(/behind you/i)
    }
  })

  test('the hire itself, and ending the day, stay open', async () => {
    const { body: c } = await createCampaign()
    await openRecruit(c.id)
    expect((await auth(api.post(`/api/campaigns/${c.id}/recruit/hire`)).send({ entryId: 'travellers' })).status).toBe(200)
    expect((await endTurn(c.id)).status).toBe(200)
  })
})

// Squad reinforcement (docs/CAMPAIGN_PLAN.md "SLICE 3 — reinforcement"): the
// Recruit phase's OTHER sink. A hire spends food/workers and adds bodies to the
// ARMY; a reinforcement spends gold/materials and moves bodies from the loose
// pool into a CHARTER, once per turn per squad, bounded by the archetype's
// pooled intake. The two are fully independent in both directions (decision I).
//
// The pure layer — recipes, headroom, intake, the hex budget — is covered in
// squadReinforce.test.js; this is the route's contract: the phase gate, the
// once-per-turn ledger, and atomicity (a refusal spends NOTHING).
describe('squad reinforcement (docs/CAMPAIGN_PLAN.md "SLICE 3")', () => {
  const openRecruit = (id) => auth(api.post(`/api/campaigns/${id}/recruit/open`)).send({})
  const reinforce = (id, squadId, body) =>
    auth(api.post(`/api/campaigns/${id}/squads/${squadId}/reinforce`)).send(body)

  // The starting squads all sit exactly AT their caps (a full formation has no
  // room, which reads correctly), so every case here first takes losses off
  // one — the state a battle or a raid would leave behind.
  const maulSquad = (id, squadId, composition) =>
    Campaign.updateOne(
      { _id: id, 'squads.id': squadId },
      { $set: { 'squads.$.composition': composition } },
    )
  const fund = (id, resources) => Campaign.findByIdAndUpdate(id, { $set: resources })
  // Take whatever the day actually offered: funding a campaign with gold puts
  // the casters in the affordable pool, so the two drawn options are not
  // reliably the day-1 Militia card.
  const hireWhateverIsOffered = async (id) => {
    const view = await getView(id)
    return auth(api.post(`/api/campaigns/${id}/recruit/hire`)).send({ entryId: view.recruit.options[0].id })
  }

  // A campaign in the Recruit phase with a mauled 1st Cohort (line: 40 Soldier,
  // intake 10) and coin to spend.
  // Gold is generous by default so the day's DRAWN offer stays affordable
  // after a reinforcement has been paid for. That interaction is real and
  // intended (see the independence test below): the two sinks share the purse
  // even though neither gates the other, so a lavish reinforcement can put a
  // 100-gold caster out of reach. The free Travellers card is what keeps the
  // phase exitable regardless.
  const readyCampaign = async ({ composition = { Soldier: 30 }, squadId = 1, gold = 500 } = {}) => {
    const { body: c } = await createCampaign()
    await maulSquad(c.id, squadId, composition)
    await fund(c.id, { 'resources.gold': gold, 'resources.horses': 10 })
    await openRecruit(c.id)
    return c
  }

  test('the view resolves each squad’s archetype into its caps and intake', async () => {
    const { body: c } = await createCampaign()
    expectNoHiddenInfo(c)
    const cohort = c.squads.find((s) => s.id === 1)
    // Resolved SERVER-side from the id (which is all the document stores), so
    // the config stays single-sourced and a rebalance reaches live campaigns.
    expect(cohort.archetype).toBe('line')
    expect(cohort.caps).toEqual({ Soldier: 40, Pikeman: 10 })
    expect(cohort.intake).toBe(10)
    expect(cohort.reinforcedToday).toBe(false)
    // The loose pool the reinforcement draws on: roster minus every charter.
    expect(c.loose.Soldier).toBe(c.roster.Soldier - 40)
    expect(c.loose.Cavalry).toBe(c.roster.Cavalry - 6)
    // The price list, once for the army rather than copied onto every squad —
    // so the panel previews a cost from the same numbers the route charges.
    expect(c.reinforceRecipes.Cavalry).toEqual({
      count: 1,
      inputs: { Cavalry: 1 },
      cost: { gold: 5, materials: 4, horses: 1 },
    })
  })

  test('reinforcing moves loose bodies into the charter and charges the recipe', async () => {
    const c = await readyCampaign()
    const before = await getView(c.id)
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 5 } })

    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)
    const cohort = res.body.squads.find((s) => s.id === 1)
    expect(cohort.composition.Soldier).toBe(35)
    // 1:1 today: the army is no bigger, the bodies just moved off the loose
    // rolls and into the squad.
    expect(res.body.roster.Soldier).toBe(before.roster.Soldier)
    expect(res.body.loose.Soldier).toBe(before.loose.Soldier - 5)
    expect(res.body.resources.gold).toBe(before.resources.gold - 10)
    expect(res.body.resources.materials).toBe(before.resources.materials - 10)
    expect(cohort.reinforcedToday).toBe(true)
    expect(res.body.log.at(-1).entries.join(' ')).toMatch(/1st Cohort/)
  })

  test('once per turn, per squad — and the ledger is per charter, not global', async () => {
    const c = await readyCampaign()
    await maulSquad(c.id, 2, { Archer: 25 })
    expect((await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })).status).toBe(200)

    const again = await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/already/i)

    // A different charter is untouched by the first one's stamp.
    expect((await reinforce(c.id, 2, { reinforce: { Archer: 2 } })).status).toBe(200)
  })

  test('a mixed request is applied atomically — or refused whole', async () => {
    const c = await readyCampaign({ squadId: 3, composition: { Cavalry: 5, LightCavalry: 5 } })
    const before = await getView(c.id)
    // vanguard: intake 2, two permitted types — the case a single-type call
    // could not serve without breaking once-per-turn.
    const ok = await reinforce(c.id, 3, { reinforce: { Cavalry: 1, LightCavalry: 1 } })
    expect(ok.status).toBe(200)
    const vanguard = ok.body.squads.find((s) => s.id === 3)
    expect(vanguard.composition).toEqual({ Cavalry: 6, LightCavalry: 6 })
    expect(ok.body.resources.gold).toBe(before.resources.gold - 9)
    expect(ok.body.resources.horses).toBe(before.resources.horses - 2)
  })

  test('an over-request is refused with NOTHING spent — never a silent clamp', async () => {
    const c = await readyCampaign({ composition: { Soldier: 38 } })
    const before = await getView(c.id)
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 5 } })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/room for 2/)
    const after = await getView(c.id)
    expect(after.squads.find((s) => s.id === 1).composition.Soldier).toBe(38)
    expect(after.resources.gold).toBe(before.resources.gold)
    expect(after.squads.find((s) => s.id === 1).reinforcedToday).toBe(false)
  })

  test('one bad type in the map spends nothing for the good ones either', async () => {
    const c = await readyCampaign({ squadId: 3, composition: { Cavalry: 4, LightCavalry: 4 } })
    const before = await getView(c.id)
    // Archer is not in vanguard's caps at all; the Cavalry half is legal.
    const res = await reinforce(c.id, 3, { reinforce: { Cavalry: 1, Archer: 1 } })
    expect(res.status).toBe(400)
    const after = await getView(c.id)
    expect(after.squads.find((s) => s.id === 3).composition).toEqual({ Cavalry: 4, LightCavalry: 4 })
    expect(after.resources.gold).toBe(before.resources.gold)
  })

  test('the pooled intake bounds the turn, however the map is split', async () => {
    const c = await readyCampaign({ squadId: 3, composition: { Cavalry: 2, LightCavalry: 2 } })
    const greedy = await reinforce(c.id, 3, { reinforce: { Cavalry: 2, LightCavalry: 1 } })
    expect(greedy.status).toBe(400)
    expect(greedy.body.error).toMatch(/at most 2/)
  })

  test('a wiped charter refills through the ordinary intake — no special case', async () => {
    const c = await readyCampaign({ composition: {} })
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 10 } })
    expect(res.status).toBe(200)
    expect(res.body.squads.find((s) => s.id === 1).composition).toEqual({ Soldier: 10 })
  })

  test('the loose pool is the only source — a committed body cannot be recommitted', async () => {
    const c = await readyCampaign({ composition: { Soldier: 30 } })
    // Every loose Soldier spent elsewhere: roster down to exactly what the
    // charters already hold (30 here + nothing else), so nothing is unassigned.
    await Campaign.findByIdAndUpdate(c.id, { $set: { 'roster.Soldier': 30 } })
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unassigned/i)
  })

  test('the stores must cover it: no reinforcing on credit', async () => {
    const c = await readyCampaign({ gold: 3 })
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 5 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/gold/)
  })

  test('it is phase-guarded: not before recruiting opens, not after it closes', async () => {
    const { body: early } = await createCampaign()
    await maulSquad(early.id, 1, { Soldier: 30 })
    await fund(early.id, { 'resources.gold': 100 })
    const before = await reinforce(early.id, 1, { reinforce: { Soldier: 1 } })
    expect(before.status).toBe(400)
    expect(before.body.error).toMatch(/opened/i)

    const c = await readyCampaign()
    await Campaign.findByIdAndUpdate(c.id, { phase: 'deploy' })
    const late = await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })
    expect(late.status).toBe(409)
    expect(late.body.error).toMatch(/behind you/i)
  })

  // Decision I: reinforcing does not consume the day's hire, and the hire does
  // not gate reinforcing. Coupling them would make the mandatory hire silently
  // a mandatory reinforcement decision too.
  test('it is independent of the day’s hire, in both directions', async () => {
    const c = await readyCampaign()
    const reinforced = await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })
    expect(reinforced.status).toBe(200)
    // The day's hire is untouched: still owed, still on the table.
    expect(reinforced.body.recruit.hiredToday).toBe(false)
    expect(reinforced.body.recruit.options.length).toBeGreaterThan(0)
    expect((await hireWhateverIsOffered(c.id)).status).toBe(200)

    const other = await readyCampaign()
    expect((await hireWhateverIsOffered(other.id)).status).toBe(200)
    expect((await reinforce(other.id, 1, { reinforce: { Soldier: 1 } })).status).toBe(200)
  })

  test('the stamp is a DAY stamp: the next turn reinforces again', async () => {
    const c = await readyCampaign()
    await pinAugury(c.id)
    expect((await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })).status).toBe(200)
    await hireWhateverIsOffered(c.id)
    await endTurn(c.id)
    await openRecruit(c.id)
    const res = await reinforce(c.id, 1, { reinforce: { Soldier: 1 } })
    expect(res.status).toBe(200)
    expect(res.body.squads.find((s) => s.id === 1).composition.Soldier).toBe(32)
  })

  test('an unknown squad, a malformed body and a foreign campaign are all refused', async () => {
    const c = await readyCampaign()
    expect((await reinforce(c.id, 99, { reinforce: { Soldier: 1 } })).status).toBe(400)
    expect((await reinforce(c.id, 1, {})).status).toBe(400)
    expect((await reinforce(c.id, 1, { reinforce: { Soldier: 'lots' } })).status).toBe(400)

    const foreign = new mongoose.Types.ObjectId()
    expect((await reinforce(foreign, 1, { reinforce: { Soldier: 1 } })).status).toBe(404)
  })
})

// ── The one-way turn (docs/CAMPAIGN_PLAN.md "Effort slider", decision 12) ──
//
// The turn marches prepare → omens → raids → recruit → deploy and never back.
// `campaign.phase` is the authority (the client only asks it to move), which is
// what makes a decision final once its screen is behind you — and what makes a
// double-submitted end-day impossible.
describe('the one-way turn phase machine', () => {
  const setPhase = (id, phase) => auth(api.post(`/api/campaigns/${id}/phase`)).send({ phase })

  test('a fresh campaign starts in prepare, and the view says so', async () => {
    const { body: c } = await createCampaign()
    expect(c.phase).toBe('prepare')
  })

  test('advances one step at a time, and never backwards', async () => {
    const { body: c } = await createCampaign()

    expect((await setPhase(c.id, 'omens')).body.phase).toBe('omens')
    expect((await setPhase(c.id, 'raids')).body.phase).toBe('raids')

    // Back is refused outright — that is the whole point of the march.
    const back = await setPhase(c.id, 'prepare')
    expect(back.status).toBe(409)
    expect((await Campaign.findById(c.id)).phase).toBe('raids')
  })

  test('skipping a phase is refused', async () => {
    const { body: c } = await createCampaign()
    const res = await setPhase(c.id, 'raids') // prepare → raids, skipping omens
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/one phase forward/i)
  })

  test('an unknown phase is refused', async () => {
    const { body: c } = await createCampaign()
    expect((await setPhase(c.id, 'feasting')).status).toBe(400)
  })

  test('recruit is entered by opening it (that draw is the phase step)', async () => {
    const { body: c } = await createCampaign()
    await setPhase(c.id, 'omens')
    await setPhase(c.id, 'raids')

    // The pure phase route refuses it: entering recruit DRAWS the day's offer,
    // so it belongs to the one route that owns that.
    expect((await setPhase(c.id, 'recruit')).status).toBe(400)

    const opened = await auth(api.post(`/api/campaigns/${c.id}/recruit/open`)).send({})
    expect(opened.status).toBe(200)
    expect(opened.body.phase).toBe('recruit')
  })

  test('deploy opens only on the pitched-battle day', async () => {
    const { body: c } = await createCampaign()
    await auth(api.post(`/api/campaigns/${c.id}/recruit/open`)).send({})

    const quiet = await setPhase(c.id, 'deploy')
    expect(quiet.status).toBe(400)
    expect(quiet.body.error).toMatch(/no battle/i)

    const doc = await Campaign.findById(c.id)
    doc.bossFightDue = true
    await doc.save()
    expect((await setPhase(c.id, 'deploy')).body.phase).toBe('deploy')
  })

  test('a decision behind the turn is refused — but acting early is not', async () => {
    const { body: c } = await createCampaign()

    // Early: the client can't do this (its screens are sequential) and nothing
    // later has happened yet, so it is deliberately left alone.
    expect((await auth(api.post(`/api/campaigns/${c.id}/raids/scout`)).send({ action: 'add_target' })).status)
      .not.toBe(409)

    await setPhase(c.id, 'omens')
    const late = await auth(api.post(`/api/campaigns/${c.id}/effort`)).send({ share: 0.5 })
    expect(late.status).toBe(409)
    expect(late.body.error).toMatch(/prepare phase is behind you/i)
  })

  test('the fortnight cannot end before it has been seen through', async () => {
    const { body: c } = await createCampaign()
    const early = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(early.status).toBe(409)
    expect(early.body.error).toMatch(/still in prepare/i)
    expect((await Campaign.findById(c.id)).day).toBe(1) // nothing resolved
  })

  test('a double-submitted end-day resolves ONE fortnight, not two', async () => {
    const { body: c } = await createCampaign()
    expect((await endTurn(c.id)).status).toBe(200)

    // The second submit lands on a turn that has just reset to 'prepare'.
    const again = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(again.status).toBe(409)
    expect((await Campaign.findById(c.id)).day).toBe(2)
  })

  test('a new turn re-opens the march at prepare', async () => {
    const { body: c } = await createCampaign()
    await endTurn(c.id) // stamps 'recruit', then resolves
    expect((await Campaign.findById(c.id)).phase).toBe('prepare')
  })
})

describe('POST /api/campaigns/:id/end-day', () => {
  test('advances the turn: upkeep, enemy foraging, fresh augury, report', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id) // ±0-food truth keeps the resource math exact
    const res = await endTurn(c.id)
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
        // `effect` (2026-08-10): every reveal card states what the fate did.
        // QUIET is a 0 kg fixture, so its line takes no sign — see the `sign`
        // helper in describeEffect.
        actual: {
          id: 'quiet',
          title: 'Quiet Fortnight',
          description: 'Nothing stirs.',
          severity: 1,
          effect: ['Food 0 t'],
        },
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

    // The enemy drained the near ring even though we sent nobody out. Since S2
    // that drain is a flat abstract number, not a plan derived from its army,
    // and it eats near-first. Read both constants rather than restating them:
    // this assertion went stale (20000 − 9084) when S2 scaled the rings 4× and
    // replaced enemyForagePlanKg with ENEMY_DRAIN_KG_PER_TURN.
    expect(res.body.report.forage.harvested).toEqual({ food: 0, materials: 0 })
    expect(res.body.report.forage.rings[0].richness).toBe(
      FORAGE_RINGS[0] - ENEMY_DRAIN_KG_PER_TURN,
    )
    // No forager-clash assertion: S2 deleted clashes outright (services/
    // skirmish.js is gone), so the report carries no such key any more.
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

    const res = await endTurn(c.id)
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
    const res = await endTurn(c.id)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/take the field/)
  })

  test('the other screens are NOT locked out on a boss-fight-due day — only End Turn is', async () => {
    // The player may still adjust effort/scout/etc; they simply can't skip
    // the fight. (Raid launch lives on its own route with no bossFightDue
    // gate, so it is structurally unaffected — effort here stands in for
    // "screens still open".)
    const { body: c } = await createCampaign()
    await Campaign.updateOne({ _id: c.id }, { $set: { bossFightDue: true } })

    const effortRes = await auth(api.post(`/api/campaigns/${c.id}/effort`)).send({ share: 0.6 })
    expect(effortRes.status).toBe(200)

    const consultRes = await auth(api.post(`/api/campaigns/${c.id}/augury/consult`)).send({})
    expect(consultRes.status).toBe(200)

    // But End Turn is still barred until the fight happens.
    const endRes = await endTurn(c.id)
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

    const res = await endTurn(c.id)
    expect(res.status).toBe(200)
    // Same 12,432 kg as the plain starting-roster case (see the test
    // above) — workers.used had no effect on upkeep.
    expect(res.body.report.upkeep.foodConsumed).toBe(12432)
    expect(res.body.campaign.resources.food).toBe(50000 - 12432)
  })

  test('foragers harvest at end of turn; the pool resnapshots and the share stays sticky', async () => {
    const { body: c } = await createCampaign()
    await pinBand(c.id, 'Contested') // neutral posture (×1) — this tests harvest math, not scouting scaling
    await pinAugury(c.id) // keep the food math free of event noise
    // The default share is 0 (all-scouting) — dial in 0.5 explicitly so this
    // test actually exercises the harvest math.
    await Campaign.findByIdAndUpdate(c.id, { 'forage.share': 0.5 })

    // Share 0.5 over the starting pool (1112.4): 556.2 pts × 16 = 8899 kg,
    // entirely from the near ring (yield ×1.0, no spillover).
    const res = await endTurn(c.id)
    expect(res.status).toBe(200)
    expectNoHiddenInfo(res.body)

    expect(res.body.report.forage.harvested).toEqual({ food: 7119, materials: 1779 })
    // Player takes 8899 kg, then the enemy's flat 9000 kg drain eats the rest
    // (both near-first, no contention — decision 4).
    expect(res.body.report.forage.rings[0].richness).toBe(80000 - 8899 - 9000)
    expect(res.body.campaign.resources.food).toBe(50000 + 7119 - 12432)
    expect(res.body.campaign.resources.materials).toBe(200 + 1779)
    // The pool resnapshots from the (unchanged) roster; the share is STICKY —
    // newDay never resets it (docs/CAMPAIGN_PLAN.md "Effort slider" decision 12).
    expect(res.body.campaign.forage.pool).toBeCloseTo(1112.4)
    expect(res.body.campaign.forage.share).toBe(0.5)
  })

  test('the day report reveals predicted vs actual per slot — the augur can lie', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, DOOMED, QUIET) // [4,1] reading → odds 0.35 → threshold 350
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 0: lie
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 1: lie
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 2: truth
    await auth(api.post(`/api/campaigns/${c.id}/augury/consult`)).send({})

    const res = await endTurn(c.id)
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

    const res = await endTurn(c.id)
    expect(res.body.report.upkeep.deserters).toBeGreaterThan(0)
    expect(res.body.campaign.roster.Soldier).toBe(270)
  })

  test('enemy annihilation wins the campaign', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.enemy.army = {}
    await doc.save()

    const res = await endTurn(c.id)
    expect(res.body.campaign.status).toBe('won')

    // A finished campaign refuses further actions.
    expect((await endTurn(c.id)).status).toBe(400)
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
  const endDayReq = (id) => endTurn(id)
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
    capacity: 500, // fits a whole starting squad (squad-only raiding, 2026-07-21)
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

  // ── Every fate states what it DID (user, 2026-08-10) ───────────────────────
  // The standing rule that no card shows flavour alone reached the augur's tent
  // and the choice branches, but not the beat where a fate actually LANDS: the
  // card named the fate and its prose, and the figure appeared only in the flat
  // "fortnight, in full" list a beat later, among upkeep and the enemy's turn.
  // Whether a fate's own prose carried a number was authoring accident.
  describe('the reveal card states the fate\'s mechanical outcome', () => {
    test('a plain fate reports its effect as described lines, not raw machinery', async () => {
      const { body: c } = await createCampaign()
      await pinAugury(c.id, DOOMED, QUIET)
      await setConsulted(c.id)
      await clearRaids(c.id)

      const { body } = await accept(c.id)
      for (const slot of body.report.augury) {
        expect(slot.actual.effect).toEqual(['Food −1 t'])
        // Described lines only — the raw {type, delta} never crosses, same
        // contract describeEffect holds everywhere else.
        expect(JSON.stringify(slot.actual)).not.toContain('"delta"')
        expect(JSON.stringify(slot.actual)).not.toContain('"type"')
      }
    })

    test('a recon-sensitive fate reports the FIRED rung\'s effect, not the blind one', async () => {
      const { body: c } = await createCampaign()
      await pinAugury(c.id, NIGHT_RAID, QUIET)
      await setConsulted(c.id)
      await clearRaids(c.id)
      await pinBand(c.id, 'Contested') // → the `warned` rung fires

      const { body } = await accept(c.id)
      const slot = body.report.augury[0]
      // The beat renders `fired ?? actual`, so the line must be the rung's.
      // "Pickets Hold — they flee with next to nothing" is −0.5 t; the blind
      // rung it replaced would have been −2 t and a slice of the Soldiers.
      expect(slot.fired.title).toBe('Pickets Hold')
      expect(slot.fired.effect).toEqual(['Food −0.5 t'])
      expect(slot.fired.effect).not.toEqual(slot.actual.effect)
    })

    test('a DEFERRED slot names the TRUE fate and its cost, but no verdict', async () => {
      const { body: c } = await createCampaign()
      await pinAugury(c.id, DOOMED, QUIET)
      await setConsulted(c.id)
      await pinCounterRaid(c.id, 1)

      const { body } = await accept(c.id)
      const tent = body.report.augury[1]
      expect(tent.deferred).toBe(true)
      // The VERDICT is still deferred — whether the blow landed and whether the
      // scouts turned it wait for end-day, which is what lets a raid unmake it.
      expect(tent.actual).toBeUndefined()
      expect(tent.fired).toBeUndefined()
      // But the THREAT is named, with what it will cost (2026-08-10). The truth
      // is already public by now — auguryTruthRevealed goes on at accept — and
      // the counter card on the raid board has always read trueEvent, so
      // showing the decoy here made the two screens contradict each other while
      // the player decided whether to raid it.
      expect(tent.threat.title).toBe('Doom')
      expect(tent.threat.effect).toEqual(['Food −1 t']) // DOOMED's −999 kg
      // And the bluff is gone: once the truth is out, the decoy the player was
      // shown is no longer information.
      expect(tent.predicted).toBeUndefined()
      expect(JSON.stringify(tent)).not.toContain('quiet')
    })
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

    // Squad-only raiding (2026-07-21): send the 1st Cohort (squad 1), not a
    // headcount.
    const raid = await auth(
      api.post(`/api/campaigns/${c.id}/raids/launch`),
    ).send({ parties: { 'd1-0': [1] } })
    expect(raid.status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[2].countered).toBe(true)

    const end = await endDayReq(c.id)
    // The deferred −999 never lands; food only moves by upkeep (recompute via
    // the report, which is self-consistent with whatever the raid left behind).
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

  const endDayReq = (id) => endTurn(id)
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

  // Every card states what it does (user, 2026-08-10). A branch used to cross
  // as prose alone, so a decision could only be made on tone — and the tent's
  // reveal beat and the campaign view built their option cards separately, so
  // the two screens could have disagreed. One optionCard now serves both.
  test('an option states its mechanical cost, on the tent card and in the view alike', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, REFUGEES)
    const res = await endDayReq(c.id)

    const tentCards = res.body.report.augury[0].pendingChoice.options
    const viewCards = (await getView(c.id)).pendingChoices[0].options
    expect(viewCards).toEqual(tentCards) // one builder, so they cannot drift

    const byId = Object.fromEntries(tentCards.map((o) => [o.id, o.effectText]))
    // Taking them in costs stores and musters militia; turning them away is a
    // genuine no-op and says so rather than showing an empty line.
    expect(byId.take_in).toEqual(['Food −3 t', 'Militia +20'])
    expect(byId.turn_away).toEqual(['No consequence'])
  })

  test('a garrison branch reads as a direction, never a resolve figure', async () => {
    // breach_threatens is the siege spine's turn-5 beat: one branch spends food
    // AND standing, the other spends only standing. The resolve delta is what
    // minResolve/maxResolve gate on, so it must never cross as a number.
    const { body: c } = await createCampaign()
    await pinAugury(c.id, EVENT_POOL.find((e) => e.id === 'breach_threatens'))
    const res = await endDayReq(c.id)
    const options = res.body.report.augury[0].pendingChoice.options
    const byId = Object.fromEntries(options.map((o) => [o.id, o.effectText]))
    expect(byId.into_the_breach).toEqual([
      'Food −2 t', 'Soldier ×0.98', 'Karrowgate thinks the better of you',
    ])
    expect(byId.cannot_spare).toEqual(['Karrowgate thinks the worse of you'])
    expect(JSON.stringify(options)).not.toMatch(/[-−+]?\d+ ?(resolve|standing)/i)
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
      ['recruit/open', {}],
      ['recruit/hire', { entryId: 'militia' }],
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

// Event chains (part 2): an outcome `schedule`s a GUARANTEED follow-up N turns
// out. The captured_courier choice → sprung_ambush chain is the proof, driven
// through the real routes: reading the dispatches queues the follow-up, and the
// NEXT turn's drawAugury drains it into a forced slot (the scheduled event as
// truth). `chained:true` keeps sprung_ambush out of every random draw, so it
// can only reach the player because the player's own choice put it there.
describe('event chains (part 2)', () => {
  const CAPTURED = EVENT_POOL.find((e) => e.id === 'captured_courier')

  const accept = (id) => auth(api.post(`/api/campaigns/${id}/augury/accept`)).send({})
  const endDayReq = (id) => endTurn(id)
  const choose = (id, slot, choice) =>
    auth(api.post(`/api/campaigns/${id}/choices/${slot}`)).send({ choice })
  const setup = async (id) => {
    const doc = await Campaign.findById(id)
    doc.augury.slots = doc.augury.slots.map(() => ({
      trueEvent: CAPTURED, falseEvent: QUIET, odds: null, shownTrue: null,
    }))
    doc.augury.consulted = true
    doc.raid.opportunities = [] // no stray counter_event to defer a slot
    doc.scheduledEvents = [] // isolate the courier chain from the seeded siege spine (S8)
    await doc.save()
  }

  test('reading the courier schedules the follow-up; next turn drains it into a forced slot', async () => {
    const { body: c } = await createCampaign()
    await setup(c.id)

    // The tent reveals the three couriers, each owing a decision.
    const acc = await accept(c.id)
    expect(acc.status).toBe(200)
    expect(acc.body.campaign.pendingChoices).toHaveLength(3)

    // Read the dispatches on one; ransom the rest (ransom schedules nothing).
    expect((await choose(c.id, 0, 'read_dispatches')).status).toBe(200)
    await choose(c.id, 1, 'ransom_courier')
    await choose(c.id, 2, 'ransom_courier')

    // The trap is queued for a fortnight hence — hidden state, day 1 + delay 1.
    const queued = await Campaign.findById(c.id)
    expect(queued.scheduledEvents.map((s) => ({ eventId: s.eventId, day: s.day })))
      .toEqual([{ eventId: 'sprung_ambush', day: 2 }])

    // End the turn: step-7 drawAugury (now day 2) drains the queue.
    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)
    const next = await Campaign.findById(c.id)
    // The follow-up is GUARANTEED to have surfaced as a fate's truth...
    expect(next.augury.slots.some((s) => s.trueEvent.id === 'sprung_ambush')).toBe(true)
    // ...and the queue is drained, so it fires exactly once.
    expect(next.scheduledEvents).toEqual([])
  })

  test('ransoming the courier schedules nothing — no chain without the choice', async () => {
    const { body: c } = await createCampaign()
    await setup(c.id)
    await accept(c.id)
    await choose(c.id, 0, 'ransom_courier')
    await choose(c.id, 1, 'ransom_courier')
    await choose(c.id, 2, 'ransom_courier')

    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)
    const next = await Campaign.findById(c.id)
    expect(next.scheduledEvents).toEqual([])
    expect(next.augury.slots.some((s) => s.trueEvent.id === 'sprung_ambush')).toBe(false)
  })
})

// Siege spine (S8): three GUARANTEED scripted beats seeded onto scheduledEvents
// at campaign creation (turns 2/5/8), each `chained` so it never enters a random
// draw — the schedule queue forces it into an augury slot on its day.
describe('siege spine (S8): scripted guaranteed beats', () => {
  const endDayReq = (id) => endTurn(id)
  // Neutralise the day-1 random augury so ending turn 1 pends nothing and
  // resolves clean — the spine drain is the only thing under test.
  const quietDay1 = async (id) => {
    const doc = await Campaign.findById(id)
    doc.augury.slots = doc.augury.slots.map(() => ({
      trueEvent: QUIET, falseEvent: QUIET, odds: null, shownTrue: null,
    }))
    await doc.save()
  }

  test('a fresh campaign is seeded with the three siege beats', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    expect(doc.scheduledEvents.map((s) => ({ eventId: s.eventId, day: s.day })))
      .toEqual([
        { eventId: 'siege_lines_close', day: 2 },
        { eventId: 'breach_threatens', day: 5 },
        { eventId: 'wardens_van', day: 8 },
      ])
  })

  test('ending turn 1 drains the Turn-2 beat into a forced slot; the later two stay queued', async () => {
    const { body: c } = await createCampaign()
    await quietDay1(c.id)

    const end = await endDayReq(c.id)
    expect(end.status).toBe(200)

    const next = await Campaign.findById(c.id)
    expect(next.augury.slots.some((s) => s.trueEvent.id === 'siege_lines_close')).toBe(true)
    expect(next.scheduledEvents.map((s) => ({ eventId: s.eventId, day: s.day })))
      .toEqual([
        { eventId: 'breach_threatens', day: 5 },
        { eventId: 'wardens_van', day: 8 },
      ])
  })
})

// Squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE CATALOG"), the
// route's contract. The pure layer — the slot ladder, the draft, permanence and
// the effect readers — is covered in squadUpgrades.test.js; what matters here
// is that the offer is SEALED server-side (a reload must not reshuffle it), that
// only an offered row can be taken, and that taking one spends nothing.
describe('squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4")', () => {
  const takeUpgrade = (id, squadId, upgrade) =>
    auth(api.post(`/api/campaigns/${id}/squads/${squadId}/upgrades`)).send({ upgrade })

  // Rank up a charter directly: the raid path that normally pays prestige is
  // covered in prestige.test.js, and going through it here would make these
  // tests about raids rather than about upgrades.
  const promote = (id, squadId, prestige) =>
    Campaign.updateOne({ _id: id, 'squads.id': squadId }, { $set: { 'squads.$.prestige': prestige } })

  const blooded = SQUAD_RANKS.find((r) => r.label === 'Blooded').min
  const seasoned = SQUAD_RANKS.find((r) => r.label === 'Seasoned').min

  // An offer is drawn at newDay, so a promoted squad needs a turn to roll over
  // before its draft is waiting.
  const promoteAndTurn = async (squadId = 1, prestige = blooded) => {
    const { body: c } = await createCampaign()
    await promote(c.id, squadId, prestige)
    await endTurn(c.id)
    // The rollover draws the next turn's fates, and a choice-fate owes a
    // decision that blocks every other mutating route (rejectIfChoicePending)
    // — unrelated noise for these tests, and the reason a read-only assertion
    // passes here where a POST would 409. Cleared rather than danced around so
    // each test below is about the upgrade route and nothing else.
    await Campaign.findByIdAndUpdate(c.id, { pendingChoices: [] })
    return c
  }

  test('an Untested squad is offered nothing — prestige is the gate', async () => {
    const { body: c } = await createCampaign()
    await endTurn(c.id)
    const view = await getView(c.id)
    for (const squad of view.squads) {
      expect(squad.upgradeSlots).toBe(0)
      expect(squad.upgradeOffer).toBeNull()
      expect(squad.banner).toBe(false)
    }
  })

  test('a squad that ranked up finds a draft waiting at the top of the turn', async () => {
    const c = await promoteAndTurn()
    const cohort = (await getView(c.id)).squads.find((s) => s.id === 1)
    expect(cohort.upgradeSlots).toBe(1)
    expect(cohort.upgradePicks).toBe(1)
    expect(cohort.upgradeOffer.rank).toBe('Blooded')
    expect(cohort.upgradeOffer.options.length).toBeGreaterThan(0)
    // Rows arrive RESOLVED — the client has no copy of the catalog.
    for (const option of cohort.upgradeOffer.options)
      expect(option).toMatchObject({ id: expect.any(String), name: expect.any(String), blurb: expect.any(String) })
  })

  // The draw is random, so it must happen exactly once and be sealed on the
  // document — otherwise a reload reshuffles until the player likes the offer.
  test('the offer is sealed: reading it again returns the same rows', async () => {
    const c = await promoteAndTurn()
    const first = (await getView(c.id)).squads.find((s) => s.id === 1).upgradeOffer
    const second = (await getView(c.id)).squads.find((s) => s.id === 1).upgradeOffer
    expect(second.options.map((o) => o.id)).toEqual(first.options.map((o) => o.id))
  })

  test('taking an offered row keeps it, consumes the draft, and spends nothing', async () => {
    const c = await promoteAndTurn()
    const before = await getView(c.id)
    const offered = before.squads.find((s) => s.id === 1).upgradeOffer.options[0].id

    const { body: after } = await takeUpgrade(c.id, 1, offered).expect(200)
    const cohort = after.squads.find((s) => s.id === 1)
    expect(cohort.upgrades.map((u) => u.id)).toEqual([offered])
    expect(cohort.upgradeOffer).toBeNull()
    expect(cohort.upgradePicks).toBe(0)
    // Free by design: reaching the rank and having a slot IS the price
    // (decision 5 — prestige is never spent either).
    expect(after.resources).toEqual(before.resources)
    expect(cohort.prestige).toBe(before.squads.find((s) => s.id === 1).prestige)
  })

  test('a row that was not offered is refused', async () => {
    const c = await promoteAndTurn()
    const view = await getView(c.id)
    const offered = new Set(view.squads.find((s) => s.id === 1).upgradeOffer.options.map((o) => o.id))
    const notOffered = SQUAD_UPGRADE_POOL.map((r) => r.id).find((id) => !offered.has(id))
    // With three rows and a draw of three every eligible row is offered today,
    // so this only bites once 4b-4d widen the pool — assert the guard with a
    // row that certainly is not on the list either way.
    const { body } = await takeUpgrade(c.id, 1, notOffered ?? 'no_such_upgrade').expect(400)
    expect(body.error).toBeDefined()
  })

  test('a second pick is refused while the rank pays for only one', async () => {
    const c = await promoteAndTurn()
    const offered = (await getView(c.id)).squads.find((s) => s.id === 1).upgradeOffer.options[0].id
    await takeUpgrade(c.id, 1, offered).expect(200)
    const { body } = await takeUpgrade(c.id, 1, offered).expect(400)
    expect(body.error).toBeDefined()
  })

  test('an unknown squad is a 400, not a crash', async () => {
    const { body: c } = await createCampaign()
    await takeUpgrade(c.id, 99, 'deeper_ranks').expect(400)
  })

  // Seasoned's rung pays for the banner instead of a pick — the one place the
  // ladder deliberately does not grow. The banner carries NO bonus: decision
  // 16 is deferred on purpose (see the slice-4 spec).
  test('Seasoned grants the banner and still only one pick', async () => {
    const c = await promoteAndTurn(1, seasoned)
    const cohort = (await getView(c.id)).squads.find((s) => s.id === 1)
    expect(cohort.banner).toBe(true)
    expect(cohort.upgradeSlots).toBe(1)
  })

  test('an upgrade reaches the numbers the reinforcement gates use', async () => {
    const c = await promoteAndTurn()
    const before = (await getView(c.id)).squads.find((s) => s.id === 1)
    const offer = before.upgradeOffer.options.map((o) => o.id)
    if (!offer.includes('deeper_ranks')) return
    const { body: after } = await takeUpgrade(c.id, 1, 'deeper_ranks').expect(200)
    const cohort = after.squads.find((s) => s.id === 1)
    const bonus = SQUAD_UPGRADE_POOL.find((r) => r.id === 'deeper_ranks').effect.bonus
    for (const [type, cap] of Object.entries(before.caps)) expect(cohort.caps[type]).toBe(cap + bonus)
  })
})
