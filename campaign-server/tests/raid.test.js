import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { clearRolls } from '../utils/dice.js'

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
const { generateRaidOpportunities, revealField, addScoutedTarget } = await import(
  '../services/raid.js'
)
const { raidCapacityCost } = await import('../utils/capabilities.js')
const {
  RAID_BASE_TARGETS,
  RAID_TARGET_FRACTION,
  RAID_MAX_TURNS,
  RAID_STRENGTH_BANDS,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
  METER_REVEAL_SCOUT_COST,
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

// What an opportunity looks like on the wire (scouting mini-game, Stage 4
// Part 2.5): `enemy` and `reward` carry per-type RANGES until points buy the
// exact value; the raw hidden `targetForce` Map field name never crosses, and
// a counter_event's reward.slot (which would out the bad fate) stays null on
// the wire since its reward has no numeric range to reveal.
const PUBLIC_OPPORTUNITY_KEYS = [
  'capacity', 'description', 'enemy', 'enemyReveal', 'id', 'outcome',
  'resolved', 'reward', 'rewardReveal', 'source', 'strengthBand', 'title', 'type',
]
const RAID_TYPES = ['destroy_detachment', 'loot_supplies', 'rescue_troops', 'counter_event']

const expectPublicOpportunities = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('"targetForce"')
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

  test('a quiet augury deals exactly RAID_BASE_TARGETS base target(s), no counters', () => {
    const opps = generateRaidOpportunities(fakeCampaign(), catalog)
    expect(opps).toHaveLength(RAID_BASE_TARGETS)
    expect(opps.every((o) => o.source === 'base')).toBe(true)
    expect(opps.every((o) => o.type !== 'counter_event')).toBe(true)
  })

  test('every opportunity ships per-type enemy ranges + reward range, reveals start hidden (0)', () => {
    const campaign = fakeCampaign({
      augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    for (const o of generateRaidOpportunities(campaign, catalog)) {
      expect(o.rewardReveal).toBe(0)
      expect(o.enemyReveal).toBe(0)
      // Per-type enemy ranges bracket the hidden slice (never one headcount).
      for (const [type, n] of Object.entries(o.targetForce)) {
        const [lo, hi] = o.enemyRange[type]
        expect(lo).toBeLessThanOrEqual(n)
        expect(hi).toBeGreaterThanOrEqual(n)
      }
      // A numeric reward has a bracketing range; counter/destroy have none.
      if (o.reward && typeof o.reward.food === 'number') {
        const [lo, hi] = o.rewardRange.food
        expect(lo).toBeLessThanOrEqual(o.reward.food)
        expect(hi).toBeGreaterThanOrEqual(o.reward.food)
      } else if (o.type === 'counter_event' || o.type === 'destroy_detachment') {
        expect(o.rewardRange).toBeNull()
      }
    }
  })

  test('opportunities are complete: id, type, hidden target slice, band phrase, capacity', () => {
    const opportunities = generateRaidOpportunities(fakeCampaign(), catalog)
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
      const opportunities = generateRaidOpportunities(fakeCampaign(), catalog)
      expect(opportunities.every((o) => o.type !== 'counter_event')).toBe(true)
    }
  })

  test('a bad sealed fate yields exactly one counter_event pointing at it (hidden)', () => {
    const campaign = fakeCampaign({
      augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    for (let i = 0; i < 10; i++) {
      const counters = generateRaidOpportunities(campaign, catalog).filter(
        (o) => o.type === 'counter_event',
      )
      expect(counters).toHaveLength(1)
      expect(counters[0].reward).toEqual({ slot: 2 })
      expect(counters[0].source).toBe('counter_event')
    }
  })

  // 2026-07-20: a counter now rides on top of the base target(s), and there is
  // ONE per sealed bad fate (was one total) — each coming blow gets its own
  // chance to be unmade, naming its own slot.
  test('each bad sealed fate ADDS its own counter_event on top of the base target(s)', () => {
    const oneBad = fakeCampaign({
      augury: { slots: [{ trueEvent: QUIET }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    const opps1 = generateRaidOpportunities(oneBad, catalog)
    expect(opps1).toHaveLength(RAID_BASE_TARGETS + 1)
    expect(opps1.filter((o) => o.type === 'counter_event')).toHaveLength(1)

    const twoBad = fakeCampaign({
      augury: { slots: [{ trueEvent: BAD_FATE }, { trueEvent: QUIET }, { trueEvent: BAD_FATE }] },
    })
    const opps2 = generateRaidOpportunities(twoBad, catalog)
    expect(opps2).toHaveLength(RAID_BASE_TARGETS + 2)
    const counters = opps2.filter((o) => o.type === 'counter_event')
    expect(counters).toHaveLength(2)
    // One per fate, each naming its own slot (0 and 2).
    expect(new Set(counters.map((c) => c.reward.slot))).toEqual(new Set([0, 2]))
  })

  test('revealField pins one field to exact once, then refuses; fields independent', () => {
    const [o] = generateRaidOpportunities(fakeCampaign(), catalog)
    expect(o.enemyReveal).toBe(0)
    expect(revealField(o, 'enemy')).toBe(true)
    expect(o.enemyReveal).toBe(1)
    expect(revealField(o, 'enemy')).toBe(false) // already exact
    expect(o.enemyReveal).toBe(1)
    expect(o.rewardReveal).toBe(0) // untouched — the two are independent
  })

  test('addScoutedTarget appends a scouted target continuing the id sequence', () => {
    const campaign = fakeCampaign()
    campaign.raid = { opportunities: generateRaidOpportunities(campaign, catalog) }
    const before = campaign.raid.opportunities.length
    const added = addScoutedTarget(campaign, catalog)
    expect(added.source).toBe('scouted')
    expect(campaign.raid.opportunities).toHaveLength(before + 1)
    expect(added.id).toBe(`d1-${before}`)
  })
})

// ── The launch route ─────────────────────────────────────────────────────────
describe('POST /api/campaigns/:id/raids/launch (batch)', () => {
  test('a fresh campaign carries public opportunities; the target slice stays in the DB', async () => {
    const res = await createCampaign()
    expect(res.status).toBe(201)
    // The board opens with RAID_BASE_TARGETS base target(s); a freshly drawn
    // augury may seal bad fates, each ADDING one counter_event on top.
    const opps = res.body.raid.opportunities
    const counters = opps.filter((o) => o.type === 'counter_event').length
    expect(opps).toHaveLength(RAID_BASE_TARGETS + counters)
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

  test('destroy_detachment: a LOSS still inflicts its real casualties on the hidden host', async () => {
    // Stage D: the mini-battle's actual dead (targetForce − red_survivors) are
    // subtracted even when the raid is lost — no reward, but real attrition.
    const lost = structuredClone(battleResultFixture)
    lost.winner = 'red'
    lost.blue_survivors = { Soldier: 1 }
    lost.red_survivors = { Soldier: 20, Archer: 5 } // 10 Soldier + 5 Archer fell
    engine.runBattle.mockResolvedValue(lost)

    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 200,
    })])

    const res = await launch(c.id, 'd1-0', { Soldier: 20 })
    expect(res.status).toBe(201)
    expect(res.body.results[0].winner).toBe('red')

    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 10) // 30 sent − 20 survived
    expect(doc.enemy.army.get('Archer')).toBe(150 - 5)   // 10 sent − 5 survived
    expect(doc.raid.opportunities[0].resolved).toBe(true)
    // A loss runs no reward path — no "wiped out"/"prestigious" lines.
    const allEntries = doc.log.flatMap((l) => l.entries)
    expect(allEntries.some((e) => /wiped out|prestig/i.test(e))).toBe(false)
  })

  test('destroy_detachment: a WIN with survivors pursues the remainder — whole slice gone, plus a prestige stub', async () => {
    // Casualties booked at the launch site (targetForce − survivors), then
    // applyRaidReward pursues the surviving remainder — the two together remove
    // the whole targetForce, matching the old all-or-nothing win number.
    const won = structuredClone(battleResultFixture)
    won.winner = 'blue'
    won.blue_survivors = { Soldier: 2 }
    won.red_survivors = { Soldier: 12, Archer: 4 } // survived the fight, then pursued
    engine.runBattle.mockResolvedValue(won)

    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 200,
    })])

    const res = await launch(c.id, 'd1-0', { Soldier: 20 })
    expect(res.status).toBe(201)

    const doc = await Campaign.findById(c.id)
    // 540 − (30−12 casualties) − 12 pursued = 540 − 30; likewise Archer.
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 30)
    expect(doc.enemy.army.get('Archer')).toBe(150 - 10)
    const allEntries = doc.log.flatMap((l) => l.entries)
    expect(allEntries.some((e) => /prestig/i.test(e))).toBe(true)
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

  test('tomorrow deals the base board + a points pool scaled to the roster', async () => {
    const pinArmies = async (id, { roster, enemyArmy }) => {
      const doc = await Campaign.findById(id)
      if (roster) doc.roster = new Map(Object.entries(roster))
      if (enemyArmy) doc.enemy.army = new Map(Object.entries(enemyArmy))
      await doc.save()
    }
    // Base board = opportunities minus whatever counter_event a freshly redrawn
    // augury sealed on. Count follows RAID_BASE_TARGETS now, not the band.
    const baseBoard = (opps) =>
      opps.length - opps.filter((o) => o.type === 'counter_event').length

    // Scout-LIGHT roster (Priests). 150 riders keep the pinned host above the
    // withdraw threshold so the campaign survives step 6. scoutingPoints is read
    // off the DB doc — campaignView exposure lands in stage 2.
    const { body: light } = await createCampaign()
    await pinAugury(light.id, QUIET)
    await pinArmies(light.id, { roster: { Priest: 100 }, enemyArmy: { LightCavalry: 150 } })
    await auth(api.post(`/api/campaigns/${light.id}/end-day`)).send({})
    const docLight = await Campaign.findById(light.id)
    expect(baseBoard(docLight.raid.opportunities)).toBe(RAID_BASE_TARGETS)
    expect(docLight.raid.scoutingPoints).toBeGreaterThan(0)

    // Scout-HEAVY roster (LightCavalry: reconTag +4, fast) → a bigger pool.
    const { body: heavy } = await createCampaign()
    await pinAugury(heavy.id, QUIET)
    await pinArmies(heavy.id, { roster: { LightCavalry: 100 }, enemyArmy: { Zombie: 450, LightCavalry: 10 } })
    await auth(api.post(`/api/campaigns/${heavy.id}/end-day`)).send({})
    const docHeavy = await Campaign.findById(heavy.id)
    expect(baseBoard(docHeavy.raid.opportunities)).toBe(RAID_BASE_TARGETS)
    expect(docHeavy.raid.scoutingPoints).toBeGreaterThan(docLight.raid.scoutingPoints)
  })
})

// ── The scout route (raid mini-game, Stage 4 Part 2.5) ───────────────────────
// Spend the per-turn scouting-points pool to shape the board: add_target scouts
// a new target; reveal pins a target's enemy/reward from a range to the exact
// value. The view shows ranges pre-reveal, exact post-reveal, and NEVER the
// hidden ground truth beyond what a paid reveal licenses.
describe('POST /api/campaigns/:id/raids/scout', () => {
  const scout = (id, body) => auth(api.post(`/api/campaigns/${id}/raids/scout`)).send(body)
  const getView = (id) => auth(api.get(`/api/campaigns/${id}`))
  const setPoints = async (id, n) => {
    const doc = await Campaign.findById(id)
    doc.raid.scoutingPoints = n
    await doc.save()
  }
  // A pinned loot target carrying explicit ranges that bracket the hidden truth,
  // so a reveal's exact value is assertable against a known number.
  const REVEALABLE = (over = {}) => ({
    ...OPP(),
    targetForce: { Soldier: 5, Archer: 2 },
    enemyRange: { Soldier: [4, 7], Archer: [1, 3] },
    reward: { food: 3000, materials: 20 },
    rewardRange: { food: [2250, 3750], materials: [15, 25] },
    rewardReveal: 0,
    enemyReveal: 0,
    source: 'base',
    ...over,
  })

  test('add_target: appends a scouted target and spends the cost', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    await setPoints(c.id, RAID_SCOUT_COST_ADD + 1)
    const res = await scout(c.id, { action: 'add_target' })
    expect(res.status).toBe(201)
    const opps = res.body.campaign.raid.opportunities
    expect(opps).toHaveLength(2)
    const added = opps.find((o) => o.source === 'scouted')
    expect(added).toBeTruthy()
    expect(res.body.campaign.raid.scoutingPoints).toBe(1)
    expectPublicOpportunities(res.body)
  })

  test('add_target: rejects when the pool cannot cover the cost (no target added)', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    await setPoints(c.id, RAID_SCOUT_COST_ADD - 1)
    const res = await scout(c.id, { action: 'add_target' })
    expect(res.status).toBe(400)
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities).toHaveLength(1)
    expect(doc.raid.scoutingPoints).toBe(RAID_SCOUT_COST_ADD - 1) // unspent
  })

  test('add_target: rejects when the enemy host is exhausted (nothing to scout)', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.enemy.army = new Map() // host wiped — no slice can be cut
    doc.raid.opportunities = [OPP()]
    doc.raid.scoutingPoints = RAID_SCOUT_COST_ADD
    await doc.save()
    const res = await scout(c.id, { action: 'add_target' })
    expect(res.status).toBe(400)
    const after = await Campaign.findById(c.id)
    expect(after.raid.opportunities).toHaveLength(1)
    expect(after.raid.scoutingPoints).toBe(RAID_SCOUT_COST_ADD) // unspent
  })

  test('reveal enemy: pins per-type counts to the exact truth, independent of reward', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [REVEALABLE()])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL + 5)

    const before = (await getView(c.id)).body.raid.opportunities[0]
    expect(before.enemy).toEqual({ Soldier: [4, 7], Archer: [1, 3] }) // range
    expect(before.enemyReveal).toBe(0)

    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'enemy' })
    expect(res.status).toBe(201)
    const o = res.body.campaign.raid.opportunities[0]
    expect(o.enemy).toEqual({ Soldier: 5, Archer: 2 }) // exact hidden truth
    expect(o.enemyReveal).toBe(1)
    expect(o.reward).toEqual({ food: [2250, 3750], materials: [15, 25] }) // untouched
    expect(o.rewardReveal).toBe(0)
    expect(res.body.campaign.raid.scoutingPoints).toBe(5)
    expectPublicOpportunities(res.body)
  })

  test('reveal reward: pins numeric reward to the exact truth', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [REVEALABLE()])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL)
    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'reward' })
    expect(res.status).toBe(201)
    const o = res.body.campaign.raid.opportunities[0]
    expect(o.reward).toEqual({ food: 3000, materials: 20 })
    expect(o.rewardReveal).toBe(1)
  })

  test('reveal: refuses to spend again once a field is exact', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [REVEALABLE({ enemyReveal: 1 })])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL)
    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'enemy' })
    expect(res.status).toBe(400)
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.scoutingPoints).toBe(RAID_SCOUT_COST_REVEAL) // unspent
  })

  test('reveal: rejects when the pool cannot cover the cost', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [REVEALABLE()])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL - 1)
    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'enemy' })
    expect(res.status).toBe(400)
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities[0].enemyReveal).toBe(0) // not revealed
  })

  test('reveal reward: a slot-only counter_event reward has nothing to reveal', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      REVEALABLE({ type: 'counter_event', reward: { slot: 1 }, rewardRange: null }),
    ])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL)
    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'reward' })
    expect(res.status).toBe(400)
    // The bad-fate slot never leaks — reward stays null on the wire either way.
    const view = (await getView(c.id)).body.raid.opportunities[0]
    expect(view.reward).toBeNull()
    expect(JSON.stringify(view)).not.toContain('slot')
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.scoutingPoints).toBe(RAID_SCOUT_COST_REVEAL) // unspent
  })

  test('reveal: 404 unknown target, 400 resolved, 400 bad field', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [REVEALABLE(), REVEALABLE({ id: 'd1-1', resolved: true })])
    await setPoints(c.id, 99)
    expect((await scout(c.id, { action: 'reveal', raidId: 'nope', field: 'enemy' })).status).toBe(404)
    expect((await scout(c.id, { action: 'reveal', raidId: 'd1-1', field: 'enemy' })).status).toBe(400)
    expect((await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'terrain' })).status).toBe(400)
  })

  // ── Stage C: buy the exact boss-fight meter value with leftover points ──
  const setMeter = async (id, value) => {
    const doc = await Campaign.findById(id)
    doc.meter.value = value
    await doc.save()
  }

  test('reveal_meter: spends points and pins the exact meter value (band only until then)', async () => {
    const { body: c } = await createCampaign()
    await setMeter(c.id, 500)
    await setPoints(c.id, METER_REVEAL_SCOUT_COST + 2)

    // Pre-reveal the wire carries only the band, never the number.
    const before = (await getView(c.id)).body.meter
    expect(before.revealed).toBe(false)
    expect(before.value).toBeNull()
    expect(typeof before.band).toBe('string')

    const res = await scout(c.id, { action: 'reveal_meter' })
    expect(res.status).toBe(201)
    expect(res.body.campaign.meter.revealed).toBe(true)
    expect(res.body.campaign.meter.value).toBe(500) // exact truth now visible
    expect(res.body.campaign.raid.scoutingPoints).toBe(2)
  })

  test('reveal_meter: rejects when the pool cannot cover the cost (unspent, still hidden)', async () => {
    const { body: c } = await createCampaign()
    await setMeter(c.id, 500)
    await setPoints(c.id, METER_REVEAL_SCOUT_COST - 1)
    const res = await scout(c.id, { action: 'reveal_meter' })
    expect(res.status).toBe(400)
    const doc = await Campaign.findById(c.id)
    expect(doc.meter.revealed).toBe(false)
    expect(doc.raid.scoutingPoints).toBe(METER_REVEAL_SCOUT_COST - 1) // unspent
  })

  test('reveal_meter: refuses to spend again once revealed this turn', async () => {
    const { body: c } = await createCampaign()
    const doc = await Campaign.findById(c.id)
    doc.meter.revealed = true
    await doc.save()
    await setPoints(c.id, METER_REVEAL_SCOUT_COST)
    const res = await scout(c.id, { action: 'reveal_meter' })
    expect(res.status).toBe(400)
    const after = await Campaign.findById(c.id)
    expect(after.raid.scoutingPoints).toBe(METER_REVEAL_SCOUT_COST) // unspent
  })

  test('reveal_meter: the reveal lapses at the next turn (band again until re-bought)', async () => {
    const { body: c } = await createCampaign()
    await setMeter(c.id, 500)
    await setPoints(c.id, METER_REVEAL_SCOUT_COST)
    await scout(c.id, { action: 'reveal_meter' })
    expect((await Campaign.findById(c.id)).meter.revealed).toBe(true)

    await auth(api.post(`/api/campaigns/${c.id}/end-day`)).send({})
    const after = await Campaign.findById(c.id)
    expect(after.meter.revealed).toBe(false)
    expect((await getView(c.id)).body.meter.value).toBeNull()
  })

  test('an unknown action is rejected', async () => {
    const { body: c } = await createCampaign()
    await setPoints(c.id, 99)
    expect((await scout(c.id, { action: 'wat' })).status).toBe(400)
    expect((await scout(c.id, {})).status).toBe(400)
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
