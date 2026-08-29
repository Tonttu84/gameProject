import fs from 'node:fs'
import { beforeAll, afterAll, describe, expect, test } from 'vitest'
import config from '../utils/config.js'
import { dumpSpells, dumpUnits, getInfo, runBattle } from '../services/engine.js'
import { makeZonePlacer } from '../services/enemyPlacement.js'
import { formationFighter, statMods } from '../services/squadUpgrades.js'
import { packedSize, squadCaps } from '../services/squadReinforce.js'
import { syncCatalog } from '../services/catalogSync.js'
import UnitType from '../models/unitType.js'
import { startTestDb, stopTestDb } from './helpers/db.js'
import { engineStatsFixture } from './fixtures/engineStats.js'
import { catalogFixture } from './fixtures/catalog.js'
import { RECRUIT_POOL, FALLBACK_HIRE } from '../services/recruit.js'
import { enginePaths, researchView, spellsForSchool, withEnemyScripts } from '../services/magic.js'
import {
  ENEMY_ARMY,
  ENEMY_SCRIPT_STORE,
  MAX_CHOSEN_SPELLS,
  STARTING_ROSTER,
  STARTING_SQUADS,
  SQUAD_ARCHETYPES,
  SQUAD_TROOP_BUDGET,
  SQUAD_UPGRADE_POOL,
  CHARACTER_TYPES,
  SPELL_SCHOOLS,
  SPELL_PATHS,
  SQUAD_REINFORCE_POOL,
  SQUAD_CHARACTER_RESERVE,
  CASTER_CHARACTER_TYPES,
  MINDLESS_CHARACTER_TYPES,
  CRAFTED_UNIT_CATALOG,
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
    // info.units is exactly the placeable subset of the catalog — Player plus
    // Crafted since C-5 (a forged body deploys like a hired one) — pinned to
    // dump-units instead of a count so adding a unit type can't silently
    // desync the two engine exports.
    const catalog = await dumpUnits()
    const placeable = catalog.units
      .filter((u) => u.roles.includes('Player') || u.roles.includes('Crafted'))
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
  //
  // NARROWED by C3 from CHARACTER_TYPES to the caster kind: a MINDLESS
  // character (the Golem) has no hang-back at all (C-4), so its half of the
  // claim runs the other way — it must NOT prefer range, or the derived
  // default would quietly hand it the order it cannot take.
  test('every caster character type prefers range, so the hang-back default holds', async () => {
    const catalog = await dumpUnits()
    for (const type of CASTER_CHARACTER_TYPES) {
      const unit = catalog.units.find((u) => u.name === type)
      expect(unit, `the engine has no unit named ${type}`).toBeDefined()
      expect(
        unit.stats.preferredRange,
        `${type} is a caster character type but no longer prefers range — the hang-back default has flipped`,
      ).toBeGreaterThan(0)
    }
    for (const type of MINDLESS_CHARACTER_TYPES) {
      const unit = catalog.units.find((u) => u.name === type)
      expect(unit, `the engine has no unit named ${type}`).toBeDefined()
      expect(
        unit.stats.preferredRange,
        `${type} is mindless but prefers range — it would default to a hang-back it cannot be ordered out of`,
      ).toBe(0)
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

  // The Crafted twin of the Player obtainability rule, with the same teeth
  // (C-5): a Crafted-role type without a CRAFTED_UNIT_CATALOG row is a body no
  // channel can produce, and a row whose unit the engine does not mark Crafted
  // would mint a character no battle could legally field. Both directions,
  // no carve-out list. And every crafted unit must be a CHARACTER type —
  // the foundry mints individuals, never roster counts (C-4).
  test('Crafted-role units and the foundry catalog agree, both ways', async () => {
    const catalog = await dumpUnits()
    const craftedTypes = namesWithRole(catalog, 'Crafted')
    const forgeable = new Set(CRAFTED_UNIT_CATALOG.map((r) => r.unit))

    expect(craftedTypes.length).toBeGreaterThan(0)
    expect(
      craftedTypes.filter((n) => !forgeable.has(n)),
      'Crafted-role units with no CRAFTED_UNIT_CATALOG row',
    ).toEqual([])

    const craftedSet = new Set(craftedTypes)
    expect(
      [...forgeable].sort().filter((n) => !craftedSet.has(n)),
      'in CRAFTED_UNIT_CATALOG without the Crafted role',
    ).toEqual([])

    expect(
      [...forgeable].sort().filter((n) => !CHARACTER_TYPES.includes(n)),
      'craftable but not a character type — the foundry mints individuals',
    ).toEqual([])
  }, 30000)

  // The whole battle path for a Crafted body, against the real binary: the
  // placement API accepts the type (C-5 widened the trust boundary), it stands
  // a battle, and its character_id comes back in the survivor report — which
  // is what permanent death (C-4) hangs on. An unopposed one-turn field, so
  // survival is a fact rather than a roll.
  test('a Golem with a character_id fights and reports back as a survivor', async () => {
    const result = await runBattle({
      map: 'sample_battle',
      player_placement: [{ unit_type: 'Golem', q: 4, r: 7, character_id: 42, avoids_melee: false }],
      enemy_placement: [],
      max_turns: 1,
    })
    expect(result.replay.ticks[0].units.filter((u) => u.team === 'blue')).toHaveLength(1)
    expect(result.blue_characters).toEqual([42])
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

// ── The spell roster crossing into the campaign layer (slice 3, S3-1) ────────
//
// The other half of the contract the unit catalog already has: the campaign
// server renders gates the ENGINE enforces, so a spell retuned in C++ must move
// The Study with it rather than leaving the screen quietly wrong. These run
// against the real `dump-spells`, which is what makes them worth having —
// tests/research.test.js pins the same shapes against a fixture.
describe.skipIf(!hasEngine)('the real spell roster', () => {
  test('dump-spells emits the fields the research view reads', async () => {
    const { spells } = await dumpSpells()
    expect(spells.length).toBeGreaterThan(0)

    for (const row of spells) {
      expect(typeof row.spell).toBe('string')
      expect(typeof row.form).toBe('string')
      // A blank label renders as an empty row and a blank description opens to
      // an empty panel (S3-4) — both read as bugs to the player.
      expect(row.label.length).toBeGreaterThan(0)
      expect(row.description.length).toBeGreaterThan(0)
      expect(row.paths.length).toBeGreaterThan(0)
      for (const req of row.paths) expect(SPELL_PATHS).toContain(req.path)
      if (row.school !== null) expect(SPELL_SCHOOLS).toContain(row.school)
      expect(row.fatigue).toBeGreaterThan(0)
      expect(row.castingTime).toBeGreaterThanOrEqual(1)
    }
  })

  test('every school-less form is Holy or Unholy — what S3-2 filters on', async () => {
    const { spells } = await dumpSpells()
    // The Study drops `school === null` and nothing else. If an ARCANE spell
    // ever lost its school gate it would vanish off the research screen without
    // a word, so the property that makes the filter safe is pinned here.
    for (const row of spells) {
      const granted = ['holy', 'unholy'].includes(row.paths[0].path)
      expect(row.school === null).toBe(granted)
    }
    expect(spells.some((row) => row.school === null)).toBe(true)
  })

  test('every researchable school the engine names is one the campaign offers', async () => {
    const { spells } = await dumpSpells()
    // The reverse of the filter above: a school authored in C++ that the
    // campaign layer does not know would hold spells no screen could ever show.
    const named = new Set(spells.map((row) => row.school).filter(Boolean))
    for (const school of named) expect(SPELL_SCHOOLS).toContain(school)
  })

  test('the real roster groups cleanly under the campaign view', async () => {
    const { spells } = await dumpSpells()
    // A skeleton campaign, the same degrade-safely shape the structural tests
    // sweep through magic.js: no document, just the numbers researchView reads.
    const campaign = {
      research: {
        focus: 'evocation',
        allies: 0,
        schools: Object.fromEntries(
          SPELL_SCHOOLS.map((s) => [s, { level: s === 'evocation' ? 1 : 0, points: 0 }]),
        ),
      },
    }
    const view = researchView(campaign, spells)

    // Every arcane form lands under exactly one school, and none is orphaned.
    const shown = SPELL_SCHOOLS.flatMap((s) => view.schools[s].spells)
    expect(shown).toHaveLength(spells.filter((row) => row.school !== null).length)

    // Evocation at 1 unlocks its level-1 forms and not its level-3 ones — the
    // gate the engine itself applies (Spells::qualifies), read off the view.
    for (const spell of view.schools.evocation.spells)
      expect(spell.unlocked).toBe(spell.schoolLevel <= 1)
  })

  // ── Chosen spells against the real binary (slice 4) ───────────────────────
  //
  // The strongest test in the slice, and the reason it is here rather than
  // against a fixture: it proves the WHOLE chain in one run — a list on a
  // placement entry, parsed at the wire, reordering the caster's walk, and a
  // different spell actually leaving his hands. A fixture can only ever pin the
  // shape of the JSON.
  //
  // It reads the verdict off the cast line S4-8 added, which is also the only
  // channel the PLAYER has for judging a script. If that line ever stops being
  // emitted this test goes red, which is the right coupling: the feature and
  // its evidence are the same thing.
  // The log crosses TIER-TAGGED since the tiered-logging pass; a bare string is
  // what a pre-ladder binary emits. Read through one accessor so these tests
  // pin the CAST, not the wire shape it happens to arrive in.
  const lineText = (l) => (typeof l === 'string' ? l : l.text)
  const castsIn = (replay) =>
    replay.ticks
      .flatMap((t) => t.log ?? [])
      .map(lineText)
      .filter((l) => l.includes(' casts '))

  // One Mage who commands two paths, against a host far enough away to give him
  // several turns of casting. Evocation 1 opens the minor form of both spells,
  // so which one he reaches for is decided by his list and by nothing else.
  const castingMage = async (script) => {
    const entry = { unit_type: 'Mage', q: 4, r: 7, paths: { fire: 1, air: 1 } }
    if (script) entry.script = script
    const { replay } = await runBattle({
      map: 'sample_battle',
      player_placement: [entry],
      enemy_placement: [{ unit_type: 'Soldier', q: 4, r: 22, count: 6 }],
      max_turns: 40,
      magic: {
        blue: { schools: { evocation: 1, conjuration: 0, enchantment: 0, construction: 0 }, channels: 0 },
        red: { schools: { evocation: 0, conjuration: 0, enchantment: 0, construction: 0 }, channels: 0 },
      },
    })
    return castsIn(replay)
  }

  test('an unscripted caster reaches for the roster\'s own order', async () => {
    const casts = await castingMage(null)
    expect(casts.length).toBeGreaterThan(0)
    expect(casts.every((l) => l.includes('Ember'))).toBe(true)
  }, 30000)

  test('a chosen spell leads — the same mage now casts what he was given', async () => {
    const casts = await castingMage(['shock'])
    expect(casts.length).toBeGreaterThan(0)
    expect(casts.every((l) => l.includes('Shock'))).toBe(true)
  }, 30000)

  test('an unknown id is skipped, and the caster is never left mute', async () => {
    // The never-throw discipline at the wire, proved rather than assumed: a
    // list the roster cannot resolve must degrade to the default walk, not to
    // silence. S4-1's promise is that nothing here can stop a caster casting.
    const casts = await castingMage(['no_such_spell'])
    expect(casts.length).toBeGreaterThan(0)
    expect(casts.every((l) => l.includes('Ember'))).toBe(true)
  }, 30000)

  // ── The enemy script store against the real roster (slice B, E-7 / E-8) ───
  //
  // The store is HAND-AUTHORED campaign-side and names spells the ENGINE owns,
  // which is exactly the hand-copied-facts loophole the fixtures above close for
  // unit stats: a renamed or retired spell id would leave every unit test green
  // (a row nobody qualifies for is a legal row) while the host quietly stopped
  // scripting anything. Only a run against the real binary can see both halves.
  test('every id in ENEMY_SCRIPT_STORE is a spell the engine actually carries', async () => {
    const { spells } = await dumpSpells()
    const known = new Set(spells.map((row) => row.spell))
    const named = [...new Set(ENEMY_SCRIPT_STORE.flatMap((row) => row.spells))].sort()
    expect(named.length).toBeGreaterThan(0)
    expect(
      named.filter((id) => !known.has(id)),
      'scripted by ENEMY_SCRIPT_STORE but not in the engine roster',
    ).toEqual([])
    // The same two shape rules the player's own list is held to, restated here
    // against the live roster so a row cannot grow past what the engine will
    // read off a placement entry.
    for (const row of ENEMY_SCRIPT_STORE) {
      expect(row.spells.length, `${row.id} exceeds MAX_CHOSEN_SPELLS`)
        .toBeLessThanOrEqual(MAX_CHOSEN_SPELLS)
      expect(new Set(row.spells).size, `${row.id} names a spell twice`).toBe(row.spells.length)
    }
  })

  // The whole of slice B in one run, and the twin of the player's chosen-spells
  // case above: an authored store row, matched by the campaign's own walk
  // against a sealed encounter, riding the ordinary `script` field, and the
  // spell actually leaving an ENEMY caster's hands. Nothing here mocks anything.
  //
  // Leaden Air is the row worth proving because it is the one the pool locks
  // (E-8): the red block below seals Enchantment 2 and 3 channels, which is
  // precisely what qualifies it. Drop either and the cast does not happen.
  test('a store-scripted enemy caster casts what the store gave him', async () => {
    const { spells } = await dumpSpells()
    const magic = {
      schools: { evocation: 1, conjuration: 2, enchantment: 2, construction: 0 },
      channels: 3,
    }
    // Composed exactly as buildEnemyPlacement and the raid route compose it:
    // paths already on the entry, then the derived scripting pass over them.
    const enemy = withEnemyScripts(
      [{ unit_type: 'Necromancer', q: 4, r: 22, paths: enginePaths({ death: 2 }) }],
      magic,
      spells,
    )
    // The store, not the test, decided this — so say out loud what it decided,
    // and fail here rather than in the log assertion if a retune moves it.
    expect(enemy[0].script, 'the store no longer scripts Leaden Air for a Death 2 raiser')
      .toContain('leaden_air')

    const { replay } = await runBattle({
      map: 'sample_battle',
      player_placement: [{ unit_type: 'Soldier', q: 4, r: 7, count: 6 }],
      enemy_placement: enemy,
      max_turns: 40,
      magic: {
        blue: { schools: { evocation: 0, conjuration: 0, enchantment: 0, construction: 0 }, channels: 0 },
        red: magic,
      },
    })
    const casts = castsIn(replay)
    expect(casts.length).toBeGreaterThan(0)
    expect(casts.some((l) => l.includes('Leaden Air')), casts.join(' | ')).toBe(true)
  }, 30000)

  test('spellsForSchool keeps the engine order, so minor precedes major', async () => {
    const { spells } = await dumpSpells()
    for (const school of SPELL_SCHOOLS) {
      const rows = spellsForSchool(spells, school, 9)
      // Within one spell the engine authors weakest first — the order
      // chooseSpellToCast walks (M-13). A screen that re-sorted would show the
      // major form above the minor one it falls back to.
      const bySpell = new Map()
      for (const row of rows) {
        const seen = bySpell.get(row.spell) ?? []
        seen.push(row.schoolLevel)
        bySpell.set(row.spell, seen)
      }
      for (const levels of bySpell.values())
        expect([...levels]).toEqual([...levels].sort((a, b) => a - b))
    }
  })
})
