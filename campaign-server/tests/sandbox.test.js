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

import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import supertest from 'supertest'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { battleResultFixture } from './fixtures/battleResult.js'
import { catalogFixture } from './fixtures/catalog.js'
import { spellsFixture } from './fixtures/spells.js'
import { setSpellCatalog, clearSpellCatalogCache } from '../utils/spellCatalog.js'

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
const {
  ENEMY_CHANNELS, ENEMY_SCHOOLS, SANDBOX_MAX_CHANNELS, SANDBOX_MAX_PATH_LEVEL,
  SANDBOX_MAX_RUNS, SANDBOX_MAX_SCHOOL_LEVEL, SANDBOX_MAX_UNITS_PER_SIDE, SPELL_PATHS,
  SPELL_SCHOOLS,
} = await import('../utils/campaignConfig.js')

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
afterEach(() => clearSpellCatalogCache())
beforeEach(async () => {
  await clearDb()
  vi.clearAllMocks()
  await UnitType.insertMany(catalogFixture.units)
  engine.getInfo.mockResolvedValue(info)
  // The lab's script whitelist is checked against the ENGINE'S roster, so the
  // suite needs one — the same fixture the chosen-spells suite reasons about,
  // for the same reason: a retune in the C++ table must not move assertions
  // about what the whitelist does.
  setSpellCatalog(spellsFixture)
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
      // S3's second argument: the run's seed, and `null` is "draw fresh".
      { seed: null },
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

// ── S2: the casters ─────────────────────────────────────────────────────────
//
// The seam S1 left on purpose. The whitelist grows by two fields and a
// top-level block, and what is pinned here is the discipline that made the
// whitelist worth having: everything is REBUILT, an empty field is OMITTED
// rather than sent, and the omission is load-bearing — absence is how the
// engine's own default is asked for (SB-7), so a `{}` where a caster meant
// "leave him alone" would overwrite his craft's own seeding and field a mute
// mage.
describe('the caster fields on a placement entry (SB-6 / SB-7 / D2)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  const launchCaster = (entry) => launch({
    player_placement: [{ unit_type: 'Mage', q: 4, r: 4, ...entry }],
    enemy_placement: [],
  })

  test('paths and a script survive the whitelist for a caster', async () => {
    stubEngine()
    await launchCaster({ paths: { fire: 3, water: 1 }, script: ['fireball', 'bless'] })

    expect(inputOf().player_placement).toEqual([{
      unit_type: 'Mage', q: 4, r: 4,
      paths: { fire: 3, water: 1 },
      script: ['fireball', 'bless'],
    }])
  })

  test('and are stripped from a body that is no caster at all', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, paths: { fire: 3 }, script: ['fireball'] },
      ],
      enemy_placement: [],
    })

    expect(inputOf().player_placement).toEqual([{ unit_type: 'Soldier', q: 4, r: 4 }])
  })

  test('an unknown path key is never looked at', async () => {
    stubEngine()
    await launchCaster({ paths: { fire: 2, telepathy: 9, holy: 1 } })

    expect(inputOf().player_placement[0].paths).toEqual({ fire: 2, holy: 1 })
  })

  test('a level is truncated, clamped and dropped when it is not a number', async () => {
    stubEngine()
    await launchCaster({
      paths: {
        fire: 2.9, water: SANDBOX_MAX_PATH_LEVEL + 40, air: -3, earth: 'lots', death: null,
      },
    })

    // 'earth' was not a number and 'death' was null: both are gone, rather
    // than crossing as NaN — which JSON writes as `null` and the engine reads
    // as a level it never checks.
    expect(inputOf().player_placement[0].paths).toEqual({
      fire: 2, water: SANDBOX_MAX_PATH_LEVEL, air: 0,
    })
  })

  test('an unknown spell id and a duplicate are rebuilt away, and order is kept', async () => {
    stubEngine()
    await launchCaster({ script: ['bless', 'summon_dragon', 'fireball', 'bless', 42] })

    // Position IS priority (S4-1), so what survives keeps the order it arrived
    // in — the dedupe drops the LATER copy, never the first.
    expect(inputOf().player_placement[0].script).toEqual(['bless', 'fireball'])
  })

  test('an empty bag and an empty script are OMITTED, not sent as {} or []', async () => {
    stubEngine()
    await launchCaster({ paths: {}, script: [] })

    const [entry] = inputOf().player_placement
    expect(entry).toEqual({ unit_type: 'Mage', q: 4, r: 4 })
    expect('paths' in entry).toBe(false)
    expect('script' in entry).toBe(false)
  })

  test('a bag of nothing but junk is omitted too — it is not a decision', async () => {
    stubEngine()
    await launchCaster({ paths: { telepathy: 4 }, script: ['summon_dragon'] })

    expect(inputOf().player_placement[0]).toEqual({ unit_type: 'Mage', q: 4, r: 4 })
  })
})

describe('the per-side magic block (D1)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  test('both sides cross, each rebuilt from the four schools', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      magic: {
        blue: { schools: { evocation: 9, conjuration: 9, enchantment: 9, construction: 9 }, channels: 0 },
        red: { schools: { evocation: 1, conjuration: 2, enchantment: 1, construction: 0 }, channels: 3 },
      },
    })

    expect(inputOf().magic).toEqual({
      blue: { schools: { evocation: 9, conjuration: 9, enchantment: 9, construction: 9 }, channels: 0 },
      red: { schools: { evocation: 1, conjuration: 2, enchantment: 1, construction: 0 }, channels: 3 },
    })
  })

  test('clamps every number and drops an unknown school', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      magic: {
        blue: {
          schools: {
            evocation: SANDBOX_MAX_SCHOOL_LEVEL + 5, conjuration: -2,
            enchantment: 2.7, necromancy: 9,
          },
          channels: SANDBOX_MAX_CHANNELS + 1000,
        },
      },
    })

    expect(inputOf().magic).toEqual({
      blue: {
        schools: {
          evocation: SANDBOX_MAX_SCHOOL_LEVEL, conjuration: 0, enchantment: 2,
        },
        channels: SANDBOX_MAX_CHANNELS,
      },
    })
  })

  test('an absent side is omitted, and an absent block leaves the engine alone', async () => {
    stubEngine()
    await launch({ ...oneOfEach, magic: { red: { channels: 4 } } })
    expect(inputOf().magic).toEqual({ red: { channels: 4 } })

    engine.runBattle.mockClear()
    stubEngine()
    await launch(oneOfEach)
    // Nothing at all rather than {}: an absent block is how the engine's own
    // open defaults are asked for, which is what makes the lab's "all nine,
    // no pool" default reproduce today's behaviour exactly.
    expect('magic' in inputOf()).toBe(false)
  })
})

describe('GET /api/sandbox/reference', () => {
  const reference = () =>
    api.get('/api/sandbox/reference').set('Authorization', `Bearer ${token}`)

  test('requires a login', async () => {
    expect((await api.get('/api/sandbox/reference')).status).toBe(401)
  })

  test('serves the phrased vocabulary in the engine\'s own order', async () => {
    const res = await reference()

    expect(res.status).toBe(200)
    expect(res.body.paths.map((p) => p.key)).toEqual(SPELL_PATHS)
    expect(res.body.schools.map((s) => s.key)).toEqual(SPELL_SCHOOLS)
    expect(res.body.paths[0]).toEqual({ key: 'fire', label: 'Fire' })
  })

  test('derives the caster types from isCasterType, never from a second list', async () => {
    const { isCasterType } = await import('../services/magic.js')
    const res = await reference()

    expect(res.body.casterTypes.length).toBeGreaterThan(0)
    for (const type of res.body.casterTypes) expect(isCasterType(type)).toBe(true)
    // The two lanes plus the craft that declares its own path — a Soldier and
    // the mindless Golem (C-4) are not offered paths by the wire.
    expect(res.body.casterTypes).toContain('Mage')
    expect(res.body.casterTypes).not.toContain('Soldier')
    expect(res.body.casterTypes).not.toContain('Golem')
  })

  test('reports SB-8\'s preset off the LIVE constants, so the balance pass moves it', async () => {
    const res = await reference()

    expect(res.body.enemyPreset).toEqual({ schools: ENEMY_SCHOOLS, channels: ENEMY_CHANNELS })
  })

  test('names the bounds the lab clamps to, open level included', async () => {
    const res = await reference()

    expect(res.body.limits).toEqual({
      maxPathLevel: SANDBOX_MAX_PATH_LEVEL,
      maxSchoolLevel: SANDBOX_MAX_SCHOOL_LEVEL,
      maxChannels: SANDBOX_MAX_CHANNELS,
      openSchoolLevel: SANDBOX_MAX_SCHOOL_LEVEL,
      maxRuns: SANDBOX_MAX_RUNS,
    })
  })
})

describe('POST /api/sandbox/castable (D3)', () => {
  const castable = (body) =>
    api.post('/api/sandbox/castable').set('Authorization', `Bearer ${token}`).send(body)
  const idsOf = (res) => res.body.options.map((o) => o.spell).sort()

  const allOpen = {
    evocation: 9, conjuration: 9, enchantment: 9, construction: 9,
  }

  test('requires a login', async () => {
    expect((await api.post('/api/sandbox/castable').send({})).status).toBe(401)
  })

  test('grows as a path level rises — the same fold The Study uses', async () => {
    const atFire = async (level) =>
      idsOf(await castable({ paths: { fire: level }, schools: allOpen }))

    // Nothing at all without a path: the gate is his, not the side's.
    expect(await atFire(0)).toEqual([])
    // Fire 1 reaches Ember, and the row IS fireball — the id never changes as
    // the form under it gets stronger.
    expect(await atFire(1)).toEqual(['fireball'])
    expect(await atFire(3)).toEqual(['fireball'])
  })

  test("respects the SIDE's school levels, not just his paths", async () => {
    const sealed = { evocation: 0, conjuration: 0, enchantment: 0, construction: 0 }
    expect(idsOf(await castable({ paths: { fire: 3 }, schools: sealed }))).toEqual([])

    // A school-less form (M-14) passes the second gate outright, so a Priest's
    // blessing is his from day one whatever the side has researched.
    expect(idsOf(await castable({ paths: { holy: 2 }, schools: sealed }))).toEqual(['bless'])
  })

  test('answers the strongest form the caster qualifies for', async () => {
    const at = async (level) =>
      (await castable({ paths: { fire: level }, schools: allOpen })).body.options[0]

    expect((await at(1)).label).toBe('Ember')
    expect((await at(3)).label).toBe('Fireball')
  })

  test('sanitizes both bags exactly as a launch would', async () => {
    // Junk keys and an over-range level: the answer must be the one a launch
    // carrying the same bag would actually fight with.
    const res = await castable({
      paths: { fire: SANDBOX_MAX_PATH_LEVEL + 90, telepathy: 9 },
      schools: { evocation: 'lots', ...allOpen },
    })
    expect(idsOf(res)).toEqual(['fireball'])
  })
})


// ── S3: the batch and the seed (SB-10) ──────────────────────────────────────
//
// One battle is one sample from a noisy distribution, so a launch is now a
// BATCH: N runs, a win rate read off them, and average survivors. What is
// pinned here is the four rules that keep the batch honest and keep SB-2's
// guard intact — sequential runs with only the FIRST persisted (E1), a seed
// collapsing the batch because a repeated draw sequence is one sample wearing
// N (E2), an aggregate over the runs that COMPLETED (E3), and a later
// failure ending the batch rather than voiding it (E4).
describe('a batch of runs (SB-10 / E1-E4)', () => {
  // Distinct results, so an aggregate that quietly counted one run N times
  // could not pass: three battles, two blue wins and one red.
  const runResults = [
    { winner: 'blue', blue_survivors: { Soldier: 4 }, red_survivors: {},
      replay: structuredClone(battleResultFixture.replay) },
    { winner: 'red', blue_survivors: {}, red_survivors: { Zombie: 2 },
      replay: structuredClone(battleResultFixture.replay) },
    { winner: 'blue', blue_survivors: { Soldier: 2, Archer: 1 }, red_survivors: {},
      replay: structuredClone(battleResultFixture.replay) },
  ]

  const stubRuns = (results) => {
    engine.runBattle.mockReset()
    for (const result of results) engine.runBattle.mockResolvedValueOnce(structuredClone(result))
    return results
  }

  test('runs the engine N times but persists exactly ONE battle (E1)', async () => {
    stubRuns(runResults)
    const res = await launch({ ...oneOfEach, runs: 3 })

    expect(res.status).toBe(201)
    expect(engine.runBattle).toHaveBeenCalledTimes(3)
    // One Battle document and one set of ticks, whatever N was — the replay on
    // screen is the batch's FIRST run, which is the one a player can name.
    expect(await Battle.countDocuments({ sandbox: true })).toBe(1)
    expect(await Tick.countDocuments({ battle: res.body.id })).toBe(3)
    expect(res.body.winner).toBe('blue')
  })

  test('counts the wins and averages the survivors over the runs (E3)', async () => {
    stubRuns(runResults)
    const { body } = await launch({ ...oneOfEach, runs: 3 })

    expect(body.batch.runs).toBe(3)
    expect(body.batch.requested).toBe(3)
    expect(body.batch.wins).toEqual({ blue: 2, red: 1, draw: 0 })
    // A type absent from a run survived it zero times, so the mean is over
    // every run and not just the ones that fielded the type: 4 + 0 + 2 over
    // three runs, and one lone Archer over the same three.
    expect(body.batch.averageSurvivors.blue.Soldier).toBeCloseTo(2)
    expect(body.batch.averageSurvivors.blue.Archer).toBeCloseTo(1 / 3)
    expect(body.batch.averageSurvivors.red.Zombie).toBeCloseTo(2 / 3)
  })

  test('a launch of one is a batch of one, so the block is always there', async () => {
    stubEngine()
    const { body } = await launch(oneOfEach)

    expect(body.batch).toEqual({
      runs: 1,
      requested: 1,
      seed: null,
      wins: { blue: 1, red: 0, draw: 0 },
      averageSurvivors: { blue: { Soldier: 2 }, red: {} },
    })
    // ADDITIVE: everything S1 and S2 returned is still there, unchanged.
    expect(body.id).toBeDefined()
    expect(body.winner).toBe('blue')
    expect(body.tickCount).toBe(3)
  })

  test('clamps runs to 1..SANDBOX_MAX_RUNS and falls back to one on junk', async () => {
    stubEngine()
    await launch({ ...oneOfEach, runs: SANDBOX_MAX_RUNS + 50 })
    expect(engine.runBattle).toHaveBeenCalledTimes(SANDBOX_MAX_RUNS)

    for (const runs of [0, -4, 'lots', null, undefined, {}]) {
      engine.runBattle.mockClear()
      await launch({ ...oneOfEach, runs })
      expect(engine.runBattle, `runs: ${JSON.stringify(runs)}`).toHaveBeenCalledTimes(1)
    }

    // 2.9 runs is two battles, not three: the same truncation every other
    // number on this wire gets.
    engine.runBattle.mockClear()
    await launch({ ...oneOfEach, runs: 2.9 })
    expect(engine.runBattle).toHaveBeenCalledTimes(2)
  })

  test('a seed collapses the batch to one run and rides to the engine (E2)', async () => {
    stubEngine()
    const { body } = await launch({ ...oneOfEach, runs: 10, seed: 4242 })

    // GAME_RNG_SEED repeats the ENTIRE draw sequence, so ten seeded runs are
    // ten copies of one battle — a "100% win rate" off a single sample. The
    // server decides this, not the client.
    expect(engine.runBattle).toHaveBeenCalledTimes(1)
    expect(engine.runBattle).toHaveBeenCalledWith(expect.any(Object), { seed: 4242 })
    expect(body.batch).toMatchObject({ runs: 1, requested: 1, seed: 4242 })
  })

  test('reads the seed a text field produces, and treats junk as no seed', async () => {
    stubEngine()
    await launch({ ...oneOfEach, seed: '20260825' })
    expect(engine.runBattle).toHaveBeenLastCalledWith(expect.any(Object), { seed: 20260825 })

    // Absent, empty and unreadable all mean "draw fresh" — and none of them
    // may collapse a batch the player actually asked for.
    for (const seed of ['', ' ', 'abc', null, undefined, {}, []]) {
      engine.runBattle.mockClear()
      await launch({ ...oneOfEach, runs: 2, seed })
      expect(engine.runBattle, `seed: ${JSON.stringify(seed)}`).toHaveBeenCalledTimes(2)
      expect(engine.runBattle).toHaveBeenLastCalledWith(expect.any(Object), { seed: null })
    }
  })

  test('a FIRST-run failure is a 400 with nothing stored (E4)', async () => {
    engine.runBattle.mockReset()
    engine.runBattle.mockResolvedValueOnce({ error: 'no such map' })
    const res = await launch({ ...oneOfEach, runs: 5 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no such map')
    expect(await Battle.countDocuments({})).toBe(0)
    // The batch stops at the failure rather than pressing on through it.
    expect(engine.runBattle).toHaveBeenCalledTimes(1)
  })

  test('a LATER failure ends the batch without voiding it (E4)', async () => {
    stubRuns(runResults.slice(0, 2))
    engine.runBattle.mockResolvedValueOnce({ error: 'engine died' })
    const res = await launch({ ...oneOfEach, runs: 5 })

    // The persisted replay is still there to watch, and the two good samples
    // are still reported — throwing them away because the third subprocess
    // died would be the wrong way to be wrong.
    expect(res.status).toBe(201)
    expect(await Battle.findById(res.body.id)).not.toBe(null)
    expect(engine.runBattle).toHaveBeenCalledTimes(3)
    expect(res.body.batch.runs).toBe(2)
    expect(res.body.batch.requested).toBe(5)
    expect(res.body.batch.wins).toEqual({ blue: 1, red: 1, draw: 0 })
    expect(res.body.batch.incomplete).toBe('engine died')
  })

  test('a THROWN engine failure ends it the same way', async () => {
    stubRuns([runResults[0]])
    engine.runBattle.mockRejectedValueOnce(new Error('game battle: timed out'))
    const res = await launch({ ...oneOfEach, runs: 3 })

    expect(res.status).toBe(201)
    expect(res.body.batch.runs).toBe(1)
    expect(res.body.batch.incomplete).toMatch(/timed out/)
  })
})
