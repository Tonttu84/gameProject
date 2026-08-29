import { describe, expect, test, beforeEach } from 'vitest'
import {
  accrueResearch,
  castableSpellsFor,
  castableSpellsForLevels,
  channelsForSquads,
  emptySchools,
  enemyMagic,
  enginePaths,
  freshResearch,
  isCasterType,
  magicBlock,
  nextLevelCost,
  pathEntries,
  planResearchFocus,
  playerMagic,
  researchRate,
  researchingMages,
  rollCasterPathsFor,
  rollPaths,
  schoolLevels,
  schoolOf,
  withCasterPaths,
} from '../services/magic.js'
import { applyEffect, describeEffect, eventValence, EVENT_POOL } from '../services/events.js'
import { priceEffect } from '../services/balanceSheet.js'
import { clearRolls, pushRoll } from '../utils/dice.js'
import { spellsFixture } from './fixtures/spells.js'
import {
  CHANNELS_BY_BANNER_TIER,
  ENEMY_CHANNELS,
  ENEMY_SCHOOLS,
  HIRE_PATH_POOL,
  RESEARCH_LEVEL_COST,
  RESEARCH_MAX_LEVEL,
  RESEARCH_POINTS_PER_MAGE,
  SPELL_PATHS,
  SPELL_SCHOOLS,
} from '../utils/campaignConfig.js'

// The magic campaign layer (docs/CAMPAIGN_PLAN.md "▶ SLICE 2 — THE CAMPAIGN
// LAYER"), pure half: the hire roll, the research track, the channel pool and
// the block each side is sent. Route wiring and end-of-turn accrual live in
// campaigns.test.js.
//
// The interview's numbers are BALANCE-DEFERRED, so this file pins the RULES
// against the constants rather than restating the constants — a retune moves
// the sheet and leaves the decisions standing.

beforeEach(() => clearRolls())

// rollPaths draws in a fixed order, so a queue pins a hire exactly:
//   [primary index, the d100 check, second index]
// A declared-path type skips the first of those.
const mageRoll = (primaryIdx, check, secondIdx) => {
  pushRoll(primaryIdx)
  pushRoll(check)
  if (secondIdx !== undefined) pushRoll(secondIdx)
}

describe('the hire roll (S2-3 / S2-4 / S2-14)', () => {
  test('a Mage takes a primary at 2 from the eight non-Holy paths', () => {
    mageRoll(0, 100) // fire, check fails
    expect(rollPaths('Mage')).toEqual({ fire: 2 })
  })

  test('the pool is the eight non-Holy paths — never Holy, never Unholy', () => {
    expect(HIRE_PATH_POOL).toHaveLength(8)
    expect(HIRE_PATH_POOL).not.toContain('holy')
    expect(HIRE_PATH_POOL).not.toContain('unholy')
    // Every path the engine knows, minus those two, and in the engine's order.
    expect(HIRE_PATH_POOL).toEqual(SPELL_PATHS.filter((p) => p !== 'holy' && p !== 'unholy'))
  })

  test('a passing 25% check on a NEW path enters it at 1', () => {
    mageRoll(0, 25, 2) // fire primary, check passes on the boundary, water second
    expect(rollPaths('Mage')).toEqual({ fire: 2, water: 1 })
  })

  test('a passing check on the SAME path is +1, not a second entry — the only way a hire reaches a level-3 gate', () => {
    mageRoll(0, 1, 0) // fire twice
    expect(rollPaths('Mage')).toEqual({ fire: 3 })
  })

  test('a failing check leaves the hire on one path', () => {
    mageRoll(3, 26) // one over the boundary
    expect(rollPaths('Mage')).toEqual({ air: 2 })
  })

  test('the check happens ONCE — no lottery tail', () => {
    // A queue of nothing but passing checks still yields at most two paths'
    // worth of levels: 2 + 1. A loop would drain the queue instead.
    mageRoll(0, 1, 1)
    const rolled = rollPaths('Mage')
    expect(Object.values(rolled).reduce((a, b) => a + b, 0)).toBe(3)
  })

  test('a Priest is flat Holy 2 and rolls nothing at all (S2-4)', () => {
    // Nothing queued: a Priest that rolled would fall through to Math.random
    // and could not be pinned. That it needs no queue IS the assertion.
    expect(rollPaths('Priest')).toEqual({ holy: 2 })
    expect(rollPaths('Priest')).toEqual({ holy: 2 })
  })

  test('a Necromancer is Death 2 and then takes the same one check (S2-14)', () => {
    pushRoll(100) // declared primary needs no index; the check fails
    expect(rollPaths('Necromancer')).toEqual({ death: 2 })
  })

  test('a Necromancer whose check lands on Death reaches the major raise', () => {
    pushRoll(1) // check passes
    pushRoll(HIRE_PATH_POOL.indexOf('death'))
    expect(rollPaths('Necromancer')).toEqual({ death: 3 })
  })

  test('every enemy Necromancer can raise — S2-9 is never contradicted by the roll', () => {
    for (let i = 0; i < 200; i++) expect(rollPaths('Necromancer').death).toBeGreaterThanOrEqual(2)
  })
})

describe('what the engine is told about a caster', () => {
  test('isCasterType covers both hire lanes and the enemy raiser, and nothing else', () => {
    expect(isCasterType('Mage')).toBe(true)
    expect(isCasterType('Priest')).toBe(true)
    expect(isCasterType('Necromancer')).toBe(true)
    expect(isCasterType('Soldier')).toBe(false)
    // A character since C3, but character-hood stopped implying casterhood the
    // day the mindless Golem joined the rolls (C-4).
    expect(isCasterType('Golem')).toBe(false)
  })

  test('enginePaths sends every path the engine knows, zeros included', () => {
    const wire = enginePaths({ fire: 2, water: 1 })
    expect(Object.keys(wire).sort()).toEqual([...SPELL_PATHS].sort())
    expect(wire.fire).toBe(2)
    expect(wire.water).toBe(1)
  })

  test('the zeros are what stop a constructor seed outliving the roll', () => {
    // AUnit::setPathLevel only writes what it is handed, and Mage() seeds
    // Fire 1. A hire who rolled Air must reach the field with fire: 0 or he
    // quietly carries Fire anyway — and the roll is what the Mage lane sells.
    expect(enginePaths({ air: 2 }).fire).toBe(0)
    expect(enginePaths({ air: 2 }).holy).toBe(0)
  })

  test('a Mongoose Map reads the same as a plain object', () => {
    expect(enginePaths(new Map([['fire', 2]]))).toEqual(enginePaths({ fire: 2 }))
  })

  test('withCasterPaths stamps casters and leaves the rank and file alone', () => {
    const placement = [
      { unit_type: 'Soldier', q: 0, r: 0 },
      { unit_type: 'Necromancer', q: 1, r: 0 },
    ]
    const stamped = withCasterPaths(placement, [{ death: 3 }])
    expect(stamped[0].paths).toBeUndefined()
    expect(stamped[1].paths.death).toBe(3)
  })

  test('a sealed roll is DEALT in order, so the card fields the enemy it advertised', () => {
    const placement = [
      { unit_type: 'Necromancer' }, { unit_type: 'Soldier' }, { unit_type: 'Necromancer' },
    ]
    const stamped = withCasterPaths(placement, [{ death: 2 }, { death: 3 }])
    expect(stamped[0].paths.death).toBe(2)
    expect(stamped[2].paths.death).toBe(3)
  })

  test('rollCasterPathsFor rolls one bag per caster BODY, not per type', () => {
    const rolls = rollCasterPathsFor({ Soldier: 40, Necromancer: 3 })
    expect(rolls).toHaveLength(3)
    for (const r of rolls) expect(r.death).toBeGreaterThanOrEqual(2)
  })

  test('a force with no casters seals nothing', () => {
    expect(rollCasterPathsFor({ Soldier: 40, Archer: 10 })).toEqual([])
  })
})

describe('the character sheet line (S2-13)', () => {
  test('paths come back phrased, in the engine\'s canonical order', () => {
    expect(pathEntries({ water: 1, fire: 2 })).toEqual([
      { path: 'fire', label: 'Fire', level: 2 },
      { path: 'water', label: 'Water', level: 1 },
    ])
  })

  test('a path at 0 is dropped, not sent as an empty row', () => {
    expect(pathEntries({ fire: 0, water: 2 })).toEqual([
      { path: 'water', label: 'Water', level: 2 },
    ])
  })

  test('a caster with nothing has an empty list rather than a null', () => {
    expect(pathEntries(undefined)).toEqual([])
  })
})

describe('research (S2-2 / S2-6 / S2-7)', () => {
  const campaignWith = (characters, research = freshResearch()) => ({ characters, research })
  const caster = (type) => ({ type, alive: true })

  test('a fresh campaign starts with all four schools at 0 (S2-2)', () => {
    const schools = emptySchools()
    expect(Object.keys(schools).sort()).toEqual([...SPELL_SCHOOLS].sort())
    for (const s of SPELL_SCHOOLS) expect(schools[s]).toEqual({ level: 0, points: 0 })
  })

  test('MAGES ALONE feed research — a Priest studies nothing (S2-6)', () => {
    const c = campaignWith([caster('Mage'), caster('Priest'), caster('Priest')])
    expect(researchingMages(c)).toBe(1)
    expect(researchRate(c)).toBe(RESEARCH_POINTS_PER_MAGE)
  })

  test('a DEAD mage studies nothing', () => {
    const c = campaignWith([caster('Mage'), { type: 'Mage', alive: false }])
    expect(researchRate(c)).toBe(RESEARCH_POINTS_PER_MAGE)
  })

  test('a lent ally studies like one of your own, and is permanent (S2-11)', () => {
    const c = campaignWith([caster('Mage')], { ...freshResearch(), allies: 2 })
    expect(researchRate(c)).toBe(3 * RESEARCH_POINTS_PER_MAGE)
  })

  test('level n costs 30 × n, bought in turn out of the same bank', () => {
    expect(nextLevelCost(0)).toBe(RESEARCH_LEVEL_COST)
    expect(nextLevelCost(1)).toBe(2 * RESEARCH_LEVEL_COST)
    expect(nextLevelCost(2)).toBe(3 * RESEARCH_LEVEL_COST)
  })

  test('three Mages open a school at the end of turn 1 and reach level 3 on turn 6', () => {
    const c = campaignWith([caster('Mage'), caster('Mage'), caster('Mage')])
    const levelAfter = []
    for (let turn = 1; turn <= 6; turn++) {
      accrueResearch(c)
      levelAfter.push(schoolOf(c, 'evocation').level)
    }
    expect(levelAfter).toEqual([1, 1, 2, 2, 2, 3])
  })

  test('a level-up says so, so the first unlock is an event the player feels', () => {
    const c = campaignWith([caster('Mage'), caster('Mage'), caster('Mage')])
    expect(accrueResearch(c).join(' ')).toMatch(/Evocation/)
    expect(accrueResearch(c)).toEqual([]) // a turn that banks but does not unlock
  })

  test('points land in the FOCUSED school only, and bank per school (S2-7)', () => {
    const c = campaignWith([caster('Mage')])
    c.research.focus = 'conjuration'
    accrueResearch(c)
    expect(schoolOf(c, 'conjuration').points).toBe(RESEARCH_POINTS_PER_MAGE)
    expect(schoolOf(c, 'evocation').points).toBe(0)
  })

  test('switching focus parks progress where it was earned and costs nothing', () => {
    const c = campaignWith([caster('Mage')])
    accrueResearch(c) // 10 into evocation
    c.research.focus = 'enchantment'
    accrueResearch(c) // 10 into enchantment
    c.research.focus = 'evocation'
    accrueResearch(c) // and back — the parked 10 is untouched
    expect(schoolOf(c, 'evocation').points).toBe(2 * RESEARCH_POINTS_PER_MAGE)
    expect(schoolOf(c, 'enchantment').points).toBe(RESEARCH_POINTS_PER_MAGE)
  })

  test('a campaign with no mages studies nothing rather than throwing', () => {
    expect(accrueResearch(campaignWith([caster('Priest')]))).toEqual([])
  })

  test('a skeleton campaign with no research block passes quietly', () => {
    expect(accrueResearch({ characters: [caster('Mage')] })).toEqual([])
  })

  test('a fat bank may carry a school more than one rung in a turn', () => {
    const c = campaignWith(Array.from({ length: 9 }, () => caster('Mage')))
    accrueResearch(c) // 90 points at once: level 1 (30) then level 2 (60)
    expect(schoolOf(c, 'evocation').level).toBe(2)
  })

  test('at the ceiling the bank stops growing rather than hoarding unspendable points', () => {
    const c = campaignWith([caster('Mage')])
    c.research.schools.evocation.level = RESEARCH_MAX_LEVEL
    accrueResearch(c)
    expect(schoolOf(c, 'evocation')).toEqual({ level: RESEARCH_MAX_LEVEL, points: 0 })
  })
})

describe('the focus is validated server-side (S2-12)', () => {
  test('one of the four schools is accepted', () => {
    expect(planResearchFocus('conjuration')).toEqual({ school: 'conjuration' })
  })

  test('anything else is refused rather than stored', () => {
    expect(planResearchFocus('necromancy').error).toBeTruthy()
    expect(planResearchFocus('').error).toBeTruthy()
    expect(planResearchFocus(null).error).toBeTruthy()
    expect(planResearchFocus({ toString: () => 'evocation' }).error).toBeTruthy()
  })
})

describe('channels come off the banner tier, and only the fielded squads count (S2-8)', () => {
  const plain = { prestige: 0 }
  const basic = { prestige: 1e9 }
  const withItem = { prestige: 1e9, banner: 'anything' }

  test('the three tiers are worth what the table says', () => {
    expect(channelsForSquads([plain])).toBe(CHANNELS_BY_BANNER_TIER.plain)
    expect(channelsForSquads([basic])).toBe(CHANNELS_BY_BANNER_TIER.basic)
    expect(channelsForSquads([withItem])).toBe(CHANNELS_BY_BANNER_TIER.item)
  })

  test('the pool is army-wide: the fielded squads add up', () => {
    expect(channelsForSquads([basic, basic, plain])).toBe(2 * CHANNELS_BY_BANNER_TIER.basic)
  })

  test('a banner sitting in camp channels nothing — a two-squad raid draws on less', () => {
    const army = [basic, basic, basic]
    expect(channelsForSquads(army.slice(0, 2))).toBeLessThan(channelsForSquads(army))
  })

  test('an army with no squads on the field channels nothing', () => {
    expect(channelsForSquads([])).toBe(0)
  })
})

describe('the block each side is sent (M-19 / S2-9)', () => {
  const campaign = { characters: [], research: freshResearch() }

  test('the player\'s schools are their research, so day 1 is all zeroes', () => {
    expect(schoolLevels(campaign)).toEqual(
      Object.fromEntries(SPELL_SCHOOLS.map((s) => [s, 0])),
    )
  })

  test('the player\'s block carries schools and the fielded channel pool', () => {
    const block = playerMagic(campaign, [{ prestige: 1e9 }])
    expect(block.schools.evocation).toBe(0)
    expect(block.channels).toBe(CHANNELS_BY_BANNER_TIER.basic)
  })

  test('the host\'s schools are the sealed number on the encounter', () => {
    expect(enemyMagic({ enemy: { magic: { schools: ENEMY_SCHOOLS, channels: 7 } } })).toEqual({
      schools: ENEMY_SCHOOLS,
      channels: 7,
    })
  })

  test('the host keeps raising: conjuration clears the minor raise gate', () => {
    expect(enemyMagic({}).schools.conjuration).toBeGreaterThanOrEqual(1)
  })

  test('a campaign with no sealed block falls back to the authored constants', () => {
    expect(enemyMagic({})).toEqual({ schools: ENEMY_SCHOOLS, channels: ENEMY_CHANNELS })
  })

  test('the player is BLUE and the host is RED — the one place that is written down', () => {
    const block = magicBlock(campaign, [])
    expect(block.blue.schools.evocation).toBe(0)
    expect(block.red.schools).toEqual(ENEMY_SCHOOLS)
  })
})

describe('a raid card seals its casters when it is DEALT (S2-10)', () => {
  test('the board carries one sealed roll per caster in the target force', async () => {
    const { generateRaidOpportunities } = await import('../services/raid.js')
    const { catalogFixture } = await import('./fixtures/catalog.js')
    const catalog = new Map(catalogFixture.units.map((u) => [u.name, u]))
    const campaign = {
      day: 1,
      augury: { slots: [] },
      enemy: { army: new Map([['Soldier', 400], ['Necromancer', 8]]) },
    }
    const board = generateRaidOpportunities(campaign, catalog)
    expect(board.length).toBeGreaterThan(0)
    for (const opp of board) {
      const casters = [...Object.entries(Object.fromEntries(
        opp.targetForce instanceof Map ? opp.targetForce : Object.entries(opp.targetForce),
      ))].filter(([type]) => isCasterType(type)).reduce((n, [, c]) => n + c, 0)
      expect(opp.casterPaths).toHaveLength(casters)
      for (const roll of opp.casterPaths) expect(roll.death).toBeGreaterThanOrEqual(2)
    }
  })

  test('a card whose force holds no caster seals an empty list, never a null', async () => {
    const { generateRaidOpportunities } = await import('../services/raid.js')
    const { catalogFixture } = await import('./fixtures/catalog.js')
    const catalog = new Map(catalogFixture.units.map((u) => [u.name, u]))
    const board = generateRaidOpportunities(
      { day: 1, augury: { slots: [] }, enemy: { army: new Map([['Soldier', 400]]) } },
      catalog,
    )
    for (const opp of board) expect(opp.casterPaths).toEqual([])
  })

  test('the seal is never exposed to the player — it is ground truth like the force', async () => {
    const { PUBLIC_OPPORTUNITY_KEYS } = await import('./helpers/publicShape.js')
    expect(PUBLIC_OPPORTUNITY_KEYS).not.toContain('casterPaths')
  })
})

describe('the `research` effect and the sources that grant it (S2-11)', () => {
  const campaign = () => ({ characters: [], research: freshResearch(), day: 1, log: [] })

  test('{points} lands in the focused school, like the turn\'s own study', () => {
    const c = campaign()
    c.research.focus = 'conjuration'
    applyEffect(c, { type: 'research', points: 45 })
    expect(schoolOf(c, 'conjuration').points).toBe(15) // 45 − the 30 that bought level 1
    expect(schoolOf(c, 'conjuration').level).toBe(1)
    expect(schoolOf(c, 'evocation').points).toBe(0)
  })

  test('{allies} is a PERMANENT standing contributor, and only goes up', () => {
    const c = campaign()
    applyEffect(c, { type: 'research', allies: 1 })
    applyEffect(c, { type: 'research', allies: 1 })
    expect(c.research.allies).toBe(2)
    expect(researchRate(c)).toBe(2 * RESEARCH_POINTS_PER_MAGE)
  })

  test('a lent mage carries no expiry — nothing on the campaign ages one out', () => {
    const c = campaign()
    applyEffect(c, { type: 'research', allies: 1, untilDay: 3 })
    expect(c.research.allies).toBe(1)
    expect(JSON.stringify(c.research)).not.toMatch(/untilDay/)
  })

  test('both halves say so in the log — research is the player\'s own state, not hidden', () => {
    expect(applyEffect(campaign(), { type: 'research', points: 20 }).length).toBeGreaterThan(0)
    expect(applyEffect(campaign(), { type: 'research', allies: 1 }).length).toBeGreaterThan(0)
  })

  test('a skeleton campaign with no research block survives the sweep', () => {
    expect(() => applyEffect({ day: 1 }, { type: 'research', points: 20 })).not.toThrow()
    expect(() => applyEffect({ day: 1 }, { type: 'research', allies: 1 })).not.toThrow()
  })

  test('research reads as a GAIN', () => {
    expect(eventValence({ type: 'research', points: 20 })).toBe('good')
    expect(eventValence({ type: 'research', allies: 1 })).toBe('good')
  })

  test('the card prices it — a fate the player cannot price is one they cannot weigh', () => {
    expect(describeEffect({ type: 'research', points: 40 }).join(' ')).toMatch(/40/)
    expect(describeEffect({ type: 'research', allies: 1 }).join(' ')).toBeTruthy()
  })

  test('the balance sheet prices it rather than reporting it UNPRICED', () => {
    for (const effect of [{ type: 'research', points: 40 }, { type: 'research', allies: 1 }]) {
      const notes = priceEffect(effect).notes.join(' ')
      expect(notes).not.toMatch(/UNPRICED/)
      expect(notes).toMatch(/research/)
    }
  })

  test('a resolve-gated garrison fate teaches what the wardens know (M-7)', () => {
    const taught = EVENT_POOL.filter(
      (e) => e.requires?.minResolve != null && JSON.stringify(e.effect).includes('"research"'),
    )
    expect(taught.length).toBeGreaterThan(0)
  })

  test('an ally fate lends a mage', () => {
    const lends = EVENT_POOL.filter((e) => JSON.stringify(e.effect).includes('"allies"'))
    expect(lends.length).toBeGreaterThan(0)
  })
})

// ── The level-driven fold (the battle lab's S2) ─────────────────────────────
//
// castableSpellsForLevels is castableSpellsFor with the campaign taken out of
// it: two {key: level} bags and the catalog, which is all the gate ever needed.
// The lab has no campaign at all (SB-1) and still has to answer "what can this
// man cast", so the rule had to be reachable without one.
//
// This case exists to make the EXTRACTION unable to drift. Everything else
// about the fold — which forms qualify, which label wins — is pinned in
// chosenSpells.test.js against the function the campaign calls; what is pinned
// here is only that the two are the same function underneath.
describe('castableSpellsForLevels (the battle lab S2)', () => {
  const campaignAt = (schools) => ({
    research: {
      schools: Object.fromEntries(
        Object.entries(schools).map(([s, level]) => [s, { level, points: 0 }]),
      ),
    },
  })

  test('answers exactly what the campaign-shaped call answers, given the same levels', () => {
    const paths = { fire: 3, holy: 1, death: 2 }
    const schools = { evocation: 1, conjuration: 1, enchantment: 2, construction: 0 }
    const campaign = campaignAt(schools)

    const viaCampaign = castableSpellsFor({ paths }, campaign, spellsFixture)
    const viaLevels = castableSpellsForLevels(paths, schoolLevels(campaign), spellsFixture)

    expect(viaLevels).toEqual(viaCampaign)
    // Not vacuous: these levels really do open something, and something else
    // stays shut — Evocation 1 is Ember, never the level-3 Fireball.
    expect(viaLevels.map((r) => r.spell).sort())
      .toEqual(['bless', 'fireball', 'leaden_air', 'raise_dead'])
    expect(viaLevels.find((r) => r.spell === 'fireball').label).toBe('Ember')
  })

  test('a caster with nothing is offered nothing, however open the side is', () => {
    const wideOpen = { evocation: 9, conjuration: 9, enchantment: 9, construction: 9 }
    expect(castableSpellsForLevels({}, wideOpen, spellsFixture)).toEqual([])
  })
})
