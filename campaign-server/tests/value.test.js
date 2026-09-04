import { describe, expect, test } from 'vitest'
import { characterEntryFor, characterValue } from '../services/characters.js'
import { bearerEntry, BEARER_SQUAD_ID } from '../services/enemyBearers.js'
import { findItem } from '../services/items.js'
import {
  CHARACTER_VALUE_BASE, ITEM_CATALOG, VALUE_PER_ABILITY, VALUE_PER_STAT,
} from '../utils/campaignConfig.js'

// WHAT A CHARACTER IS WORTH (docs/CAMPAIGN_PLAN.md "THE CASTING AI", A-5): the
// number the enemy's scorer weighs him by, computed campaign-side off his gear
// and sent as `value` on his placement entry.
//
// The shape being pinned throughout is the user's constraint, not the
// arithmetic: "we dont want the AI to be super good at sniping mages, but it
// should sometimes try to get some damage to a well kitted supercombatant". So
// what these cases hold is that a NAKED caster is worth exactly what a soldier
// is, and that everything above that comes from the kit — with the defensive
// pieces weighing heaviest.
//
// The WEIGHTS themselves are balance-deferred and are read from the constants
// rather than restated, so a retune moves these with it. Only their ORDER is
// asserted as a rule, because the order is a decision and the numbers are not.

const character = (items = []) => ({
  id: 1, name: 'Isolde', type: 'Mage', alive: true, paths: { fire: 1 }, script: [],
  items: items.map((itemId, index) => ({ slot: findItem(itemId)?.slot, index, itemId })),
})

// The catalog rows these cases talk about, found by what they DO rather than by
// id, so a renamed row does not break a case about weighting.
const rowWith = (stat) => ITEM_CATALOG.find(
  (row) => row.target === 'character' && (row.mods?.[stat] ?? 0) > 0
    && Object.keys(row.mods ?? {}).length === 1 && (row.abilities?.length ?? 0) === 0,
)
const BLADE = rowWith('attack')
const HELM = rowWith('defence')
// The relic: an ability granted, and a point of defence given up for it (9-6).
const RELIC = ITEM_CATALOG.find((row) => row.unique && row.target === 'character')

describe('what a naked body is worth (A-5)', () => {
  test('exactly the engine\'s own default — a mage is no magnet for being a mage', () => {
    // The whole of the user's first constraint, in one number. If this ever
    // rises above a Soldier's catalog value, every enemy caster starts hunting
    // mages and the shape of the fight changes without anyone choosing it.
    expect(characterValue(character())).toBe(CHARACTER_VALUE_BASE)
  })

  test('a body with no items field at all is still worth the base', () => {
    expect(characterValue({ id: 2, name: 'Bran', type: 'Soldier' })).toBe(CHARACTER_VALUE_BASE)
  })
})

describe('what the kit adds', () => {
  test('a stat delta is priced at its weight, per point', () => {
    expect(characterValue(character([BLADE.id])))
      .toBe(CHARACTER_VALUE_BASE + VALUE_PER_STAT.attack * BLADE.mods.attack)
  })

  test('two pieces add, exactly as their mods do', () => {
    expect(characterValue(character([BLADE.id, HELM.id]))).toBe(
      CHARACTER_VALUE_BASE
        + VALUE_PER_STAT.attack * BLADE.mods.attack
        + VALUE_PER_STAT.defence * HELM.mods.defence,
    )
  })

  test('DEFENSIVE gear weighs more than offensive — the same +1 is worth more', () => {
    // A-5's "defensive items add more", asserted as the RULE it is: what makes
    // a champion worth spending a spell on is that he is hard to kill.
    expect(characterValue(character([HELM.id])))
      .toBeGreaterThan(characterValue(character([BLADE.id])))
    expect(VALUE_PER_STAT.armour).toBeGreaterThan(VALUE_PER_STAT.attack)
    expect(VALUE_PER_STAT.defence).toBeGreaterThan(VALUE_PER_STAT.attack)
  })

  test('a granted ability is worth its flat price, and a denial is not charged for', () => {
    // The relic gives `fearless` and costs its bearer a point of defence — so
    // it prices as the ability MINUS that cost, and never as a bonus for the
    // cost itself. A self-crippling item must not read as a fatter target.
    expect(characterValue(character([RELIC.id]))).toBe(
      CHARACTER_VALUE_BASE
        + VALUE_PER_ABILITY * RELIC.abilities.length
        + VALUE_PER_STAT.defence * RELIC.mods.defence,
    )
  })

  test('a stat nothing scores moves nothing — the mail\'s speed cost is free', () => {
    const mail = ITEM_CATALOG.find((row) => (row.mods?.armour ?? 0) > 0 && (row.mods?.speed ?? 0) < 0)
    expect(characterValue(character([mail.id])))
      .toBe(CHARACTER_VALUE_BASE + VALUE_PER_STAT.armour * mail.mods.armour)
  })

  test('an id whose row has left the catalog prices nothing, and never throws', () => {
    expect(characterValue(character(['gear_that_was_deleted']))).toBe(CHARACTER_VALUE_BASE)
  })

  test('gear stranded in a slot the body does not have is not priced either', () => {
    // The wornItems rule (5-5), inherited whole: a piece the anatomy filter
    // drops modifies nothing, so it must be worth nothing too.
    const naked = { head: 0, torso: 0, legs: 0, hand: 0, misc: 0 }
    expect(characterValue(character([HELM.id]), naked)).toBe(CHARACTER_VALUE_BASE)
  })
})

describe('the floor', () => {
  test('never drops below 1 — a unit worth 0 is a unit no spell may target', () => {
    // Not a loadout anybody can build: the catalog holds no piece heavy enough
    // to sink a man on its own, so this is the ARITHMETIC being pinned. A value
    // of 0 does not read as "unimportant" to a scorer that multiplies by it —
    // it reads as "never worth casting at", which is a different sentence.
    const drowned = character(Array.from({ length: 12 }, () => RELIC.id))
    expect(characterValue(drowned)).toBe(1)
  })
})

describe('what crosses to the engine', () => {
  test('every character\'s entry carries it, caster or not', () => {
    expect(characterEntryFor(character([HELM.id]), { q: 1, r: 2 }).value)
      .toBe(characterValue(character([HELM.id])))
    const soldier = { ...character([BLADE.id]), type: 'Soldier' }
    expect(characterEntryFor(soldier, { q: 1, r: 2 }).value).toBe(characterValue(soldier))
  })

  test('the ENEMY\'s champion is priced off the same function (A-5)', () => {
    // "A well kitted supercombatant" is a thing the player's casters should
    // sometimes go for too, and he would not be one if only our own side were
    // priced. His items are bare ids where a character's are worn entries;
    // that is the only difference, and it is a shape, not a rule.
    const entry = bearerEntry(
      { type: 'Soldier', items: [BLADE.id, HELM.id] }, { q: 3, r: 5 }, BEARER_SQUAD_ID, findItem,
    )
    expect(entry.value).toBe(characterValue(character([BLADE.id, HELM.id])))
  })

  test('an empty-handed champion is worth the base, like an empty-handed hire', () => {
    const entry = bearerEntry({ type: 'Archer', items: [] }, { q: 0, r: 0 }, 1, findItem)
    expect(entry.value).toBe(CHARACTER_VALUE_BASE)
  })
})
