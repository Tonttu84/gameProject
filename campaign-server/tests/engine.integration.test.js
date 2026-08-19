import fs from 'node:fs'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import config from '../utils/config.js'
import { dumpUnits, getInfo, runBattle } from '../services/engine.js'
import { makeZonePlacer } from '../services/enemyPlacement.js'
import { formationFighter, statMods } from '../services/squadUpgrades.js'
import { packedSize, squadCaps } from '../services/squadReinforce.js'
import { syncCatalog } from '../services/catalogSync.js'
import UnitType from '../models/unitType.js'
import { startTestDb, stopTestDb } from './helpers/db.js'
import { engineStatsFixture } from './fixtures/engineStats.js'
import { catalogFixture } from './fixtures/catalog.js'
import { RECRUIT_POOL, FALLBACK_HIRE } from '../services/recruit.js'
import {
  ENEMY_ARMY,
  STARTING_ROSTER,
  STARTING_SQUADS,
  SQUAD_ARCHETYPES,
  SQUAD_TROOP_BUDGET,
  SQUAD_UPGRADE_POOL,
  CHARACTER_TYPES,
  SQUAD_REINFORCE_POOL,
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

  // `preferredRange` was, until slice 5, a field NO campaign capability read —
  // which is why engineStatsFixture deliberately omits it and why the hand-written
  // catalogFixture had drifted to invented values (Priest 0, Archer 8) without
  // anything noticing. 5-8 makes it load-bearing: a character's hang-back DEFAULT
  // is derived from it, so a stale copy silently flips a default the player sees
  // on the screen. Pinned per type rather than wholesale, since the fixture names
  // only a subset of the catalog.
  test('the catalog fixture agrees with the engine about preferredRange', async () => {
    const catalog = await dumpUnits()
    for (const fixtureUnit of catalogFixture.units) {
      const real = catalog.units.find((u) => u.name === fixtureUnit.name)
      if (!real) continue
      expect(
        fixtureUnit.stats.preferredRange,
        `catalogFixture ${fixtureUnit.name}.preferredRange has drifted from the engine`,
      ).toBe(real.stats.preferredRange)
    }
  }, 30000)

  // The hang-back default (5-8) is derived rather than stored, on the strength of
  // a claim about the live catalog: that `preferredRange > 0` picks out exactly
  // the ranged types and nothing else. If a retune ever makes a Mage a melee
  // unit by that measure, the default silently inverts — so assert the claim
  // itself against the real binary rather than trusting the comment.
  test('every character type prefers range, so the hang-back default holds', async () => {
    const catalog = await dumpUnits()
    for (const type of CHARACTER_TYPES) {
      const unit = catalog.units.find((u) => u.name === type)
      expect(unit, `the engine has no unit named ${type}`).toBeDefined()
      expect(
        unit.stats.preferredRange,
        `${type} is a character type but no longer prefers range — the hang-back default has flipped`,
      ).toBeGreaterThan(0)
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

  // WIDENED in 4d, from "every Player type is in RECRUIT_POOL" to "…is in
  // RECRUIT_POOL **or** SQUAD_REINFORCE_POOL". The rule's real intent has
  // always been *no Player type is unobtainable*, and since slice 3 there are
  // TWO honest acquisition channels: hire one, or train one up through a
  // reinforcement recipe. RoyalGuard is the first type reachable only the
  // second way — it must be a Player unit to be deployed, drawn and placed, and
  // must never appear on the Recruit screen, or the royal_guard upgrade would
  // grant a cap rather than the exclusive access it exists to sell.
  //
  // Still no carve-out list, which is the part worth keeping: a genuinely dead
  // type — one no channel can produce — fails here naming itself.
  test('every Player-role unit is obtainable, by hire or by training', async () => {
    const catalog = await dumpUnits()
    const obtainable = new Set([
      ...RECRUIT_POOL.map((e) => e.unit),
      ...SQUAD_REINFORCE_POOL.map((r) => r.output.type),
    ])
    const playerTypes = namesWithRole(catalog, 'Player')

    expect(playerTypes.length).toBeGreaterThan(0)
    const unobtainable = playerTypes.filter((n) => !obtainable.has(n))
    expect(unobtainable, 'Player-role units with no RECRUIT_POOL or SQUAD_REINFORCE_POOL entry')
      .toEqual([])
  }, 30000)

  // The converse for the second channel, matching the RECRUIT_POOL guard below:
  // a recipe that produced a type no battle could deploy would spend real gold
  // on a body that vanishes at the placement boundary.
  test('SQUAD_REINFORCE_POOL only trains units the engine gives the player', async () => {
    const catalog = await dumpUnits()
    const playerTypes = new Set(namesWithRole(catalog, 'Player'))
    const trained = [...new Set(SQUAD_REINFORCE_POOL.map((r) => r.output.type))].sort()
    expect(trained.filter((n) => !playerTypes.has(n)), 'trained but not a Player unit').toEqual([])
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
  // Priced through squadCaps — the reader the route itself uses — with every
  // row the archetype may draw taken at once, rather than re-implementing the
  // fold here. That is what makes it see 4d's TYPE SWAP as well as 4c's caps
  // bonus: the guard replaces a Soldier body for body today, but a swap to a
  // bigger body is exactly the way a squad could be handed more than its hex
  // holds with nothing noticing.
  test('no archetype outgrows the hex budget once its upgrades are taken', async () => {
    const catalog = await dumpUnits()
    const sizeOf = new Map(catalog.units.map((u) => [u.name, u.size]))
    for (const id of Object.keys(SQUAD_ARCHETYPES)) {
      const everyRow = SQUAD_UPGRADE_POOL.filter((row) => row.archetypes.includes(id)).map((r) => r.id)
      const caps = squadCaps({ archetype: id, upgrades: everyRow })
      const points = Object.entries(caps).reduce((sum, [type, cap]) => {
        const size = sizeOf.get(type)
        expect(size, `${id} caps ${type}, which the engine catalog does not know`).toBeDefined()
        return sum + size * cap
      }, 0)
      expect(
        points + SQUAD_CHARACTER_RESERVE,
        `archetype ${id} with every upgrade does not fit SQUAD_TROOP_BUDGET`,
      ).toBeLessThanOrEqual(SQUAD_TROOP_BUDGET)
    }
  }, 30000)

  // ── The two sizes agree across the boundary (slice 4c) ────────────────────
  //
  // The campaign measures a squad against the hex with packedSize(); the engine
  // seats it with AUnit::getPackingSize(). Two implementations of one rule, in
  // two languages — so this runs a drilled block through the REAL binary and
  // checks that every body the campaign said would fit actually reached the
  // field. A floor or a sign that drifted on either side fails here.
  test('a drilled squad packs into one hex exactly as the campaign layer predicts', async () => {
    const info = await getInfo()
    const catalog = await dumpUnits()
    const soldier = catalog.units.find((u) => u.name === 'Soldier')
    const packing = formationFighter({ archetype: 'line', upgrades: ['formation_fighters'] })
    const perHex = Math.floor(info.grid.hexCapacity / packedSize(soldier.size, packing))
    // The upgrade has to buy something, or this test would pass on a no-op.
    expect(perHex).toBeGreaterThan(Math.floor(info.grid.hexCapacity / soldier.size))

    const zone = { ...info.playerZone, width: info.grid.width, hexCapacity: info.grid.hexCapacity }
    const placer = makeZonePlacer(zone, new Map([['Soldier', soldier.size]]))
    placer.addBlock(
      { Soldier: perHex },
      { squad_id: 1, squad_name: 'Drilled', squad_mods: statMods({ archetype: 'line', upgrades: ['formation_fighters'] }) },
    )
    const placement = placer.result()
    expect(placement).toHaveLength(perHex)
    expect(new Set(placement.map((p) => `${p.q}|${p.r}`)).size).toBe(1)

    const { replay } = await runBattle({
      map: 'sample_battle',
      player_placement: placement,
      enemy_placement: [],
      max_turns: 1,
    })
    // Every body the campaign packed onto that hex is on the field at tick 0.
    // Without the packing size the engine would have dropped the overflow at
    // the capacity gate and this would come back short.
    const placed = replay.ticks[0].units.filter((u) => u.team === 'blue')
    expect(placed).toHaveLength(perHex)
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
