import fs from 'node:fs'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import config from '../utils/config.js'
import { dumpUnits, getInfo } from '../services/engine.js'
import { syncCatalog } from '../services/catalogSync.js'
import UnitType from '../models/unitType.js'
import { startTestDb, stopTestDb } from './helpers/db.js'
import { engineStatsFixture } from './fixtures/engineStats.js'
import { RECRUIT_POOL, FALLBACK_HIRE } from '../services/recruit.js'
import {
  ENEMY_ARMY,
  STARTING_ROSTER,
  STARTING_SQUADS,
  SQUAD_ARCHETYPES,
  SQUAD_TROOP_BUDGET,
  SQUAD_UPGRADE_POOL,
  SQUAD_CHARACTER_RESERVE,
} from '../utils/campaignConfig.js'

// Contract test against the real C++ binary: what dump-units emits must pass
// the Mongoose schema unchanged, so the DB can never silently drift from the
// engine. Skipped when ./game hasn't been built (e.g. plain `npm test` on a
// fresh checkout).
const hasEngine = fs.existsSync(config.ENGINE_BIN)
if (!hasEngine)
  // A skipIf'd suite is invisible in a green run — say out loud that the
  // engine contract went unchecked so nobody mistakes "passed" for "covered".
  console.warn(
    `engine binary not built (${config.ENGINE_BIN}) — engine contract tests SKIPPED; run \`make\` to enable them`,
  )

describe.skipIf(!hasEngine)('real engine contract', () => {
  beforeAll(startTestDb)
  afterAll(stopTestDb)

  test('dump-units output passes schema validation and syncs 1:1 into the DB', async () => {
    const catalog = await dumpUnits()
    expect(catalog.units.length).toBeGreaterThanOrEqual(10)

    await syncCatalog(catalog)

    const stored = await UnitType.find({})
    expect(stored.map((u) => u.name).sort()).toEqual(
      catalog.units.map((u) => u.name).sort(),
    )
    for (const unit of catalog.units) {
      const doc = stored.find((d) => d.name === unit.name)
      expect(doc.size).toBe(unit.size)
      expect(doc.symbol).toBe(unit.symbol)
      expect([...doc.forbiddenTerrain]).toEqual(unit.forbiddenTerrain)
    }
  }, 30000)

  test('info output has the grid/units shape the frontend relies on', async () => {
    const info = await getInfo()
    expect(info.grid.width).toBeGreaterThan(0)
    // info.units is exactly the Player-role subset of the catalog — pin it to
    // dump-units instead of a count so adding a unit type can't silently
    // desync the two engine exports.
    const catalog = await dumpUnits()
    const placeable = catalog.units
      .filter((u) => u.roles.includes('Player'))
      .map((u) => u.name)
      .sort()
    expect(info.units.map((u) => u.type).sort()).toEqual(placeable)
    for (const u of info.units)
      expect(u).toMatchObject({ type: expect.any(String), placementSize: expect.any(Number) })
  }, 30000)

  // Closes the hand-copied-facts loophole: fixtures/engineStats.js (the
  // inputs capabilities.test.js derives scouting/forage/raid math from) is
  // hand-typed, so a C++ stat retune would otherwise leave those tests
  // green while the campaign layer computes from stale numbers. Pin every
  // fixture field to the live dump-units value, unit by unit.
  test('capability stat fixtures match the real engine dump 1:1', async () => {
    const catalog = await dumpUnits()
    for (const [name, pinned] of Object.entries(engineStatsFixture)) {
      const unit = catalog.units.find((u) => u.name === name)
      expect(unit, `dump-units emits no unit named ${name}`).toBeDefined()
      // Compare exactly the fields the fixture pins (it deliberately omits
      // preferredRange — no campaign capability reads it).
      const actual = Object.fromEntries(
        Object.keys(pinned).map((field) => [field, unit.stats[field]]),
      )
      expect({ [name]: actual }).toEqual({ [name]: pinned })
    }
  }, 30000)

  // ── Role coverage: the campaign's unit lists vs the engine catalog ─────────
  //
  // The engine owns unit facts (including roles); campaign-server owns what
  // units COST and who fields them. Nothing can see both at once except a test
  // against the real binary — which is why these live here and not in
  // recruit.test.js, where catalogFixture is hand-written and would stay green
  // through exactly the mistake being guarded against.
  //
  // Direction is always catalog → config: the engine is the source of truth,
  // so every assertion reads "the config covers what the engine offers".
  const namesWithRole = (catalog, role) =>
    catalog.units.filter((u) => u.roles.includes(role)).map((u) => u.name).sort()

  test('every Player-role unit is recruitable in the Recruit phase', async () => {
    const catalog = await dumpUnits()
    const recruitable = new Set(RECRUIT_POOL.map((e) => e.unit))
    const playerTypes = namesWithRole(catalog, 'Player')

    expect(playerTypes.length).toBeGreaterThan(0)
    // No exemptions, deliberately: a rule with a carve-out list is a second
    // thing to maintain. Adding a Player-role unit to the C++ catalog without
    // a RECRUIT_POOL row fails here, naming the unit.
    const unrecruitable = playerTypes.filter((n) => !recruitable.has(n))
    expect(unrecruitable, 'Player-role units with no RECRUIT_POOL entry').toEqual([])
  }, 30000)

  test('RECRUIT_POOL only sells units the engine gives the player', async () => {
    const catalog = await dumpUnits()
    const playerTypes = new Set(namesWithRole(catalog, 'Player'))
    // The converse guard: catches a typo'd or renamed `unit` in a pool row,
    // which would otherwise sell a type no battle could ever deploy. Covers
    // FALLBACK_HIRE too — it hands out Militia and is not a pool row.
    const sold = [...new Set([...RECRUIT_POOL, FALLBACK_HIRE].map((e) => e.unit))].sort()
    expect(sold.filter((n) => !playerTypes.has(n)), 'sold but not a Player unit').toEqual([])
  }, 30000)

  test('ENEMY_ARMY fields only Enemy-role units', async () => {
    const catalog = await dumpUnits()
    const enemyTypes = new Set(namesWithRole(catalog, 'Enemy'))
    const fielded = Object.keys(ENEMY_ARMY).sort()
    expect(fielded.length).toBeGreaterThan(0)
    // Adding a type to ENEMY_ARMY without giving it the Enemy role in C++
    // fails here — mild, deliberate friction that keeps the roles honest.
    expect(fielded.filter((n) => !enemyTypes.has(n)), 'in ENEMY_ARMY without the Enemy role')
      .toEqual([])
  }, 30000)

  test('the starting army is made only of Player-role units', async () => {
    const catalog = await dumpUnits()
    const playerTypes = new Set(namesWithRole(catalog, 'Player'))
    const startingTypes = new Set([
      ...Object.keys(STARTING_ROSTER),
      ...STARTING_SQUADS.flatMap((s) => Object.keys(s.composition)),
    ])
    // Closes the last way to hand the player a unit they could never
    // legitimately own — a summon, a mount, or an enemy-only type.
    expect(
      [...startingTypes].sort().filter((n) => !playerTypes.has(n)),
      'in the starting army without the Player role',
    ).toEqual([])
  }, 30000)

  // ── The hex budget: a bug fence, not a design knob ────────────────────────
  //
  // A squad is always ONE formation on ONE hex, so an archetype whose caps
  // outgrow the hex would field a squad that cannot be placed whole — and the
  // raid route's addBlock now THROWS rather than scattering it (decisions G
  // and H). The check needs both halves of the fact and only a run against the
  // real binary can see them: the caps are campaign config, what a body
  // occupies is engine data.
  test('no archetype at full strength outgrows the hex budget', async () => {
    const catalog = await dumpUnits()
    const sizeOf = new Map(catalog.units.map((u) => [u.name, u.size]))
    for (const [id, archetype] of Object.entries(SQUAD_ARCHETYPES)) {
      const points = Object.entries(archetype.caps).reduce((sum, [type, cap]) => {
        const size = sizeOf.get(type)
        expect(size, `${id} caps ${type}, which the engine catalog does not know`).toBeDefined()
        return sum + size * cap
      }, 0)
      // Characters sit outside the CAPS but inside the HEX, so their reserve
      // counts against the same budget — a cap raise that only fits by
      // borrowing the character's room is exactly the case this catches.
      expect(
        points + SQUAD_CHARACTER_RESERVE,
        `archetype ${id} at full strength does not fit SQUAD_TROOP_BUDGET`,
      ).toBeLessThanOrEqual(SQUAD_TROOP_BUDGET)
    }
  }, 30000)

  // The same fence, with slice 4a's caps upgrades applied. The base check above
  // only ever sees an archetype's PRINTED caps, so a caps row is exactly the
  // way a squad could be handed more bodies than its hex holds without anything
  // noticing — the slice-4 spec calls this out as the invariant to respect.
  // Summed over every caps row an archetype may draw, since upgrades stack and
  // nothing stops a squad taking all of them it is eligible for.
  test('no archetype outgrows the hex budget once its caps upgrades are taken', async () => {
    const catalog = await dumpUnits()
    const sizeOf = new Map(catalog.units.map((u) => [u.name, u.size]))
    const capsRows = SQUAD_UPGRADE_POOL.filter((row) => row.effect.kind === 'caps')
    for (const [id, archetype] of Object.entries(SQUAD_ARCHETYPES)) {
      const bonus = capsRows
        .filter((row) => row.archetypes.includes(id))
        .reduce((sum, row) => sum + row.effect.bonus, 0)
      const points = Object.entries(archetype.caps).reduce((sum, [type, cap]) => {
        const size = sizeOf.get(type)
        expect(size, `${id} caps ${type}, which the engine catalog does not know`).toBeDefined()
        return sum + size * (cap + bonus)
      }, 0)
      expect(
        points + SQUAD_CHARACTER_RESERVE,
        `archetype ${id} with every caps upgrade does not fit SQUAD_TROOP_BUDGET`,
      ).toBeLessThanOrEqual(SQUAD_TROOP_BUDGET)
    }
  }, 30000)

  // The budget itself must fit the hex it is a budget FOR: 600 + 40 against
  // Hex::CAPACITY. Pinned to the live grid rather than the 640 in the comments,
  // so an engine capacity change fails here instead of silently un-fencing the
  // gate that protects it.
  test('the squad budget plus its character reserve fits one engine hex', async () => {
    const info = await getInfo()
    expect(SQUAD_TROOP_BUDGET + SQUAD_CHARACTER_RESERVE).toBeLessThanOrEqual(info.grid.hexCapacity)
  }, 30000)
})
