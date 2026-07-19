import { afterEach, describe, expect, test } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  drawAugury,
  consultAugury,
  rerollAugurySlot,
  auguryReveal,
  rollAuguryOdds,
  mageBonus,
} from '../services/augury.js'
import {
  EVENT_POOL,
  POOL_LEGIBILITY,
  eventValence,
  eventValenceFor,
  choiceRung,
  applyEffect,
  firedRung,
} from '../services/events.js'
import {
  AUGURY_SLOTS,
  AUGURY_ODDS_MAX,
  AUGURY_REROLLS_PER_DAY,
} from '../utils/campaignConfig.js'

// Pure-service tests on a plain campaign-shaped object (the service only
// touches augury/roster/character, all mutated in place like the Mongoose
// doc). Readings are queue-driven and consumed per slot in order: first the
// exploding throwDice chain (value die, explosion die, recursing on a 6 —
// the JS port pins [4,6,3,2] → 7 against the C++ engine), then one d1000
// chanceRoll deciding the vision against odds×1000.
//
// Odds math (campaignConfig): odds = clamp((roll + 2 base + mageBonus +
// characterBonus + POOL_LEGIBILITY[severity]) × 0.05, 0.05, 0.9).

afterEach(clearRolls)

// A truth that is NOT in EVENT_POOL, so a redraw can never reproduce it —
// that's what makes "the old fate never fires" assertable. Severity 3:
// the major pool, whose readings get no legibility bonus.
const DOOMED = {
  id: 'doomed_omen',
  title: 'Doom',
  description: 'A fate that must never come to pass.',
  severity: 3,
  effect: { type: 'food', delta: -999 },
}
const DECOY = { ...EVENT_POOL.find((e) => e.id === 'supply') }

// All slots pinned to the same unread DOOMED/DECOY pair. With no mages and
// no character, a queued [4,1] reading gives points 4+2+0+0+0 = 6 → odds 0.3
// → d1000 vision threshold 300.
const makeCampaign = ({ mages = 0, character = null } = {}) => ({
  roster: new Map(mages > 0 ? [['Mage', mages]] : []),
  character,
  augury: {
    slots: Array.from({ length: AUGURY_SLOTS }, () => ({
      trueEvent: { ...DOOMED },
      falseEvent: { ...DECOY },
      odds: null,
      shownTrue: null,
    })),
    consulted: false,
    rerollsRemaining: AUGURY_REROLLS_PER_DAY,
  },
})

describe('mageBonus', () => {
  test('floor(sqrt(mages)), capped at 3', () => {
    expect(mageBonus(new Map())).toBe(0)
    expect(mageBonus(new Map([['Mage', 3]]))).toBe(1)
    expect(mageBonus(new Map([['Mage', 9]]))).toBe(3)
    expect(mageBonus(new Map([['Mage', 100]]))).toBe(3) // capped
  })
})

describe('rollAuguryOdds', () => {
  test('exploding chain [4,6,3,2] → roll 7 → (7+2)×0.05 = 0.45 for a dire truth', () => {
    pushRoll(4); pushRoll(6); pushRoll(3); pushRoll(2)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBeCloseTo(0.45)
  })

  test('pool legibility, mages and character all add points', () => {
    // roll 4 + base 2 + mage 3 + character 2 + minor pool 2 = 13 → 0.65
    const c = makeCampaign({ mages: 9, character: { auguryBonus: 2 } })
    pushRoll(4); pushRoll(1)
    expect(rollAuguryOdds(c, { ...DOOMED, severity: 1 })).toBeCloseTo(0.65)
  })

  test('a monster roll is capped at the maximum', () => {
    // 6 → explode → 6 → explode → 6 (stop): roll 18 + base 2 = 20 → 1.0 → cap
    pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(6); pushRoll(1)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBe(AUGURY_ODDS_MAX)
  })

  test('the floor of the formula: a 1 with no help reads at 15%', () => {
    pushRoll(1); pushRoll(1)
    expect(rollAuguryOdds(makeCampaign(), DOOMED)).toBeCloseTo(0.15)
  })
})

describe('drawAugury', () => {
  test('draws the configured number of unread slots', () => {
    const a = drawAugury()
    expect(a.slots).toHaveLength(AUGURY_SLOTS)
    for (const slot of a.slots) {
      expect(slot.odds).toBeNull() // rolled at consult, not at draw
      expect(slot.shownTrue).toBeNull()
    }
    expect(a).toMatchObject({ consulted: false, rerollsRemaining: AUGURY_REROLLS_PER_DAY })
  })

  test("every slot's pair: distinct events from the SAME pool", () => {
    for (let i = 0; i < 100; i++) {
      for (const slot of drawAugury().slots) {
        expect(slot.trueEvent.id).not.toBe(slot.falseEvent.id)
        expect(slot.falseEvent.severity).toBe(slot.trueEvent.severity) // no cross-pool pairs
        expect(EVENT_POOL.some((e) => e.id === slot.trueEvent.id)).toBe(true)
        expect(EVENT_POOL.some((e) => e.id === slot.falseEvent.id)).toBe(true)
      }
    }
  })
})

// The leak guards the pool structure exists for (user, 2026-07-05): the odds
// modifier belongs to the pool, every pool can form a pair, and knowing the
// pool must not reveal the direction of the fate — magnitude leaks, valence
// never. These tripwires keep future pool edits honest.
describe('EVENT_POOL structure', () => {
  const pools = [...new Set(EVENT_POOL.map((e) => e.severity))]

  // Valence is derived by the one server-side classifier, so the leak guards
  // and the augur's header can never drift apart. eventValenceFor honours a
  // choice event's DECLARED valence (it has no single effect to derive from).
  const isGood = (e) => eventValenceFor(e) === 'good'
  const isBad = (e) => eventValenceFor(e) === 'bad'

  test('every pool has a legibility modifier', () => {
    for (const pool of pools) expect(POOL_LEGIBILITY[pool]).toBeTypeOf('number')
  })

  test('every pool can form a true/false pair (≥2 events)', () => {
    for (const pool of pools)
      expect(EVENT_POOL.filter((e) => e.severity === pool).length).toBeGreaterThanOrEqual(2)
  })

  test('every pool mixes good and bad events — the pool never tells direction', () => {
    for (const pool of pools) {
      const members = EVENT_POOL.filter((e) => e.severity === pool)
      expect(members.some(isGood)).toBe(true)
      expect(members.some(isBad)).toBe(true)
    }
  })

  test('every event has a recognized valence (keeps the classifier honest)', () => {
    for (const e of EVENT_POOL)
      expect(['good', 'bad', 'neutral']).toContain(eventValenceFor(e))
  })

  // Stage 4 1c: recon-sensitive events carry the full three-rung ladder in
  // the POOL (the stored slot copy keeps only display fields — firedRung
  // looks the ladder up by id). The event itself IS the Blind rung and must
  // be a genuine threat; the anticipated rung is the scouts' reversal and
  // must not be.
  test('recon-sensitive events: complete ladders, bad when blind, defused when anticipated', () => {
    const sensitives = EVENT_POOL.filter((e) => e.reconSensitive)
    expect(sensitives.map((e) => e.id).sort()).toEqual(['ambush', 'forage_raiders', 'night_raid'])
    for (const e of sensitives) {
      expect(isBad(e)).toBe(true) // the base event is the full-bad Blind rung
      for (const name of ['warned', 'anticipated']) {
        const rung = e.rungs[name]
        expect(rung.title).toBeTruthy()
        expect(rung.description).toBeTruthy()
        expect(rung.effect).toBeTruthy()
      }
      // Anticipated: neutral or reversed to positive — never still a blow.
      expect(eventValence(e.rungs.anticipated.effect)).not.toBe('bad')
    }
  })
})

// The augur's header labels the SHOWN card's flavour (user, 2026-07-13): the
// valence comes from the displayed omen's own effect, so a bluff card reads
// as the mood it shows, not the mood of the hidden truth. Neutral is a real
// third mood — some fates (rains that foul both sides, a passing comet) net to
// no advantage — so the classifier and the pool both carry it.
describe('eventValence', () => {
  test('classifies gains, losses, and no-ops', () => {
    expect(eventValence({ type: 'food', delta: 3000 })).toBe('good')
    expect(eventValence({ type: 'food', delta: -1000 })).toBe('bad')
    expect(eventValence({ type: 'materials', delta: 25 })).toBe('good')
    expect(eventValence({ type: 'materials', delta: -15 })).toBe('bad')
    expect(eventValence({ type: 'roster', unit: 'Soldier', delta: 20 })).toBe('good')
    expect(eventValence({ type: 'roster', unit: 'Soldier', factor: 0.9 })).toBe('bad')
    expect(eventValence({ type: 'all_roster', factor: 0.95 })).toBe('bad')
    expect(eventValence({ type: 'enemy_advance' })).toBe('bad')
    expect(eventValence({ type: 'none' })).toBe('neutral')
    expect(eventValence(undefined)).toBe('neutral')
    // Stage 4 1c arms: the enemy's losses and betrayed secrets are our gain.
    expect(eventValence({ type: 'enemy_losses', factor: 0.93 })).toBe('good')
    expect(eventValence({ type: 'enemy_reveal' })).toBe('good')
    // Upgrading units in place (mount soldiers as cavalry) reads as a gain.
    expect(eventValence({ type: 'convert', from: 'Soldier', to: 'Cavalry', count: 20 })).toBe('good')
  })

  test('multi effects: agreeing parts share their mood, mixed parts read neutral', () => {
    const food = (delta) => ({ type: 'food', delta })
    expect(
      eventValence({ type: 'multi', effects: [food(-2000), { type: 'roster', unit: 'Soldier', factor: 0.98 }] }),
    ).toBe('bad')
    expect(eventValence({ type: 'multi', effects: [food(3000), { type: 'materials', delta: 25 }] })).toBe('good')
    expect(eventValence({ type: 'multi', effects: [food(3000), { type: 'materials', delta: -15 }] })).toBe('neutral')
    expect(eventValence({ type: 'multi', effects: [{ type: 'none' }] })).toBe('neutral')
  })

  test('the pool carries neutral events so all three moods appear in play', () => {
    expect(EVENT_POOL.some((e) => eventValence(e.effect) === 'neutral')).toBe(true)
  })
})

describe('consultAugury', () => {
  test('reads each slot in order: reading roll → odds, then the vision roll', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(300) // slot 0: odds 0.30, 300 ≤ 300 → truth
    pushRoll(4); pushRoll(1); pushRoll(301) // slot 1: odds 0.30, just over → lie
    pushRoll(1); pushRoll(1); pushRoll(1000) // slot 2: odds 0.15 → lie
    const shown = consultAugury(c)
    expect(c.augury.slots.map((s) => s.odds)).toEqual([0.3, 0.3, 0.15])
    expect(c.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
    expect(shown.map((e) => e.id)).toEqual(['doomed_omen', 'supply', 'supply'])
    expect(c.augury.consulted).toBe(true)
  })

  test('mages raise the odds of every reading', () => {
    const c = makeCampaign({ mages: 9 }) // +3 points
    pushRoll(4); pushRoll(1); pushRoll(450) // (4+2+3)×0.05 = 0.45 → truth at 450
    pushRoll(4); pushRoll(1); pushRoll(451) // → lie at 451
    pushRoll(4); pushRoll(1); pushRoll(1000)
    consultAugury(c)
    expect(c.augury.slots.map((s) => s.odds)).toEqual([0.45, 0.45, 0.45])
    expect(c.augury.slots.map((s) => s.shownTrue)).toEqual([true, false, false])
  })
})

describe('rerollAugurySlot', () => {
  test('replaces exactly one fate; the other slots stay sealed', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 0: truth
    pushRoll(4); pushRoll(1); pushRoll(1000) // slot 1: lie
    pushRoll(4); pushRoll(1); pushRoll(1) // slot 2: truth
    consultAugury(c)

    pushRoll(4); pushRoll(1); pushRoll(1) // the fresh slot's reading: odds ≥ 0.3, vision true
    const shown = rerollAugurySlot(c, 1)

    // Slot 1 is a fresh pool pair — DOOMED is not in the pool, so the old
    // fate is gone for good; slots 0 and 2 still hold their doom.
    expect(c.augury.slots[1].trueEvent.id).not.toBe('doomed_omen')
    expect(c.augury.slots[1].shownTrue).toBe(true)
    expect(c.augury.slots[1].odds).toBeGreaterThanOrEqual(0.3) // fresh reading recorded
    expect(shown.id).toBe(c.augury.slots[1].trueEvent.id)
    expect(c.augury.slots[0].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[2].trueEvent.id).toBe('doomed_omen')
    expect(c.augury.slots[0].shownTrue).toBe(true) // earlier readings untouched
    expect(c.augury.slots[0].odds).toBeCloseTo(0.3)
    expect(c.augury.rerollsRemaining).toBe(AUGURY_REROLLS_PER_DAY - 1)
  })
})

describe('auguryReveal', () => {
  test('unconsulted: no predictions or odds, every truth still revealed', () => {
    const reveal = auguryReveal(makeCampaign())
    expect(reveal).toHaveLength(AUGURY_SLOTS)
    for (const r of reveal) {
      expect(r.predicted).toBeNull()
      expect(r.odds).toBeNull()
      expect(r.wasAccurate).toBeNull()
      expect(r.actual).toEqual({
        id: 'doomed_omen',
        title: 'Doom',
        description: DOOMED.description,
        severity: 3,
      })
    }
  })

  test('per slot: predicted card + odds vs the truth, wasAccurate per vision', () => {
    const c = makeCampaign()
    pushRoll(4); pushRoll(1); pushRoll(1) // truth at odds 0.30
    pushRoll(4); pushRoll(1); pushRoll(1000) // lie
    pushRoll(4); pushRoll(1); pushRoll(1) // truth
    consultAugury(c)
    const reveal = auguryReveal(c)
    expect(reveal.map((r) => r.wasAccurate)).toEqual([true, false, true])
    expect(reveal[0].predicted.id).toBe('doomed_omen')
    expect(reveal[0].odds).toBeCloseTo(0.3)
    expect(reveal[1].predicted.id).toBe('supply') // the lie the player saw
    expect(reveal[1].actual.id).toBe('doomed_omen') // ...and what really came
    // The reveal card never carries the hidden legibility bonus or the effect
    // machinery — display fields only.
    expect(reveal[0].actual.baseAccuracy).toBeUndefined()
    expect(reveal[0].actual.effect).toBeUndefined()
  })
})

// ── Stage 4 1c: recon-sensitive event rungs ─────────────────────────────────

describe('applyEffect — recon-rung arms (Stage 4 1c)', () => {
  const makeTarget = () => ({
    day: 1,
    resources: { food: 10000, materials: 100 },
    roster: new Map([['Soldier', 100]]),
    enemy: { army: new Map([['Soldier', 400], ['Zombie', 200]]), stance: 'camp' },
  })

  test('enemy_losses thins every enemy line, telling the player only a phrase', () => {
    const c = makeTarget()
    const log = applyEffect(c, { type: 'enemy_losses', factor: 0.93 })
    expect(c.enemy.army.get('Soldier')).toBe(372)
    expect(c.enemy.army.get('Zombie')).toBe(186)
    // The log is player-visible: no enemy numbers may leak through it.
    expect(log.length).toBeGreaterThan(0)
    expect(log.join(' ')).not.toMatch(/\d/)
  })

  test('enemy_reveal lays the enemy bare for the coming turn', () => {
    const c = makeTarget()
    const log = applyEffect(c, { type: 'enemy_reveal' })
    // Applied during end-of-day N, the reveal covers the new day N+1.
    expect(c.enemy.revealedUntilDay).toBe(2)
    expect(log.length).toBeGreaterThan(0)
  })

  test('multi applies every part in order and concatenates the logs', () => {
    const c = makeTarget()
    const log = applyEffect(c, {
      type: 'multi',
      effects: [
        { type: 'food', delta: -2000 },
        { type: 'roster', unit: 'Soldier', factor: 0.98 },
      ],
    })
    expect(c.resources.food).toBe(8000)
    expect(c.roster.get('Soldier')).toBe(98)
    expect(log).toHaveLength(2)
  })

  // `convert` upgrades units in place: N of `from` become `to` (mount soldiers
  // as cavalry, arm levy as soldiers…). It's the mechanic the Horses event
  // hangs on — a real roster change, not just a number tweak.
  test('convert moves units from one type to another', () => {
    const c = makeTarget() // Soldier 100
    const log = applyEffect(c, { type: 'convert', from: 'Soldier', to: 'Cavalry', count: 30 })
    expect(c.roster.get('Soldier')).toBe(70)
    expect(c.roster.get('Cavalry')).toBe(30)
    expect(log.length).toBeGreaterThan(0)
  })

  test('convert takes only what the source holds — never a negative roster', () => {
    const c = makeTarget()
    c.roster.set('Soldier', 10)
    applyEffect(c, { type: 'convert', from: 'Soldier', to: 'Cavalry', count: 30 })
    expect(c.roster.get('Soldier')).toBe(0)
    expect(c.roster.get('Cavalry')).toBe(10)
  })
})

describe('the Horses event: mount soldiers as cavalry', () => {
  const horses = EVENT_POOL.find((e) => e.id === 'horses')

  test('exists as a choice event that declares a valence', () => {
    expect(horses).toBeTruthy()
    expect(horses.effect).toEqual({ type: 'choice' })
    expect(['good', 'bad', 'neutral']).toContain(horses.valence)
  })

  test('one branch upgrades Soldiers into Cavalry via a convert effect', () => {
    const branch = horses.choices.find((c) => {
      const eff = c.effect
      const parts = eff.type === 'multi' ? eff.effects : [eff]
      return parts.some((p) => p.type === 'convert' && p.from === 'Soldier' && p.to === 'Cavalry')
    })
    expect(branch).toBeTruthy()
  })
})

describe('minor pool has an interactive event: the merchant caravan', () => {
  const caravan = EVENT_POOL.find((e) => e.id === 'merchant_caravan')
  // a flat list of every (type, sign) resource delta across a branch's effects
  const deltas = (branch) =>
    (branch.effect.type === 'multi' ? branch.effect.effects : [branch.effect])
      .filter((e) => e.delta !== undefined)
      .map((e) => `${e.type}:${e.delta > 0 ? 'gain' : 'spend'}`)

  test('the minor pool (severity 1) carries a choice event', () => {
    const minorChoices = EVENT_POOL.filter((e) => e.severity === 1 && e.effect?.type === 'choice')
    expect(minorChoices.some((e) => e.id === 'merchant_caravan')).toBe(true)
  })

  test('it lets the player trade materials for food, and food for materials', () => {
    expect(caravan).toBeTruthy()
    expect(caravan.severity).toBe(1)
    const all = caravan.choices.flatMap(deltas)
    // one branch gains food (spending materials); the other gains materials
    // (spending food) — a genuine two-way trade, not a one-sided gift.
    expect(all).toContain('food:gain')
    expect(all).toContain('materials:spend')
    expect(all).toContain('materials:gain')
    expect(all).toContain('food:spend')
  })
})

describe('firedRung (Stage 4 1c)', () => {
  // An event as an augury slot stores it: the schema keeps only the display
  // fields, so the ladder must come from EVENT_POOL by id, never from the
  // stored copy.
  const stored = (id) => {
    const { title, description, severity, effect } = EVENT_POOL.find((e) => e.id === id)
    return { id, title, description, severity, effect }
  }

  test('Blind: the event fires exactly as foretold', () => {
    const fired = firedRung(stored('ambush'), 'Blind')
    expect(fired).toMatchObject({
      rung: 'blind',
      intervened: false,
      reconSensitive: true,
      title: 'Enemy Ambush',
    })
    expect(fired.effect).toEqual({ type: 'enemy_advance' })
  })

  test('Outmatched/Contested: the warned rung fires, flagged as intervention', () => {
    for (const band of ['Outmatched', 'Contested']) {
      const fired = firedRung(stored('ambush'), band)
      expect(fired.rung).toBe('warned')
      expect(fired.intervened).toBe(true)
      expect(fired.title).toBeTruthy()
      expect(fired.title).not.toBe('Enemy Ambush') // the downgraded rung has its own card
    }
  })

  test('Superior/Overwhelming: the anticipated rung fires', () => {
    for (const band of ['Superior', 'Overwhelming']) {
      const fired = firedRung(stored('night_raid'), band)
      expect(fired.rung).toBe('anticipated')
      expect(fired.intervened).toBe(true)
      expect(fired.effect).toEqual({ type: 'enemy_reveal' })
    }
  })

  test('plain events and unknown ids pass through untouched at any band', () => {
    const supply = stored('supply')
    const fired = firedRung(supply, 'Overwhelming')
    expect(fired).toMatchObject({ rung: 'blind', intervened: false, reconSensitive: false })
    expect(fired.title).toBe(supply.title)
    expect(fired.effect).toEqual(supply.effect)
    // DOOMED is not in the pool — a stale id degrades to the stored card.
    const doom = firedRung(DOOMED, 'Overwhelming')
    expect(doom.rung).toBe('blind')
    expect(doom.intervened).toBe(false)
    expect(doom.title).toBe('Doom')
  })
})

// ── Events with choices (resolve-then-choose) ────────────────────────────────
// Some fired fates hand the player a decision instead of an effect. The
// branches (`choices`) live in EVENT_POOL — on the event itself (its blind
// rung) or on a recon rung — and ride out of firedRung with the rung that
// fires; the stored slot copy keeps only display fields plus a `choice`
// sentinel effect (the schema requires one; it never applies). Option text is
// phrases only — the effects stay server-side, so no digits may appear.
describe('EVENT_POOL: events with choices', () => {
  const allChoiceSets = (e) =>
    [e.choices, ...Object.values(e.rungs ?? {}).map((r) => r.choices)].filter(Boolean)
  const choiceEvents = EVENT_POOL.filter((e) => allChoiceSets(e).length > 0)

  test('at least two choice events exist', () => {
    expect(choiceEvents.length).toBeGreaterThanOrEqual(2)
  })

  test('every choice event declares a valence and carries the choice-sentinel effect', () => {
    for (const e of choiceEvents) {
      expect(['good', 'bad', 'neutral']).toContain(e.valence)
      expect(e.effect).toEqual({ type: 'choice' })
    }
  })

  test('every option is a complete card: unique id, phrase-only label/description, an effect', () => {
    for (const e of choiceEvents)
      for (const choices of allChoiceSets(e)) {
        expect(choices.length).toBeGreaterThanOrEqual(2)
        expect(new Set(choices.map((c) => c.id)).size).toBe(choices.length)
        for (const c of choices) {
          expect(c.id).toBeTruthy()
          expect(c.label).toBeTruthy()
          expect(c.description).toBeTruthy()
          expect(c.effect).toBeTruthy()
          expect(c.label).not.toMatch(/\d/)
          expect(c.description).not.toMatch(/\d/)
        }
      }
  })
})

describe('eventValenceFor', () => {
  test('a declared valence (looked up in the pool by id) overrides the effect-derived one', () => {
    const declared = EVENT_POOL.find((e) => e.valence)
    expect(declared).toBeTruthy()
    // The stored slot copy carries only display fields + the sentinel effect;
    // the declared valence must still be found via the pool.
    const stored = {
      id: declared.id,
      title: declared.title,
      severity: declared.severity,
      effect: declared.effect,
    }
    expect(eventValenceFor(stored)).toBe(declared.valence)
  })

  test('falls back to the effect for plain events, pooled or not', () => {
    expect(eventValenceFor({ id: 'supply', effect: { type: 'food', delta: 3000 } })).toBe('good')
    expect(eventValenceFor(DOOMED)).toBe('bad') // not in the pool
    expect(eventValenceFor(undefined)).toBe('neutral')
  })
})

describe('firedRung/choiceRung: choices ride the fired rung', () => {
  const storedCopy = (e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    severity: e.severity,
    effect: e.effect,
  })

  test('a plain choice event fires blind with its choices attached', () => {
    const e = EVENT_POOL.find((ev) => ev.choices && !ev.reconSensitive)
    expect(e).toBeTruthy()
    const fired = firedRung(storedCopy(e), 'Contested')
    expect(fired.rung).toBe('blind')
    expect(fired.choices).toEqual(e.choices)
  })

  test('events without choices fire with none', () => {
    const supply = EVENT_POOL.find((ev) => ev.id === 'supply')
    expect(firedRung(storedCopy(supply), 'Blind').choices).toBeUndefined()
    expect(firedRung(DOOMED, 'Blind').choices).toBeUndefined()
  })

  test('choiceRung: pool lookup by id+rung; ids or rungs without choices yield null', () => {
    const e = EVENT_POOL.find((ev) => ev.choices && !ev.reconSensitive)
    expect(choiceRung(e.id, 'blind')).toEqual({
      title: e.title,
      description: e.description,
      choices: e.choices,
    })
    expect(choiceRung('no_such_event', 'blind')).toBeNull()
    expect(choiceRung('supply', 'blind')).toBeNull()
    expect(choiceRung(e.id, 'warned')).toBeNull() // no such rung on a plain event
  })
})
