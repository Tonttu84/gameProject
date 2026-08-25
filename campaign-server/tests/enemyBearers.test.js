import { describe, expect, test } from 'vitest'
import {
  rollBearer, bearerEntry, bearerTypes, bandRung, TOP_RUNG,
  BEARER_SQUAD_ID, BEARER_CHARACTER_ID,
} from '../services/enemyBearers.js'
import { findItem } from '../services/items.js'
import { ENEMY_ARMY, RAID_STRENGTH_BANDS, ITEM_CATALOG } from '../utils/campaignConfig.js'

// Enemy champions carrying real gear (docs/CAMPAIGN_PLAN.md 9-12 / 9-13 / 9-14).
//
// The line these cases exist to hold is standing principle 1: a bearer is DATA,
// not behaviour. He has better kit and no decisions — nothing here may grow into
// a reaction, a stance or a name that persists.

const WEAKEST = RAID_STRENGTH_BANDS.at(-1).label   // 'a handful'
const STRONGEST = RAID_STRENGTH_BANDS[0].label     // 'a strong detachment'
const RELIC = ITEM_CATALOG.find((r) => r.unique && r.target === 'character')

// A rand(min, max) queue. rollBearer asks in a fixed order: the presence roll
// (1..100), the type index, then the relic roll and the mundane draws.
//
// CLAMPED to the requested range, like the real getRandom — a stub that can
// return an out-of-range index tests a function nobody calls.
const rolls = (...values) => {
  const queue = [...values]
  return (min, max) => {
    const next = queue.length ? queue.shift() : min
    return Math.min(Math.max(next, min), max)
  }
}

describe('the strength ladder', () => {
  test('the weakest band is rung 0 and the strongest is the top', () => {
    // Derived from the config array rather than restated, so retuning the bands
    // moves this with them.
    expect(bandRung(WEAKEST)).toBe(0)
    expect(bandRung(STRONGEST)).toBe(TOP_RUNG)
    expect(TOP_RUNG).toBe(RAID_STRENGTH_BANDS.length - 1)
  })

  test('an unknown band reads as the weakest rather than throwing', () => {
    expect(bandRung('a rumour')).toBe(0)
  })
})

describe('rolling a champion', () => {
  test('a failed presence roll means nobody rides with them', () => {
    expect(rollBearer({}, WEAKEST, () => 100)).toBeNull()
  })

  test('a champion is always a type the host actually fields', () => {
    // The campaign layer checks itself against the host's own composition
    // rather than inventing a creature.
    for (let i = 0; i < bearerTypes().length; i += 1) {
      const bearer = rollBearer({}, STRONGEST, rolls(1, i))
      expect(Object.keys(ENEMY_ARMY)).toContain(bearer.type)
    }
  })

  test('a weak card carries less than a strong one', () => {
    // 9-14's payoff, as arithmetic: a harder card is where the better relic is,
    // which is what makes choosing a raid FOR its reward a real decision.
    const weak = rollBearer({}, WEAKEST, rolls(1, 0))
    const strong = rollBearer({}, STRONGEST, rolls(1, 0, 100))
    expect(strong.items.length).toBeGreaterThan(weak.items.length)
  })

  test('the unique relic is reachable only at the top rung', () => {
    // Uniques are GUARANTEED recoveries (9-10), so putting one on a trivial
    // card would make the whole ladder pointless.
    const weak = rollBearer({}, WEAKEST, rolls(1, 0, 1))
    expect(weak.items).not.toContain(RELIC.id)
    const strong = rollBearer({}, STRONGEST, rolls(1, 0, 1))
    expect(strong.items).toContain(RELIC.id)
  })

  test('a relic the campaign already holds is never put on the board', () => {
    // The draw-time half of uniqueness (grantItem defends the other half).
    // Winning a second copy is the one thing 9-6 says cannot happen, and the
    // card must not advertise it either.
    const held = { items: [RELIC.id] }
    const bearer = rollBearer(held, STRONGEST, rolls(1, 0, 1))
    expect(bearer.items).not.toContain(RELIC.id)
  })

  test('a champion never carries a banner, in either direction', () => {
    // 9-12: banners sit outside the loot path, so an enemy never carries one to
    // be stripped of. Enforced by the row's `lootable` flag rather than by a
    // kind test, which is why sweeping the whole pool is the right assertion.
    for (let i = 0; i < 40; i += 1) {
      const bearer = rollBearer({}, STRONGEST, rolls(1, 0, 1, i, i, i))
      if (!bearer) continue
      for (const id of bearer.items) {
        expect(findItem(id).target).toBe('character')
        expect(findItem(id).lootable).not.toBe(false)
      }
    }
  })

  test('he carries no duplicates', () => {
    const bearer = rollBearer({}, STRONGEST, rolls(1, 0, 100))
    expect(new Set(bearer.items).size).toBe(bearer.items.length)
  })
})

describe('putting him on the field', () => {
  test('his gear reaches the engine as stats and ability words', () => {
    // The campaign layer translates; the engine learns `attack` and `fearless`
    // and never the word `item`, exactly as it never learns the word `banner`.
    const entry = bearerEntry(
      { type: 'Soldier', items: ['gear_soldiers_blade', RELIC.id] },
      { q: 3, r: 5 }, BEARER_SQUAD_ID, findItem,
    )
    expect(entry.unit_type).toBe('Soldier')
    expect(entry.squad_mods).toEqual({ attack: 1, defence: -1 })
    // On carried_abilities, never squad_abilities: everything a champion has,
    // he has from his gear, and no banner flies over him.
    expect(entry.carried_abilities).toEqual(['fearless'])
    expect(entry.squad_abilities).toBeUndefined()
    expect(JSON.stringify(entry)).not.toContain('relic')
  })

  test('he rides under a squad tag and a character tag', () => {
    // The squad tag names the one-man formation the replay calls Champion. It
    // used to be what made his relic work at all — granted abilities are scoped
    // to squad membership (6-6) — but gear travels on carried_abilities now, so
    // the tag is no longer holding his gift up.
    const entry = bearerEntry(
      { type: 'Soldier', items: [RELIC.id] }, { q: 0, r: 0 }, BEARER_SQUAD_ID, findItem,
    )
    expect(entry.squad_id).toBe(BEARER_SQUAD_ID)
    expect(BEARER_CHARACTER_ID).toBeGreaterThan(0)
  })

  test('a champion placed as a loner keeps his relic’s gift', () => {
    // The scoping bug from the enemy side: pass no squad at all and the ability
    // is still on the entry, because carried_abilities is not gated on one.
    const entry = bearerEntry(
      { type: 'Soldier', items: [RELIC.id] }, { q: 0, r: 0 }, undefined, findItem,
    )
    expect(entry.carried_abilities).toEqual(['fearless'])
  })

  test('an empty-handed champion sends no gear fields at all', () => {
    const entry = bearerEntry({ type: 'Archer', items: [] }, { q: 1, r: 1 }, 1, findItem)
    expect(entry.squad_mods).toBeUndefined()
    expect(entry.carried_abilities).toBeUndefined()
    expect(entry.squad_abilities).toBeUndefined()
    expect(entry.denied_abilities).toBeUndefined()
  })

  test('an id whose row has left the catalog is skipped, never thrown on', () => {
    const entry = bearerEntry(
      { type: 'Soldier', items: ['gear_of_a_previous_build'] }, { q: 0, r: 0 }, 1, findItem,
    )
    expect(entry.squad_mods).toBeUndefined()
  })
})
