import { describe, it, expect } from 'vitest'
import { generateRaidOpportunities, applyRaidReward } from '../services/raid.js'
import { applyEffect, eventValence } from '../services/events.js'
import { ageForageModifiers } from '../services/forage.js'

// Standing forage pressures, end to end but WITHOUT the DB (S3,
// docs/CAMPAIGN_PLAN.md "Effort slider"): the effect that grants a modifier,
// the persistent raid card that carries over until it's beaten, and the lift
// that beating it applies. Every function here takes plain objects, so this
// runs anywhere — the DB-backed integration path lives in campaigns.test.js.

const catalog = new Map([['Soldier', { size: 10 }], ['Archer', { size: 10 }]])

const makeCampaign = (over = {}) => ({
  day: 3,
  augury: { slots: [] },
  enemy: { army: new Map([['Soldier', 40], ['Archer', 20]]) },
  roster: new Map([['Soldier', 50]]),
  resources: { food: 0, materials: 0, gold: 0, horses: 0 },
  garrison: { resolve: 0 },
  forage: { modifiers: [] },
  raid: { opportunities: [] },
  ...over,
})

const riders = {
  type: 'forage_modifier',
  id: 'foraging_riders',
  label: 'Harried by enemy horse',
  target: 'playerYield',
  factor: 0.6,
  raidable: true,
}

describe('the forage_modifier effect', () => {
  it('pushes a modifier carrying the effect\'s terms, permanent by default', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    expect(c.forage.modifiers).toHaveLength(1)
    expect(c.forage.modifiers[0]).toMatchObject({
      id: 'foraging_riders', target: 'playerYield', factor: 0.6, deltaKg: 0, raidable: true,
    })
    // null, not a number: the default pressure marks the rest of the campaign.
    expect(c.forage.modifiers[0].turnsLeft).toBeNull()
  })

  it('re-granting the same id REPLACES rather than stacking', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    applyEffect(c, { ...riders, factor: 0.9 })
    expect(c.forage.modifiers).toHaveLength(1)
    expect(c.forage.modifiers[0].factor).toBe(0.9)
  })

  it('names a playerYield pressure in the log but never an enemyDrain one', () => {
    const mine = applyEffect(makeCampaign(), riders)
    expect(mine.join(' ')).toContain('Harried by enemy horse')
    // Enemy-side fact is recon-gated in campaignView; a log line would walk
    // straight past that gate, so there is none.
    const theirs = applyEffect(makeCampaign(), {
      type: 'forage_modifier', id: 'depot', label: 'Enemy supply depot',
      target: 'enemyDrain', deltaKg: 4000,
    })
    expect(theirs).toEqual([])
  })

  it('reads as bad for the player on either target, with the enemy sign flipped', () => {
    expect(eventValence(riders)).toBe('bad') // less of the player's own yield
    expect(eventValence({ type: 'forage_modifier', target: 'playerYield', factor: 1.3 })).toBe('good')
    // MORE enemy drain empties the shared rings faster — a loss, not a gain.
    expect(eventValence({ type: 'forage_modifier', target: 'enemyDrain', deltaKg: 4000 })).toBe('bad')
    expect(eventValence({ type: 'forage_modifier', target: 'enemyDrain', deltaKg: -4000 })).toBe('good')
  })
})

describe('the persistent raid card a raidable modifier spawns', () => {
  const boardFor = (campaign) => generateRaidOpportunities(campaign, catalog)

  it('spawns one card per raidable modifier, flagged persistent and linked back', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    const card = boardFor(c).find((o) => o.source === 'forage_modifier')
    expect(card).toBeDefined()
    expect(card.persistent).toBe(true)
    expect(card.modifierId).toBe('foraging_riders')
    expect(card.title).toBe('The Riders\' Camp') // its own flavour, not the generic one
  })

  it('spawns NO card for a modifier that is not raidable', () => {
    const c = makeCampaign()
    applyEffect(c, { ...riders, raidable: false })
    expect(boardFor(c).some((o) => o.source === 'forage_modifier')).toBe(false)
  })

  it('carries the card across a redeal INTACT — same force, reward and reveals', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    c.raid.opportunities = boardFor(c)
    const before = c.raid.opportunities.find((o) => o.modifierId === 'foraging_riders')
    // Scouting bought on it must not be thrown away by the redeal.
    before.enemyReveal = 1
    before.rewardReveal = 1

    c.day += 1
    c.raid.opportunities = boardFor(c)
    const after = c.raid.opportunities.find((o) => o.modifierId === 'foraging_riders')
    expect(after).toBeDefined()
    expect(after.id).toBe(before.id) // the same card, not a fresh roll
    expect(after.targetForce).toEqual(before.targetForce)
    expect(after.reward).toEqual(before.reward)
    expect(after.enemyReveal).toBe(1)
    expect(after.rewardReveal).toBe(1)
    // And it is not duplicated by a second spawn.
    expect(c.raid.opportunities.filter((o) => o.modifierId === 'foraging_riders')).toHaveLength(1)
  })

  it('drops ordinary unresolved cards on the redeal, unlike the persistent one', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    c.raid.opportunities = boardFor(c)
    const ordinary = c.raid.opportunities.find((o) => o.source === 'base')
    c.day += 1
    const next = boardFor(c)
    expect(next.some((o) => o.id === ordinary.id)).toBe(false)
    expect(next.some((o) => o.modifierId === 'foraging_riders')).toBe(true)
  })

  it('drops a resolved persistent card, and does not respawn one for a lifted modifier', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    c.raid.opportunities = boardFor(c)
    const card = c.raid.opportunities.find((o) => o.modifierId === 'foraging_riders')
    card.resolved = true
    c.forage.modifiers = [] // the win lifted it

    c.day += 1
    expect(boardFor(c).some((o) => o.modifierId === 'foraging_riders')).toBe(false)
  })

  it('drops the card if its modifier times out without being fought', () => {
    const c = makeCampaign()
    applyEffect(c, { ...riders, turnsLeft: 1 })
    c.raid.opportunities = boardFor(c)
    expect(c.raid.opportunities.some((o) => o.modifierId === 'foraging_riders')).toBe(true)

    c.forage.modifiers = [] // newDay expired it
    c.day += 1
    expect(boardFor(c).some((o) => o.modifierId === 'foraging_riders')).toBe(false)
  })
})

describe('winning a linked card lifts its modifier', () => {
  it('removes the modifier and says so, whatever the card is typed as', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    const card = generateRaidOpportunities(c, catalog).find((o) => o.modifierId === 'foraging_riders')

    const entries = applyRaidReward(c, card, {})
    expect(c.forage.modifiers).toHaveLength(0)
    expect(entries.join(' ')).toContain('Harried by enemy horse')
  })

  it('lifts ONLY the linked modifier, leaving other pressures standing', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    applyEffect(c, {
      type: 'forage_modifier', id: 'enemy_supply_depot', label: 'Enemy supply depot',
      target: 'enemyDrain', deltaKg: 4000, raidable: true,
    })
    const card = generateRaidOpportunities(c, catalog).find((o) => o.modifierId === 'foraging_riders')

    applyRaidReward(c, card, {})
    expect(c.forage.modifiers.map((m) => m.id)).toEqual(['enemy_supply_depot'])
  })

  it('an ordinary card with no link touches no modifier', () => {
    const c = makeCampaign()
    applyEffect(c, riders)
    const ordinary = generateRaidOpportunities(c, catalog).find((o) => o.source === 'base')

    applyRaidReward(c, ordinary, {})
    expect(c.forage.modifiers).toHaveLength(1)
  })
})

describe('ageForageModifiers (the newDay countdown)', () => {
  const perm = { id: 'perm', label: 'P', target: 'playerYield', factor: 0.8, turnsLeft: null }

  it('never counts down a permanent pressure', () => {
    expect(ageForageModifiers([perm])).toEqual([perm])
    // Repeated turns leave it exactly as it was.
    expect(ageForageModifiers(ageForageModifiers(ageForageModifiers([perm])))).toEqual([perm])
  })

  it('counts a timed pressure down and drops it when it runs out', () => {
    const timed = { id: 't', label: 'T', target: 'playerYield', factor: 0.5, turnsLeft: 2 }
    const afterOne = ageForageModifiers([timed])
    expect(afterOne[0].turnsLeft).toBe(1)
    // Still in force on the turn it has 1 left — it expires AFTER that day.
    expect(afterOne[0].factor).toBe(0.5)
    expect(ageForageModifiers(afterOne)).toEqual([])
  })

  it('ages a mixed list independently', () => {
    const timed = { id: 't', label: 'T', target: 'enemyDrain', deltaKg: 1000, turnsLeft: 1 }
    expect(ageForageModifiers([perm, timed]).map((m) => m.id)).toEqual(['perm'])
  })

  it('is safe on an empty or absent list', () => {
    expect(ageForageModifiers([])).toEqual([])
    expect(ageForageModifiers(undefined)).toEqual([])
  })
})
