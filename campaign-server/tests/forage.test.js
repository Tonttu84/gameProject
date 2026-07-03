import { describe, it, expect, afterEach } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  forageCapacityKg,
  allocateNearFirst,
  enemyForageParty,
  resolveForaging,
} from '../services/forage.js'
import { resolveClash } from '../services/skirmish.js'
import { catalogFixture } from './fixtures/catalog.js'

// Pure campaign math against the fixture catalog — no DB, no engine. All
// randomness is queued through utils/dice.js, mirroring the C++ pushDiceRoll
// pattern.

const catalog = new Map(catalogFixture.units.map((u) => [u.name, u]))

// Screen values with the fixture stats: Soldier 4, Archer 4, Cavalry 8,
// LightCavalry 6 — heavy cavalry dies last in a routed foraging party.

const makeCampaign = ({ assignment = {}, enemyPlan = 0, rings, army = { Soldier: 100 } }) => ({
  roster: new Map([['Soldier', 300], ['Cavalry', 10]]),
  resources: { food: 0, materials: 0 },
  forage: {
    rings: rings.map((richness, ring) => ({ ring, richness, initialRichness: richness })),
    assignment: new Map(Object.entries(assignment)),
    enemyPlan,
  },
  enemy: { army: new Map(Object.entries(army)), supplies: 0 },
})

afterEach(clearRolls)

describe('forage capacity and allocation', () => {
  it('capacity is forageValue points × kg per point', () => {
    // Soldier speed 1 → 2 points → 30 kg each; LightCavalry speed 3 → 6 → 90 kg.
    expect(forageCapacityKg({ Soldier: 100 }, catalog)).toBe(3000)
    expect(forageCapacityKg({ LightCavalry: 10 }, catalog)).toBe(900)
    expect(forageCapacityKg({}, catalog)).toBe(0)
  })

  it('fills the near ring first and spills outward', () => {
    expect(allocateNearFirst(25000, [20000, 35000, 55000])).toEqual([20000, 5000, 0])
    expect(allocateNearFirst(0, [20000, 35000, 55000])).toEqual([0, 0, 0])
    // More capacity than land: everything is taken, the excess is idle hands.
    expect(allocateNearFirst(999999, [100, 200, 300])).toEqual([100, 200, 300])
  })

  it('enemy party is a pro-rata slice, dropping fractional zeros', () => {
    expect(enemyForageParty(new Map([['Soldier', 10], ['Archer', 1]]))).toEqual({ Soldier: 4 })
  })
})

describe('resolveForaging', () => {
  it('uncontested harvest splits into food and materials; no dice consumed', () => {
    const c = makeCampaign({ assignment: { Soldier: 100 }, rings: [20000, 35000, 55000] })
    const { forage } = resolveForaging(c, catalog)

    expect(c.resources.food).toBe(2400) // 0.8 × 3000
    expect(c.resources.materials).toBe(600) // 0.2 × 3000
    expect(forage.rings[0].richness).toBe(17000)
    expect(forage.clashes).toEqual([])
  })

  it('a ring that cannot feed both sides scales them pro-rata and runs dry', () => {
    const c = makeCampaign({
      assignment: { Soldier: 100 }, // capacity 3000
      enemyPlan: 3000,
      rings: [1000],
    })
    pushRoll(1000) // contested ring: force NO clash

    const { forage } = resolveForaging(c, catalog)
    expect(forage.rings[0].richness).toBe(0)
    expect(c.resources.food).toBe(400) // 0.8 × 500
    expect(c.enemy.supplies).toBe(400)
  })

  it('a won clash costs the enemy casualties and half its ring yield', () => {
    const c = makeCampaign({
      assignment: { Soldier: 100 }, // capacity 3000, party strength 675 + dice
      enemyPlan: 3000,
      rings: [20000],
      army: { Soldier: 100 }, // party {Soldier: 40}, strength 270 + dice
    })
    pushRoll(1) // clash chance p = 0.05 + 0.3×(3000/6000) = 0.2 → clash
    pushRoll(1); pushRoll(1) // player strength die = 1 → 676
    pushRoll(1); pushRoll(1) // enemy strength die = 1 → 271, player wins
    pushRoll(6) // loser casualties 6% → ceil(40 × 0.06) = 3
    pushRoll(2) // winner casualties 2% → ceil(100 × 0.02) = 2

    const { forage } = resolveForaging(c, catalog)

    expect(forage.clashes).toEqual([
      { ring: 0, winner: 'player', playerLosses: { Soldier: 2 }, enemyLosses: { Soldier: 3 } },
    ])
    expect(c.roster.get('Soldier')).toBe(298)
    expect(c.enemy.army.get('Soldier')).toBe(97)
    // Loser forfeits half its 3000: supplies credit 0.8 × 1500. Winner keeps all.
    expect(c.enemy.supplies).toBe(1200)
    expect(c.resources.food).toBe(2400)
    // The land is stripped by everything gathered, forfeited or not.
    expect(forage.rings[0].richness).toBe(14000)
  })
})

describe('resolveClash casualty order', () => {
  it('low-screen troops die first; escorts (heavy cavalry) die last', () => {
    pushRoll(1); pushRoll(1) // player strength die
    pushRoll(1); pushRoll(1) // enemy strength die — enemy vastly stronger, wins
    pushRoll(6) // loser (player) 6% of 60 → 4 casualties
    pushRoll(1) // winner 1% of 1000 → 10

    const clash = resolveClash({ Cavalry: 10, Soldier: 50 }, { Soldier: 1000 }, 2, catalog)

    expect(clash.winner).toBe('enemy')
    // All four fall on the Soldiers (screen 4); the Cavalry screen (8) holds.
    expect(clash.playerLosses).toEqual({ Soldier: 4 })
    expect(clash.enemyLosses).toEqual({ Soldier: 10 })
  })
})
