import { describe, it, expect } from 'vitest'
import { describeEffect, optionCard, EVENT_POOL } from '../services/events.js'

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

describe('hidden state gives a direction, never a figure', () => {
  // These emit no log line in applyEffect, and until 2026-08-10 they described
  // as nothing here either. That was too broad: every `garrison` and `schedule`
  // effect in the pool sits on a CHOICE, so five branches could be priced only
  // by tone. They now say which WAY they push — and nothing a gate reads.
  it('says which way the garrison’s regard moves, without the delta', () => {
    expect(describeEffect({ type: 'garrison', delta: 15 }))
      .toEqual(['Karrowgate thinks the better of you'])
    const [line] = describeEffect({ type: 'garrison', delta: -10 })
    expect(line).toBe('Karrowgate thinks the worse of you')
    // The resolve TRACK is what minResolve/maxResolve gate on. A number here
    // would let the player solve for which fates are about to open or close.
    expect(line).not.toMatch(/\d/)
  })

  it('promises a follow-up without naming it or dating it', () => {
    const [line] = describeEffect({ type: 'schedule', event: 'breach_threatens', delay: 3 })
    expect(line).toBe('Sets a fate in motion, to come to pass in a later turn')
    expect(line).not.toMatch(/breach|3/) // neither the beat nor the target day
  })

  it('still says nothing at all for a flag — pure bookkeeping', () => {
    // A flag moves no resource and opens no priceable choice; it only gates
    // later draws. Describing it would leak chain structure for no gain.
    expect(describeEffect({ type: 'flag', name: 'siege_seen', value: 1 })).toEqual([])
  })
})

describe('every card in the pool states what it does', () => {
  // The standing rule (user, 2026-08-10): "every raid and every event must state
  // its reward, at some level" — no card may show flavour alone. Three earlier
  // fixes each treated one instance; this is the rule itself, so a NEW fate or
  // branch written with an undescribable effect fails here instead of shipping
  // as prose the player cannot price.
  //
  // The one legitimate silence is a bare `flag`, which moves nothing (see
  // above). Nothing in the pool is one today; if that changes, exempt it here
  // deliberately rather than deleting the assertion.
  const rungsOf = (event) => [event, ...Object.values(event.rungs ?? {})]

  it.each(EVENT_POOL.flatMap((event) =>
    rungsOf(event)
      .filter((rung) => rung.effect && rung.effect.type !== 'choice')
      .map((rung) => [`${event.id}${rung === event ? '' : ` (${rung.title})`}`, rung.effect]),
  ))('fate %s describes its effect', (_id, effect) => {
    expect(describeEffect(effect).length).toBeGreaterThan(0)
  })

  it.each(EVENT_POOL.flatMap((event) =>
    rungsOf(event).flatMap((rung) =>
      (rung.choices ?? []).map((choice) => [`${event.id} → ${choice.id}`, choice]),
    ),
  ))('branch %s states its cost', (_id, choice) => {
    expect(optionCard(choice).effectText.length).toBeGreaterThan(0)
  })
})

describe('optionCard', () => {
  it('carries the branch’s prose AND its mechanical cost, never the raw effect', () => {
    const card = optionCard({
      id: 'answer_the_call',
      label: 'Send provisions',
      description: 'Spend from your own stores.',
      effect: { type: 'multi', effects: [{ type: 'food', delta: -1500 }, { type: 'garrison', delta: 15 }] },
    })
    expect(card).toEqual({
      id: 'answer_the_call',
      label: 'Send provisions',
      description: 'Spend from your own stores.',
      // The food cost is a figure; the resolve half is a direction only.
      effectText: ['Food −1.5 t', 'Karrowgate thinks the better of you'],
    })
    // The branch is re-looked-up by id at choose time — the effect must not ride
    // along to the client, where it would hand over every gate at once.
    expect(card).not.toHaveProperty('effect')
  })
})

describe('bundles and edges', () => {
  it('flattens a multi into its parts, in order', () => {
    expect(describeEffect({
      type: 'multi',
      effects: [
        { type: 'food', delta: -1000 },
        { type: 'flag', name: 'chain_open' }, // silent, and must not leave a gap
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
