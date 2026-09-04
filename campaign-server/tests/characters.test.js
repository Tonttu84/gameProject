import { describe, expect, test, beforeEach } from 'vitest'
import {
  isCharacterType,
  livingCharacters,
  characterById,
  charactersOfSquad,
  looseCharacters,
  characterBodies,
  allBodies,
  characterMods,
  characterSheet,
  characterSlots,
  hangsBackByDefault,
  nextCharacterId,
  drawCharacterName,
  mintCharacter,
  planAttach,
  characterEntryFor,
  reconcileCharacters,
  wornItems,
  characterAbilities,
  characterIsAway,
  awayBlocker,
  planEquip,
  planUnequip,
} from '../services/characters.js'
import { enginePaths } from '../services/magic.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { catalogFixture } from './fixtures/catalog.js'
import {
  CHARACTER_TYPES,
  CHARACTER_NAMES,
  CHARACTER_VALUE_BASE,
  MAX_CHARACTERS_PER_SQUAD,
  STARTING_CHARACTERS,
} from '../utils/campaignConfig.js'

// The character layer (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS"), pure
// half: the living filter, the modifier seam, minting, attachment and the
// reckoning after a battle. Route wiring lives in campaigns.test.js.

const catalog = new Map(catalogFixture.units.map((u) => [u.name, u]))

const character = (overrides = {}) => ({
  id: 1,
  name: 'Isolde',
  type: 'Mage',
  squadId: null,
  hangBack: true,
  alive: true,
  diedDay: null,
  items: [],
  experience: 0,
  wounds: [],
  ...overrides,
})

const campaignWith = (characters, roster = {}) => ({
  characters,
  roster: new Map(Object.entries(roster)),
  squads: [{ id: 1, name: '1st Cohort' }, { id: 2, name: 'Skirmishers' }],
})

beforeEach(clearRolls)

describe('who is who', () => {
  test('the character types are exactly the ones config names', () => {
    for (const type of CHARACTER_TYPES) expect(isCharacterType(type)).toBe(true)
    expect(isCharacterType('Soldier')).toBe(false)
    expect(isCharacterType(undefined)).toBe(false)
  })

  // The dead stay on the rolls (5-9), so every reader that asks "who can do
  // something" has to filter — forgetting it is how a fallen mage reads omens.
  test('the living exclude the dead, who are still on the rolls', () => {
    const c = campaignWith([character(), character({ id: 2, alive: false, diedDay: 3 })])
    expect(livingCharacters(c).map((x) => x.id)).toEqual([1])
    expect(c.characters).toHaveLength(2)
  })

  test('lookup by id tolerates a string, and misses cleanly', () => {
    const c = campaignWith([character()])
    expect(characterById(c, '1')?.id).toBe(1)
    expect(characterById(c, 99)).toBeNull()
  })

  test('a squad’s characters are its living ones only', () => {
    const c = campaignWith([
      character({ id: 1, squadId: 1 }),
      character({ id: 2, squadId: 1, alive: false }),
      character({ id: 3, squadId: 2 }),
    ])
    expect(charactersOfSquad(c, 1).map((x) => x.id)).toEqual([1])
    expect(looseCharacters(c)).toEqual([])
  })

  test('an absent characters field reads as empty rather than throwing', () => {
    expect(livingCharacters({})).toEqual([])
    expect(livingCharacters(undefined)).toEqual([])
    expect(characterBodies({})).toEqual(new Map())
  })
})

// 5-10, straight from 5-0: characters are troops for every army-wide number.
// If they stopped counting, migrating six casters out of the roster would
// refund their rations and shift the meter — balance changes nobody chose.
describe('every body in camp', () => {
  test('characters are added to the roster’s count, by type', () => {
    const c = campaignWith(
      [character({ id: 1, type: 'Mage' }), character({ id: 2, type: 'Priest' })],
      { Soldier: 10, Mage: 0 },
    )
    const bodies = allBodies(c)
    expect(bodies.get('Soldier')).toBe(10)
    expect(bodies.get('Mage')).toBe(1)
    expect(bodies.get('Priest')).toBe(1)
  })

  test('the dead eat nothing', () => {
    const c = campaignWith([character({ alive: false })], { Soldier: 1 })
    expect(allBodies(c).get('Mage')).toBeUndefined()
  })

  test('the roster is never mutated by the reading', () => {
    const c = campaignWith([character()], { Soldier: 1 })
    allBodies(c)
    expect(c.roster.get('Mage')).toBeUndefined()
    expect([...c.roster.keys()]).toEqual(['Soldier'])
  })

  test('an explicit roster argument wins over the campaign’s own', () => {
    const c = campaignWith([character()], { Soldier: 1 })
    expect(allBodies(c, { Archer: 5 }).get('Archer')).toBe(5)
    expect(allBodies(c, { Archer: 5 }).get('Soldier')).toBeUndefined()
  })
})

// 5-2/5-3: the base type is never modified, sources are stored, the bag is
// derived. It returns {} today and that is the point — the seam exists and its
// callers are wired, so the slices that fill it change one function.
describe('the modifier seam', () => {
  test('a character with nothing on them modifies nothing', () => {
    expect(characterMods(character())).toEqual({})
  })

  test('experience and wounds are still unpriced', () => {
    // 9a filled the ITEMS half of the seam and deliberately left the other two:
    // they are later slices. When that changes, this test changes with it.
    const decorated = character({ experience: 40, wounds: [{ id: 'limp' }] })
    expect(characterMods(decorated)).toEqual({})
  })

  test('it never throws on a half-built character', () => {
    expect(characterMods({})).toEqual({})
    expect(characterMods(undefined)).toEqual({})
  })
})

// ── Gear (slice 9a) ─────────────────────────────────────────────────────────
//
// The seam 5a shipped empty, filled. What these cases guard is the promise 5-3
// made and 9a has to keep: SOURCES are stored and the bag is DERIVED, so
// retuning an item re-prices every character that already owns one.

const HUMANOID = { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 }

describe('what gear adds up to', () => {
  test('one item is its own bag', () => {
    const kitted = character({
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(characterMods(kitted, HUMANOID)).toEqual({ attack: 1 })
  })

  test('deltas ADD across items, including negative ones', () => {
    // The hauberk pays for its armour in speed. Two items touching two stats
    // and one item touching two stats at once, all in one bag.
    const kitted = character({
      items: [
        { slot: 'torso', index: 0, itemId: 'gear_mail_hauberk' },  // +1 armour, -1 speed
        { slot: 'legs',  index: 0, itemId: 'gear_boiled_greaves' }, // +1 armour
      ],
    })
    expect(characterMods(kitted, HUMANOID)).toEqual({ armour: 2, speed: -1 })
  })

  test('the bag is DERIVED, so a retuned catalog re-prices an old save', () => {
    // 5-3's whole promise, as a test: nothing about the modifier is stored on
    // the character, so this cannot go stale. The document holds an id.
    const kitted = character({
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(kitted.items[0]).not.toHaveProperty('mods')
    expect(characterMods(kitted, HUMANOID)).toEqual({ attack: 1 })
  })

  test('an id whose row has left the catalog is dropped, not thrown on', () => {
    const kitted = character({
      items: [
        { slot: 'hand', index: 0, itemId: 'gear_of_a_previous_build' },
        { slot: 'head', index: 0, itemId: 'gear_iron_helm' },
      ],
    })
    expect(characterMods(kitted, HUMANOID)).toEqual({ defence: 1 })
  })

  test('gear worn in a slot the creature does not have is stranded, not counted', () => {
    // 5-5: a creature that loses a limb changes its LAYOUT only. The save is
    // never surgically rewritten, so this is a read-time filter — and the item
    // comes back if the limb does.
    const horseLike = { head: 1, torso: 1, legs: 1, hand: 0, misc: 1 }
    const kitted = character({
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(characterMods(kitted, horseLike)).toEqual({})
    expect(wornItems(kitted, horseLike)).toHaveLength(0)
    // Still on the record, untouched.
    expect(kitted.items).toHaveLength(1)
    expect(characterMods(kitted, HUMANOID)).toEqual({ attack: 1 })
  })

  test('with no anatomy in hand, nothing is stranded', () => {
    const kitted = character({
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(characterMods(kitted)).toEqual({ attack: 1 })
  })
})

describe('the character sheet (9-16)', () => {
  const mage = catalogFixture.units.find((u) => u.name === 'Mage')

  test('base plus the bag, in the vocabulary the item cards use', () => {
    const sheet = characterSheet(mage.stats, { defence: 1, speed: -1 })
    const row = (stat) => sheet.find((r) => r.stat === stat)
    expect(row('defence')).toEqual({
      stat: 'defence',
      label: 'defence',
      base: mage.stats.defence,
      delta: 1,
      value: mage.stats.defence + 1,
    })
    expect(row('speed').value).toBe(mage.stats.speed - 1)
    // Untouched stats are still ON the sheet — it is a sheet, not a diff.
    expect(row('attack')).toMatchObject({ delta: 0, value: mage.stats.attack })
    expect(row('maxHP').label).toBe('stamina')
  })

  test('reconTag is not a sheet number (9-5)', () => {
    // A signed fudge term in the recon formula, not something a player reads.
    // The exclusion falls out of reusing ITEM_STAT_TEXT as the vocabulary,
    // which is why there is no second list to keep in step.
    expect(characterSheet(mage.stats).map((r) => r.stat)).not.toContain('reconTag')
  })

  test('a stat the type does not carry shows up only once something moves it', () => {
    // The engine exports formationFighter; the campaign's UnitType does not
    // store it. A modifier to a stat with no base must still be visible — a
    // number the player cannot see is worse than a zero they can.
    expect(characterSheet(mage.stats).map((r) => r.stat)).not.toContain('formationFighter')
    expect(characterSheet(mage.stats, { formationFighter: 2 }).find(
      (r) => r.stat === 'formationFighter',
    )).toMatchObject({ base: 0, delta: 2, value: 2 })
  })

  test('a type the catalog cannot describe has no sheet at all', () => {
    // Null, not a table of zeroes: "nothing is known about this creature" and
    // "every number is zero" are different sentences, and the screen says the
    // first.
    expect(characterSheet(null, { attack: 1 })).toBeNull()
    expect(characterSlots(null)).toBeNull()
  })

  test('the slots are phrased, ordered, and only the ones that exist', () => {
    expect(characterSlots(HUMANOID)).toEqual([
      { slot: 'head', label: 'head', count: 1 },
      { slot: 'torso', label: 'body', count: 1 },
      { slot: 'legs', label: 'legs', count: 1 },
      { slot: 'hand', label: 'hand', count: 2 },
      { slot: 'misc', label: 'kit', count: 1 },
    ])
    // A slot the creature does not have is DROPPED rather than sent as a zero:
    // an empty row a player can never fill reads as a bug.
    expect(characterSlots({ head: 1, torso: 1, legs: 1, hand: 0, misc: 0 }).map((r) => r.slot))
      .toEqual(['head', 'torso', 'legs'])
  })
})

describe('what gear grants and denies', () => {
  test('a relic hands over its ability word', () => {
    const kitted = character({
      items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }],
    })
    expect(characterAbilities(kitted, HUMANOID).granted).toEqual(['fearless'])
    expect(characterAbilities(kitted, HUMANOID).denied).toEqual([])
  })

  test('two items granting the same word grant it once', () => {
    const kitted = character({
      items: [
        { slot: 'misc', index: 0, itemId: 'relic_the_long_watch' },
        { slot: 'head', index: 0, itemId: 'relic_the_long_watch' },
      ],
    })
    expect(characterAbilities(kitted, HUMANOID).granted).toEqual(['fearless'])
  })

  test('a character with nothing on them grants and denies nothing', () => {
    expect(characterAbilities(character())).toEqual({ granted: [], denied: [] })
    expect(characterAbilities(undefined)).toEqual({ granted: [], denied: [] })
  })
})

describe('being away (9-8 / 9-9)', () => {
  const withSquads = (chars, squads, raiding = []) => ({
    characters: chars,
    squads,
    raid: { squadAssignment: raiding },
  })

  test('a loose character is never away', () => {
    const c = character({ squadId: null })
    const campaign = withSquads([c], [{ id: 1, name: '1st Cohort' }], [1])
    expect(characterIsAway(campaign, c)).toBe(false)
    expect(awayBlocker(campaign, c)).toBeNull()
  })

  test('a character in camp with their squad is not away', () => {
    const c = character({ squadId: 1 })
    const campaign = withSquads([c], [{ id: 1, name: '1st Cohort' }])
    expect(characterIsAway(campaign, c)).toBe(false)
  })

  test('a squad out raiding today takes its character with it', () => {
    const c = character({ squadId: 1 })
    const campaign = withSquads([c], [{ id: 1, name: '1st Cohort' }], [1])
    expect(characterIsAway(campaign, c)).toBe(true)
    expect(awayBlocker(campaign, c)).toMatch(/out raiding with 1st Cohort/)
  })

  test('a squad away on a mission does too, and reads differently', () => {
    // 12-3 stores TWO notions of busy, not one, and 12-2 gave the second its
    // own word. The blocker says which — "on a mission" and "out raiding" are
    // different facts about where someone is.
    const c = character({ squadId: 1 })
    const campaign = withSquads(
      [c], [{ id: 1, name: '1st Cohort', mission: { untilDay: 5, eventId: 'x' } }],
    )
    expect(characterIsAway(campaign, c)).toBe(true)
    expect(awayBlocker(campaign, c)).toMatch(/away on a mission with 1st Cohort/)
  })
})

describe('equipping (9-8)', () => {
  const store = (ids, chars, squads = [{ id: 1, name: '1st Cohort' }], raiding = []) => ({
    items: ids,
    characters: chars,
    squads,
    raid: { squadAssignment: raiding },
  })

  test('a piece goes on, and the plan says exactly where', () => {
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store(['gear_iron_helm'], [c])
    const plan = planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, HUMANOID)
    expect(plan.error).toBeUndefined()
    expect(plan.worn).toEqual({ slot: 'head', index: 0, itemId: 'gear_iron_helm' })
    // Pure: nothing moved. The route applies the plan.
    expect(campaign.items).toEqual(['gear_iron_helm'])
    expect(c.items).toEqual([])
  })

  test('an item not in the store cannot be worn', () => {
    // "In the store" means "on nothing" (slice 6). An item already on someone
    // is not available, and neither is one never won.
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store([], [c])
    expect(planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, HUMANOID).error)
      .toMatch(/not in the store/)
  })

  test('a piece only goes in its own kind of slot', () => {
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store(['gear_iron_helm'], [c])
    expect(planEquip(campaign, 1, { slot: 'hand', index: 0, itemId: 'gear_iron_helm' }, HUMANOID).error)
      .toMatch(/worn in a head slot/)
  })

  test('a slot the creature does not have refuses by name', () => {
    const horseLike = { head: 1, torso: 1, legs: 1, hand: 0, misc: 1 }
    const c = character({ id: 1, type: 'Warhorse' })
    const campaign = store(['gear_soldiers_blade'], [c])
    expect(planEquip(campaign, 1, { slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }, horseLike).error)
      .toMatch(/no hand slot/)
  })

  test('an index past the count refuses, and names how many there are', () => {
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store(['gear_soldiers_blade'], [c])
    // A humanoid has two hands: index 1 is the second, index 2 is nobody's.
    expect(planEquip(campaign, 1, { slot: 'hand', index: 1, itemId: 'gear_soldiers_blade' }, HUMANOID).error)
      .toBeUndefined()
    expect(planEquip(campaign, 1, { slot: 'hand', index: 2, itemId: 'gear_soldiers_blade' }, HUMANOID).error)
      .toMatch(/only 2 hand slots/)
  })

  test('a filled slot refuses', () => {
    const c = character({
      id: 1, type: 'Soldier',
      items: [{ slot: 'head', index: 0, itemId: 'gear_iron_helm' }],
    })
    const campaign = store(['gear_iron_helm'], [c])
    expect(planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, HUMANOID).error)
      .toMatch(/already filled/)
  })

  test('two identical pieces fit two different hands', () => {
    // Ordinary kit STACKS (9-6): the store may hold two, and they are the same
    // row, so nothing needs telling them apart.
    const c = character({
      id: 1, type: 'Soldier',
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    const campaign = store(['gear_soldiers_blade'], [c])
    expect(planEquip(campaign, 1, { slot: 'hand', index: 1, itemId: 'gear_soldiers_blade' }, HUMANOID).error)
      .toBeUndefined()
  })

  test('a squad item cannot be worn by a person', () => {
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store(['banner_unbroken_line'], [c])
    expect(planEquip(campaign, 1, { slot: 'misc', index: 0, itemId: 'banner_unbroken_line' }, HUMANOID).error)
      .toMatch(/does not go to a character/)
  })

  test('an away character cannot be re-kitted', () => {
    const c = character({ id: 1, type: 'Soldier', squadId: 1 })
    const campaign = store(['gear_iron_helm'], [c], [{ id: 1, name: '1st Cohort' }], [1])
    expect(planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, HUMANOID).error)
      .toMatch(/out raiding/)
  })

  test('a dead character cannot be re-kitted', () => {
    // Their gear is preserved (5-9) for a later recovery to find; that is not
    // the same as being able to move it now.
    const c = character({ id: 1, type: 'Soldier', alive: false, diedDay: 3 })
    const campaign = store(['gear_iron_helm'], [c])
    expect(planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, HUMANOID).error)
      .toMatch(/is dead/)
  })

  test('an unknown body plan refuses rather than guessing humanoid', () => {
    // 5-6's rule reaching the campaign layer: an undeclared anatomy is an
    // ERROR, never a humanoid by omission. Here it can only mean a drifted
    // sync, and answering "no slots" is the safe direction.
    const c = character({ id: 1, type: 'Soldier' })
    const campaign = store(['gear_iron_helm'], [c])
    expect(planEquip(campaign, 1, { slot: 'head', index: 0, itemId: 'gear_iron_helm' }, null).error)
      .toMatch(/nothing is known about where/)
  })
})

describe('unequipping', () => {
  const store = (ids, chars, squads = [{ id: 1, name: '1st Cohort' }], raiding = []) => ({
    items: ids,
    characters: chars,
    squads,
    raid: { squadAssignment: raiding },
  })

  test('a worn piece comes off by slot and index', () => {
    const c = character({
      id: 1, type: 'Soldier',
      items: [{ slot: 'hand', index: 1, itemId: 'gear_soldiers_blade' }],
    })
    const plan = planUnequip(store([], [c]), 1, { slot: 'hand', index: 1 })
    expect(plan.error).toBeUndefined()
    expect(plan.worn.itemId).toBe('gear_soldiers_blade')
  })

  test('an empty slot refuses', () => {
    const c = character({ id: 1, type: 'Soldier' })
    expect(planUnequip(store([], [c]), 1, { slot: 'hand', index: 0 }).error)
      .toMatch(/nothing is worn there/)
  })

  test('a permanent item cannot be taken back', () => {
    // Nothing character-targeted is permanent today; the check exists because
    // the ROW declares permanence (17's flexibility rule) and a future one may.
    const c = character({
      id: 1, type: 'Soldier',
      items: [{ slot: 'misc', index: 0, itemId: 'banner_unbroken_line' }],
    })
    expect(planUnequip(store([], [c]), 1, { slot: 'misc', index: 0 }).error)
      .toMatch(/cannot be taken back/)
  })

  test('an away character cannot be stripped either', () => {
    const c = character({
      id: 1, type: 'Soldier', squadId: 1,
      items: [{ slot: 'head', index: 0, itemId: 'gear_iron_helm' }],
    })
    const campaign = store([], [c], [{ id: 1, name: '1st Cohort' }], [1])
    expect(planUnequip(campaign, 1, { slot: 'head', index: 0 }).error).toMatch(/out raiding/)
  })
})

describe('hanging back', () => {
  // Derived from preferredRange > 0, which picks out exactly the ranged types
  // and needs no new data. engine.integration.test.js pins that claim against
  // the real binary.
  test('spellcasters and archers hang back; melee does not', () => {
    expect(hangsBackByDefault('Mage', catalog)).toBe(true)
    expect(hangsBackByDefault('Priest', catalog)).toBe(true)
    expect(hangsBackByDefault('Archer', catalog)).toBe(true)
    expect(hangsBackByDefault('Soldier', catalog)).toBe(false)
  })

  test('a type the catalog cannot describe does not hang back', () => {
    // A body we cannot describe is not one to assume is fragile.
    expect(hangsBackByDefault('Wyvern', catalog)).toBe(false)
    expect(hangsBackByDefault('Mage', undefined)).toBe(false)
  })
})

describe('minting', () => {
  test('ids climb past the dead and are never reused', () => {
    const c = campaignWith([character({ id: 1 }), character({ id: 7, alive: false })])
    // 8, not 2: a recovery spell must never wake a name someone else now holds.
    expect(nextCharacterId(c)).toBe(8)
  })

  test('a name nobody holds — the dead included', () => {
    const taken = CHARACTER_NAMES.slice(0, 3)
    const c = campaignWith(taken.map((name, i) => character({ id: i + 1, name, alive: i !== 0 })))
    pushRoll(0)
    expect(taken).not.toContain(drawCharacterName(c))
  })

  test('an exhausted pool falls back rather than blocking a paid hire', () => {
    const c = campaignWith(CHARACTER_NAMES.map((name, i) => character({ id: i + 1, name })))
    // Deliberately ugly: it should read as a pool wanting more entries.
    expect(drawCharacterName(c)).toMatch(/^Stranger /)
  })

  test('a minted character is alive, unattached and carries the empty seams', () => {
    pushRoll(0)
    const minted = mintCharacter(campaignWith([]), 'Mage', catalog)
    expect(minted).toMatchObject({
      id: 1, type: 'Mage', squadId: null, alive: true, diedDay: null, experience: 0, hangBack: true,
    })
    expect(minted.items).toEqual([])
    expect(minted.wounds).toEqual([])
    expect(CHARACTER_NAMES).toContain(minted.name)
  })

  // The starting six are named in order for reproducibility, and a supplied
  // name must cost no roll — the day-1 augury draw reads the same queue.
  test('a supplied name is used and draws no roll', () => {
    const minted = mintCharacter(campaignWith([]), 'Priest', catalog, { name: 'Barnabas' })
    expect(minted.name).toBe('Barnabas')
    // The queue is untouched, so the next consumer gets the roll it expected.
    pushRoll(3)
    expect(drawCharacterName(campaignWith([]))).toBe(CHARACTER_NAMES[3])
  })

  test('the starting six are all character types', () => {
    for (const spec of STARTING_CHARACTERS) expect(isCharacterType(spec.type)).toBe(true)
  })
})

describe('attaching', () => {
  test('a living character joins a squad that exists', () => {
    const c = campaignWith([character()])
    expect(planAttach(c, 1, 1)).toMatchObject({ squadId: 1 })
  })

  test('a null squad is always legal — that is what makes riding along fair', () => {
    const c = campaignWith([character({ squadId: 1 })])
    expect(planAttach(c, 1, null)).toMatchObject({ squadId: null })
  })

  test('the dead, the unknown and the imaginary are all refused', () => {
    const c = campaignWith([character({ id: 1, alive: false })])
    expect(planAttach(c, 1, 1).error).toMatch(/dead/)
    expect(planAttach(c, 99, 1).error).toMatch(/no such character/)
    expect(planAttach(campaignWith([character()]), 1, 99).error).toMatch(/no such squad/)
  })

  test('a squad takes only MAX_CHARACTERS_PER_SQUAD', () => {
    const held = Array.from({ length: MAX_CHARACTERS_PER_SQUAD }, (_, i) =>
      character({ id: i + 1, squadId: 1 }))
    const c = campaignWith([...held, character({ id: 99 })])
    expect(planAttach(c, 99, 1).error).toMatch(/already has/)
  })

  test('re-attaching someone already there is not a conflict with themselves', () => {
    const c = campaignWith([character({ id: 1, squadId: 1 })])
    expect(planAttach(c, 1, 1).error).toBeUndefined()
  })

  test('planning never mutates — a refusal has changed nothing', () => {
    const c = campaignWith([character({ id: 1, alive: false, squadId: null })])
    planAttach(c, 1, 1)
    expect(c.characters[0].squadId).toBeNull()
  })

  // ── 9-9 AMENDS 5-7 ────────────────────────────────────────────────────────
  test('an away character can be neither detached nor re-attached', () => {
    // Without this, 9-8's equip restriction is advisory: detach, re-kit,
    // re-attach is three clicks. THAT is why the amendment exists, so the
    // detach half matters as much as the attach half.
    const away = {
      characters: [character({ id: 1, squadId: 1 })],
      squads: [{ id: 1, name: '1st Cohort' }, { id: 2, name: 'Skirmishers' }],
      raid: { squadAssignment: [1] },
    }
    expect(planAttach(away, 1, null).error).toMatch(/out raiding/)
    expect(planAttach(away, 1, 2).error).toMatch(/out raiding/)
  })

  test('attachment stays free for everyone who is actually in camp', () => {
    // The amendment narrows 5-7, it does not repeal it: "away" is simply not a
    // state you can act on, and every other phase and count is untouched.
    const home = {
      characters: [character({ id: 1, squadId: 1 })],
      squads: [{ id: 1, name: '1st Cohort' }, { id: 2, name: 'Skirmishers' }],
      raid: { squadAssignment: [2] },
    }
    expect(planAttach(home, 1, 2).error).toBeUndefined()
  })
})

describe('the placement entry', () => {
  test('carries identity and the toggle, built from the record', () => {
    const entry = characterEntryFor(character({ id: 4, hangBack: true }), { q: 3, r: 5 })
    // Slice 2 adds `paths` to a CASTER's entry — the full map, zeros included
    // (services/magic.js enginePaths), because the engine's own Mage()
    // constructor seeds Fire 1 and a hire who did not roll Fire must arrive
    // saying so. Pulled out of the exact-shape check below and asserted
    // separately so this case stays about identity and the toggle.
    // AI-2 adds `value` to every character's entry (A-5) — what the enemy's
    // scorer weighs him at. Pulled out for the same reason `paths` is, and
    // asserted where the weights themselves are (tests/value.test.js).
    const { paths, value, ...identity } = entry
    expect(identity).toEqual({
      unit_type: 'Mage', q: 3, r: 5, character_id: 4, avoids_melee: true,
    })
    expect(paths).toEqual(enginePaths(character().paths))
    expect(value).toBe(CHARACTER_VALUE_BASE)
  })

  test('an ordinary trooper is no caster, so no paths ride their entry', () => {
    // The wire says what the engine must not ASSUME about a caster; a body that
    // was never going to be assumed anything is left alone.
    expect(characterEntryFor(character({ type: 'Soldier' }), { q: 0, r: 0 }).paths)
      .toBeUndefined()
  })

  test('states the toggle explicitly even when it is off', () => {
    expect(characterEntryFor(character({ hangBack: false }), { q: 0, r: 0 }).avoids_melee).toBe(false)
    expect(characterEntryFor(character({ hangBack: undefined }), { q: 0, r: 0 }).avoids_melee).toBe(false)
  })

  test('carries no squad_mods when neither the character nor a squad grants any', () => {
    expect(characterEntryFor(character(), { q: 0, r: 0 }).squad_mods).toBeUndefined()
  })

  // 13-17: membership means membership. The squad's drill and equipment reach
  // its posted character, the way the squad's banner ability already did (6-6)
  // and the way 5-0 says a character follows every rule troops follow.
  test('carries the SQUAD’s upgrades — a posted character is drilled with them', () => {
    const entry = characterEntryFor(character(), { q: 1, r: 2 }, [], { attack: 1, defense: 2 })
    expect(entry.squad_mods).toEqual({ attack: 1, defense: 2 })
  })

  // The squad's bag is COPIED, not handed through: the entry must not alias the
  // caller's modsBySquad value, or one character's gear would write itself into
  // every other member's bag.
  test('the squad’s bag is copied into the entry, never aliased', () => {
    const squadBag = { attack: 1 }
    const entry = characterEntryFor(character(), { q: 0, r: 0 }, [], squadBag)
    expect(entry.squad_mods).toEqual(squadBag)
    expect(entry.squad_mods).not.toBe(squadBag)
  })

  test('a loose character is in no squad, so no squad mods reach them', () => {
    expect(characterEntryFor(character(), { q: 0, r: 0 }, [], {}).squad_mods).toBeUndefined()
  })

  // ── Gear on the wire (slice 9a) ──────────────────────────────────────────
  test('a character’s own gear reaches the field as squad_mods', () => {
    const kitted = character({
      type: 'Soldier',
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(characterEntryFor(kitted, { q: 0, r: 0 }, [], {}, HUMANOID).squad_mods)
      .toEqual({ attack: 1 })
  })

  test('the two bags ADD rather than override', () => {
    // A squad's +1 on top of a character's own +1 is +2, by the only arithmetic
    // either side means. Nothing observed this until gear filled the seam.
    const kitted = character({
      type: 'Soldier',
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    const entry = characterEntryFor(kitted, { q: 0, r: 0 }, [], { attack: 1, armour: 1 }, HUMANOID)
    expect(entry.squad_mods).toEqual({ attack: 2, armour: 1 })
  })

  test('a relic’s ability rides on carried_abilities, not the squad’s field', () => {
    // The engine still learns the word `fearless` and never the words `banner`
    // or `horn` (6-7). What the FIELD tells it is the scope: a banner's gift is
    // scoped to squad membership (6-6) and gear's is worn on the body.
    const kitted = character({
      type: 'Soldier',
      items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }],
    })
    const entry = characterEntryFor(kitted, { q: 0, r: 0 }, [], {}, HUMANOID)
    expect(entry.carried_abilities).toEqual(['fearless'])
    expect(entry.squad_abilities).toBeUndefined()
  })

  test('a LOOSE character’s gear still reaches the field', () => {
    // The bug 9a recorded and 9b left standing, from this side. Merged onto
    // squad_abilities, this entry's gift was dropped in silence: a character
    // posted to no charter is in no squad, and the engine scopes a grant to
    // membership. `abilities` is [] here for exactly that reason — the route
    // passes nothing to someone no banner covers.
    const kitted = character({
      type: 'Soldier',
      squadId: null,
      items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }],
    })
    const entry = characterEntryFor(kitted, { q: 0, r: 0 }, [], {}, HUMANOID)
    expect(entry.carried_abilities).toEqual(['fearless'])
  })

  test('a banner and a relic granting the same word send it on both fields', () => {
    // Not a duplicate: they are scoped differently, so the engine needs both.
    // Leave the squad and the banner's Fearless goes; the relic's stays.
    const kitted = character({
      type: 'Soldier',
      items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }],
    })
    const entry = characterEntryFor(kitted, { q: 0, r: 0 }, ['fearless'], {}, HUMANOID)
    expect(entry.squad_abilities).toEqual(['fearless'])
    expect(entry.carried_abilities).toEqual(['fearless'])
  })

  test('nothing worn means no gear fields at all on the entry', () => {
    // The JSON for an unkitted character is byte-identical to what 5a sent, so
    // an old placement and a new one cannot diverge for a person with no gear.
    const entry = characterEntryFor(character(), { q: 3, r: 5 }, [], {}, HUMANOID)
    expect(entry.squad_abilities).toBeUndefined()
    expect(entry.carried_abilities).toBeUndefined()
    expect(entry.denied_abilities).toBeUndefined()
    expect(entry.squad_mods).toBeUndefined()
  })

  test('stranded gear never reaches the field', () => {
    const horseLike = { head: 1, torso: 1, legs: 1, hand: 0, misc: 1 }
    const kitted = character({
      type: 'Soldier',
      items: [{ slot: 'hand', index: 0, itemId: 'gear_soldiers_blade' }],
    })
    expect(characterEntryFor(kitted, { q: 0, r: 0 }, [], {}, horseLike).squad_mods)
      .toBeUndefined()
  })
})

describe('coming home', () => {
  test('anyone sent and not returned is dead, with the day recorded', () => {
    const c = campaignWith([character({ id: 1 }), character({ id: 2 })])
    const fallen = reconcileCharacters(c, [1, 2], [2], 6)
    expect(fallen.map((x) => x.id)).toEqual([1])
    expect(c.characters[0]).toMatchObject({ alive: false, diedDay: 6, squadId: null })
    expect(c.characters[1].alive).toBe(true)
  })

  test('everything they earned survives them (5-9)', () => {
    const c = campaignWith([character({ id: 1, items: [{ id: 'staff' }], experience: 12, wounds: [{ id: 'burn' }] })])
    reconcileCharacters(c, [1], [], 2)
    expect(c.characters[0].items).toHaveLength(1)
    expect(c.characters[0].experience).toBe(12)
    expect(c.characters[0].wounds).toHaveLength(1)
  })

  test('a character in camp is never killed by a battle they never joined', () => {
    const c = campaignWith([character({ id: 1 }), character({ id: 2 })])
    reconcileCharacters(c, [1], [], 3)
    expect(c.characters[1].alive).toBe(true)
  })

  // The asymmetry that matters: [] means nobody survived, undefined means the
  // engine never reported. A death is permanent, so a missing field must not
  // be read as a massacre.
  test('a missing survivor list kills nobody; an empty one kills everyone sent', () => {
    const missing = campaignWith([character({ id: 1 })])
    expect(reconcileCharacters(missing, [1], undefined, 3)).toEqual([])
    expect(missing.characters[0].alive).toBe(true)

    const empty = campaignWith([character({ id: 1 })])
    expect(reconcileCharacters(empty, [1], [], 3)).toHaveLength(1)
    expect(empty.characters[0].alive).toBe(false)
  })

  test('the already dead are not killed twice, and ids may arrive as strings', () => {
    const c = campaignWith([character({ id: 1, alive: false, diedDay: 2 })])
    expect(reconcileCharacters(c, ['1'], [], 9)).toEqual([])
    expect(c.characters[0].diedDay).toBe(2)
  })

  test('sending nobody is a no-op', () => {
    const c = campaignWith([character({ id: 1 })])
    expect(reconcileCharacters(c, [], [], 3)).toEqual([])
    expect(reconcileCharacters(c, undefined, [], 3)).toEqual([])
    expect(c.characters[0].alive).toBe(true)
  })
})
