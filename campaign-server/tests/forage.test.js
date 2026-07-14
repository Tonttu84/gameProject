import { describe, it, expect, afterEach } from 'vitest'
import { pushRoll, clearRolls } from '../utils/dice.js'
import {
  forageCapacityKg,
  forageYieldMultiplier,
  allocateNearFirst,
  enemyForageParty,
  resolveForaging,
} from '../services/forage.js'
import { resolveClash } from '../services/skirmish.js'
import { SCOUTING_BANDS } from '../utils/capabilities.js'
import {
  FORAGE_YIELD_BY_BAND,
  FORAGE_CLASH_DAMPER_BY_BAND,
} from '../utils/campaignConfig.js'
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

// ── Stage 4 (1d): forage posture ─────────────────────────────────────────────
// The scouting band sets HOW you forage: dispersed efficient sweeps when your
// riders own the field (higher yield, fewer clashes), clumped defensive
// columns when theirs do (lower yield, more clashes). Two passive multipliers
// on the existing math — the player never micro-manages group size.
describe('forage posture (Stage 4 1d)', () => {
  it('both tables carry exactly the five bands; Contested is neutral; unknown degrades to ×1', () => {
    // Pins the tables to the band ladder so a renamed band can't silently
    // fall back to ×1, and Contested stays the no-op baseline.
    expect(Object.keys(FORAGE_YIELD_BY_BAND).sort()).toEqual([...SCOUTING_BANDS].sort())
    expect(Object.keys(FORAGE_CLASH_DAMPER_BY_BAND).sort()).toEqual([...SCOUTING_BANDS].sort())
    expect(FORAGE_YIELD_BY_BAND.Contested).toBe(1)
    expect(FORAGE_CLASH_DAMPER_BY_BAND.Contested).toBe(1)
    expect(forageYieldMultiplier(undefined)).toBe(1)
    expect(forageYieldMultiplier('NoSuchBand')).toBe(1)
  })

  it('yield multiplier scales capacity, harvest, and depletion: Blind ×0.7, Overwhelming ×1.25', () => {
    // Blind: 100 Soldiers raw 3000 kg → 2100 effective; the land is only
    // stripped of what the clumped columns actually reach.
    const blind = makeCampaign({ assignment: { Soldier: 100 }, rings: [20000, 35000, 55000] })
    const b = resolveForaging(blind, catalog, 'Blind')
    expect(b.forage.capacity).toBe(2100)
    expect(b.forage.posture).toBe('Blind')
    expect(blind.resources.food).toBe(1680) // 0.8 × 2100
    expect(blind.resources.materials).toBe(420)
    expect(b.forage.rings[0].richness).toBe(17900)

    // Overwhelming: dispersed sweeps cover more ground than the raw points.
    const over = makeCampaign({ assignment: { Soldier: 100 }, rings: [20000, 35000, 55000] })
    const o = resolveForaging(over, catalog, 'Overwhelming')
    expect(o.forage.capacity).toBe(3750) // floor(3000 × 1.25)
    expect(over.resources.food).toBe(3000)
  })

  it('the same clash roll springs at Contested but is screened off at Superior', () => {
    // Equal harvests → pressure 0.15. Contested: p = 0.2 (threshold 200);
    // Superior damps it ×0.75 → 0.15 (threshold 150). Roll 160 sits between.
    const contested = makeCampaign({
      assignment: { Soldier: 100 }, // capacity 3000
      enemyPlan: 3000,
      rings: [20000],
      army: { Soldier: 100 },
    })
    pushRoll(160) // clash
    pushRoll(1); pushRoll(1) // player strength die → 676
    pushRoll(1); pushRoll(1) // enemy strength die → 271, player wins
    pushRoll(6) // loser casualties
    pushRoll(2) // winner casualties
    const c = resolveForaging(contested, catalog, 'Contested')
    expect(c.forage.clashes).toHaveLength(1)

    const superior = makeCampaign({
      assignment: { Soldier: 100 }, // capacity floor(3000 × 1.1) = 3300
      enemyPlan: 3300,
      rings: [20000],
      army: { Soldier: 100 },
    })
    pushRoll(160) // same roll — the damped 0.15 no longer reaches it
    const s = resolveForaging(superior, catalog, 'Superior')
    expect(s.forage.clashes).toEqual([])
    expect(superior.resources.food).toBe(2640) // 0.8 × 3300 — and the yield bonus rode along
  })

  it('Blind heightens clash risk: a roll safe at Contested still springs', () => {
    // Capacity 2100, enemyPlan 2100 → pressure 0.15; Blind: p = 0.2 × 1.5 =
    // 0.3 (threshold 300). Roll 250 would be safe at Contested (200).
    const blind = makeCampaign({
      assignment: { Soldier: 100 },
      enemyPlan: 2100,
      rings: [20000],
      army: { Soldier: 100 },
    })
    pushRoll(250) // clash only because Blind raised the odds
    pushRoll(1); pushRoll(1) // player strength die → 676
    pushRoll(1); pushRoll(1) // enemy strength die → 271, player wins
    pushRoll(6) // loser casualties
    pushRoll(2) // winner casualties
    const { forage } = resolveForaging(blind, catalog, 'Blind')
    expect(forage.clashes).toHaveLength(1)
    expect(forage.clashes[0].winner).toBe('player')
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
