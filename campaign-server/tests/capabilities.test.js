import { describe, it, expect } from 'vitest'
import {
  forageValue,
  screenValue,
  reconLevel,
  reconBand,
  scoutingPointValue,
  scoutingPointsFor,
} from '../utils/capabilities.js'
import {
  RECON_LEVEL_THRESHOLDS,
  BASELINE_ACCURACY,
  ACCURACY_PER_BALLISTIC,
} from '../utils/campaignConfig.js'
import { engineStatsFixture } from './fixtures/engineStats.js'

// Stats as exported by the engine, shared through fixtures/engineStats.js so
// tests/engine.integration.test.js can assert these exact values against a
// real `./game dump-units` run — the fixture can't silently drift from the
// C++ constructors on any machine with the binary built.
const {
  Soldier: soldier,
  Cavalry: cavalry,
  LightCavalry: lightCavalry,
} = engineStatsFixture

describe('derived campaign capabilities', () => {
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

describe('scoutingPointValue (raid points one unit generates)', () => {
  it('a baseline human (accuracy 10, foot speed, no tag) is worth exactly 1.0', () => {
    // accuracy = ballisticSkill × ACCURACY_PER_BALLISTIC; the baseline bs makes
    // accuracy == BASELINE_ACCURACY, so the whole product is 1.0 — no literal 10s.
    const baselineBs = BASELINE_ACCURACY / ACCURACY_PER_BALLISTIC
    expect(scoutingPointValue({ ballisticSkill: baselineBs, speed: 10, reconTag: 0 })).toBeCloseTo(1)
  })

  it('the signed reconTag shifts a unit up or down from its accuracy×mobility worth', () => {
    const base = { ballisticSkill: 2, speed: 10, reconTag: 0 } // worth 1.0
    expect(scoutingPointValue({ ...base, reconTag: 4 })).toBeCloseTo(5)
    expect(scoutingPointValue({ ...base, reconTag: -2 })).toBeCloseTo(-1)
  })

  it('faster, sharper eyes are worth more, and the value stays fractional (no rounding)', () => {
    expect(scoutingPointValue(lightCavalry)).toBeGreaterThan(scoutingPointValue(soldier))
    expect(Number.isInteger(scoutingPointValue({ ballisticSkill: 3, speed: 15, reconTag: 0 }))).toBe(
      false,
    )
  })
})

describe('scoutingPointsFor (the turn pool)', () => {
  const catalog = new Map([
    ['Soldier', { size: 10, stats: soldier }],
    ['LightCavalry', { size: 20, stats: lightCavalry }],
  ])

  it('is a RAW sum Σ(count·scoutingPointValue) — scales with army size, Map or object', () => {
    const one = scoutingPointValue(soldier)
    expect(scoutingPointsFor({ Soldier: 10 }, catalog)).toBeCloseTo(10 * one)
    expect(scoutingPointsFor(new Map([['Soldier', 10]]), catalog)).toBeCloseTo(10 * one)
    // Unlike scoutingCoverage (÷size), a bigger force strictly generates MORE.
    expect(scoutingPointsFor({ Soldier: 20 }, catalog)).toBeGreaterThan(
      scoutingPointsFor({ Soldier: 10 }, catalog),
    )
  })

  it('a scout-heavy force out-generates a plain one of equal count', () => {
    expect(scoutingPointsFor({ LightCavalry: 50 }, catalog)).toBeGreaterThan(
      scoutingPointsFor({ Soldier: 50 }, catalog),
    )
  })

  it('unknown types and an empty army degrade to 0 (never NaN/throw)', () => {
    expect(scoutingPointsFor({ Dragon: 5 }, catalog)).toBe(0)
    expect(scoutingPointsFor({}, catalog)).toBe(0)
  })
})

describe('reconLevel / reconBand (accumulated scouting points → scouting level)', () => {
  const [t1, t2, t3, t4] = RECON_LEVEL_THRESHOLDS

  it('counts thresholds crossed: 0 points is Blind, climbing one band per threshold', () => {
    expect(reconLevel(0)).toBe(0)
    expect(reconBand(0)).toBe('Blind')
    expect(reconBand(t1 - 1)).toBe('Blind')
    expect(reconBand(t1)).toBe('Outmatched')
    expect(reconBand(t2)).toBe('Contested')
    expect(reconBand(t3)).toBe('Superior')
    expect(reconBand(t4)).toBe('Overwhelming')
  })

  it('is monotonic and caps at Overwhelming — extra points past the top band do not overflow', () => {
    expect(reconLevel(t4)).toBe(4)
    expect(reconLevel(t4 * 100)).toBe(4)
    expect(reconBand(t4 * 100)).toBe('Overwhelming')
  })

  it('degrades safely on missing/negative points (treated as Blind)', () => {
    expect(reconBand(undefined)).toBe('Blind')
    expect(reconLevel(-50)).toBe(0)
  })
})
