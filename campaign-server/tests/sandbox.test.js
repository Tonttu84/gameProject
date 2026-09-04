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
  CHARTER_CATALOG, ENEMY_CHANNELS, ENEMY_SCHOOLS, HEX_DIRECTIONS, ITEM_CATALOG,
  SANDBOX_MAX_CHANNELS, SANDBOX_MAX_PATH_LEVEL, SANDBOX_MAX_PRESTIGE,
  SANDBOX_MAX_REINFORCEMENTS, SANDBOX_MAX_REINFORCE_COUNT, SANDBOX_MAX_REINFORCE_MESSAGE,
  SANDBOX_MAX_RUNS, SANDBOX_MAX_SCHOOL_LEVEL, SANDBOX_MAX_SQUADS_PER_SIDE,
  SANDBOX_MAX_UNITS_PER_SIDE, SANDBOX_MAX_VALUE, SANDBOX_MAX_WALL_DURABILITY, SANDBOX_MAX_WALL_SIDES,
  SPELL_PATHS, SPELL_SCHOOLS, SQUAD_ARCHETYPES, SQUAD_RANKS, SQUAD_UPGRADE_POOL,
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

// ── AI-3: the two casting-AI fields (L-1 / L-2 / L-4) ───────────────────────
//
// The whitelist widens by two more fields, on the same terms S2 established
// and reviewed one at a time: everything is REBUILT, an empty field is
// OMITTED, and the absence is what asks for the engine's own default — the
// whole castable roster for a shortlist (A-7) and the catalog's own worth for
// a value. What is new is the SPLIT between them: a shortlist is a caster's
// (it fences his lottery), while a value says what a body is worth TO THE
// OTHER SIDE'S caster and therefore belongs on every body there is.
describe("a caster's shortlist and a body's value (A-5 / A-7)", () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  const launchCaster = (entry) => launch({
    player_placement: [{ unit_type: 'Mage', q: 4, r: 4, ...entry }],
    enemy_placement: [],
  })

  test('a shortlist survives the whitelist for a caster', async () => {
    stubEngine()
    await launchCaster({ shortlist: ['fireball', 'bless'] })

    expect(inputOf().player_placement).toEqual([{
      unit_type: 'Mage', q: 4, r: 4, shortlist: ['fireball', 'bless'],
    }])
  })

  test('and is stripped from a body that is no caster at all', async () => {
    stubEngine()
    await launch({
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 4, shortlist: ['fireball'] }],
      enemy_placement: [],
    })

    expect(inputOf().player_placement).toEqual([{ unit_type: 'Soldier', q: 4, r: 4 }])
  })

  test('an unknown id and a duplicate are rebuilt away', async () => {
    stubEngine()
    await launchCaster({ shortlist: ['bless', 'summon_dragon', 'bless', 42, 'fireball'] })

    // Unordered (A-7 — the engine draws by lottery, not by position), so the
    // only thing the dedupe owes is that each id appears once.
    expect(inputOf().player_placement[0].shortlist).toEqual(['bless', 'fireball'])
  })

  test('a BATTLEFIELD spell is dropped — a global is cast only when scripted (E-3)', async () => {
    stubEngine()
    await launchCaster({ shortlist: ['soothing_winds', 'fireball', 'leaden_air'] })

    // The same rule `shortlistableFor` applies campaign-side: a lottery must
    // not be able to reach a spell the engine only fires on an order, or the
    // fence would offer a line that could only ever be skipped.
    expect(inputOf().player_placement[0].shortlist).toEqual(['fireball'])
  })

  test('a shortlist of nothing but globals and junk is OMITTED, not sent as []', async () => {
    stubEngine()
    await launchCaster({ shortlist: ['leaden_air', 'summon_dragon'] })

    const [entry] = inputOf().player_placement
    expect(entry).toEqual({ unit_type: 'Mage', q: 4, r: 4 })
    expect('shortlist' in entry).toBe(false)
  })

  test('an empty shortlist is omitted — absence is the whole roster (A-7)', async () => {
    stubEngine()
    await launchCaster({ shortlist: [] })

    expect('shortlist' in inputOf().player_placement[0]).toBe(false)
  })

  test('a value rides on ANY body, caster or not (L-2)', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, value: 200 },
        { unit_type: 'Mage', q: 4, r: 5, value: 30, shortlist: ['fireball'] },
      ],
      enemy_placement: [],
    })

    expect(inputOf().player_placement).toEqual([
      { unit_type: 'Soldier', q: 4, r: 4, value: 200 },
      { unit_type: 'Mage', q: 4, r: 5, value: 30, shortlist: ['fireball'] },
    ])
  })

  test('a value is truncated and clamped to the engine\'s own cap', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, value: 12.9 },
        { unit_type: 'Soldier', q: 4, r: 5, value: SANDBOX_MAX_VALUE + 5000 },
        { unit_type: 'Soldier', q: 4, r: 6, value: -8 },
      ],
      enemy_placement: [],
    })

    expect(inputOf().player_placement.map((e) => e.value))
      // Floored at 1 where the ENGINE floors it (AI_VALUE_CAP's other end): a
      // body worth nothing is a body no scorer would ever look at.
      .toEqual([12, SANDBOX_MAX_VALUE, 1])
  })

  test('a blank, a null and a word are omitted — none of them is a number', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, value: '' },
        { unit_type: 'Soldier', q: 4, r: 5, value: null },
        { unit_type: 'Soldier', q: 4, r: 6, value: 'lots' },
        { unit_type: 'Soldier', q: 4, r: 7, value: [] },
      ],
      enemy_placement: [],
    })

    // `Number(null)`, `Number('')` and `Number([])` are all 0, and a blank box
    // is nobody asking for a worthless body — so none of these may travel.
    for (const entry of inputOf().player_placement) expect('value' in entry).toBe(false)
  })

  test('a value typed as text still crosses, since a text box is where it is typed', async () => {
    stubEngine()
    await launch({
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 4, value: ' 45 ' }],
      enemy_placement: [],
    })

    expect(inputOf().player_placement[0].value).toBe(45)
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
      // S4's four. `maxReinforceCount` is the ENGINE'S own per-wave clamp
      // mirrored (MAX_REINFORCE_COUNT in BattleServer.cpp), so the lab stops
      // where the engine would have trimmed without saying so.
      maxWallSides: SANDBOX_MAX_WALL_SIDES,
      maxWallDurability: SANDBOX_MAX_WALL_DURABILITY,
      maxReinforcements: SANDBOX_MAX_REINFORCEMENTS,
      maxReinforceCount: SANDBOX_MAX_REINFORCE_COUNT,
      // R2's two: a sanity bound on prestige (the rank ladder has no ceiling
      // of its own) and a bound on how many SHEETS one side may carry.
      maxPrestige: SANDBOX_MAX_PRESTIGE,
      maxSquadsPerSide: SANDBOX_MAX_SQUADS_PER_SIDE,
      // AI-3's one (L-3): the engine's own AI_VALUE_CAP mirrored, so the box
      // stops where the engine would have clamped without saying so.
      maxValue: SANDBOX_MAX_VALUE,
    })
  })

  test("names the engine's six hexside directions, so the lab keeps no copy", async () => {
    const res = await reference()

    // In the engine's own declaration order (HexDirection, hex/HexGrid.hpp) —
    // the wall painter draws its six toggles straight off this.
    expect(res.body.hexDirections).toEqual(HEX_DIRECTIONS)
    expect(res.body.hexDirections).toEqual(['NE', 'E', 'SE', 'SW', 'W', 'NW'])
  })

  // ── R2's squad vocabulary (R-7) ───────────────────────────────────────────
  test('serves EVERY charter row, the opening three included', async () => {
    const res = await reference()

    // All of them: the lab may field the companies a campaign starts with as
    // readily as the ones it drafts (R-7 sets the sheet directly), so the
    // `opening` flag is not a filter here.
    expect(res.body.charters).toHaveLength(CHARTER_CATALOG.length)
    expect(res.body.charters.map((c) => c.id)).toContain('first_cohort')

    const cohort = res.body.charters.find((c) => c.id === 'first_cohort')
    expect(cohort).toEqual({
      id: 'first_cohort',
      name: '1st Cohort',
      archetype: 'line',
      composition: { Soldier: 40 },
      prestige: 0,
      blurb: expect.any(String),
    })
  })

  test('serves the archetypes, the upgrade pool priced in slots, the banners and the ranks', async () => {
    const res = await reference()

    expect(res.body.archetypes.map((a) => a.id)).toEqual(Object.keys(SQUAD_ARCHETYPES))
    expect(res.body.archetypes.find((a) => a.id === 'line')).toEqual({
      id: 'line', caps: { Soldier: 40, Pikeman: 10 }, intake: 10,
    })

    // Every row, whatever archetype it names: R-7 lets the lab tick any
    // upgrade, and `slots` is what the row would COST a campaign — said beside
    // the box, not enforced by it.
    expect(res.body.upgrades.map((u) => u.id)).toEqual(SQUAD_UPGRADE_POOL.map((u) => u.id))
    expect(res.body.upgrades.find((u) => u.id === 'royal_guard').slots).toBe(2)
    expect(res.body.upgrades.find((u) => u.id === 'honed_edge').slots).toBe(1)

    // Exactly ONE banner exists today, which is a fact about the content and
    // not about the picker — the filter is on `kind`, so a second row appears
    // here the day one is authored.
    const banners = ITEM_CATALOG.filter((row) => row.kind === 'banner')
    expect(res.body.banners.map((b) => b.id)).toEqual(banners.map((b) => b.id))
    expect(res.body.banners.every((b) => typeof b.name === 'string')).toBe(true)

    // The ladder itself, so the sheet prints "Blooded" beside a 10 without
    // holding the thresholds.
    expect(res.body.ranks).toEqual(SQUAD_RANKS)
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

// ── S4: the walls and the scheduled waves (SB-9) ─────────────────────────────
//
// Two BattleInput fields with no other way to be posed as a question: the
// campaign injects walls from its own fort presets and a wave only when the
// garrison sallies, so neither can be varied anywhere but here. Both go through
// the same by-construction whitelist S1 built and S2 widened — nothing from the
// body is passed through, and an entry that cannot be rebuilt is dropped whole
// rather than half-built.
describe('walls on the field (SB-9 / F1)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  test('a painted side survives the whitelist and reaches the engine', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      fortified_sides: [{ q: 4, r: 7, dir: 'SE', durability: 160 }],
    })

    expect(inputOf().fortified_sides).toEqual([{ q: 4, r: 7, dir: 'SE', durability: 160 }])
  })

  test('an unknown direction drops the entry rather than defaulting to one', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      fortified_sides: [
        { q: 4, r: 7, dir: 'NORTH', durability: 100 },
        { q: 5, r: 7, dir: 'SW', durability: 100 },
      ],
    })

    // The engine's own hexDirFromName answers NE for anything it does not
    // know, so a typo that travelled would silently wall a side nobody painted.
    expect(inputOf().fortified_sides).toEqual([{ q: 5, r: 7, dir: 'SW', durability: 100 }])
  })

  test('coordinates are truncated and durability clamped', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      fortified_sides: [
        { q: 4.9, r: 7.2, dir: 'SE', durability: SANDBOX_MAX_WALL_DURABILITY + 4000 },
        { q: 2, r: 7, dir: 'W', durability: -50 },
      ],
    })

    expect(inputOf().fortified_sides).toEqual([
      { q: 4, r: 7, dir: 'SE', durability: SANDBOX_MAX_WALL_DURABILITY },
      { q: 2, r: 7, dir: 'W', durability: 0 },
    ])
  })

  test('an unreadable durability is OMITTED, which is the engine\'s own default', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      fortified_sides: [{ q: 4, r: 7, dir: 'SE' }, { q: 5, r: 7, dir: 'SE', durability: 'lots' }],
    })

    // DEFAULT_FORT_DURABILITY is what the engine puts on a side whose entry
    // carries no durability, and saying nothing is the only way to ask for it.
    expect(inputOf().fortified_sides).toEqual([
      { q: 4, r: 7, dir: 'SE' },
      { q: 5, r: 7, dir: 'SE' },
    ])
  })

  test('caps the list by count, before anything is rebuilt', async () => {
    const painted = Array.from({ length: SANDBOX_MAX_WALL_SIDES + 1 }, (_, i) => ({
      q: i, r: 7, dir: 'SE',
    }))
    const res = await launch({ ...oneOfEach, fortified_sides: painted })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too many walled sides/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('an empty list is omitted rather than sent as []', async () => {
    stubEngine()
    await launch({ ...oneOfEach, fortified_sides: [] })

    expect('fortified_sides' in inputOf()).toBe(false)
  })
})

describe('scheduled waves (SB-9 / F3 / F4)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  test('a side name becomes the engine\'s team integer', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      reinforcements: [
        { side: 'blue', unit_type: 'Soldier', count: 40, tick: 4, message: 'The gates open!' },
        { side: 'red', unit_type: 'Archer', count: 10, tick: 2 },
      ],
    })

    // REDTEAM 1 / BLUETEAM 2 (backend/engine/include/Defines.hpp). The client
    // never names a team number — the route is the one place that translation
    // happens, exactly as the map is stamped here rather than sent.
    expect(inputOf().reinforcements).toEqual([
      { team: 2, unit_type: 'Soldier', count: 40, tick: 4, message: 'The gates open!' },
      { team: 1, unit_type: 'Archer', count: 10, tick: 2 },
    ])
  })

  test('drops an unknown side, an unknown type, a dead count and a tick below one', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      reinforcements: [
        { side: 'green', unit_type: 'Soldier', count: 5, tick: 2 },
        { side: 'blue', unit_type: 'Dragon', count: 5, tick: 2 },
        { side: 'blue', unit_type: 'Soldier', count: 0, tick: 2 },
        { side: 'blue', unit_type: 'Soldier', count: -3, tick: 2 },
        { side: 'blue', unit_type: 'Soldier', count: 5, tick: 0 },
        { side: 'blue', unit_type: 'Soldier', count: 5, tick: 'soon' },
        { side: 'blue', unit_type: 'Soldier', count: 5, tick: 3 },
      ],
    })

    // Dropped WHOLE, never passed through half-built: a wave the engine would
    // have quietly moved to tick 1 is a wave nobody scheduled.
    expect(inputOf().reinforcements).toEqual([
      { team: 2, unit_type: 'Soldier', count: 5, tick: 3 },
    ])
  })

  test('truncates the tick and trims the message to its cap', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      reinforcements: [{
        side: 'blue',
        unit_type: 'Soldier',
        count: 40,
        tick: 2.9,
        message: 'x'.repeat(SANDBOX_MAX_REINFORCE_MESSAGE + 50),
      }],
    })

    const [wave] = inputOf().reinforcements
    expect(wave.tick).toBe(2)
    // Trimmed rather than refused: a long log line is a mistake with an obvious
    // repair, and this one is STORED on the battle input and printed into the
    // replay.
    expect(wave.message).toHaveLength(SANDBOX_MAX_REINFORCE_MESSAGE)
  })

  test("clamps the count to the engine's own maximum before anything counts it", async () => {
    const res = await launch({
      ...oneOfEach,
      reinforcements: [{
        side: 'blue', unit_type: 'Soldier', count: SANDBOX_MAX_REINFORCE_COUNT + 1000, tick: 2,
      }],
    })

    // The clamp shows itself in the REFUSAL'S arithmetic, because the two caps
    // collide: SANDBOX_MAX_REINFORCE_COUNT mirrors the engine's own 500, and
    // the per-side cap is 400 — so a wave that big is over the line even after
    // being clamped, and what the message counts is the clamped 500 rather than
    // the 1500 the client asked for. (Which means the engine's own clamp can
    // never actually fire through this route; it is mirrored so the number the
    // player types is the number that arrives, never one trimmed a layer down.)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(new RegExp(`${SANDBOX_MAX_REINFORCE_COUNT} scheduled`))
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('an empty message is omitted, and so is an empty list', async () => {
    stubEngine()
    await launch({
      ...oneOfEach,
      reinforcements: [{ side: 'blue', unit_type: 'Soldier', count: 5, tick: 2, message: '   ' }],
    })
    expect('message' in inputOf().reinforcements[0]).toBe(false)

    engine.runBattle.mockClear()
    stubEngine()
    await launch({ ...oneOfEach, reinforcements: [] })
    expect('reinforcements' in inputOf()).toBe(false)
  })

  test('caps the number of waves by count', async () => {
    const waves = Array.from({ length: SANDBOX_MAX_REINFORCEMENTS + 1 }, () => ({
      side: 'blue', unit_type: 'Soldier', count: 1, tick: 1,
    }))
    const res = await launch({ ...oneOfEach, reinforcements: waves })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too many reinforcement waves/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('F4: scheduled bodies count against the per-side cap, and the refusal names both', async () => {
    const placed = Array.from({ length: SANDBOX_MAX_UNITS_PER_SIDE - 10 }, () => ({
      unit_type: 'Soldier', q: 4, r: 4,
    }))
    const res = await launch({
      player_placement: placed,
      enemy_placement: [],
      reinforcements: [{ side: 'blue', unit_type: 'Soldier', count: 11, tick: 3 }],
    })

    expect(res.status).toBe(400)
    // A reinforcement is a body that arrives late, not a body that is free —
    // and what is over the line is the SUM, so the sum is what the sentence
    // shows rather than a placement count the player can see is under the cap.
    expect(res.body.error).toMatch(/too many units on the blue side/i)
    expect(res.body.error).toMatch(new RegExp(`${SANDBOX_MAX_UNITS_PER_SIDE - 10} placed`))
    expect(res.body.error).toMatch(/11 scheduled/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('the cap is per side, so red\'s waves do not close blue\'s door', async () => {
    stubEngine()
    const placed = Array.from({ length: SANDBOX_MAX_UNITS_PER_SIDE - 10 }, () => ({
      unit_type: 'Soldier', q: 4, r: 4,
    }))
    const res = await launch({
      player_placement: placed,
      enemy_placement: [],
      reinforcements: [{ side: 'red', unit_type: 'Soldier', count: 300, tick: 3 }],
    })

    expect(res.status).toBe(201)
    expect(inputOf().reinforcements).toEqual([
      { team: 1, unit_type: 'Soldier', count: 300, tick: 3 },
    ])
  })
})

// ── R2: the squads (docs/CAMPAIGN_PLAN.md, R-7) ─────────────────────────────
//
// The seam every slice before this one widened by one field, widened again —
// and this time the fields the engine reads mostly do NOT come from the client
// at all. R-7 lets the lab set a company's SHEET directly (any charter, any
// prestige, any upgrades regardless of slots, any banner regardless of rank),
// and the route composes `squad_name`/`squad_mods`/`squad_abilities` from that
// sheet with the deploy route's own `statMods`/`squadAbilities`. So what is
// pinned here is the two halves of that bargain: everything about a company is
// rebuilt server-side, and the one rule the lab keeps — the archetype's caps,
// which are what MAKE it that archetype — is checked against the bodies.
describe('the squad sheet on a launch (R-7)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  // One line company on one hex, with whatever sheet the test is about.
  const launchSquad = (sheet, entries = [{ unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 }]) =>
    launch({
      player_placement: entries,
      enemy_placement: [],
      squads: { blue: [{ id: 1, archetype: 'line', ...sheet }] },
    })

  const entryOf = async (sheet) => {
    stubEngine()
    await launchSquad(sheet)
    return inputOf().player_placement[0]
  }

  test('is rebuilt by construction: name trimmed, prestige clamped, junk dropped', async () => {
    const entry = await entryOf({
      name: `  ${'A'.repeat(60)}  `,
      prestige: SANDBOX_MAX_PRESTIGE + 5000.7,
      upgrades: ['honed_edge', 'summon_dragon', 'honed_edge', 42],
      banner: 'gear_iron_helm',
    })

    // Forty characters of a sixty-character name, trimmed of its whitespace
    // first — it is stored on the battle input and printed into the replay.
    expect(entry.squad_name).toHaveLength(40)
    // The unknown row and the duplicate are rebuilt away and the order of what
    // survives is kept; only the real upgrade reaches the engine, as a mod.
    expect(entry.squad_mods).toEqual({ attack: 1 })
    // `gear_iron_helm` is a real item and NOT a banner, so it is not a banner
    // this company could carry — omitted rather than sent.
    expect('squad_abilities' in entry).toBe(false)
  })

  test('clamps prestige into the sanity bound and reads junk as Untested', async () => {
    stubEngine()
    // Prestige reaches the engine only THROUGH the sheet (it decides nothing
    // the engine reads), so what it is pinned by here is the rank ladder the
    // banner rule is written against — see the banner test below.
    const res = await launchSquad({ prestige: 'lots' })
    expect(res.status).toBe(201)
  })

  test('drops the whole sheet when the archetype is one nobody knows', async () => {
    stubEngine()
    await launch({
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 }],
      enemy_placement: [],
      squads: { blue: [{ id: 1, name: 'Ghosts', archetype: 'phalanx', upgrades: ['honed_edge'] }] },
    })

    // The archetype decides which types may stand in the company and how many,
    // so a company with none has no caps at all — dropping the sheet is what
    // keeps R-7's one remaining fence from being turned off by a typo. The body
    // simply fights loose.
    expect(inputOf().player_placement).toEqual([{ unit_type: 'Soldier', q: 4, r: 4 }])
  })

  test('takes a banner whatever the prestige, and three upgrades with no slot to pay with', async () => {
    // R-7 outright: any banner item and any upgrades REGARDLESS OF SLOTS. An
    // Untested company has no upgrade slot and no banner rung in the campaign;
    // here it carries three rows and the standard, because the lab is where you
    // ask what they do.
    const entry = await entryOf({
      prestige: 0,
      upgrades: ['honed_edge', 'heavier_kit', 'formation_fighters'],
      banner: 'banner_unbroken_line',
    })

    expect(entry.squad_mods).toEqual({ attack: 1, armour: 1, formationFighter: 2 })
    expect(entry.squad_abilities).toEqual(['fearless'])
  })

  test('says nothing at all for a company with nothing to say', async () => {
    const entry = await entryOf({ name: '1st Cohort' })

    // The absence rule, one layer up from the caster fields: an unupgraded,
    // bannerless company sends its two tags and no empty bags beside them.
    expect(entry).toEqual({
      unit_type: 'Soldier', q: 4, r: 4, squad_id: 1, squad_name: '1st Cohort',
    })
    expect('squad_mods' in entry).toBe(false)
    expect('squad_abilities' in entry).toBe(false)
  })

  test('names an unnamed company by its number rather than sending an empty string', async () => {
    const entry = await entryOf({ name: '   ' })
    expect(entry.squad_name).toBe('Company 1')
  })

  test('caps the sheets by COUNT before rebuilding any of them', async () => {
    const many = Array.from({ length: SANDBOX_MAX_SQUADS_PER_SIDE + 1 }, (_, i) => ({
      id: i + 1, archetype: 'line',
    }))
    const res = await launch({ ...oneOfEach, squads: { blue: many } })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too many companies on the player side/i)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })
})

describe('the squad fields on a placement entry (R-7)', () => {
  const inputOf = () => engine.runBattle.mock.calls[0][0]

  const sheets = {
    blue: [{ id: 1, name: '1st Cohort', archetype: 'line', upgrades: ['honed_edge'] }],
    red: [{ id: 9, name: 'The Host', archetype: 'line' }],
  }

  test('survives only when it names a sheet on its OWN side', async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 },
        // Red's company: not blue's to field, so the tag drops and the body
        // fights loose rather than borrowing another army's charter.
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 9 },
        // A number nobody sent a sheet for: a tag with nothing behind it could
        // carry no mods anyway.
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 4 },
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 'first' },
      ],
      enemy_placement: [{ unit_type: 'Soldier', q: 4, r: 25, squad_id: 9 }],
      squads: sheets,
    })

    const [tagged, ...loose] = inputOf().player_placement
    expect(tagged.squad_id).toBe(1)
    for (const entry of loose) expect(entry).toEqual({ unit_type: 'Soldier', q: 4, r: 4 })
    // Red's own company is red's to field.
    expect(inputOf().enemy_placement[0].squad_id).toBe(9)
    expect(inputOf().enemy_placement[0].squad_name).toBe('The Host')
  })

  test('discards a forged squad_mods, squad_abilities and squad_name and rebuilds all three', async () => {
    stubEngine()
    await launch({
      player_placement: [{
        unit_type: 'Soldier', q: 4, r: 4, squad_id: 1,
        squad_name: 'The Invincibles',
        squad_mods: { attack: 99, armour: 99 },
        squad_abilities: ['fearless', 'nocorpse'],
      }],
      enemy_placement: [],
      squads: sheets,
    })

    // The deploy route's own rule, moved here unchanged: the client sends
    // placements, never stat modifiers. `honed_edge` is worth +1 attack and
    // the company carries no banner, so THAT is what crosses.
    expect(inputOf().player_placement).toEqual([{
      unit_type: 'Soldier', q: 4, r: 4,
      squad_id: 1, squad_name: '1st Cohort', squad_mods: { attack: 1 },
    }])
  })

  test('strips a forged pair outright from a body in no company at all', async () => {
    stubEngine()
    await launch({
      player_placement: [{
        unit_type: 'Soldier', q: 4, r: 4,
        squad_mods: { attack: 99 }, squad_abilities: ['fearless'], squad_name: 'Nobody',
      }],
      enemy_placement: [],
    })

    expect(inputOf().player_placement).toEqual([{ unit_type: 'Soldier', q: 4, r: 4 }])
  })

  test('formation_fighters travels as a mod, and a banner as an ability', async () => {
    stubEngine()
    await launch({
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 }],
      enemy_placement: [],
      squads: {
        blue: [{
          id: 1, name: 'Drilled', archetype: 'line',
          upgrades: ['formation_fighters'], banner: 'banner_unbroken_line',
        }],
      },
    })

    // formationFighter is not a `stat` row but IS an engine stat, applied by
    // the same AUnit::applyStatMod — it rides squad_mods rather than a private
    // transport, exactly as it does from the deploy route.
    const [entry] = inputOf().player_placement
    expect(entry.squad_mods).toEqual({ formationFighter: 2 })
    // The engine learns the ABILITY and never that a banner exists (6-7): the
    // translation happens campaign-side, where the item catalog is.
    expect(entry.squad_abilities).toEqual(['fearless'])
  })

  test("a caster in the company carries the company's mods and abilities", async () => {
    stubEngine()
    await launch({
      player_placement: [
        { unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 },
        { unit_type: 'Mage', q: 4, r: 4, squad_id: 1, paths: { fire: 3 } },
      ],
      enemy_placement: [],
      squads: {
        blue: [{
          id: 1, name: 'Drilled', archetype: 'line',
          upgrades: ['honed_edge'], banner: 'banner_unbroken_line',
        }],
      },
    })

    // `modsFor`/`abilitiesFor` at the deploy route: an attached character rides
    // with their squad and is covered by its banner (5-0, 13-17). His own
    // caster fields ride alongside, untouched.
    expect(inputOf().player_placement[1]).toEqual({
      unit_type: 'Mage', q: 4, r: 4,
      squad_id: 1, squad_name: 'Drilled',
      squad_mods: { attack: 1 }, squad_abilities: ['fearless'],
      paths: { fire: 3 },
    })
  })
})

describe('what a company may look like on the field (R-7)', () => {
  const line = (n, extra = {}) =>
    Array.from({ length: n }, () => ({ unit_type: 'Soldier', q: 4, r: 4, squad_id: 1, ...extra }))

  const withSheet = (sheet, entries) => launch({
    player_placement: entries,
    enemy_placement: [],
    squads: { blue: [{ id: 1, name: '1st Cohort', archetype: 'line', ...sheet }] },
  })

  test('refuses a company standing on two hexes', async () => {
    const res = await withSheet({}, [
      { unit_type: 'Soldier', q: 4, r: 4, squad_id: 1 },
      { unit_type: 'Soldier', q: 5, r: 4, squad_id: 1 },
    ])

    // The engine groups a formation by hex + squad_id, so a company on two
    // hexes arrives as two formations with no cohesion between them — the very
    // degradation addBlock throws rather than performs.
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/1st Cohort stands on more than one hex — one company, one hex/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('refuses more of a type than the archetype caps', async () => {
    const res = await withSheet({}, line(SQUAD_ARCHETYPES.line.caps.Soldier + 1))

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/1st Cohort may field 40 Soldier, not 41/)
    expect(engine.runBattle).not.toHaveBeenCalled()
  })

  test('deeper_ranks lifts the very cap the lab checks against', async () => {
    stubEngine()
    // squadCaps resolves the archetype row THROUGH the upgrades, so this proves
    // the check reads the rule site rather than the archetype table — a caps
    // row raises the cap here for the same reason it raises it in a campaign.
    const res = await withSheet(
      { upgrades: ['deeper_ranks'] },
      line(SQUAD_ARCHETYPES.line.caps.Soldier + 1),
    )
    expect(res.status).toBe(201)
  })

  test('refuses a type the archetype does not name at all', async () => {
    const res = await withSheet({}, [{ unit_type: 'Cavalry', q: 4, r: 4, squad_id: 1 }])

    // The caps are what MAKE it that archetype: a caps row widens the muster,
    // it never admits a type the charter was not written for.
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/1st Cohort is a line company and has no place for Cavalry/)
  })

  test('a caster on the company hex sits OUTSIDE the caps', async () => {
    stubEngine()
    const res = await withSheet({}, [
      ...line(SQUAD_ARCHETYPES.line.caps.Soldier),
      { unit_type: 'Mage', q: 4, r: 4, squad_id: 1 },
      { unit_type: 'Priest', q: 4, r: 4, squad_id: 1 },
    ])

    // Characters sit outside the CAPS (decision 3) and inside the hex, which is
    // where an attached lab caster sits too — a full company may still take one.
    expect(res.status).toBe(201)
  })

  test('lets an untagged body stand on the company hex without joining it', async () => {
    stubEngine()
    const res = await withSheet({}, [
      ...line(SQUAD_ARCHETYPES.line.caps.Soldier),
      { unit_type: 'Cavalry', q: 4, r: 4 },
    ])

    // Loose troops are budgeted against nothing but the hex: the caps are a
    // fence around a COMPANY, not around a coordinate.
    expect(res.status).toBe(201)
  })
})

describe('POST /api/sandbox/squad-caps (the D3 pattern)', () => {
  const caps = (body) =>
    api.post('/api/sandbox/squad-caps').set('Authorization', `Bearer ${token}`).send(body)

  test('requires a login', async () => {
    expect((await api.post('/api/sandbox/squad-caps').send({ archetype: 'line' })).status).toBe(401)
  })

  test('answers the archetype row, and answers it THROUGH the upgrades', async () => {
    expect((await caps({ archetype: 'line' })).body.caps)
      .toEqual(SQUAD_ARCHETYPES.line.caps)
    expect((await caps({ archetype: 'vanguard' })).body.caps)
      .toEqual(SQUAD_ARCHETYPES.vanguard.caps)

    // +2 to every type this company may field.
    expect((await caps({ archetype: 'line', upgrades: ['deeper_ranks'] })).body.caps)
      .toEqual({ Soldier: 42, Pikeman: 12 })

    // A type-swap row rewrites which type a cap is FOR, and it applies BEFORE
    // the caps bonus — the ordering squadCaps owns, which is exactly what the
    // sheet must not hold a second copy of.
    expect((await caps({ archetype: 'line', upgrades: ['royal_guard', 'deeper_ranks'] })).body.caps)
      .toEqual({ RoyalGuard: 42, Pikeman: 12 })
  })

  test('sanitizes both halves exactly as a launch would', async () => {
    // An unknown row is never looked at, so the answer is the one a launch
    // carrying the same list would actually be measured against.
    expect((await caps({ archetype: 'line', upgrades: ['deeper_ranks', 'summon_dragon'] })).body.caps)
      .toEqual({ Soldier: 42, Pikeman: 12 })

    // A half-made company has no types yet, which is an answer rather than a
    // refusal — the sheet is still being typed.
    expect((await caps({})).body.caps).toEqual({})
    expect((await caps({ archetype: 'phalanx' })).body.caps).toEqual({})
  })
})

describe('POST /api/sandbox/auto-place with companies (D-R2-4)', () => {
  const autoPlace = (body) =>
    api.post('/api/sandbox/auto-place').set('Authorization', `Bearer ${token}`).send(body)

  const hexOf = (entry) => `${entry.q},${entry.r}`

  test('puts each block on ONE hex, tagged, and scatters the loose army around them', async () => {
    const res = await autoPlace({
      side: 'blue',
      army: { Soldier: 6 },
      squads: [
        { id: 1, army: { Soldier: 20, Archer: 10 } },
        { id: 2, army: { Cavalry: 5 } },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body.placement).toHaveLength(41)

    // ONE SQUAD, ONE HEX: the engine groups a formation by hex + squad_id, so a
    // block scattered unit by unit would arrive as N one-member companies.
    for (const id of [1, 2]) {
      const block = res.body.placement.filter((p) => p.squad_id === id)
      expect(new Set(block.map(hexOf)).size).toBe(1)
    }
    expect(res.body.placement.filter((p) => p.squad_id === 1)).toHaveLength(30)
    expect(res.body.placement.filter((p) => p.squad_id === 2)).toHaveLength(5)

    // Blocks first, then the loose troops — which is what makes addBlock's
    // "prefer an untouched hex" mean anything.
    const loose = res.body.placement.filter((p) => p.squad_id === undefined)
    expect(loose).toHaveLength(6)
    for (const entry of loose) {
      expect(entry.r).toBeGreaterThanOrEqual(info.playerZone.rowMin)
      expect(entry.r).toBeLessThanOrEqual(info.playerZone.rowMax)
    }
    // Two companies never share a hex while an untouched one is left.
    const first = res.body.placement.find((p) => p.squad_id === 1)
    const second = res.body.placement.find((p) => p.squad_id === 2)
    expect(hexOf(first)).not.toBe(hexOf(second))
  })

  test('sends no squads exactly as every launch before this one did', async () => {
    const res = await autoPlace({ side: 'blue', army: { Soldier: 4 } })

    expect(res.status).toBe(200)
    expect(res.body.placement).toHaveLength(4)
    expect(res.body.placement.every((p) => p.squad_id === undefined)).toBe(true)
  })

  test('refuses an over-count list, an unknown company id and an unknown type inside one', async () => {
    const many = Array.from({ length: SANDBOX_MAX_SQUADS_PER_SIDE + 1 }, (_, i) => ({
      id: i + 1, army: { Soldier: 1 },
    }))
    const over = await autoPlace({ side: 'blue', army: {}, squads: many })
    expect(over.status).toBe(400)
    expect(over.body.error).toMatch(/too many companies/i)

    // A block has to be identifiable — there is no loose fallback here, unlike
    // a sheet at the launch route.
    const unknown = await autoPlace({
      side: 'blue', army: {}, squads: [{ id: 'first', army: { Soldier: 1 } }],
    })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toMatch(/each company needs an id/i)

    const dragon = await autoPlace({
      side: 'blue', army: {}, squads: [{ id: 1, army: { Dragon: 1 } }],
    })
    expect(dragon.status).toBe(400)
    expect(dragon.body.error).toMatch(/company 1/)
  })

  test('refuses a block too fat for one hex, naming the company', async () => {
    // Hex::CAPACITY is 640 and a Soldier is 10 size points, so 65 of them
    // cannot stand together — addBlock throws rather than scattering them, and
    // the throw becomes an answer the player can see.
    const res = await autoPlace({
      side: 'blue', army: {}, squads: [{ id: 3, army: { Soldier: 65 } }],
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/company 3/)
    expect(res.body.error).toMatch(/one squad, one hex/)
  })

  test('counts a company body against the per-side cap like any other', async () => {
    const res = await autoPlace({
      side: 'blue',
      army: { Soldier: SANDBOX_MAX_UNITS_PER_SIDE - 5 },
      squads: [{ id: 1, army: { Soldier: 6 } }],
    })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/too many units on the blue side/i)
  })
})
