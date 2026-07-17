import { describe, it, expect } from 'vitest'
import { reconValue, forageValue, screenValue, scoutingCoverage, scoutingBand } from '../utils/capabilities.js'
import { SCOUTING_BAND_THRESHOLDS } from '../utils/campaignConfig.js'
import { engineStatsFixture } from './fixtures/engineStats.js'

// Stats as exported by the engine, shared through fixtures/engineStats.js so
// tests/engine.integration.test.js can assert these exact values against a
// real `./game dump-units` run — the fixture can't silently drift from the
// C++ constructors on any machine with the binary built.
const {
  Soldier: soldier,
  Archer: archer,
  Cavalry: cavalry,
  LightCavalry: lightCavalry,
  Horse: horse,
  Warhorse: warhorse,
} = engineStatsFixture

describe('derived campaign capabilities', () => {
  it('recon is super-linear in speed: light cavalry dominates, foot barely registers', () => {
    // (speed/10)² + ⌊ballisticSkill/2⌋ + reconTag — engine speed is movement
    // points/tick, normalized so foot = 1.0 and a horse = 2.8.
    expect(reconValue(lightCavalry)).toBeCloseTo(15.84)
    expect(reconValue(soldier)).toBe(3)
    expect(reconValue(lightCavalry)).toBeGreaterThan(reconValue(cavalry))
    expect(reconValue(lightCavalry)).toBeGreaterThan(reconValue(archer))
    expect(reconValue(archer)).toBeGreaterThan(reconValue(soldier))
  })

  it('the signed reconTag lets a designer demote a fast-but-blind battle mount', () => {
    // Same speed, same ballistic sense — only the tag separates them.
    expect(reconValue(warhorse)).toBeLessThan(reconValue(horse))
    // A quick ranged-blind animal still cannot out-scout a trained rider pair.
    expect(reconValue(horse)).toBeLessThanOrEqual(reconValue(cavalry))
  })

  it('foraging scales with speed, minimum 1', () => {
    // Light and heavy cavalry ride the same Horse (speed 28) until barding
    // lands, so they forage identically — both far ahead of foot.
    expect(forageValue(lightCavalry)).toBe(forageValue(cavalry))
    expect(forageValue(cavalry)).toBeGreaterThan(forageValue(soldier))
    expect(forageValue({ ...soldier, speed: 0 })).toBe(1)
  })

  it('heavy cavalry screens foragers better than light', () => {
    expect(screenValue(cavalry)).toBeGreaterThan(screenValue(lightCavalry))
    expect(screenValue(cavalry)).toBeGreaterThan(screenValue(soldier))
  })
})

describe('scoutingCoverage', () => {
  const catalog = new Map([
    ['Soldier', { size: 10, stats: soldier }],
    ['LightCavalry', { size: 20, stats: lightCavalry }],
  ])

  it('is Σ(count·reconValue) / Σ(count·size), Map or plain object', () => {
    // 12 LightCavalry: (12·15.84) / (12·20) = 0.792
    expect(scoutingCoverage({ LightCavalry: 12 }, catalog)).toBeCloseTo(0.792)
    expect(scoutingCoverage(new Map([['LightCavalry', 12]]), catalog)).toBeCloseTo(0.792)
  })

  it('a blob dilutes its own coverage: adding infantry LOWERS the ratio', () => {
    const scouts = scoutingCoverage({ LightCavalry: 12 }, catalog)
    const mixed = scoutingCoverage({ LightCavalry: 12, Soldier: 300 }, catalog)
    const blob = scoutingCoverage({ LightCavalry: 12, Soldier: 600 }, catalog)
    expect(mixed).toBeLessThan(scouts)
    expect(blob).toBeLessThan(mixed)
  })

  it('empty army or unknown types degrade safely', () => {
    expect(scoutingCoverage({}, catalog)).toBe(0)
    // Unknown type: no recon, still screening burden (size-10 guard, like
    // armyFoodPerTurn) — never NaN/throw.
    expect(scoutingCoverage({ Dragon: 5 }, catalog)).toBe(0)
  })
})

describe('scoutingBand', () => {
  const t = SCOUTING_BAND_THRESHOLDS

  it('maps the player/enemy coverage ratio onto the five bands', () => {
    expect(scoutingBand(t.Overwhelming, 1)).toBe('Overwhelming')
    expect(scoutingBand(t.Superior, 1)).toBe('Superior')
    expect(scoutingBand(1, 1)).toBe('Contested')
    expect(scoutingBand(t.Contested, 1)).toBe('Contested')
    expect(scoutingBand(t.Outmatched, 1)).toBe('Outmatched')
    expect(scoutingBand(t.Outmatched - 0.01, 1)).toBe('Blind')
  })

  it('degenerate coverages: no enemy eyes → Overwhelming; no eyes at all → Contested; no own eyes → Blind', () => {
    expect(scoutingBand(0.5, 0)).toBe('Overwhelming')
    expect(scoutingBand(0, 0)).toBe('Contested')
    expect(scoutingBand(0, 0.5)).toBe('Blind')
  })
})
