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
const { raidCapacityCost, raidPrestige } = await import('../utils/capabilities.js')
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

// Shrinking the army to an exact size means the CHARACTERS too since slice 5:
// the six starting casters left the roster but not the army, and they still eat
// (5-10). A test pinning a roster to make its food arithmetic exact would
// otherwise be silently 168 kg out — six bodies at 28 kg — so the casters go
// with the roster unless a caller wants them.
const shrinkRoster = async (id, roster, characters = []) => {
  const doc = await Campaign.findById(id)
  doc.roster = roster
  doc.characters = characters
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
  // Surviving CHARACTER ids (5-9). Left undefined by default so the existing
  // raid cases keep behaving exactly as before — a missing list means the
  // engine never reported, which kills nobody.
  blue_characters,
  // Surviving ENEMY character ids (slice 9a). The enemy has exactly one tagged
  // body — the champion — so this list is really the question "did he walk
  // away", which decides both whether you loot him and whether he counts as one
  // of the target force's survivors. Undefined by default, like its blue
  // sibling, so every existing case behaves exactly as before.
  red_characters,
} = {}) => {
  const r = structuredClone(battleResultFixture)
  r.winner = winner
  r.blue_squads = blue_squads
  r.blue_survivors = sumSurvivors(blue_squads)
  r.red_survivors = red_survivors
  if (blue_characters !== undefined) r.blue_characters = blue_characters
  if (red_characters !== undefined) r.red_characters = red_characters
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
    // A loss runs no REWARD path — neither of applyRaidReward's two lines.
    // Narrowed from a loose /prestig/ match by slice 1: a lost raid now DOES
    // log a prestige award (participating earns, win or lose), so matching the
    // word alone would fail on the very thing the design intends.
    const allEntries = doc.log.flatMap((l) => l.entries)
    expect(allEntries.some((e) => /wiped out/i.test(e))).toBe(false)
    expect(allEntries.some((e) => /word of it spreads/i.test(e))).toBe(false)
    // The participation award, on the other hand, IS expected on a loss.
    expect(allEntries.some((e) => /earns \d+ prestige/i.test(e))).toBe(true)
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
    // The 1st Cohort lost every man but is NOT disbanded — the charter stays on
    // the rolls at zero and refills later (docs/CAMPAIGN_PLAN.md decision 14).
    // Changed with slice 1; this used to assert the squad was gone.
    const cohort = res.body.campaign.squads.find((s) => s.id === 1)
    expect(cohort).toBeDefined()
    expect(cohort.composition).toEqual({})
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
// ── Squad prestige + charter survival (slice 1) ─────────────────────────────
// docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL": prestige is a permanent
// rank earned mainly from raids, and a wiped squad stays on the rolls at zero
// rather than being disbanded — otherwise its prestige dies with it and the
// persistence is a fiction.
describe('POST .../raids/launch — squad prestige', () => {
  const prestigeOf = (body, id) => body.campaign.squads.find((s) => s.id === id).prestige

  test('a won raid pays the WIN rate, scaled by the target band', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ strengthBand: 'a handful' })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    // 'a handful' is band weight 1 → a win pays 1 × RAID_PRESTIGE_WIN_PER_BAND.
    expect(prestigeOf(res.body, 1)).toBe(raidPrestige('a handful', true))
    expect(prestigeOf(res.body, 1)).toBe(2)
  })

  test('a stronger target pays more for the same win', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ strengthBand: 'a strong detachment' })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(prestigeOf(res.body, 1)).toBe(raidPrestige('a strong detachment', true))
    expect(prestigeOf(res.body, 1)).toBe(8)
  })

  test('a LOST raid still pays the participation rate', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ winner: 'red', blue_squads: { 1: { survivors: { Soldier: 5 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ strengthBand: 'a full company' })])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)
    expect(prestigeOf(res.body, 1)).toBe(raidPrestige('a full company', false))
    expect(prestigeOf(res.body, 1)).toBe(3)
  })

  test('prestige ACCUMULATES across turns and is never spent', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    await launch(c.id, 'd1-0', [1])
    // QUIET, like every other cross-turn test here: an unpinned augury can seal
    // a CHOICE fate, whose pendingChoice 409s the next turn's raid launch.
    await pinAugury(c.id, QUIET)
    await endTurn(c.id)

    await pinRaid(c.id, [OPP({ id: 'd2-0' })])
    const res = await launch(c.id, 'd2-0', [1])
    expect(prestigeOf(res.body, 1)).toBe(raidPrestige('a handful', true) * 2)

    // And it survived the round-trip, not just the response.
    const doc = await Campaign.findById(c.id)
    expect(doc.squads.find((s) => s.id === 1).prestige).toBe(4)
  })

  test('only the squads that went earn it', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(prestigeOf(res.body, 1)).toBeGreaterThan(0)
    // Squads 2 and 3 stayed in camp.
    expect(prestigeOf(res.body, 2)).toBe(0)
    expect(prestigeOf(res.body, 3)).toBe(0)
  })

  test('every squad in a stacked party earns, not just the first', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({
        blue_squads: {
          1: { survivors: { Soldier: 30 }, wiped: false },
          2: { survivors: { Archer: 20 }, wiped: false },
        },
      }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ capacity: 5000 })])

    const res = await launch(c.id, 'd1-0', [1, 2])
    expect(res.status).toBe(201)
    expect(prestigeOf(res.body, 1)).toBe(raidPrestige('a handful', true))
    expect(prestigeOf(res.body, 2)).toBe(raidPrestige('a handful', true))
  })
})

describe('POST .../raids/launch — a wiped charter survives', () => {
  test('a wiped squad stays on the rolls at zero, keeping its name and prestige', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: {}, wiped: true } } }),
    )
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)

    // The charter is NOT disbanded — decision 14: nothing special happens, it
    // is simply a charter at zero that refills later.
    const squad = res.body.campaign.squads.find((s) => s.id === 1)
    expect(squad).toBeDefined()
    expect(squad.name).toBe('1st Cohort')
    expect(squad.composition).toEqual({})
    // And it still earned the raid's prestige — that is the whole point of the
    // charter surviving.
    expect(squad.prestige).toBe(raidPrestige('a handful', true))

    const doc = await Campaign.findById(c.id)
    expect(doc.squads.find((s) => s.id === 1)).toBeDefined()
  })

  test('an EMPTY squad cannot be sent on a raid', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP()])
    // Empty the 1st Cohort without removing the charter.
    const doc = await Campaign.findById(c.id)
    doc.squads.find((s) => s.id === 1).composition = new Map()
    await doc.save()

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no troops/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('an empty squad cannot ride along in a party with a real one', async () => {
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ capacity: 5000 })])
    const doc = await Campaign.findById(c.id)
    doc.squads.find((s) => s.id === 2).composition = new Map()
    await doc.save()

    // Squad 1 is fine, squad 2 is empty — the party must still be refused,
    // rather than the empty one slipping through on the other's coat-tails.
    const res = await launch(c.id, 'd1-0', [1, 2])
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no troops/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })
})

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

  // ── Every card states its payoff (user, 2026-08-10) ───────────────────────
  // The standing rule: no card may show flavour alone. `reward` covers the loot
  // and `threat` covers a counter_event; `payoff` is the channel for what is
  // neither — the host thinned, a standing forage pressure ended. The gap that
  // prompted it: a thins-enemy garrison_sortie's whole point is the besiegers'
  // losses, raid.js strips `thinsEnemy` out of the reward as a control flag, so
  // the card rendered NO reward line at all.
  describe('payoff — the half of the reward that is not loot', () => {
    const payoffOf = async (id, i = 0) =>
      (await getView(id)).body.raid.opportunities[i].payoff

    test('a thins-enemy sortie promises the losses it inflicts — its only payoff', async () => {
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [
        OPP({ type: 'garrison_sortie', reward: { resolve: 10 }, rewardRange: null, thinsEnemy: true }),
      ])
      const view = (await getView(c.id)).body.raid.opportunities[0]
      expect(view.reward).toBeNull() // resolve is hidden, so loot says nothing
      expect(view.payoff).toEqual(['The enemy host is the thinner for it'])
      // Resolve stays hidden bookkeeping — the sally's standing is felt, not
      // read. (`resolved` is a different field; match the reward key exactly.)
      expect(JSON.stringify(view)).not.toContain('"resolve"')
      expect(view.payoff.join(' ')).not.toMatch(/\d/)
    })

    test('a loot sortie states its stores and claims no losses it will not inflict', async () => {
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [
        OPP({
          type: 'garrison_sortie',
          reward: { resolve: 14, materials: 250 },
          rewardRange: { materials: [200, 300] },
          thinsEnemy: false,
        }),
      ])
      const view = (await getView(c.id)).body.raid.opportunities[0]
      expect(view.payoff).toEqual([])
      expect(view.reward).toEqual({ materials: [200, 300] })
    })

    test('a destroy_detachment names the kill, not just the coin off the field', async () => {
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [OPP({ type: 'destroy_detachment', reward: { gold: 30 }, rewardRange: { gold: [22, 38] } })])
      expect(await payoffOf(c.id)).toEqual(['The enemy host is the thinner for it'])
    })

    test('a plundering raid claims nothing beyond its loot', async () => {
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [OPP()]) // loot_supplies: the host is never touched
      expect(await payoffOf(c.id)).toEqual([])
    })

    test('a persistent card says which pressure it ends, and what that pressure costs', async () => {
      const { body: c } = await createCampaign()
      const doc = await Campaign.findById(c.id)
      doc.forage.modifiers = [{
        id: 'foraging_riders',
        label: 'Harried by enemy horse',
        target: 'playerYield',
        factor: 0.6,
        raidable: true,
      }]
      doc.raid.opportunities = [OPP({
        type: 'destroy_detachment',
        reward: { gold: 30 },
        rewardRange: { gold: [22, 38] },
        persistent: true,
        modifierId: 'foraging_riders',
      })]
      await doc.save()
      expect(await payoffOf(c.id)).toEqual([
        'The enemy host is the thinner for it',
        'Ends "Harried by enemy horse" (now: Your foraging ×0.6)',
      ])
    })

    test('an enemy-side pressure stays a phrase on the card, exactly as on the forage panel', async () => {
      const { body: c } = await createCampaign()
      const doc = await Campaign.findById(c.id)
      doc.forage.modifiers = [{
        id: 'enemy_supply_depot',
        label: 'Enemy supply depot',
        target: 'enemyDrain',
        deltaKg: 4000,
        raidable: true,
      }]
      doc.raid.opportunities = [OPP({
        type: 'loot_supplies', persistent: true, modifierId: 'enemy_supply_depot',
      })]
      await doc.save()
      const [line] = await payoffOf(c.id)
      expect(line).toBe('Ends "Enemy supply depot" (now: The enemy strips the countryside faster)')
      expect(line).not.toMatch(/4000|4 t/) // the drain figure is recon-gated
    })

    test('a resolved card promises nothing — the outcome is the reveal', async () => {
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [
        OPP({ type: 'destroy_detachment', resolved: true, outcome: { winner: 'blue', battleId: 'b1' } }),
      ])
      expect(await payoffOf(c.id)).toEqual([])
    })
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

// Characters on raids (docs/CAMPAIGN_PLAN.md 5-8/5-9): attached means
// EVERYWHERE, automatically, and at full risk. There is no per-raid opt-out
// and none is wanted — detaching is free, so leaving your only Mage behind is
// one click, and the risk is what makes taking them a decision.
describe('characters ride on raids (docs/CAMPAIGN_PLAN.md "SLICE 5")', () => {
  const attach = (id, characterId, squadId) =>
    auth(api.post(`/api/campaigns/${id}/characters/${characterId}/attach`)).send({ squadId })

  test('an attached character joins the raid party on the squad’s block', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } } }),
    )
    const { body: c } = await createCampaign()
    const mage = c.characters.find((x) => x.type === 'Mage')
    await attach(c.id, mage.id, 1).expect(200)
    await pinRaid(c.id, [OPP()])

    expect((await launch(c.id, 'd1-0', [1])).status).toBe(201)

    const input = engine.runBattle.mock.calls.at(-1)[0]
    const entry = input.player_placement.find((e) => e.character_id === mage.id)
    expect(entry).toBeDefined()
    // Same hex as the squad's block, so the engine groups them into one
    // formation rather than fielding a one-body squad alongside it.
    const block = input.player_placement.find((e) => e.squad_id === 1 && e.character_id == null)
    expect([entry.q, entry.r]).toEqual([block.q, block.r])
    expect(entry.avoids_melee).toBe(true)
  })

  test('a character left in camp does not ride, and cannot die on the raid', async () => {
    engine.runBattle.mockResolvedValue(battleResult({ blue_characters: [] }))
    const { body: c } = await createCampaign()
    const mage = c.characters.find((x) => x.type === 'Mage')
    await pinRaid(c.id, [OPP()])

    expect((await launch(c.id, 'd1-0', [1])).status).toBe(201)

    const input = engine.runBattle.mock.calls.at(-1)[0]
    expect(input.player_placement.some((e) => e.character_id === mage.id)).toBe(false)
    const doc = await Campaign.findById(c.id)
    expect(doc.characters.find((x) => x.id === mage.id).alive).toBe(true)
  })

  test('a raid kills a character exactly as a battle does, and keeps the record', async () => {
    engine.runBattle.mockResolvedValue(
      battleResult({ blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } }, blue_characters: [] }),
    )
    const { body: c } = await createCampaign()
    const mage = c.characters.find((x) => x.type === 'Mage')
    await attach(c.id, mage.id, 1).expect(200)
    await pinRaid(c.id, [OPP()])

    const res = await launch(c.id, 'd1-0', [1])
    expect(res.status).toBe(201)

    const doc = await Campaign.findById(c.id)
    const after = doc.characters.find((x) => x.id === mage.id)
    expect(after.alive).toBe(false)
    expect(after.diedDay).toBe(doc.day)
    // Still on the rolls with their name — a later recovery needs something left.
    expect(after.name).toBe(mage.name)
    expect(res.body.report ?? JSON.stringify(res.body)).toBeDefined()
  })
})

// ── Enemy bearers and loot (docs/CAMPAIGN_PLAN.md DECISION 9, slice 9a) ──────
//
// A champion is a full enemy character carrying real gear: he fights with its
// mods and abilities and drops it when you take the field. "A relic you win is
// one that hurt you." He decides nothing, which is what keeps him inside
// standing principle 1 — these cases pin what he DOES, never a reaction.

describe('enemy bearers', () => {
  const RELIC = 'relic_the_long_watch'
  const HELM = 'gear_iron_helm'
  const CHAMPION = { type: 'Soldier', items: [RELIC, HELM] }
  const entriesOf = (doc) => doc.log.flatMap((l) => l.entries).join(' ')
  const attach = (id, characterId, squadId) =>
    auth(api.post(`/api/campaigns/${id}/characters/${characterId}/attach`)).send({ squadId })

  test('a sealed champion takes the field, with his gear translated', () => {
    // The engine learns `attack` and `fearless` and never the word `item` —
    // the same line UnitRole drew and slice 6 held for banners.
    return (async () => {
      engine.runBattle.mockResolvedValue(battleResult())
      const { body: c } = await createCampaign()
      await pinRaid(c.id, [OPP({ bearer: CHAMPION })])
      await launch(c.id, 'd1-0', [1])

      const input = engine.runBattle.mock.calls[0][0]
      const champion = input.enemy_placement.at(-1)
      expect(champion.unit_type).toBe('Soldier')
      expect(champion.squad_abilities).toEqual(['fearless'])
      // Tagged into a squad of one, or 6-6's membership scoping would drop the
      // relic's gift the moment he stood alone.
      expect(champion.squad_id).toBeGreaterThan(0)
      expect(champion.character_id).toBeGreaterThan(0)
      expect(JSON.stringify(input)).not.toContain(RELIC)
    })()
  })

  test('a card with no champion places nothing extra', async () => {
    engine.runBattle.mockResolvedValue(battleResult())
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ bearer: null, targetForce: { Soldier: 5 } })])
    await launch(c.id, 'd1-0', [1])

    const input = engine.runBattle.mock.calls[0][0]
    expect(input.enemy_placement.every((e) => e.character_id == null)).toBe(true)
  })

  test('beat him and take the field: the unique comes home, ordinary kit rolls', async () => {
    // 9-11 through the route. The unique is the deterministic half — it is
    // guaranteed on a win — so it is what the assertion can pin.
    engine.runBattle.mockResolvedValue(battleResult({ winner: 'blue', red_characters: [] }))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ bearer: CHAMPION })])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    expect([...doc.items]).toContain(RELIC)
    expect(entriesOf(doc)).toMatch(/champion's body is stripped/i)
  })

  test('a champion who rides away keeps everything, even on a win', async () => {
    // Hold the field and he still got out — you loot the DEAD (9-11), and his
    // surviving id is the only thing that can say which.
    engine.runBattle.mockResolvedValue(battleResult({ winner: 'blue', red_characters: [1] }))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ bearer: CHAMPION })])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    expect([...doc.items]).not.toContain(RELIC)
  })

  test('lose the field and nothing is stripped', async () => {
    engine.runBattle.mockResolvedValue(battleResult({
      winner: 'red',
      blue_squads: { 1: { survivors: {}, wiped: true } },
      red_characters: [],
    }))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({ bearer: CHAMPION })])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    expect([...doc.items]).not.toContain(RELIC)
  })

  test('a surviving champion is not counted among the target force’s survivors', async () => {
    // He is an EXTRA body, not one of targetForce, so counting his survival as
    // one of theirs would understate the host's real losses by one.
    engine.runBattle.mockResolvedValue(battleResult({
      winner: 'blue',
      red_survivors: { Soldier: 21 }, // 20 of the target + the champion
      red_characters: [1],            // he lived
    }))
    const { body: c } = await createCampaign()
    await pinRaid(c.id, [OPP({
      type: 'destroy_detachment',
      targetForce: { Soldier: 30 },
      reward: null,
      capacity: 500,
      bearer: { type: 'Soldier', items: [] },
    })])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    // 30 sent − 20 of them surviving = 10 real dead, plus the win's pursuit of
    // the routing remainder, which applyRaidReward removes on top.
    expect(doc.enemy.army.get('Soldier')).toBe(540 - 30)
  })

  test('your own fallen give up what can be carried back', async () => {
    // The same one rule, pointed the other way (9-10). The relic is guaranteed;
    // what is NOT recovered stays on the body for a later recovery (5-9).
    engine.runBattle.mockResolvedValue(battleResult({
      winner: 'blue',
      blue_squads: { 1: { survivors: { Soldier: 30 }, wiped: false } },
      blue_characters: [],
    }))
    const { body: c } = await createCampaign()
    const mage = c.characters.find((x) => x.type === 'Mage')
    await attach(c.id, mage.id, 1).expect(200)
    const seeded = await Campaign.findById(c.id)
    seeded.characters.find((x) => x.id === mage.id).items = [
      { slot: 'misc', index: 0, itemId: RELIC },
    ]
    await seeded.save()
    await pinRaid(c.id, [OPP()])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    const fallen = doc.characters.find((x) => x.id === mage.id)
    expect(fallen.alive).toBe(false)
    expect([...doc.items]).toContain(RELIC)
    // It LEFT the record — an item cannot be in two places, and "in the store"
    // means "on nothing".
    expect([...fallen.items]).toHaveLength(0)
    expect(entriesOf(doc)).toMatch(/kit is carried back/i)
  })

  test('a character who falls on a LOST raid keeps everything', async () => {
    engine.runBattle.mockResolvedValue(battleResult({
      winner: 'red',
      blue_squads: { 1: { survivors: {}, wiped: true } },
      blue_characters: [],
    }))
    const { body: c } = await createCampaign()
    const mage = c.characters.find((x) => x.type === 'Mage')
    await attach(c.id, mage.id, 1).expect(200)
    const seeded = await Campaign.findById(c.id)
    seeded.characters.find((x) => x.id === mage.id).items = [
      { slot: 'misc', index: 0, itemId: RELIC },
    ]
    await seeded.save()
    await pinRaid(c.id, [OPP()])
    await launch(c.id, 'd1-0', [1])

    const doc = await Campaign.findById(c.id)
    expect([...doc.items]).not.toContain(RELIC)
    expect([...doc.characters.find((x) => x.id === mage.id).items]).toHaveLength(1)
  })
})
