import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { PUBLIC_OPPORTUNITY_KEYS } from './helpers/publicShape.js'
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
  GARRISON_RESOLVE_START,
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

// Ending the fortnight is the LAST phase's act: the route refuses a turn that
// hasn't been seen through (routes' rejectIfPhaseBefore), which is what makes a
// double submit impossible. A test that resolves a turn without walking the
// screens stamps the phase first — the same state Recruiting leaves behind.
const endTurn = async (id) => {
  await Campaign.findByIdAndUpdate(id, { phase: 'recruit' })
  return auth(api.post(`/api/campaigns/${id}/end-day`)).send({})
}
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
// PUBLIC_OPPORTUNITY_KEYS now lives in helpers/publicShape.js — campaigns.test.js
// pins the same list, and keeping two copies is what turned S3's one new field
// into 45 red tests across both suites.
const RAID_TYPES = [
  'destroy_detachment', 'loot_supplies', 'rescue_troops', 'counter_event', 'seize_horses',
]

const expectPublicOpportunities = (body) => {
  const raw = JSON.stringify(body)
  expect(raw).not.toContain('"targetForce"')
  for (const c of [body, body.campaign]) {
    for (const o of c?.raid?.opportunities ?? [])
      expect(Object.keys(o).sort()).toEqual(PUBLIC_OPPORTUNITY_KEYS)
  }
}

// A pinned opportunity so route tests control capacity/reward exactly. The
// default capacity (500) comfortably fits the starting 1st Cohort squad
// (40 Soldier × 7.5 = 300); tests that probe the cap pass a tighter one.
const OPP = (over = {}) => ({
  id: 'd1-0',
  type: 'loot_supplies',
  title: 'Supply Train',
  description: 'Laden wagons under light guard.',
  targetForce: { Soldier: 5 },
  strengthBand: 'a handful',
  capacity: 500,
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

const setSquads = async (id, squads) => {
  const doc = await Campaign.findById(id)
  doc.squads = squads
  await doc.save()
}

// A `./game battle` result shaped for squad-only raiding: `blue_squads` is the
// per-squad survivor breakdown the launch route reconciles each raided squad
// against (composition = survivors, disbanded if wiped). blue_survivors is
// derived from it so the flat roster reconciliation and the per-squad one stay
// consistent (the invariant loose = roster − Σ squads.composition).
const sumSurvivors = (squads) => {
  const acc = {}
  for (const s of Object.values(squads))
    for (const [t, n] of Object.entries(s.survivors ?? {})) acc[t] = (acc[t] ?? 0) + n
  return acc
}
const battleResult = ({
  winner = 'blue',
  blue_squads = { 1: { survivors: { Soldier: 30 }, wiped: false } },
  red_survivors = {},
} = {}) => {
  const r = structuredClone(battleResultFixture)
  r.winner = winner
  r.blue_squads = blue_squads
  r.blue_survivors = sumSurvivors(blue_squads)
  r.red_survivors = red_survivors
  return r
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
      // A numeric reward has a bracketing range; only counter_event (whose
      // reward is the {slot} it unmakes) has nothing to bracket.
      if (o.reward && typeof o.reward.food === 'number') {
        const [lo, hi] = o.rewardRange.food
        expect(lo).toBeLessThanOrEqual(o.reward.food)
        expect(hi).toBeGreaterThanOrEqual(o.reward.food)
      } else if (o.type === 'counter_event') {
        expect(o.rewardRange).toBeNull()
      }
      // Gold (Recruit phase's caster currency) is bracketed like any other
      // numeric reward — buying the reward field pins it.
      if (typeof o.reward?.gold === 'number') {
        const [lo, hi] = o.rewardRange.gold
        expect(lo).toBeLessThanOrEqual(o.reward.gold)
        expect(hi).toBeGreaterThanOrEqual(o.reward.gold)
      }
    }
  })

  // Raid gold (docs/CAMPAIGN_PLAN.md "Recruit phase" — new resource `gold`):
  // won destroy/loot raids pay coin, sized off the target but with wide
  // variance, so scouting can find a fat target under a weak guard.
  describe('gold reward', () => {
    // 200 draws of one base target each — enough for the distribution claims
    // below without leaning on a seeded RNG (generation uses Math.random by
    // design, so the dice queue stays free for consult/clash rolls).
    const sample = (over) => {
      const out = []
      for (let i = 0; i < 200; i++)
        out.push(...generateRaidOpportunities(fakeCampaign(over), catalog))
      return out
    }

    test('destroy_detachment and loot_supplies pay gold; rescue_troops does not', () => {
      const byType = {}
      for (const o of sample()) (byType[o.type] ??= []).push(o)
      for (const type of ['destroy_detachment', 'loot_supplies'])
        expect(byType[type].every((o) => typeof o.reward.gold === 'number' && o.reward.gold > 0)).toBe(true)
      expect(byType.rescue_troops.every((o) => o.reward.gold === undefined)).toBe(true)
      // Loot still pays its stores alongside the coin.
      expect(byType.loot_supplies.every((o) => o.reward.food > 0 && o.reward.materials > 0)).toBe(true)
    })

    test('gold tracks target size — a ten-times bigger host pays far more on average', () => {
      const mean = (opps) => {
        const gold = opps.filter((o) => o.reward?.gold).map((o) => o.reward.gold)
        return gold.reduce((a, b) => a + b, 0) / gold.length
      }
      const small = mean(sample({ enemy: { army: { Soldier: 60 } } }))
      const big = mean(sample({ enemy: { army: { Soldier: 600 } } }))
      expect(big).toBeGreaterThan(small * 5)
    })

    test('…but with enough variance that some targets are bargains and some are poor', () => {
      // Coin PER GUARD unit is what a scout is really judging. Same host, same
      // guard strength, wildly different payoffs — that spread is the point.
      const perUnit = sample({ enemy: { army: { Soldier: 600 } } })
        .filter((o) => o.reward?.gold)
        .map((o) => o.reward.gold / Object.values(o.targetForce).reduce((a, b) => a + b, 0))
      expect(Math.max(...perUnit) / Math.min(...perUnit)).toBeGreaterThan(2.5)
    })
  })

  // Horses (docs/CAMPAIGN_PLAN.md "Recruit phase" — the resource Cavalry and
  // LightCavalry hires SPEND, grilled 2026-08-03): a dedicated 4th card type,
  // "The Horse Drove" — a dealer's string of remounts under hired guard,
  // deliberately NOT the enemy's own cavalry, so it draws whatever the host is
  // made of. Same payout shape as gold (guards × rate × a wide independent
  // variance roll), so a fat herd under a thin guard is a real find.
  describe('horses reward (seize_horses)', () => {
    const sample = (over) => {
      const out = []
      for (let i = 0; i < 200; i++)
        out.push(...generateRaidOpportunities(fakeCampaign(over), catalog))
      return out
    }

    test('the drove is dealt from the ordinary pool like any other base target', () => {
      const types = new Set(sample().map((o) => o.type))
      expect(types.has('seize_horses')).toBe(true)
      // Ungated: it is not keyed to the enemy having mounted units, so a host
      // of pure infantry still offers it (the herd is a dealer's, not theirs).
      const footOnly = new Set(sample({ enemy: { army: { Soldier: 600 } } }).map((o) => o.type))
      expect(footOnly.has('seize_horses')).toBe(true)
    })

    test('only the drove pays horses, and it pays nothing else', () => {
      const byType = {}
      for (const o of sample()) (byType[o.type] ??= []).push(o)
      expect(byType.seize_horses.every((o) => typeof o.reward.horses === 'number' && o.reward.horses > 0)).toBe(true)
      // Horses ONLY — the card has one clean identity; loot is still the
      // food/materials card and destroy/loot are still the coin cards.
      expect(byType.seize_horses.every((o) => o.reward.food === undefined && o.reward.materials === undefined && o.reward.gold === undefined)).toBe(true)
      for (const type of ['destroy_detachment', 'loot_supplies', 'rescue_troops'])
        expect(byType[type].every((o) => o.reward.horses === undefined)).toBe(true)
    })

    test('the herd tracks the guard size — a ten-times bigger host pays far more', () => {
      const mean = (opps) => {
        const horses = opps.filter((o) => o.reward?.horses).map((o) => o.reward.horses)
        return horses.reduce((a, b) => a + b, 0) / horses.length
      }
      expect(mean(sample({ enemy: { army: { Soldier: 600 } } }))).toBeGreaterThan(
        mean(sample({ enemy: { army: { Soldier: 60 } } })) * 5,
      )
    })

    test('…but loosely, so scouting can find a bargain herd under a thin guard', () => {
      const perUnit = sample({ enemy: { army: { Soldier: 600 } } })
        .filter((o) => o.reward?.horses)
        .map((o) => o.reward.horses / Object.values(o.targetForce).reduce((a, b) => a + b, 0))
      expect(Math.max(...perUnit) / Math.min(...perUnit)).toBeGreaterThan(2.5)
    })

    test('the horse count is buyable intel: a range that brackets the truth', () => {
      const droves = sample().filter((o) => o.type === 'seize_horses')
      expect(droves.length).toBeGreaterThan(0)
      for (const o of droves) {
        const [lo, hi] = o.rewardRange.horses
        expect(lo).toBeLessThanOrEqual(o.reward.horses)
        expect(hi).toBeGreaterThanOrEqual(o.reward.horses)
      }
    })

    test('a hire is five horses, so a typical drove is worth a few of them', () => {
      const horses = sample().filter((o) => o.reward?.horses).map((o) => o.reward.horses)
      const mean = horses.reduce((a, b) => a + b, 0) / horses.length
      // Sized against the 5-horses-per-hire cost: several hires' worth on
      // average, never a single-card army.
      expect(mean).toBeGreaterThan(5)
      expect(mean).toBeLessThan(40)
    })
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
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    // The party is the 1st Cohort squad (id 1 = 40 Soldier), not a headcount.
    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.results).toEqual([expect.objectContaining({ raidId: 'd1-0', winner: 'blue' })])
    expectPublicOpportunities(res.body)

    // Both sides auto-placed in their own zones; a short battle, no walls. The
    // player's 40 Soldiers all carry the squad_id tag (→ blue_squads breakdown)
    // and — because the engine forms squads by (hex, squad_id) — all land on ONE
    // hex, so the party fights as the 1st Cohort instead of 40 loners.
    const input = engine.runBattle.mock.calls[0][0]
    expect(input.map).toBe('sample_battle')
    expect(input.max_turns).toBe(RAID_MAX_TURNS)
    expect(input.fortified_sides).toBeUndefined()
    expect(input.player_placement).toHaveLength(40)
    for (const p of input.player_placement) {
      expect(p.unit_type).toBe('Soldier')
      expect(p.squad_id).toBe(1)
      expect(p.squad_name).toBe('1st Cohort')
      expect(p.r).toBeGreaterThanOrEqual(infoFixture.playerZone.rowMin)
      expect(p.r).toBeLessThanOrEqual(infoFixture.playerZone.rowMax)
    }
    expect(new Set(input.player_placement.map((p) => `${p.q}|${p.r}`)).size).toBe(1)
    expect(input.enemy_placement).toHaveLength(5)
    for (const p of input.enemy_placement) {
      expect(p.r).toBeGreaterThanOrEqual(infoFixture.enemyZone.rowMin)
      expect(p.r).toBeLessThanOrEqual(infoFixture.enemyZone.rowMax)
    }

    // Roster reconciled by survivors (40 sent, 30 back) and the squad regrouped
    // to its survivors; loot applied.
    expect(res.body.campaign.roster.Soldier).toBe(300 - 40 + 30)
    expect(res.body.campaign.squads.find((s) => s.id === 1).composition).toEqual({ Soldier: 30 })
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

  test('a multi-squad party deploys one formation per squad, each on its own hex', async () => {
    engine.runBattle.mockResolvedValue(battleResult({
      blue_squads: {
        1: { survivors: { Soldier: 40 }, wiped: false },
        2: { survivors: { Archer: 30 }, wiped: false },
      },
    }))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ capacity: 2000 })])

    // 1st Cohort (40 Soldier) + Skirmishers (30 Archer) on one raid.
    expect((await launch(c.id, 'd1-0', [1, 2])).status).toBe(201)

    const { player_placement: placement } = engine.runBattle.mock.calls[0][0]
    expect(placement).toHaveLength(70)
    const hexesOf = (sid) =>
      new Set(placement.filter((p) => p.squad_id === sid).map((p) => `${p.q}|${p.r}`))
    // Each squad whole on one hex, and the two squads on different hexes: two
    // formations, not one blended stack and not 70 scattered loners.
    expect(hexesOf(1).size).toBe(1)
    expect(hexesOf(2).size).toBe(1)
    expect([...hexesOf(1)]).not.toEqual([...hexesOf(2)])
    expect(placement.filter((p) => p.squad_name === 'Skirmishers')).toHaveLength(30)
  })

  test('party capacity is enforced (Σ size × (40 − speed) / 40 ≤ capacity)', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ capacity: 200 })])
    // The 1st Cohort (40 Soldier × 7.5 = 300) blows past a 200 budget.
    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/capacity/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('rejects malformed, empty, non-array, and unknown-squad parties', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    expect((await launch(c.id, 'd1-0', undefined)).status).toBe(400)
    expect((await launch(c.id, 'd1-0', [])).status).toBe(400)          // empty
    expect((await launch(c.id, 'd1-0', { 1: true })).status).toBe(400) // not an array
    expect((await launch(c.id, 'd1-0', [1.5])).status).toBe(400)       // non-integer id
    expect((await launch(c.id, 'd1-0', [999])).status).toBe(400)       // not one of your squads
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('404 for an unknown opportunity, 400 for a resolved one', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    expect((await launch(c.id, 'nope', [1])).status).toBe(404)
    expect((await launch(c.id, 'd1-0', [1])).status).toBe(201)
    const again = await launch(c.id, 'd1-0', [1])
    expect(again.status).toBe(400)
    expect(again.body.error).toMatch(/resolved/)
  })

  test('destroy_detachment: a win subtracts the target force from the hidden host', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 500,
    })])
    expect((await launch(c.id, 'd1-0', [1])).status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 30)
    expect(doc.enemy.army.get('Archer')).toBe(150 - 10)
  })

  test('destroy_detachment: a LOSS still inflicts its real casualties on the hidden host', async () => {
    // Stage D: the mini-battle's actual dead (targetForce − red_survivors) are
    // subtracted even when the raid is lost — no reward, but real attrition.
    const lost = battleResult({
      winner: 'red',
      blue_squads: { 1: { survivors: { Soldier: 1 }, wiped: false } },
      red_survivors: { Soldier: 20, Archer: 5 }, // 10 Soldier + 5 Archer fell
    })
    engine.runBattle.mockResolvedValue(lost)

    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 500,
    })])

    const res = await launch(c.id, 'd1-0', [1])
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
    const won = battleResult({
      winner: 'blue',
      blue_squads: { 1: { survivors: { Soldier: 2 }, wiped: false } },
      red_survivors: { Soldier: 12, Archer: 4 }, // survived the fight, then pursued
    })
    engine.runBattle.mockResolvedValue(won)

    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: null,
      capacity: 500,
    })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)

    const doc = await Campaign.findById(c.id)
    // 540 − (30−12 casualties) − 12 pursued = 540 − 30; likewise Archer.
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 30)
    expect(doc.enemy.army.get('Archer')).toBe(150 - 10)
    const allEntries = doc.log.flatMap((l) => l.entries)
    expect(allEntries.some((e) => /prestig/i.test(e))).toBe(true)
  })

  // Raid gold (docs/CAMPAIGN_PLAN.md "Recruit phase"): the coin a won raid
  // brings back is what pays for Mages/Priests in the Recruit phase.
  test('a won destroy raid banks its gold and says so in the log', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({
        winner: 'blue',
        blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } },
        red_survivors: { Soldier: 5 },
      }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30 },
      reward: { gold: 35 },
      capacity: 500,
    })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.resources.gold).toBe(35)
    const entries = (await Campaign.findById(c.id)).log.flatMap((l) => l.entries)
    expect(entries.some((e) => /35 gold/.test(e))).toBe(true)
  })

  test('a won loot raid banks gold alongside the stores', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ reward: { food: 3000, materials: 20, gold: 18 } })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.resources.food).toBe(50000 + 3000)
    expect(res.body.campaign.resources.materials).toBe(200 + 20)
    expect(res.body.campaign.resources.gold).toBe(18)
  })

  // The horse drove (Stage E): the raid tap for the resource Cavalry and
  // LightCavalry hires spend.
  test('a won horse drove banks its horses and says so in the log', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ type: 'seize_horses', reward: { horses: 18 } })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.resources.horses).toBe(18)
    const entries = (await Campaign.findById(c.id)).log.flatMap((l) => l.entries)
    expect(entries.some((e) => /18 horses/.test(e))).toBe(true)
  })

  test('a lost horse drove banks none', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ winner: 'red', blue_squads: { 1: { survivors: {}, wiped: true } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ type: 'seize_horses', reward: { horses: 18 } })])
    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.resources.horses).toBe(0)
  })

  // The drove is loot-shaped, not destroy-shaped: its guard is a narrative
  // slice (hired swords watching a dealer's herd), so beating it never thins
  // the hidden enemy host.
  test('a won horse drove leaves the enemy host untouched', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({
        winner: 'blue',
        blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } },
        red_survivors: { Soldier: 2 },
      }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'seize_horses',
      targetForce: { Soldier: 30 },
      reward: { horses: 12 },
    })])
    await launch(c.id, 'd1-0', [1])
    expect((await Campaign.findById(c.id)).enemy.army.get('Soldier')).toBe(540)
  })

  test('a lost raid banks no gold', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ winner: 'red', blue_squads: { 1: { survivors: {}, wiped: true } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ reward: { food: 3000, materials: 20, gold: 18 } })])
    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.resources.gold).toBe(0)
  })

  test('rescue_troops: a win adds the freed prisoners to the roster', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ type: 'rescue_troops', reward: { roster: { Soldier: 15 } } })])
    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.roster.Soldier).toBe(300 - 40 + 30 + 15)
  })

  test('counter_event: a win counters the slot; end-day skips the blow and reports it', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 9: { survivors: { Soldier: 2 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    // A small pinned squad matching a shrunk roster so the food math stays exact.
    await setSquads(c.id, [{ id: 9, name: 'Outriders', composition: { Soldier: 2 } }])
    await shrinkRoster(c.id, { Soldier: 10 })
    await pinAugury(c.id, BAD_FATE)
    await pinRaid(c.id, [OPP({ type: 'counter_event', reward: { slot: 0 } })])

    expect((await launch(c.id, 'd1-0', [9])).status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.augury.slots[0].countered).toBe(true)
    expect(doc.augury.slots[1].countered).toBe(false)

    const res = await endTurn(c.id)
    expect(res.status).toBe(200)
    // Slot 0 is unmade; slots 1–2 land in full. Roster after the raid is
    // back to 10 (2 fielded, 2 survivors), eating 10 × 28 = 280 kg.
    expect(res.body.report.augury[0].countered).toBe(true)
    expect(res.body.report.augury[1].countered).toBe(false)
    expect(res.body.campaign.resources.food).toBe(50000 - 2 * 999 - 280)
    expect(res.body.report.entries.join(' ')).toMatch(/Averted/)
  })

  test('a lost raid resolves the opportunity with no reward', async () => {
    const lost = battleResult({
      winner: 'red',
      blue_squads: { 1: { survivors: {}, wiped: true } },
    })
    engine.runBattle.mockResolvedValue(lost)
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.campaign.roster.Soldier).toBe(300 - 40) // the whole party is lost
    // The wiped 1st Cohort is disbanded.
    expect(res.body.campaign.squads.find((s) => s.id === 1)).toBeUndefined()
    expect(res.body.campaign.resources.food).toBe(50000) // no loot
    expect(res.body.campaign.resources.materials).toBe(200)
    const [opportunity] = res.body.campaign.raid.opportunities
    expect(opportunity.resolved).toBe(true)
    expect(opportunity.outcome.winner).toBe('red')
  })

  test('end-day deals a fresh set of opportunities for the new turn', async () => {
    const { body: c } = await createCampaign()
    await pinAugury(c.id, QUIET)
    const res = await endTurn(c.id)
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
    await endTurn(light.id)
    const docLight = await Campaign.findById(light.id)
    expect(baseBoard(docLight.raid.opportunities)).toBe(RAID_BASE_TARGETS)
    expect(docLight.raid.scoutingPoints).toBeGreaterThan(0)

    // Scout-HEAVY roster (LightCavalry: reconTag +4, fast) → a bigger pool.
    const { body: heavy } = await createCampaign()
    await pinAugury(heavy.id, QUIET)
    await pinArmies(heavy.id, { roster: { LightCavalry: 100 }, enemyArmy: { Zombie: 450, LightCavalry: 10 } })
    await endTurn(heavy.id)
    const docHeavy = await Campaign.findById(heavy.id)
    expect(baseBoard(docHeavy.raid.opportunities)).toBe(RAID_BASE_TARGETS)
    expect(docHeavy.raid.scoutingPoints).toBeGreaterThan(docLight.raid.scoutingPoints)
  })
})

// ── Garrison sortie (Garrison Resolve slice 4) ───────────────────────────────
// A resolve-gated raid the garrison offers only once it trusts you. It rides the
// ordinary /raids/launch flow (party, capacity, battle, squad reconciliation,
// the raid.assignment carve-out) — what differs is the reward: a WON sally feeds
// the hidden resolve track (never a number in the log), and a thins-enemy
// version books its real casualties on the host like destroy_detachment.
describe('POST .../raids/launch — garrison sortie', () => {
  const SORTIE = (over = {}) =>
    OPP({
      type: 'garrison_sortie',
      title: 'A Coordinated Sally',
      source: 'garrison_sortie',
      targetForce: { Soldier: 30, Archer: 10 },
      reward: { resolve: 10 },
      thinsEnemy: true,
      capacity: 500,
      ...over,
    })

  test('a thins-enemy sortie: a win raises resolve (hidden) and inflicts real casualties', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({
        blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } },
        red_survivors: { Soldier: 20, Archer: 5 }, // 10 Soldier + 5 Archer fell
      }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [SORTIE()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expectPublicOpportunities(res.body) // thinsEnemy/reward.resolve never cross the wire

    const doc = await Campaign.findById(c.id)
    // Real casualties (targetForce − red_survivors), like destroy_detachment,
    // but NO pursuit of the remainder — a sortie is a spoiling attack.
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 10)
    expect(doc.enemy.army.get('Archer')).toBe(150 - 5)
    // Resolve rose by the reward; the number itself never shows in the log.
    expect(doc.garrison.resolve).toBe(GARRISON_RESOLVE_START + 10)
    const entries = doc.log.flatMap((l) => l.entries).join(' ')
    expect(entries).not.toMatch(/resolve/i)
    expect(entries).toMatch(/sally|Karrowgate/i)
    // The committed troops are carved out of the pitched-battle readiness check.
    expect(doc.raid.assignment.get('Soldier')).toBe(40)
  })

  test('a loot sortie: a win raises resolve and lands stores, host untouched', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      SORTIE({
        title: 'A Sortie Against the Siege Train',
        targetForce: { Soldier: 5 },
        reward: { resolve: 14, materials: 250 },
        thinsEnemy: false,
      }),
    ])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    const doc = await Campaign.findById(c.id)
    expect(doc.garrison.resolve).toBe(GARRISON_RESOLVE_START + 14)
    expect(doc.resources.materials).toBe(200 + 250)
    expect(doc.enemy.army.get('Soldier')).toBe(540) // a loot sortie never thins
  })

  test('a lost sortie awards no resolve, but a thins-enemy one still books real casualties', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({
        winner: 'red',
        blue_squads: { 1: { survivors: { Soldier: 1 }, wiped: false } },
        red_survivors: { Soldier: 25, Archer: 10 }, // 5 Soldier fell; no Archer
      }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [SORTIE()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(res.body.results[0].winner).toBe('red')

    const doc = await Campaign.findById(c.id)
    expect(doc.garrison.resolve).toBe(GARRISON_RESOLVE_START) // no reward on a loss
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 5) // 30 sent − 25 survived
    expect(doc.enemy.army.get('Archer')).toBe(150) // 10 sent − 10 survived = 0 dead
    // No win → no sally/loot lines.
    const entries = doc.log.flatMap((l) => l.entries).join(' ')
    expect(entries).not.toMatch(/stands the taller/i)
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

  // A destroy target's reward used to be null (nothing to buy); now it carries
  // gold, so it has a range on the wire and a reveal that pins it.
  test('reveal reward: a destroy target\'s gold shows as a range, then exact', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      REVEALABLE({ type: 'destroy_detachment', reward: { gold: 40 }, rewardRange: { gold: [30, 50] } }),
    ])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL)

    const before = (await getView(c.id)).body.raid.opportunities[0]
    expect(before.reward).toEqual({ gold: [30, 50] })

    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'reward' })
    expect(res.status).toBe(201)
    expect(res.body.campaign.raid.opportunities[0].reward).toEqual({ gold: 40 })
    expectPublicOpportunities(res.body)
  })

  // Horses are the drove's ONLY numeric reward, so without a range the card
  // would carry no buyable reward intel at all — the gap S5 closed on destroy.
  test('reveal reward: a horse drove\'s horses show as a range, then exact', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      REVEALABLE({ type: 'seize_horses', reward: { horses: 16 }, rewardRange: { horses: [12, 20] } }),
    ])
    await setPoints(c.id, RAID_SCOUT_COST_REVEAL)

    expect((await getView(c.id)).body.raid.opportunities[0].reward).toEqual({ horses: [12, 20] })

    const res = await scout(c.id, { action: 'reveal', raidId: 'd1-0', field: 'reward' })
    expect(res.status).toBe(201)
    expect(res.body.campaign.raid.opportunities[0].reward).toEqual({ horses: 16 })
    expectPublicOpportunities(res.body)
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

  // (Stage C's `reveal_meter` action was removed in recon R2 — the meter value
  // is now revealed gradually by the recon LEVEL, not bought per-turn. See
  // campaigns.test.js "recon numeric brackets (R2)".)

  test('an unknown action is rejected', async () => {
    const { body: c } = await createCampaign()
    await setPoints(c.id, 99)
    expect((await scout(c.id, { action: 'wat' })).status).toBe(400)
    expect((await scout(c.id, {})).status).toBe(400)
  })
})

// ── Double-assignment (playtest finding, 2026-07-15; squad-only 2026-07-21) ──
// A squad can't join two raids the same day: neither by appearing in two cards
// of one batch, nor across separate batch calls the same turn. The frontend
// locks its own picker, but these hit the route directly — a hostile or buggy
// client must be denied exactly the same way.
describe('raid double-assignment is rejected (server-side, not just the UI)', () => {
  test('one batch cannot send the same squad to two raids', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      OPP({ id: 'd1-0', capacity: 5000 }),
      OPP({ id: 'd1-1', capacity: 5000 }),
    ])

    // The 1st Cohort (squad 1) drafted onto both cards of one batch.
    const res = await launchBatch(c.id, { 'd1-0': [1], 'd1-1': [1] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/assigned to two raids/)
    expect(engine.runBattle).not.toHaveBeenCalled()

    // Nothing was applied: both opportunities are still open, ledgers intact.
    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities.every((o) => !o.resolved)).toBe(true)
    expect(doc.roster.get('Soldier')).toBe(300)
    expect(doc.raid.squadAssignment.length).toBe(0)
  })

  test('a later, separate batch is rejected against a squad an earlier batch already committed', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [
      OPP({ id: 'd1-0', capacity: 5000 }),
      OPP({ id: 'd1-1', capacity: 5000 }),
    ])

    // First raid sends the 1st Cohort; it lands in the squad ledger.
    const first = await launchBatch(c.id, { 'd1-0': [1] })
    expect(first.status).toBe(201)
    expect(first.body.campaign.raid.squadAssignment).toEqual([1])

    // The same squad — still in the roster as its 30 survivors — can't ride a
    // second raid today.
    const second = await launchBatch(c.id, { 'd1-1': [1] })
    expect(second.status).toBe(400)
    expect(second.body.error).toMatch(/already committed to a raid today/)
    expect(engine.runBattle).toHaveBeenCalledTimes(1) // only the first raid ran

    const doc = await Campaign.findById(c.id)
    expect(doc.raid.opportunities.find((o) => o.id === 'd1-1').resolved).toBe(false)
  })

  test('raid.squadAssignment clears at day rollover, freeing yesterday\'s raiders', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinAugury(c.id, QUIET)
    await pinRaid(c.id, [OPP({ id: 'd1-0', capacity: 5000 })])

    const day1 = await launchBatch(c.id, { 'd1-0': [1] })
    expect(day1.status).toBe(201)
    expect(day1.body.campaign.raid.squadAssignment).toEqual([1])

    const endDay = await endTurn(c.id)
    expect(endDay.body.campaign.raid.squadAssignment).toEqual([])

    // The 1st Cohort (regrouped to its survivors) can raid again today — if the
    // ledger hadn't reset, squad 1 would still read as committed and reject.
    await pinRaid(c.id, [OPP({ id: 'd2-0', capacity: 5000 })])
    const day2 = await launchBatch(c.id, { 'd2-0': [1] })
    expect(day2.status).toBe(201)
  })
})
