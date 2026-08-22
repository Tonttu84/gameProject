import { describe, expect, test } from 'vitest'
import { raidBandWeight, raidPrestige, squadRank, nextRank } from '../utils/capabilities.js'
import {
  RAID_STRENGTH_BANDS,
  SQUAD_RANKS,
  RAID_PRESTIGE_JOIN_PER_BAND,
  RAID_PRESTIGE_WIN_PER_BAND,
} from '../utils/campaignConfig.js'

// Squad prestige — the permanent RANK that gates squad upgrades and is never
// spent (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL", decision 5).
// These are the pure derivations; the award itself is wired into the raid
// route and covered in raid.test.js.

describe('raidBandWeight', () => {
  // RAID_STRENGTH_BANDS is ordered STRONGEST FIRST (min descending), so the
  // weight is the reverse index — the weakest band is worth 1. Deriving it
  // rather than hardcoding four numbers means adding a band can't silently
  // leave a weight behind.
  test('weights the bands 1 (weakest) .. N (strongest)', () => {
    expect(raidBandWeight('a handful')).toBe(1)
    expect(raidBandWeight('a small band')).toBe(2)
    expect(raidBandWeight('a full company')).toBe(3)
    expect(raidBandWeight('a strong detachment')).toBe(4)
  })

  test('every configured band has a distinct weight, so none is unreachable', () => {
    const weights = RAID_STRENGTH_BANDS.map((b) => raidBandWeight(b.label))
    expect(new Set(weights).size).toBe(RAID_STRENGTH_BANDS.length)
    expect(Math.min(...weights)).toBe(1)
    expect(Math.max(...weights)).toBe(RAID_STRENGTH_BANDS.length)
  })

  // A band label that isn't in the table earns nothing rather than throwing:
  // an unknown band must not be able to 500 a raid that otherwise resolved.
  test('an unknown band is worth zero, not an exception', () => {
    expect(raidBandWeight('a rumour')).toBe(0)
    expect(raidBandWeight(undefined)).toBe(0)
  })
})

describe('raidPrestige', () => {
  // Participating earns, winning earns MORE — and the win award REPLACES the
  // participation one rather than stacking on top of it.
  test('winning pays the win rate, joining pays the join rate', () => {
    expect(raidPrestige('a handful', true)).toBe(1 * RAID_PRESTIGE_WIN_PER_BAND)
    expect(raidPrestige('a handful', false)).toBe(1 * RAID_PRESTIGE_JOIN_PER_BAND)
    expect(raidPrestige('a strong detachment', true)).toBe(4 * RAID_PRESTIGE_WIN_PER_BAND)
    expect(raidPrestige('a strong detachment', false)).toBe(4 * RAID_PRESTIGE_JOIN_PER_BAND)
  })

  test('the settled numbers: 2..8 for a win, 1..4 for taking part', () => {
    expect(raidPrestige('a handful', true)).toBe(2)
    expect(raidPrestige('a strong detachment', true)).toBe(8)
    expect(raidPrestige('a handful', false)).toBe(1)
    expect(raidPrestige('a strong detachment', false)).toBe(4)
  })

  // The whole point of scaling by band: farming the easiest card on the board
  // must not rank a squad up as fast as beating something real.
  test('a win on the weakest band pays less than one on the strongest', () => {
    expect(raidPrestige('a handful', true)).toBeLessThan(
      raidPrestige('a strong detachment', true),
    )
  })

  // Losing still pays — a squad that fought and was beaten has still been
  // blooded — but never more than winning the same target.
  test('a loss always pays less than a win on the same target', () => {
    for (const { label } of RAID_STRENGTH_BANDS)
      expect(raidPrestige(label, false)).toBeLessThan(raidPrestige(label, true))
  })
})

describe('squadRank', () => {
  test('a fresh squad is the lowest rank', () => {
    expect(squadRank(0)).toBe(SQUAD_RANKS.at(-1).label)
    expect(squadRank(0)).toBe('Untested')
  })

  test('walks the settled ladder', () => {
    expect(squadRank(9)).toBe('Untested')
    expect(squadRank(10)).toBe('Blooded')
    expect(squadRank(24)).toBe('Blooded')
    expect(squadRank(25)).toBe('Seasoned')
    expect(squadRank(44)).toBe('Seasoned')
    expect(squadRank(45)).toBe('Renowned')
    expect(squadRank(69)).toBe('Renowned')
    expect(squadRank(70)).toBe('Legendary')
  })

  // Prestige is never spent and has no ceiling, so the top rank has to absorb
  // everything above its threshold rather than falling off the end.
  test('the top rank absorbs everything above it', () => {
    expect(squadRank(1000)).toBe('Legendary')
  })

  // Defensive: a squad document that predates the field reads as undefined,
  // and must render as the lowest rank rather than crashing the view.
  test('a missing prestige value reads as the lowest rank', () => {
    expect(squadRank(undefined)).toBe('Untested')
    expect(squadRank(null)).toBe('Untested')
  })
})

// 13-14: the screen states the rung and the number, and promises nothing about
// what the rung grants. The number is the server's — a client with its own copy
// of the thresholds goes stale the moment they are retuned.
describe('nextRank', () => {
  test('names the rung above and what it takes', () => {
    expect(nextRank(0)).toEqual({ label: 'Blooded', at: 10 })
    expect(nextRank(9)).toEqual({ label: 'Blooded', at: 10 })
    expect(nextRank(10)).toEqual({ label: 'Seasoned', at: 25 })
    expect(nextRank(44)).toEqual({ label: 'Renowned', at: 45 })
    expect(nextRank(45)).toEqual({ label: 'Legendary', at: 70 })
  })

  // The ladder ends; prestige does not. A squad at the top has no next rung,
  // and the screen must render that as an end rather than as an unreachable
  // target.
  test('the top of the ladder has nothing above it', () => {
    expect(nextRank(70)).toBeNull()
    expect(nextRank(1000)).toBeNull()
  })

  test('a missing prestige value reads as a fresh squad', () => {
    expect(nextRank(undefined)).toEqual({ label: 'Blooded', at: 10 })
  })

  // The pair must agree: you are your rank, and the next rung is the one you
  // have NOT reached — never the one you are standing on.
  test('the rung it names is always above the rank you hold', () => {
    for (let prestige = 0; prestige < 100; prestige++) {
      const next = nextRank(prestige)
      if (!next) continue
      expect(next.at).toBeGreaterThan(prestige)
      expect(squadRank(next.at)).toBe(next.label)
    }
  })
})
