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
  hangsBackByDefault,
  nextCharacterId,
  drawCharacterName,
  mintCharacter,
  planAttach,
  characterEntryFor,
  reconcileCharacters,
} from '../services/characters.js'
import { pushRoll, clearRolls } from '../utils/dice.js'
import { catalogFixture } from './fixtures/catalog.js'
import {
  CHARACTER_TYPES,
  CHARACTER_NAMES,
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

  test('the seam holds its shape for a character carrying sources', () => {
    const decorated = character({ items: [{ id: 'staff' }], experience: 40, wounds: [{ id: 'limp' }] })
    // Still {} — items/experience/wounds are RECORDED but not yet priced. When
    // that changes, this test changes with it, deliberately.
    expect(characterMods(decorated)).toEqual({})
  })

  test('it never throws on a half-built character', () => {
    expect(characterMods({})).toEqual({})
    expect(characterMods(undefined)).toEqual({})
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
})

describe('the placement entry', () => {
  test('carries identity and the toggle, built from the record', () => {
    const entry = characterEntryFor(character({ id: 4, hangBack: true }), { q: 3, r: 5 })
    expect(entry).toEqual({
      unit_type: 'Mage', q: 3, r: 5, character_id: 4, avoids_melee: true,
    })
  })

  test('states the toggle explicitly even when it is off', () => {
    expect(characterEntryFor(character({ hangBack: false }), { q: 0, r: 0 }).avoids_melee).toBe(false)
    expect(characterEntryFor(character({ hangBack: undefined }), { q: 0, r: 0 }).avoids_melee).toBe(false)
  })

  test('carries no squad_mods while the modifier layer is empty', () => {
    expect(characterEntryFor(character(), { q: 0, r: 0 }).squad_mods).toBeUndefined()
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
