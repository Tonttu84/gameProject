import { afterEach, describe, expect, test } from 'vitest'
import config from '../utils/config.js'
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
  eventEligible,
  eligiblePool,
  GARRISON_SORTIE_EVENTS,
} from '../services/events.js'
import { generateRaidOpportunities, applyRaidReward } from '../services/raid.js'
import {
  AUGURY_SLOTS,
  AUGURY_ODDS_MAX,
  AUGURY_REROLLS_PER_DAY,
  GARRISON_RESOLVE_START,
  GARRISON_WALL_SLOW_MAX,
  GARRISON_SALLY_THRESHOLD,
  GARRISON_SALLY_TROOPS,
} from '../utils/campaignConfig.js'
import { wallSlowFactor, adjustResolve, garrisonSallies, garrisonSallyTroops, garrisonLevel, garrisonSurrendered } from '../services/garrison.js'

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

// Test-only deterministic draw hook (DEV_AUGURY): the augur normally draws
// with Math.random, so the e2e can't force a KNOWN reveal. Setting
// config.DEV_AUGURY to `trueId:falseId` specs pins each slot's hidden pair so
// the shown fate is deterministic whatever the odds roll does. Unset = the
// random production path, unchanged (asserted by every OTHER test here).
describe('drawAugury — DEV_AUGURY force hook', () => {
  afterEach(() => { config.DEV_AUGURY = [] })

  test('forces the named true/false events into slots, in order', () => {
    config.DEV_AUGURY = ['horses:comet', 'merchant_caravan:refugees']
    const a = drawAugury()
    expect(a.slots[0].trueEvent.id).toBe('horses')
    expect(a.slots[0].falseEvent.id).toBe('comet')
    expect(a.slots[1].trueEvent.id).toBe('merchant_caravan')
    expect(a.slots[1].falseEvent.id).toBe('refugees')
    // A slot beyond the forced list falls back to a real random pair.
    expect(EVENT_POOL.some((e) => e.id === a.slots[2].trueEvent.id)).toBe(true)
    expect(a.slots[2].falseEvent.severity).toBe(a.slots[2].trueEvent.severity)
  })

  test('re-seeds every draw, so each turn is identical', () => {
    config.DEV_AUGURY = ['horses:comet']
    expect(drawAugury().slots[0].trueEvent.id).toBe('horses')
    expect(drawAugury().slots[0].trueEvent.id).toBe('horses') // not drained across turns
  })

  test('a forced slot without an explicit false event still gets a valid same-pool peer', () => {
    config.DEV_AUGURY = ['horses'] // severity 3, no falseId
    const slot = drawAugury().slots[0]
    expect(slot.trueEvent.id).toBe('horses')
    expect(slot.falseEvent.id).not.toBe('horses')
    expect(slot.falseEvent.severity).toBe(slot.trueEvent.severity)
  })

  test('an unknown id is ignored — that slot draws randomly, no throw', () => {
    config.DEV_AUGURY = ['no_such_event']
    const slot = drawAugury().slots[0]
    expect(EVENT_POOL.some((e) => e.id === slot.trueEvent.id)).toBe(true)
    expect(slot.falseEvent.severity).toBe(slot.trueEvent.severity)
  })

  test('a rerolled slot consumes the next forced spec', () => {
    config.DEV_AUGURY = ['horses:comet', 'merchant_caravan:refugees', 'sellswords:drillmaster', 'refugees:merchant_caravan']
    const campaign = { roster: new Map(), augury: drawAugury() }
    rerollAugurySlot(campaign, 0) // 4th spec
    expect(campaign.augury.slots[0].trueEvent.id).toBe('refugees')
    expect(campaign.augury.slots[0].falseEvent.id).toBe('merchant_caravan')
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

  // Prerequisites (R1) are ADDITIVE: a gated event only ever widens a tier's
  // eligible set, it can never shrink it below a legible pair. The guarantee
  // is that the UNCONDITIONAL events (no `requires`) already satisfy the ≥2 +
  // mixed-valence rule on their own — so however the campaign state gates the
  // rest, drawAugury can always form an honest same-pool pair. Break this and
  // a prerequisite could strand a tier with one card (no decoy) or one mood
  // (direction leaks). This is the invariant that lets eligiblePool filter
  // freely without a collapse guard.
  test('the unconditional events alone keep every pool legible (≥2, mixed)', () => {
    for (const pool of pools) {
      // The guaranteed-available base excludes BOTH `requires`-gated events
      // (part 1) and `chained` follow-ups (part 2) — neither is a candidate
      // for a random draw or a decoy, so the collapse guarantee must hold
      // without them.
      const base = EVENT_POOL.filter((e) => e.severity === pool && !e.requires && !e.chained)
      expect(base.length).toBeGreaterThanOrEqual(2)
      expect(base.some(isGood)).toBe(true)
      expect(base.some(isBad)).toBe(true)
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
    enemy: { army: new Map([['Soldier', 400], ['Zombie', 200]]) },
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

  test('enemy_advance forces the boss fight (bossFightDue) — the retired stance is gone', () => {
    const c = makeTarget()
    const log = applyEffect(c, { type: 'enemy_advance' })
    // What the old 'offering_battle' stance used to signal is now the meter's
    // bossFightDue flag: the decisive fight is due next day regardless of the meter.
    expect(c.bossFightDue).toBe(true)
    expect(log).toContain('The enemy host is moving on your camp.')
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

// ── Prerequisites (R1): events gated on campaign state ──────────────────────
// An event may carry a `requires` block; eventEligible tests it against a
// context {day, roster, eventFlags}. Ineligible events never enter a draw —
// neither as the truth nor as a decoy — so a chain's follow-up can't surface
// before its trigger, and a state-flavoured fate (horse sickness) can't fire
// on an army that has no horses. The context is duck-typed: roster/eventFlags
// may be a Map (the Mongoose doc) or a plain object (creation-time / tests).
describe('eventEligible — prerequisites', () => {
  const ev = (requires) => ({ id: 'x', title: 'X', severity: 1, effect: { type: 'none' }, requires })

  test('no requires → always eligible', () => {
    expect(eventEligible(ev(undefined), {})).toBe(true)
    expect(eventEligible(ev(undefined), { day: 1 })).toBe(true)
  })

  test('minDay / maxDay gate on the turn number', () => {
    expect(eventEligible(ev({ minDay: 3 }), { day: 2 })).toBe(false)
    expect(eventEligible(ev({ minDay: 3 }), { day: 3 })).toBe(true)
    expect(eventEligible(ev({ maxDay: 3 }), { day: 4 })).toBe(false)
    expect(eventEligible(ev({ maxDay: 3 }), { day: 3 })).toBe(true)
    // A missing day reads as day 1 (creation-time draw).
    expect(eventEligible(ev({ minDay: 2 }), {})).toBe(false)
  })

  test('flags require every named flag set; notFlags forbid any', () => {
    const flags = new Map([['caravan_dealt', 1]])
    expect(eventEligible(ev({ flags: ['caravan_dealt'] }), { eventFlags: flags })).toBe(true)
    expect(eventEligible(ev({ flags: ['caravan_dealt', 'missing'] }), { eventFlags: flags })).toBe(false)
    expect(eventEligible(ev({ notFlags: ['caravan_dealt'] }), { eventFlags: flags })).toBe(false)
    expect(eventEligible(ev({ notFlags: ['other'] }), { eventFlags: flags })).toBe(true)
    // A plain-object flag bag works the same (no Mongoose Map yet).
    expect(eventEligible(ev({ flags: ['seen'] }), { eventFlags: { seen: 1 } })).toBe(true)
    // A flag at 0 counts as unset.
    expect(eventEligible(ev({ flags: ['seen'] }), { eventFlags: { seen: 0 } })).toBe(false)
  })

  test('hasUnit gates on the roster holding that type (Map or object)', () => {
    expect(eventEligible(ev({ hasUnit: 'Cavalry' }), { roster: new Map([['Cavalry', 5]]) })).toBe(true)
    expect(eventEligible(ev({ hasUnit: 'Cavalry' }), { roster: new Map([['Cavalry', 0]]) })).toBe(false)
    expect(eventEligible(ev({ hasUnit: 'Cavalry' }), { roster: new Map() })).toBe(false)
    expect(eventEligible(ev({ hasUnit: 'Cavalry' }), { roster: { Cavalry: 3 } })).toBe(true)
    expect(eventEligible(ev({ hasUnit: 'Cavalry' }), {})).toBe(false)
  })

  test('all clauses must pass together (AND)', () => {
    const e = ev({ minDay: 2, hasUnit: 'Cavalry' })
    expect(eventEligible(e, { day: 2, roster: { Cavalry: 1 } })).toBe(true)
    expect(eventEligible(e, { day: 1, roster: { Cavalry: 1 } })).toBe(false)
    expect(eventEligible(e, { day: 2, roster: {} })).toBe(false)
  })
})

describe('eligiblePool + drawAugury honour prerequisites', () => {
  afterEach(() => { config.DEV_AUGURY = [] })

  // horse_sickness is the R1 proof event: it only makes sense on an army with
  // mounts, so it is gated hasUnit:'Cavalry'.
  test('a cavalry-gated event is out of the pool with no horses, in with them', () => {
    const withoutHorses = eligiblePool({ roster: new Map([['Soldier', 100]]) })
    expect(withoutHorses.some((e) => e.id === 'horse_sickness')).toBe(false)
    const withHorses = eligiblePool({ roster: new Map([['Soldier', 100], ['Cavalry', 20]]) })
    expect(withHorses.some((e) => e.id === 'horse_sickness')).toBe(true)
  })

  test('drawAugury never surfaces an ineligible event — truth OR decoy', () => {
    const ctx = { day: 1, roster: new Map([['Soldier', 100]]) } // no cavalry
    const ids = new Set(eligiblePool(ctx).map((e) => e.id))
    for (let i = 0; i < 80; i++) {
      for (const slot of drawAugury(ctx).slots) {
        expect(ids.has(slot.trueEvent.id)).toBe(true)
        expect(ids.has(slot.falseEvent.id)).toBe(true)
      }
    }
  })
})

describe('applyEffect — flag (R0 chain/prereq bookkeeping)', () => {
  const target = () => ({ day: 1, resources: { food: 0, materials: 0 }, roster: new Map(), eventFlags: new Map() })

  test('sets a flag to 1 by default and leaves no player-visible number', () => {
    const c = target()
    const log = applyEffect(c, { type: 'flag', name: 'caravan_dealt' })
    expect(c.eventFlags.get('caravan_dealt')).toBe(1)
    // Flags are hidden bookkeeping — the chain's narrative lives in event
    // text, never a numeric log line that would leak state.
    expect(log.join(' ')).not.toMatch(/\d/)
  })

  test('an explicit value sets, a delta increments', () => {
    const c = target()
    applyEffect(c, { type: 'flag', name: 'mood', value: 3 })
    expect(c.eventFlags.get('mood')).toBe(3)
    applyEffect(c, { type: 'flag', name: 'mood', delta: 2 })
    expect(c.eventFlags.get('mood')).toBe(5)
  })

  test('rides inside a multi alongside a real effect', () => {
    const c = target()
    c.resources.food = 1000
    applyEffect(c, { type: 'multi', effects: [{ type: 'food', delta: 2000 }, { type: 'flag', name: 'caravan_dealt' }] })
    expect(c.resources.food).toBe(3000)
    expect(c.eventFlags.get('caravan_dealt')).toBe(1)
  })
})

describe('the horse_sickness event: prerequisites in the pool', () => {
  const ev = EVENT_POOL.find((e) => e.id === 'horse_sickness')

  test('exists, gated on holding cavalry, and thins the mounted arm', () => {
    expect(ev).toBeTruthy()
    expect(ev.requires).toEqual({ hasUnit: 'Cavalry' })
    expect(eventValenceFor(ev)).toBe('bad')
    expect(ev.effect).toMatchObject({ type: 'roster', unit: 'Cavalry' })
  })
})

// ── Event chains (part 2) ──────────────────────────────────────────────────
// An outcome's `schedule` effect queues a guaranteed follow-up on
// campaign.scheduledEvents; drawAugury drains due entries into forced slots;
// `chained` events stay out of the random pool so they surface only when
// scheduled.
describe('applyEffect — schedule (chain follow-ups)', () => {
  const target = (day = 5) => ({ day, resources: { food: 0, materials: 0 }, roster: new Map(), scheduledEvents: [] })

  test('queues the event for campaign.day + delay, with no player-visible number', () => {
    const c = target(5)
    const log = applyEffect(c, { type: 'schedule', event: 'sprung_ambush', delay: 1 })
    expect(c.scheduledEvents).toEqual([{ eventId: 'sprung_ambush', day: 6 }])
    // Scheduling is hidden state — no leaked log line about a coming beat.
    expect(log).toEqual([])
  })

  test('delay defaults to the next turn', () => {
    const c = target(3)
    applyEffect(c, { type: 'schedule', event: 'sprung_ambush' })
    expect(c.scheduledEvents).toEqual([{ eventId: 'sprung_ambush', day: 4 }])
  })

  test('rides inside a multi alongside a real effect', () => {
    const c = target(2)
    c.resources.food = 1000
    applyEffect(c, { type: 'multi', effects: [{ type: 'food', delta: 500 }, { type: 'schedule', event: 'sprung_ambush', delay: 2 }] })
    expect(c.resources.food).toBe(1500)
    expect(c.scheduledEvents).toEqual([{ eventId: 'sprung_ambush', day: 4 }])
  })
})

describe('eligiblePool excludes chained follow-ups', () => {
  test('a chained event is never a random-draw or decoy candidate', () => {
    const ids = new Set(eligiblePool({ day: 10, roster: new Map([['Soldier', 100]]) }).map((e) => e.id))
    expect(ids.has('sprung_ambush')).toBe(false) // chained — only ever scheduled
    expect(ids.has('captured_courier')).toBe(true) // the trigger IS a normal draw
  })
})

describe('drawAugury drains the schedule queue into forced slots', () => {
  test('a due entry becomes a forced slot (scheduled event as truth) and is drained', () => {
    const ctx = {
      day: 6,
      roster: new Map([['Soldier', 100]]),
      scheduledEvents: [{ eventId: 'sprung_ambush', day: 6 }],
    }
    const augury = drawAugury(ctx)
    const forced = augury.slots.filter((s) => s.trueEvent.id === 'sprung_ambush')
    expect(forced).toHaveLength(1)
    // The decoy is a same-tier, non-chained peer (an honest pair).
    const decoy = forced[0].falseEvent
    expect(decoy.severity).toBe(2)
    expect(decoy.id).not.toBe('sprung_ambush')
    // Drained: the queue is now empty.
    expect(ctx.scheduledEvents).toEqual([])
  })

  test('an entry not yet due stays in the queue and forces nothing', () => {
    const ctx = {
      day: 5,
      roster: new Map([['Soldier', 100]]),
      scheduledEvents: [{ eventId: 'sprung_ambush', day: 6 }],
    }
    const augury = drawAugury(ctx)
    expect(augury.slots.some((s) => s.trueEvent.id === 'sprung_ambush')).toBe(false)
    expect(ctx.scheduledEvents).toEqual([{ eventId: 'sprung_ambush', day: 6 }])
  })

  test('an unknown scheduled id is dropped, not stranded', () => {
    const ctx = { day: 6, roster: new Map([['Soldier', 100]]), scheduledEvents: [{ eventId: 'gone_from_pool', day: 1 }] }
    drawAugury(ctx)
    expect(ctx.scheduledEvents).toEqual([])
  })

  test('an absent queue is a no-op (creation-route ctx)', () => {
    expect(() => drawAugury({ day: 1, roster: new Map() })).not.toThrow()
  })
})

describe('the captured_courier → sprung_ambush chain', () => {
  const trigger = EVENT_POOL.find((e) => e.id === 'captured_courier')
  const followUp = EVENT_POOL.find((e) => e.id === 'sprung_ambush')

  test('the trigger is a normal choice whose read branch schedules the follow-up', () => {
    expect(trigger).toBeTruthy()
    expect(trigger.chained).toBeUndefined()
    const read = trigger.choices.find((c) => c.id === 'read_dispatches')
    expect(read.effect).toEqual({ type: 'schedule', event: 'sprung_ambush', delay: 1 })
    // The other branch schedules nothing — the chain is the player's own choice.
    const ransom = trigger.choices.find((c) => c.id === 'ransom_courier')
    expect(ransom.effect.type).not.toBe('schedule')
  })

  test('the follow-up is chained, same tier, and cuts the enemy down', () => {
    expect(followUp.chained).toBe(true)
    expect(followUp.severity).toBe(trigger.severity)
    expect(eventValenceFor(followUp)).toBe('good')
    expect(followUp.effect).toEqual({ type: 'enemy_losses', factor: 0.9 })
  })
})

// ── Siege content: the relief-host chain ─────────────────────────────────────
// In the relief-army fiction (you are the mobile host racing to Karrowgate, NOT
// the besieged garrison), `relief_rider` chains a guaranteed reinforcement a
// fortnight out via the existing `schedule`/`chained` primitive: send guides to
// speed the Warden's main host, or keep your scouts foraging.
describe('siege events: the relief-host chain', () => {
  const reliefRider = EVENT_POOL.find((e) => e.id === 'relief_rider')
  const reliefArrives = EVENT_POOL.find((e) => e.id === 'relief_column_arrives')

  test("the relief rider's send-guides branch schedules the chained reinforcement", () => {
    expect(reliefRider.effect).toEqual({ type: 'choice' })
    expect(reliefRider.chained).toBeUndefined()
    const guides = reliefRider.choices.find((c) => c.id === 'send_guides')
    expect(guides.effect).toEqual({ type: 'schedule', event: 'relief_column_arrives', delay: 1 })
    // The forage branch schedules nothing — a plain supply gain instead.
    const forage = reliefRider.choices.find((c) => c.id === 'keep_foraging')
    expect(forage.effect.type).not.toBe('schedule')
  })

  test('the relief column is a chained, same-tier reinforcement kept out of the random pool', () => {
    expect(reliefArrives.chained).toBe(true)
    expect(reliefArrives.severity).toBe(reliefRider.severity)
    expect(eventValenceFor(reliefArrives)).toBe('good')
    const ids = new Set(eligiblePool({ day: 10, roster: new Map([['Soldier', 100]]) }).map((e) => e.id))
    expect(ids.has('relief_column_arrives')).toBe(false)
    expect(ids.has('relief_rider')).toBe(true)
  })
})

// ── Garrison Resolve (slice 1): the standing track + its event gate ──────────
// A hidden 0..100 relationship track (campaign.garrison.resolve) fed by the
// `garrison` effect and read as an event prerequisite (requires
// minResolve/maxResolve). Later slices hang the passive wall-slow + boss-fight
// sally off the same number; slice 1 is the track, the gate, and the
// cooperation events.
describe('applyEffect — garrison (Resolve delta)', () => {
  const target = (resolve = 40) => ({
    day: 1, resources: { food: 5000, materials: 0 }, roster: new Map(), garrison: { resolve },
  })

  test('moves resolve by the delta and leaves no player-visible number', () => {
    const c = target(40)
    const log = applyEffect(c, { type: 'garrison', delta: 15 })
    expect(c.garrison.resolve).toBe(55)
    // Hidden state like `flag` — the relationship's story is the event text.
    expect(log.join(' ')).not.toMatch(/\d/)
  })

  test('clamps to [0, 100]', () => {
    const hi = target(95); applyEffect(hi, { type: 'garrison', delta: 20 })
    expect(hi.garrison.resolve).toBe(100)
    const lo = target(10); applyEffect(lo, { type: 'garrison', delta: -25 })
    expect(lo.garrison.resolve).toBe(0)
  })

  test('initializes the track from the starting value when the campaign has none', () => {
    const c = { day: 1, resources: { food: 0, materials: 0 }, roster: new Map() }
    applyEffect(c, { type: 'garrison', delta: 5 })
    expect(c.garrison.resolve).toBe(GARRISON_RESOLVE_START + 5)
  })

  test('rides inside a multi alongside a real effect', () => {
    const c = target(40)
    applyEffect(c, { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'garrison', delta: 15 }] })
    expect(c.resources.food).toBe(3000)
    expect(c.garrison.resolve).toBe(55)
  })

  test('classifies as neutral — a relationship move, not a gain or loss', () => {
    expect(eventValence({ type: 'garrison', delta: 15 })).toBe('neutral')
    expect(eventValence({ type: 'garrison', delta: -15 })).toBe('neutral')
  })
})

// Slice 2 — the passive wall-slow: the fraction the boss-fight-meter fill is
// reduced by, linear in resolve and capped below 1 so the walls never freeze.
describe('wallSlowFactor — the passive wall-slow (slice 2)', () => {
  test('is 0 at a broken garrison and the full MAX at a devoted one', () => {
    expect(wallSlowFactor(0)).toBe(0)
    expect(wallSlowFactor(100)).toBeCloseTo(GARRISON_WALL_SLOW_MAX)
  })

  test('scales linearly with resolve', () => {
    expect(wallSlowFactor(50)).toBeCloseTo(GARRISON_WALL_SLOW_MAX / 2)
    expect(wallSlowFactor(GARRISON_RESOLVE_START)).toBeCloseTo(0.18) // start 45 -> 0.4*0.45
  })

  test('is capped below 1, so a maxed garrison can never freeze the clock', () => {
    expect(wallSlowFactor(GARRISON_RESOLVE_START)).toBeLessThan(1)
    expect(wallSlowFactor(200)).toBe(GARRISON_WALL_SLOW_MAX) // clamps the resolve
    expect(GARRISON_WALL_SLOW_MAX).toBeLessThan(1)
  })
})

// adjustResolve is the single writer for the track (the `garrison` effect and
// the band-cross decay both go through it); the applyEffect tests above pin its
// event path — here just the init + clamp contract it owns.
describe('adjustResolve — the single resolve writer', () => {
  test('initializes an absent track from the starting value', () => {
    const c = {}
    adjustResolve(c, 5)
    expect(c.garrison.resolve).toBe(GARRISON_RESOLVE_START + 5)
  })

  test('clamps both ends and returns the new value', () => {
    const c = { garrison: { resolve: 5 } }
    expect(adjustResolve(c, -20)).toBe(0)
    const hi = { garrison: { resolve: 95 } }
    expect(adjustResolve(hi, 20)).toBe(100)
  })
})

// garrisonSallies — the boss-fight sally predicate (slice 3). The battle route
// reads it once and, if true, thins the enemy before the pitched battle.
describe('garrisonSallies — the sally threshold (slice 3)', () => {
  test('fires only at or above the sally threshold', () => {
    expect(garrisonSallies(GARRISON_SALLY_THRESHOLD)).toBe(true)
    expect(garrisonSallies(GARRISON_SALLY_THRESHOLD - 1)).toBe(false)
    expect(garrisonSallies(100)).toBe(true)
  })

  test('a fresh (starting-resolve) garrison does not sally', () => {
    expect(garrisonSallies(GARRISON_RESOLVE_START)).toBe(false)
    expect(garrisonSallies()).toBe(false)
  })

  test('clamps out-of-range resolve before comparing', () => {
    expect(garrisonSallies(200)).toBe(true)
    expect(garrisonSallies(-50)).toBe(false)
  })
})

// garrisonSallyTroops — the graduated sally (S7). Troop count the garrison
// commits to the decisive battle, keyed on garrisonLevel: low none, normal
// some, determined more. The battle route turns a >0 count into a BattleInput
// reinforcement wave.
describe('garrisonSallyTroops — graduated by level (S7)', () => {
  test('a determined garrison sends the most troops', () => {
    expect(garrisonSallyTroops(80)).toBe(GARRISON_SALLY_TROOPS.determined)
    expect(garrisonSallyTroops(100)).toBe(GARRISON_SALLY_TROOPS.determined)
  })

  test('a normal garrison sends fewer', () => {
    expect(garrisonSallyTroops(50)).toBe(GARRISON_SALLY_TROOPS.normal)
    expect(garrisonSallyTroops(GARRISON_RESOLVE_START)).toBe(GARRISON_SALLY_TROOPS.normal)
    expect(GARRISON_SALLY_TROOPS.normal).toBeLessThan(GARRISON_SALLY_TROOPS.determined)
  })

  test('a low garrison sends none', () => {
    expect(garrisonSallyTroops(20)).toBe(0)
    expect(GARRISON_SALLY_TROOPS.low).toBe(0)
  })
})

// garrisonLevel — the three player-facing support levels (S5 redesign). low /
// normal / determined, by descending threshold; the HUD renders a gauge from it.
describe('garrisonLevel — the 3 support levels (S5)', () => {
  test('low 1..33, normal 34..66, determined 67..100', () => {
    expect(garrisonLevel(1)).toBe('low')
    expect(garrisonLevel(33)).toBe('low')
    expect(garrisonLevel(34)).toBe('normal')
    expect(garrisonLevel(66)).toBe('normal')
    expect(garrisonLevel(67)).toBe('determined')
    expect(garrisonLevel(100)).toBe('determined')
  })

  test('a resolve of 0 still resolves to a level (low) before surrender ends the campaign', () => {
    expect(garrisonLevel(0)).toBe('low')
  })

  test('the starting resolve reads normal', () => {
    expect(garrisonLevel(GARRISON_RESOLVE_START)).toBe('normal')
    expect(garrisonLevel()).toBe('normal') // defaulted
  })
})

// garrisonSurrendered — the second loss clock (S5). At/under the surrender floor
// the garrison opens Karrowgate's gates and the campaign is lost (dayResolution).
describe('garrisonSurrendered — the surrender floor (S5)', () => {
  test('true only at/under the floor (0)', () => {
    expect(garrisonSurrendered(0)).toBe(true)
    expect(garrisonSurrendered(1)).toBe(false)
    expect(garrisonSurrendered(GARRISON_RESOLVE_START)).toBe(false)
    expect(garrisonSurrendered()).toBe(false) // defaulted
  })

  test('clamps out-of-range resolve before comparing', () => {
    expect(garrisonSurrendered(-50)).toBe(true)
    expect(garrisonSurrendered(200)).toBe(false)
  })
})

// Garrison sortie — payoff/cost (a): a coordinated sally the garrison offers
// only once it trusts you (a resolve-gated raid opportunity). Committing a
// party is a raid-style battle whose cost is battle-day readiness (the troops
// land in raid.assignment) and whose reward FEEDS the resolve track. Surfaced
// through the event-prerequisite machinery (each version is an `event` with a
// `requires.minResolve` gate), but spawned onto the RAID board — not the augury
// — so the offer IS the raid, never a vision. See docs/CAMPAIGN_PLAN.md slice 4.
describe('garrison sortie (slice 4) — resolve-gated raid opportunities', () => {
  // capacityOf falls back to size 10 for unknown types, so an empty catalog is
  // enough to build opportunities in these pure tests.
  const catalog = new Map()
  const fakeCampaign = (resolve) => ({
    day: 3,
    augury: { slots: [] }, // no bad fates → the only opps are sorties (if any)
    enemy: { army: { Soldier: 540, Archer: 150 } },
    garrison: { resolve },
  })
  const sortiesOf = (resolve) =>
    generateRaidOpportunities(fakeCampaign(resolve), catalog).filter(
      (o) => o.type === 'garrison_sortie',
    )
  const probe = GARRISON_SORTIE_EVENTS.find((e) => e.id === 'sortie_probe')
  const grand = GARRISON_SORTIE_EVENTS.find((e) => e.id === 'sortie_grand')

  test('every sortie event is trust-gated (requires.minResolve) and feeds resolve', () => {
    expect(GARRISON_SORTIE_EVENTS.length).toBeGreaterThanOrEqual(2)
    for (const ev of GARRISON_SORTIE_EVENTS) {
      expect(ev.requires.minResolve).toBeGreaterThan(GARRISON_RESOLVE_START)
      expect(ev.sortie.resolve).toBeGreaterThan(0)
    }
  })

  test('a wary (starting-resolve) garrison offers no sortie — the board is unchanged', () => {
    expect(sortiesOf(GARRISON_RESOLVE_START)).toHaveLength(0)
    expect(sortiesOf(GARRISON_RESOLVE_START - 5)).toHaveLength(0)
  })

  test('a steadfast garrison opens the probe; a devoted one opens both versions', () => {
    const steadfast = sortiesOf(probe.requires.minResolve)
    expect(steadfast.map((o) => o.source)).toEqual(['garrison_sortie'])
    expect(steadfast).toHaveLength(1)
    // The grand assault stays shut until devoted trust.
    expect(sortiesOf(grand.requires.minResolve - 1)).toHaveLength(1)
    expect(sortiesOf(grand.requires.minResolve)).toHaveLength(2)
  })

  test('a sortie opportunity carries the event flavour, a real target slice, and its thins-enemy flag', () => {
    const [o] = sortiesOf(probe.requires.minResolve)
    expect(o.title).toBe(probe.title)
    expect(o.description).toBe(probe.description)
    expect(o.thinsEnemy).toBe(true) // the probe's whole point is spoiling the besiegers
    expect(Object.keys(o.targetForce).length).toBeGreaterThan(0)
    expect(o.capacity).toBeGreaterThan(0)
    // The resolve reward is hidden bookkeeping: it never becomes a buyable range.
    expect(o.rewardRange).toBeNull()
  })

  test('the grand assault pays a real reward instead of thinning, and shows its loot range', () => {
    const grandOpp = sortiesOf(grand.requires.minResolve).find((o) => o.title === grand.title)
    expect(grandOpp.thinsEnemy).toBe(false)
    expect(grandOpp.rewardRange.materials).toBeTruthy() // materials loot is a revealable range
  })

  // applyRaidReward runs only on a WON raid; the launch route books casualties
  // (for thins-enemy sorties) separately. Here: the reward path itself.
  const wonCampaign = () => ({
    garrison: { resolve: GARRISON_RESOLVE_START },
    resources: { food: 1000, materials: 100 },
    roster: new Map(),
    enemy: { army: new Map() },
  })

  test('winning the probe raises resolve — hidden, no number leaked to the log', () => {
    const c = wonCampaign()
    const opp = { type: 'garrison_sortie', reward: { resolve: probe.sortie.resolve } }
    const entries = applyRaidReward(c, opp)
    expect(c.garrison.resolve).toBe(GARRISON_RESOLVE_START + probe.sortie.resolve)
    expect(entries.join(' ')).not.toMatch(/resolve|\+\d/i) // the number never shows
    expect(entries.join(' ')).toMatch(/sortie|sally|garrison|karrowgate/i)
  })

  test('winning the grand assault raises resolve AND lands its loot', () => {
    const c = wonCampaign()
    const opp = { type: 'garrison_sortie', reward: { resolve: grand.sortie.resolve, materials: 250 } }
    applyRaidReward(c, opp)
    expect(c.garrison.resolve).toBe(GARRISON_RESOLVE_START + grand.sortie.resolve)
    expect(c.resources.materials).toBe(100 + 250)
  })

  test('resolve gained by a sortie clamps at the track ceiling', () => {
    const c = { ...wonCampaign(), garrison: { resolve: 95 } }
    applyRaidReward(c, { type: 'garrison_sortie', reward: { resolve: 20 } })
    expect(c.garrison.resolve).toBe(100)
  })
})

describe('eventEligible — resolve gate (minResolve/maxResolve)', () => {
  const ev = (requires) => ({ id: 'x', title: 'X', severity: 2, effect: { type: 'none' }, requires })

  test('minResolve gates on the garrison standing', () => {
    expect(eventEligible(ev({ minResolve: 60 }), { garrison: { resolve: 60 } })).toBe(true)
    expect(eventEligible(ev({ minResolve: 60 }), { garrison: { resolve: 59 } })).toBe(false)
  })

  test('maxResolve gates the other way', () => {
    expect(eventEligible(ev({ maxResolve: 20 }), { garrison: { resolve: 20 } })).toBe(true)
    expect(eventEligible(ev({ maxResolve: 20 }), { garrison: { resolve: 21 } })).toBe(false)
  })

  test('absent garrison context reads as the starting resolve', () => {
    expect(eventEligible(ev({ minResolve: GARRISON_RESOLVE_START }), {})).toBe(true)
    expect(eventEligible(ev({ minResolve: GARRISON_RESOLVE_START + 1 }), {})).toBe(false)
    expect(eventEligible(ev({ maxResolve: GARRISON_RESOLVE_START }), {})).toBe(true)
    expect(eventEligible(ev({ maxResolve: GARRISON_RESOLVE_START - 1 }), {})).toBe(false)
  })
})

describe('the garrison cooperation events', () => {
  const call = EVENT_POOL.find((e) => e.id === 'garrison_call')
  const lookout = EVENT_POOL.find((e) => e.id === 'garrison_lookout')
  const spurned = EVENT_POOL.find((e) => e.id === 'garrison_spurned')

  test('the garrison call is a choice; answering it spends stores to raise resolve', () => {
    expect(call.effect).toEqual({ type: 'choice' })
    expect(['good', 'bad', 'neutral']).toContain(call.valence)
    const answer = call.choices.find((c) => c.id === 'answer_the_call')
    const parts = answer.effect.type === 'multi' ? answer.effect.effects : [answer.effect]
    expect(parts.some((p) => p.type === 'garrison' && p.delta > 0)).toBe(true)
    // The other branch spends nothing and moves the track not at all.
    const decline = call.choices.find((c) => c.id === 'tend_your_own')
    expect(decline.effect).toEqual({ type: 'none' })
  })

  test('a high-resolve boon is gated on minResolve and lays the enemy bare', () => {
    expect(lookout.requires.minResolve).toBeGreaterThan(GARRISON_RESOLVE_START)
    expect(lookout.effect).toEqual({ type: 'enemy_reveal' })
    const low = eligiblePool({ garrison: { resolve: GARRISON_RESOLVE_START }, roster: new Map() })
    expect(low.some((e) => e.id === 'garrison_lookout')).toBe(false)
    const high = eligiblePool({ garrison: { resolve: 100 }, roster: new Map() })
    expect(high.some((e) => e.id === 'garrison_lookout')).toBe(true)
  })

  test('a soured-relationship fate is gated on maxResolve', () => {
    expect(spurned.requires.maxResolve).toBeLessThan(GARRISON_RESOLVE_START)
    expect(eventValenceFor(spurned)).toBe('bad')
    const bitter = eligiblePool({ garrison: { resolve: 10 }, roster: new Map() })
    expect(bitter.some((e) => e.id === 'garrison_spurned')).toBe(true)
    const warm = eligiblePool({ garrison: { resolve: GARRISON_RESOLVE_START }, roster: new Map() })
    expect(warm.some((e) => e.id === 'garrison_spurned')).toBe(false)
  })
})
