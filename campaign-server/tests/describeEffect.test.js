import { describe, it, expect } from 'vitest'
import { describeEffect } from '../services/events.js'

// describeEffect renders an effect as what it MECHANICALLY does (user,
// 2026-08-10: "not perfect knowledge of everything, but a clear description on
// a mechanical level"). No DB, no campaign — it is a pure formatter.
//
// The half of this that matters most is the SILENCE. describeEffect goes to the
// same player as applyEffect's log, so it inherits the same disclosure rules,
// and the tests below exist because a future "just print every field" would
// look like an improvement while quietly unpicking three gates: hidden chain
// state, recon-gated enemy figures, and the augury's own fog.

describe('player-facing resources read as plain arithmetic', () => {
  it('signs a loss and a gain, and puts food in tonnes', () => {
    // A whole tonnage drops its decimal ("−2 t", not "−2.0 t"): the +(…)
    // .toFixed(1) idiom the rest of the app formats food with, in applyEffect's
    // log and ForagePanel alike. Pinned so this stays consistent with them
    // rather than drifting into a second house style.
    expect(describeEffect({ type: 'food', delta: -2000 })).toEqual(['Food −2 t'])
    expect(describeEffect({ type: 'food', delta: 1500 })).toEqual(['Food +1.5 t'])
  })

  it('leaves the countable resources as counts', () => {
    expect(describeEffect({ type: 'materials', delta: -40 })).toEqual(['Materials −40'])
    expect(describeEffect({ type: 'gold', delta: 60 })).toEqual(['Gold +60'])
    expect(describeEffect({ type: 'horses', delta: -3 })).toEqual(['Horses −3'])
  })
})

describe('the player’s own troops', () => {
  it('reads a roster delta and a roster factor differently', () => {
    expect(describeEffect({ type: 'roster', unit: 'Soldier', delta: -12 }))
      .toEqual(['Soldier −12'])
    expect(describeEffect({ type: 'roster', unit: 'Archer', factor: 0.8 }))
      .toEqual(['Archer ×0.8'])
  })

  it('names an army-wide multiplier and a conversion', () => {
    expect(describeEffect({ type: 'all_roster', factor: 0.9 })).toEqual(['Every unit ×0.9'])
    expect(describeEffect({ type: 'convert', from: 'Soldier', to: 'Cavalry', count: 10 }))
      .toEqual(['Up to 10 Soldier → Cavalry'])
  })
})

describe('the enemy stays recon-gated', () => {
  it('gives the multiplier but never a headcount', () => {
    const [line] = describeEffect({ type: 'enemy_losses', factor: 0.5 })
    // How hard they are hit is the player's business; how many they are is not.
    expect(line).toBe('The enemy host ×0.5')
    expect(line).not.toMatch(/\d{2,}/) // no army size can have leaked in
  })

  it('describes an enemy-side forage pressure without its kg', () => {
    const [line] = describeEffect({
      type: 'forage_modifier', target: 'enemyDrain', deltaKg: 4000, label: 'Depot',
    })
    expect(line).toBe('The enemy strips the countryside faster')
    expect(line).not.toMatch(/4000|4\.0/)
  })

  it('DOES put a figure on the player’s own foraging — that side is not gated', () => {
    expect(describeEffect({ type: 'forage_modifier', target: 'playerYield', factor: 0.6 }))
      .toEqual(['Your foraging ×0.6'])
    expect(describeEffect({ type: 'forage_modifier', target: 'playerYield', deltaKg: -1000 }))
      .toEqual(['Your foraging −1 t/turn'])
  })
})

describe('hidden state describes as nothing at all', () => {
  // These three emit no log line in applyEffect for the same reason: the
  // prerequisite gates read them, and the narrative is carried by event text.
  // A number here would leak straight past the gate.
  it.each([
    ['flag', { type: 'flag', name: 'siege_seen', value: 1 }],
    ['schedule', { type: 'schedule', event: 'breach_threatens', delay: 3 }],
    ['garrison', { type: 'garrison', delta: -2 }],
  ])('%s says nothing', (_name, effect) => {
    expect(describeEffect(effect)).toEqual([])
  })
})

describe('bundles and edges', () => {
  it('flattens a multi into its parts, in order', () => {
    expect(describeEffect({
      type: 'multi',
      effects: [
        { type: 'food', delta: -1000 },
        { type: 'garrison', delta: 1 }, // silent, and must not leave a gap
        { type: 'gold', delta: 25 },
      ],
    })).toEqual(['Food −1 t', 'Gold +25'])
  })

  it('says so when a fate does nothing, and copes with no effect at all', () => {
    expect(describeEffect({ type: 'none' })).toEqual(['No consequence'])
    expect(describeEffect(null)).toEqual([])
    expect(describeEffect(undefined)).toEqual([])
  })

  it('is silent on an effect type it has never heard of', () => {
    // Fail closed: an unknown effect must not stringify its own fields into the
    // UI, because nobody has decided yet what of it the player may see.
    expect(describeEffect({ type: 'some_future_effect', secret: 42 })).toEqual([])
  })
})
