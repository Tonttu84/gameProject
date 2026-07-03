import { describe, it, expect } from 'vitest'
import { scoutValue, forageValue, screenValue } from '../utils/capabilities.js'

// Stats as exported by the engine (see backend/engine/tests/test_unit_catalog.cpp
// "movement speed and ballistic skill pinned per type" for the pinned inputs).
const soldier = { maxHP: 10, attack: 11, defence: 12, armour: 5, speed: 1, ballisticSkill: 4 }
const archer = { maxHP: 10, attack: 10, defence: 12, armour: 2, speed: 1, ballisticSkill: 10 }
const cavalry = { maxHP: 10, attack: 11, defence: 12, armour: 5, speed: 2, ballisticSkill: 4 }
const lightCavalry = { maxHP: 10, attack: 10, defence: 11, armour: 2, speed: 3, ballisticSkill: 8 }
const horse = { maxHP: 15, attack: 0, defence: 12, armour: 0, speed: 2, ballisticSkill: 1 }

describe('derived campaign capabilities', () => {
  it('light cavalry is the best scout; a fast ranged-blind animal is not', () => {
    expect(scoutValue(lightCavalry)).toBeGreaterThan(scoutValue(cavalry))
    expect(scoutValue(lightCavalry)).toBeGreaterThan(scoutValue(archer))
    expect(scoutValue(archer)).toBeGreaterThan(scoutValue(soldier))
    // The horse is as fast as heavy cavalry but its ballistic skill of 1
    // keeps it from out-scouting a trained rider pair.
    expect(scoutValue(horse)).toBeLessThanOrEqual(scoutValue(cavalry))
  })

  it('foraging scales with speed, minimum 1', () => {
    expect(forageValue(lightCavalry)).toBeGreaterThan(forageValue(cavalry))
    expect(forageValue(cavalry)).toBeGreaterThan(forageValue(soldier))
    expect(forageValue({ ...soldier, speed: 0 })).toBe(1)
  })

  it('heavy cavalry screens foragers better than light', () => {
    expect(screenValue(cavalry)).toBeGreaterThan(screenValue(lightCavalry))
    expect(screenValue(cavalry)).toBeGreaterThan(screenValue(soldier))
  })
})
