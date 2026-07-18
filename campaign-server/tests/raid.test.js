import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearRolls } from '../utils/dice.js'
import { SCOUTING_BANDS } from '../utils/capabilities.js'

// Stub the engine service — raids run REAL battles in production, but these
// tests cover the campaign layer around them. getInfo feeds the zone spread.
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
const { generateRaidOpportunities } = await import('../services/raid.js')
const { raidCapacityCost } = await import('../utils/capabilities.js')
const {
  RAID_OPPORTUNITIES_PER_DAY,
  RAID_TARGET_FRACTION,
  RAID_MAX_TURNS,
  RAID_STRENGTH_BANDS,
} = await import('../utils/campaignConfig.js')

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
// Batch launch: {parties: {raidId: {type: count}}}. A single-raid convenience
// wrapper covers the common one-opportunity case used by most tests below.
const launchBatch = (id, parties) =>
  auth(api.post(`/api/campaigns/${id}/raids/launch`)).send({ parties })
const launch = (id, raidId, party) => launchBatch(id, { [raidId]: party })

// What an opportunity may look like on the wire. targetForce (the hidden
// slice the raid fights) and reward (counter_event's reward.slot would out
// which fate is bad) NEVER cross the boundary — the strength band and the
// description carry the promise instead.
const PUBLIC_OPPORTUNITY_KEYS = [
  'capacity', 'description', 'id', 'outcome', 'resolved', 'strengthBand', 'title', 'type',
]
const RAID_TYPES = ['destroy_detachment', 'loot_supplies', 'rescue_troops', 'counter_event']

const expectPublicOpportunities = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('"targetForce"')
  expect(raw).not.toContain('"reward"')
  for (const c of [body, body.campaign]) {
    for (const o of c?.raid?.opportunities ?? [])
      expect(Object.keys(o).sort()).toEqual(PUBLIC_OPPORTUNITY_KEYS)
  }
}

// A pinned opportunity so route tests control capacity/reward exactly.
const OPP = (over = {}) => ({
  id: 'd1-0',
  type: 'loot_supplies',
  title: 'Supply Train',
  description: 'Laden wagons under light guard.',
  targetForce: { Soldier: 5 },
  strengthBand: 'a handful',
  capacity: 100,
  reward: { food: 3000, materials: 20 },
  resolved: false,
  outcome: null,
  ...over,
})

const pinRaid = async (id, opportunities) => {
  const doc = await Campaign.findById(id)
  doc.raid.opportunities = opportunities
  await doc.save()
}

const pinAugury = async (id, trueEvent, falseEvent = trueEvent) => {
  const doc = await Campaign.findById(id)
  doc.augury.slots = doc.augury.slots.map(() => ({
    trueEvent,
    falseEvent,
    odds: null,
    shownTrue: null,
  }))
  await doc.save()
}

const shrinkRoster = async (id, roster) => {
  const doc = await Campaign.findById(id)
  doc.roster = roster
  await doc.save()
}

// Neutral and bad fates for pinning (BAD_FATE's id is not in EVENT_POOL, so
// no rung ladder interferes; QUIET's `none` effect is a genuine no-op).
const QUIET = {
  id: 'quiet', title: 'A Quiet Fortnight', description: 'Nothing stirs.',
  severity: 1, effect: { type: 'none' },
}
const BAD_FATE = {
  id: 'bad_fate', title: 'Bad Fate', description: 'A blow is coming.',
  severity: 2, effect: { type: 'food', delta: -999 },
}

// ── Capacity formula ─────────────────────────────────────────────────────────
describe('raidCapacityCost', () => {
  // User formula, kept literally: size × (40 − speed) / 40, on RAW movement
  // points (foot 10, horse 28) — the scale this formula was designed for.
  test('foot: 10 × (40 − 10) / 40 = 7.5', () => {
    expect(raidCapacityCost({ speed: 10 }, 10)).toBe(7.5)
  })
  test('cavalry: 20 × (40 − 28) / 40 = 6', () => {
    expect(raidCapacityCost({ speed: 28 }, 20)).toBe(6)
  })
  test('clamps at zero for absurd future speeds', () => {
    expect(raidCapacityCost({ speed: 50 }, 10)).toBe(0)
  })
})

// ── Generation ───────────────────────────────────────────────────────────────
describe('generateRaidOpportunities', () => {
  const catalog = new Map(catalogFixture.units.map((u) => [u.name, u]))
  const fakeCampaign = (over = {}) => ({
    day: 1,
    augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: QUIET }] },
    enemy: { army: { Soldier: 540, Archer: 150, Necromancer: 11, LightCavalry: 20 } },
    ...over,
  })

  test('the per-band count table covers exactly the five scouting bands', () => {
    expect(Object.keys(RAID_OPPORTUNITIES_PER_DAY).sort()).toEqual([...SCOUTING_BANDS].sort())
    expect(RAID_OPPORTUNITIES_PER_DAY.Blind).toBe(1)
    expect(RAID_OPPORTUNITIES_PER_DAY.Overwhelming).toBe(3)
  })

  test('opportunity count follows the scouting band', () => {
    for (const band of SCOUTING_BANDS)
      expect(generateRaidOpportunities(fakeCampaign(), catalog, band))
        .toHaveLength(RAID_OPPORTUNITIES_PER_DAY[band])
  })

  test('opportunities are complete: id, type, hidden target slice, band phrase, capacity', () => {
    const opportunities = generateRaidOpportunities(fakeCampaign(), catalog, 'Overwhelming')
    const enemyArmy = fakeCampaign().enemy.army
    const ids = new Set()
    for (const o of opportunities) {
      expect(typeof o.id).toBe('string')
      ids.add(o.id)
      expect(RAID_TYPES).toContain(o.type)
      expect(o.title).toBeTruthy()
      expect(o.description).toBeTruthy()
      // The target is a real slice of the enemy host, scaled by the fraction.
      const types = Object.keys(o.targetForce)
      expect(types.length).toBeGreaterThan(0)
      for (const [type, n] of Object.entries(o.targetForce)) {
        expect(enemyArmy[type]).toBeGreaterThan(0)
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(Math.ceil(enemyArmy[type] * RAID_TARGET_FRACTION * 1.4) + 1)
      }
      expect(RAID_STRENGTH_BANDS.map((b) => b.label)).toContain(o.strengthBand)
      expect(o.capacity).toBeGreaterThan(0)
      expect(o.resolved).toBe(false)
      expect(o.outcome).toBeNull()
    }
    expect(ids.size).toBe(opportunities.length)
  })

  test('counter_event never generates without a bad sealed fate', () => {
    for (let i = 0; i < 10; i++) {
      const opportunities = generateRaidOpportunities(fakeCampaign(), catalog, 'Overwhelming')
      expect(opportunities.every((o) => o.type !== 'counter_event')).toBe(true)
    }
  })

  test('a bad sealed fate yields exactly one counter_event pointing at it (hidden)', () => {
    const campaign = fakeCampaign({
      augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    for (let i = 0; i < 10; i++) {
      const counters = generateRaidOpportunities(campaign, catalog, 'Overwhelming')
        .filter((o) => o.type === 'counter_event')
      expect(counters).toHaveLength(1)
      expect(counters[0].reward).toEqual({ slot: 2 })
    }
  })

  // Playtest fix 2026-07-18: a coming blow ADDS a chance to unmake it — the
  // counter_event rides ON TOP of the scouting-band count, it never eats a
  // plundering target (before, it replaced one, so a bad-fate day at Contested
  // still showed only 2 targets — the "again only 2" complaint).
  test('a bad sealed fate ADDS the counter_event on top of the band count (additive)', () => {
    const campaign = fakeCampaign({
      augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    for (const band of SCOUTING_BANDS) {
      const opps = generateRaidOpportunities(campaign, catalog, band)
      expect(opps).toHaveLength(RAID_OPPORTUNITIES_PER_DAY[band] + 1)
      expect(opps.filter((o) => o.type === 'counter_event')).toHaveLength(1)
    }
  })
})

// ── The launch route ─────────────────────────────────────────────────────────
describe('POST /api/campaigns/:id/raids/launch (batch)', () => {
  test('a fresh campaign carries public opportunities; the target slice stays in the DB', async () => {
    const res = await createCampaign()
    expect(res.status).toBe(201)
    // Turn-1 default band is Contested (see campaigns.test.js). A freshly drawn
    // augury may seal a bad fate, which now ADDS a counter_event on top.
    const opps = res.body.raid.opportunities
    const counters = opps.filter((o) => o.type === 'counter_event').length
    expect(opps).toHaveLength(RAID_OPPORTUNITIES_PER_DAY.Contested + counters)
    expectPublicOpportunities(res.body)
    const doc = await Campaign.findById(res.body.id)
    for (const o of doc.raid.opportunities) {
      expect(o.targetForce.size).toBeGreaterThan(0)
      expect(o.id).toMatch(/^d1-/)
    }
  })

  test('runs a short auto-placed battle through the one pipeline and applies the loot', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', { Soldier: 10 })
    expect(res.status).toBe(201)
    expect(res.body.results).toEqual([expect.objectContaining({ raidId: 'd1-0', winner: 'blue' })])
    expectPublicOpportunities(res.body)

    // Both sides auto-placed in their own zones; a short battle, no walls.
    const input = engine.runBattle.mock.calls[0][0]
    expect(input.map).toBe('sample_battle')
    expect(input.max_turns).toBe(RAID_MAX_TURNS)
    expect(input.fortified_sides).toBeUndefined()
    expect(input.player_placement).toHaveLength(10)
    for (const p of input.player_placement) {
      expect(p.unit_type).toBe('Soldier')
      expect(p.r).toBeGreaterThanOrEqual(infoFixture.playerZone.rowMin)
      expect(p.r).toBeLessThanOrEqual(infoFixture.playerZone.rowMax)
    }
    expect(input.enemy_placement).toHaveLength(5)
    for (const p of input.enemy_placement) {
      expect(p.r).toBeGreaterThanOrEqual(infoFixture.enemyZone.rowMin)
      expect(p.r).toBeLessThanOrEqual(infoFixture.enemyZone.rowMax)
    }

    // Party replaced by survivors (fixture: 2 of 10 come back), loot applied.
    expect(res.body.campaign.roster.Soldier).toBe(300 - 10 + 2)
    expect(res.body.campaign.resources.food).toBe(50000 + 3000)
    expect(res.body.campaign.resources.materials).toBe(200 + 20)

    // Resolved, and the replay is the reveal.
    const [opportunity] = res.body.campaign.raid.opportunities
    expect(opportunity.resolved).toBe(true)
    expect(opportunity.outcome).toEqual({ winner: 'blue', battleId: res.body.results[0].id })
    expect(res.body.campaign.battles).toContain(res.body.results[0].id)

    // The enemy host was NOT pre-subtracted for a loot raid.
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540)
  })

  test('party capacity is enforced (Σ size × (40 − speed) / 40 ≤ capacity)', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ capacity: 100 })])
    // Soldiers (speed 10) cost 7.5 each: 14 cost 105 > 100; 13 cost 97.5 would fit.
    const res = await launch(c.id, 'd1-0', { Soldier: 14 })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/capacity/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('the party must come from the roster, minus foragers', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    expect((await launch(c.id, 'd1-0', { Soldier: 9999 })).status).toBe(400)

    await auth(api.post(`/api/campaigns/${c.id}/forage`)).send({ assignment: { Soldier: 295 } })
    const res = await launch(c.id, 'd1-0', { Soldier: 10 }) // 300 − 295 = 5 in camp
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/out foraging/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('rejects malformed, empty, and non-placeable parties', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    expect((await launch(c.id, 'd1-0', undefined)).status).toBe(400)
    expect((await launch(c.id, 'd1-0', {})).status).toBe(400)
    expect((await launch(c.id, 'd1-0', { Soldier: 1.5 })).status).toBe(400)
    expect((await launch(c.id, 'd1-0', { Soldier: -1 })).status).toBe(400)
    expect((await launch(c.id, 'd1-0', { Zombie: 2 })).status).toBe(400)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('404 for an unknown opportunity, 400 for a resolved one', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    expect((await launch(c.id, 'nope', { Soldier: 1 })).status).toBe(404)
    expect((await launch(c.id, 'd1-0', { Soldier: 10 })).status).toBe(201)
    const again = await launch(c.id, 'd1-0', { Soldier: 10 })
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/resolved/)
  })

  test('destroy_detachment: a win subtracts the target force from the hidden host', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 200,
    })])
    expect((await launch(c.id, 'd1-0', { Soldier: 20 })).status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 30)
    expect(doc.enemy.army.get('Archer')).toBe(150 - 10)
  })

  test('rescue_troops: a win adds the freed prisoners to the roster', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ type: 'rescue_troops', reward: { roster: { Soldier: 15 } } })])
    const res = await launch(c.id, 'd1-0', { Soldier: 10 })
    expect(res.status).toBe(201)
    expect(res.body.campaign.roster.Soldier).toBe(300 - 10 + 2 + 15)
  })

  test('counter_event: a win counters the slot; end-day skips the blow and reports it', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await shrinkRoster(c.id, { Soldier: 10 })
    await pinAugury(c.id, BAD_FATE)
    await pinRaid(c.id, [OPP({ type: 'counter_event', reward: { slot: 0 } })])

    expect((await launch(c.id, 'd1-0', { Soldier: 2 })).status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[0].countered).toBe(true)
    expect(doc.augury.slots[1].countered).toBe(false)

    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    // Slot 0 is unmade; slots 1–2 land in full. Roster after the raid is
    // back to 10 (2 fielded, 2 survivors), eating 10 × 28 = 280 kg.
    expect(res.body.report.augury[0].countered).toBe(true)
    expect(res.body.report.augury[1].countered).toBe(false)
    expect(res.body.campaign.resources.food).toBe(50000 - 2 * 999 - 280)
    expect(res.body.report.entries.join(' ')).toMatch(/Averted/)
  })

  test('a lost raid resolves the opportunity with no reward', async () => {
    const lost = structuredClone(battleResultFixture)
    lost.winner = 'red'
    lost.blue_survivors = {}
    engine.runBattle.mockResolvedValue(lost)
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', { Soldier: 10 })
    expect(res.status).toBe(201)
    expect(res.body.campaign.roster.Soldier).toBe(290) // the party is lost
    expect(res.body.campaign.resources.food).toBe(50000) // no loot
    expect(res.body.campaign.resources.materials).toBe(200)
    const [opportunity] = res.body.campaign.raid.opportunities
    expect(opportunity.resolved).toBe(true)
    expect(opportunity.outcome.winner).toBe('red')
  })

  test('end-day deals a fresh set of opportunities for the new turn', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, QUIET)
    const res = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(res.status).toBe(200)
    const opportunities = res.body.campaign.raid.opportunities
    expect(opportunities.length).toBeGreaterThan(0)
    for (const o of opportunities) {
      expect(o.id).toMatch(/^d2-/)
      expect(o.resolved).toBe(false)
    }
  })

  test('tomorrow\'s opportunity count follows tomorrow\'s scouting band', async () => {
    const pinArmies = async (id, { roster, enemyArmy }) => {
      const doc = await Campaign.findById(id)
      if (roster) doc.roster = new Map(Object.entries(roster))
      if (enemyArmy) doc.enemy.army = new Map(Object.entries(enemyArmy))
      await doc.save()
    }
    // end-day redraws a RANDOM augury for tomorrow (step 7) — pinning today's
    // fates doesn't control it, so a bad fate may seal and add a counter_event
    // on top. Count the band's openings plus whatever counter rode along.
    const bandCount = (opps, band) =>
      opps.length - opps.filter((o) => o.type === 'counter_event').length === RAID_OPPORTUNITIES_PER_DAY[band]
    // Blind (player 0.30 vs enemy 0.85 — see campaigns.test.js 1b): one raid.
    // 150 riders keep the pinned host above the withdraw threshold (0.2 ×
    // the CREATION initialStrength of 721) so the campaign survives step 6.
    const { body: blind } = await createCampaign()
    await pinAugury(blind.id, QUIET)
    await pinArmies(blind.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 150 } })
    const resBlind = await auth(api.post(`/api/campaigns/${blind.id}/end-day`)).send({})
    expect(bandCount(resBlind.body.campaign.raid.opportunities, 'Blind')).toBe(true)

    // Overwhelming (ratio 2.83): three raids.
    const { body: over } = await createCampaign()
    await pinAugury(over.id, QUIET)
    await pinArmies(over.id, { enemyArmy: { Zombie: 450, LightCavalry: 10 } })
    const resOver = await auth(api.post(`/api/campaigns/${over.id}/end-day`)).send({})
    expect(bandCount(resOver.body.campaign.raid.opportunities, 'Overwhelming')).toBe(true)
  })
})

// ── Double-assignment (playtest finding, 2026-07-15) ─────────────────────────
// Troops can't join two raids the same day: neither by overlapping within one
// batch, nor across separate batch calls the same turn. The frontend clamps
// its own party-builder against a shared pool, but these hit the route
// directly — a hostile or buggy client must be denied exactly the same way.
describe('raid double-assignment is rejected (server-side, not just the UI)', () => {
  test('one batch cannot double-book the same troops across two raids', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      OPP({ id: 'd1-0', capacity: 5000 }),
      OPP({ id: 'd1-1', capacity: 5000 }),
    ])

    // 300 Soldiers in the roster; 200 + 150 = 350 requested across the batch.
    const res = await launchBatch(c.id, { 'd1-0': { Soldier: 200 }, 'd1-1': { Soldier: 150 } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not enough Soldier in the roster/)
    expect(engine.runBattle).not.toHaveBeenCalled()

    // Nothing was applied: both opportunities are still open, roster intact.
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities.every((o) => !o.resolved)).toBe(true)
    expect(doc.roster.get('Soldier')).toBe(300)
    expect(doc.raid.assignment.size).toBe(0)
  })

  test('a later, separate batch is rejected against troops an earlier batch already committed', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      OPP({ id: 'd1-0', capacity: 5000 }),
      OPP({ id: 'd1-1', capacity: 5000 }),
    ])

    // First raid alone is well within the 300-Soldier roster.
    const first = await launchBatch(c.id, { 'd1-0': { Soldier: 250 } })
    expect(first.status).toBe(201)
    expect(first.body.campaign.raid.assignment).toEqual({ Soldier: 250 })

    // Roster still shows 300 − 250 + 2 survivors = 52 available — but the
    // SECOND raid asks for 60, which the roster alone would allow were it
    // not for the 250 already committed to the first raid today.
    expect(first.body.campaign.roster.Soldier).toBe(52)
    const second = await launchBatch(c.id, { 'd1-1': { Soldier: 60 } })
    expect(second.status).toBe(400)
    expect(second.body.error).toMatch(/already committed to a raid today/)
    expect(engine.runBattle).toHaveBeenCalledTimes(1) // only the first raid ran

    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities.find((o) => o.id === 'd1-1').resolved).toBe(false)
  })

  test('raid.assignment clears at day rollover, freeing yesterday\'s raiders', async () => {
    engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))
    const { body: c } = await createCampaign()
    await pinAugury(c.id, QUIET)
    await pinRaid(c.id, [OPP({ id: 'd1-0', capacity: 5000 })])

    const day1 = await launchBatch(c.id, { 'd1-0': { Soldier: 250 } })
    expect(day1.status).toBe(201)
    expect(day1.body.campaign.roster.Soldier).toBe(52) // 300 − 250 + 2 survivors

    const endDay = await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    expect(endDay.body.campaign.raid.assignment).toEqual({})

    // The 52 remaining Soldiers can raid again today — if assignment hadn't
    // reset, 52 available minus a stale 250 committed would still reject.
    await pinRaid(c.id, [OPP({ id: 'd2-0', capacity: 5000 })])
    const day2 = await launchBatch(c.id, { 'd2-0': { Soldier: 52 } })
    expect(day2.status).toBe(201)
  })
})
