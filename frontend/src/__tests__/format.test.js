/**
 * Mass display formatter. Two playtest-driven rules (2026-07-03):
 *  - a real, non-zero amount must never render as "0 t" — below one tonne
 *    the unit switches to kg;
 *  - a MISSING value must look broken, not like an innocent zero (the old
 *    `kg ?? 0` coercion hid a missing-foodNeedPerTurn bug on stale docs).
 */

import { describe, it, expect } from 'vitest'
import { tons, estimate } from '../utils/format'

describe('tons()', () => {
  it('formats tonne-scale values with one decimal, trailing .0 dropped', () => {
    expect(tons(50000)).toBe('50 t')
    expect(tons(12432)).toBe('12.4 t')
    expect(tons(1500)).toBe('1.5 t')
    expect(tons(1000)).toBe('1 t')
  })

  it('shows sub-tonne amounts in kg so they never render as 0 t', () => {
    expect(tons(600)).toBe('600 kg')
    expect(tons(999)).toBe('999 kg')
    expect(tons(100)).toBe('100 kg')
    expect(tons(1)).toBe('1 kg')
    expect(tons(0)).toBe('0 kg')
  })

  it('rounds fractional kg and promotes values that round to a tonne', () => {
    expect(tons(600.4)).toBe('600 kg')
    expect(tons(999.6)).toBe('1 t')
  })

  it('renders missing or non-numeric values as an obviously-broken placeholder', () => {
    expect(tons(undefined)).toBe('?? t')
    expect(tons(null)).toBe('?? t')
    expect(tons(NaN)).toBe('?? t')
    expect(tons('5000')).toBe('?? t')
  })
})

describe('estimate()', () => {
  it('shows an en-dashed range for a partial recon bracket', () => {
    expect(estimate({ low: 600, high: 1100 })).toBe('600–1100')
  })

  it('collapses to a single figure when the bracket is exact (top recon level)', () => {
    expect(estimate({ low: 560, high: 560 })).toBe('560')
  })
})
