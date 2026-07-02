/**
 * Placement budget tests — P1/P2/P5/P6
 *
 * P1: Roster shown in ReachMenu must subtract units placed on OTHER hexes.
 * P2: Placing more than the available roster logs a console.warn and caps the count.
 * P5: Hex capacity displayed in ReachMenu accounts for other unit types already on the same hex.
 * P6: ReachMenu has a "Clear" button that zeros all placements on the hex.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HexGrid from '../components/HexGrid'
import ReachMenu from '../components/ReachMenu'

// ---------------------------------------------------------------------------
// Fixtures (same schema as zoneEnforcement.test.jsx)
// ---------------------------------------------------------------------------

const makeInfo = (overrides = {}) => ({
  grid: { width: 4, height: 6, hexCapacity: 10 },
  playerZone: { rowMin: 4, rowMax: 5 },
  enemyZone:  { rowMin: 0, rowMax: 1 },
  units: [
    { type: 'Soldier', symbol: 'S', placementSize: 1 },
    { type: 'Mage',    symbol: 'M', placementSize: 2 },
  ],
  terrain: [{ name: 'Open', color: '#5a6441' }],
  ...overrides,
})

const makeMap = (hexes = []) => ({ hexes })

const renderGrid = (props = {}) => {
  const onPlacementsChange = vi.fn()
  return {
    onPlacementsChange,
    ...render(
      <HexGrid
        info={props.info ?? makeInfo()}
        map={props.map ?? makeMap()}
        placements={props.placements ?? []}
        onPlacementsChange={props.onPlacementsChange ?? onPlacementsChange}
        roster={props.roster ?? { Soldier: 10, Mage: 5 }}
        disabled={props.disabled ?? false}
      />
    ),
  }
}

const renderMenu = (props = {}) => {
  const onPlace = vi.fn()
  const onClose = vi.fn()
  return {
    onPlace,
    onClose,
    ...render(
      <ReachMenu
        hex={props.hex ?? { col: 1, row: 4 }}
        placements={props.placements ?? []}
        roster={props.roster ?? { Soldier: 10, Mage: 5 }}
        units={props.units ?? [
          { type: 'Soldier', symbol: 'S', placementSize: 1 },
          { type: 'Mage',    symbol: 'M', placementSize: 2 },
        ]}
        hexTerrain={props.hexTerrain ?? 'Open'}
        hexCapacity={props.hexCapacity ?? 10}
        onPlace={props.onPlace ?? onPlace}
        onClose={props.onClose ?? onClose}
      />
    ),
  }
}

// ---------------------------------------------------------------------------
// P1 — Roster decrements across hexes
// ---------------------------------------------------------------------------

describe('P1: roster shown in ReachMenu subtracts units placed on other hexes', () => {
  it('opening a hex shows reduced roster when another hex already has placements', () => {
    // 3 Soldiers placed on hex (0,4); opening (1,4) should show /7
    renderGrid({
      roster: { Soldier: 10, Mage: 5 },
      placements: [{ type: 'Soldier', col: 0, row: 4, count: 3 }],
    })
    fireEvent.click(screen.getByTestId('hex-1-4'))
    expect(screen.getByText('/7')).toBeInTheDocument()
  })

  it('opening the hex that already has placements does NOT double-subtract them', () => {
    // 3 Soldiers on hex (0,4); re-opening (0,4) should still show /10
    // because those 3 are already on this hex and re-assignable
    renderGrid({
      roster: { Soldier: 10, Mage: 5 },
      placements: [{ type: 'Soldier', col: 0, row: 4, count: 3 }],
    })
    fireEvent.click(screen.getByTestId('hex-0-4'))
    expect(screen.getByText('/10')).toBeInTheDocument()
  })

  it('placements on multiple other hexes all subtract from the available count', () => {
    // 2 Soldiers on (0,4), 3 Soldiers on (1,5) → opening (2,5) should show /5 for Soldier.
    // Mage roster is 7 (stays at /7) so there is no ambiguous duplicate.
    renderGrid({
      roster: { Soldier: 10, Mage: 7 },
      placements: [
        { type: 'Soldier', col: 0, row: 4, count: 2 },
        { type: 'Soldier', col: 1, row: 5, count: 3 },
      ],
    })
    fireEvent.click(screen.getByTestId('hex-2-5'))
    expect(screen.getByText('/5')).toBeInTheDocument()
  })

  it('placing all units on one hex leaves zero available for another', () => {
    // Mage roster is 2 so it shows /2; only Soldier shows /0 — no ambiguity.
    renderGrid({
      roster: { Soldier: 5, Mage: 2 },
      placements: [{ type: 'Soldier', col: 0, row: 4, count: 5 }],
    })
    fireEvent.click(screen.getByTestId('hex-1-4'))
    expect(screen.getByText('/0')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// P2 — console.warn on over-budget placement
// ---------------------------------------------------------------------------

describe('P2: console.warn fires when placement exceeds available roster', () => {
  let warnSpy

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('console.warn is called when handlePlace receives a count above remaining roster', () => {
    // Pre-place 8 Soldiers elsewhere; roster=10 → only 2 remain.
    // Then place 5 Soldiers on a new hex → over-budget.
    const onPlacementsChange = vi.fn()
    renderGrid({
      roster: { Soldier: 10, Mage: 5 },
      placements: [{ type: 'Soldier', col: 0, row: 4, count: 8 }],
      onPlacementsChange,
    })
    fireEvent.click(screen.getByTestId('hex-1-4'))
    // Set Soldier input to 5 (over the available 2)
    const [soldierInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(soldierInput, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(warnSpy).toHaveBeenCalled()
  })

  it('over-budget placement is capped to available units, not the requested amount', () => {
    // Only 2 Soldiers available; placing 5 should result in 2 committed
    const onPlacementsChange = vi.fn()
    renderGrid({
      roster: { Soldier: 10, Mage: 0 },
      placements: [{ type: 'Soldier', col: 0, row: 4, count: 8 }],
      onPlacementsChange,
    })
    fireEvent.click(screen.getByTestId('hex-1-4'))
    const [soldierInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(soldierInput, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    // onPlacementsChange must not commit more than 2 Soldiers
    const calls = onPlacementsChange.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    // The updater fn is called with the previous placements; extract final result
    const finalUpdater = calls[calls.length - 1][0]
    const prevPlacements = [{ type: 'Soldier', col: 0, row: 4, count: 8 }]
    const result = finalUpdater(prevPlacements)
    const newHexEntry = result.find(p => p.col === 1 && p.row === 4 && p.type === 'Soldier')
    expect(newHexEntry?.count ?? 0).toBeLessThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// P5 — Hex capacity accounts for existing placements on the same hex
// ---------------------------------------------------------------------------

describe('P5: hex capacity in ReachMenu accounts for other unit types on the same hex', () => {
  it('Soldier max is reduced by capacity already used by Mages', () => {
    // 2 Mages already on hex (size=2 each → 4 capacity used).
    // hexCapacity=10 → max Soldiers = floor((10-4)/1) = 6
    renderMenu({
      placements: [{ type: 'Mage', col: 1, row: 4, count: 2 }],
      hexCapacity: 10,
    })
    const inputs = screen.getAllByRole('spinbutton')
    // inputs[0] = Soldier, inputs[1] = Mage
    expect(inputs[0]).toHaveAttribute('max', '6')
  })

  it('Mage max is reduced by capacity already used by Soldiers', () => {
    // 4 Soldiers on hex (size=1 each → 4 used). Max Mages = floor((10-4)/2) = 3
    renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 4 }],
      hexCapacity: 10,
    })
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[1]).toHaveAttribute('max', '3')
  })

  it('capacity bar shows total size used', () => {
    // 3 Soldiers (size=1) → 3 used out of 10
    renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3 }],
      hexCapacity: 10,
    })
    expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// P6 — Clear hex button
// ---------------------------------------------------------------------------

describe('P6: Clear button zeros all placements on the hex and closes', () => {
  it('Clear button is rendered in ReachMenu', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
  })

  it('clicking Clear calls onPlace with count=0 for every unit type', () => {
    const { onPlace, onClose } = renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 5 }],
    })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 0)
  })

  it('clicking Clear calls onClose', () => {
    const { onClose } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Clear button works even when no units are currently placed', () => {
    const { onPlace, onClose } = renderMenu({ placements: [] })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    // Should still call onPlace with 0 for each type and close
    expect(onPlace).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Boundary: input clamping (ReachMenu.jsx handleChange/maxCount) — these
// guards exist in the component but had no regression coverage.
// ---------------------------------------------------------------------------

describe('Boundary: negative and over-capacity input clamping', () => {
  it('typing a negative count is clamped to 0, not committed as negative', () => {
    const { onPlace } = renderMenu({ roster: { Soldier: 10, Mage: 5 } })
    const [soldierInput] = screen.getAllByRole('spinbutton')
    fireEvent.change(soldierInput, { target: { value: '-5' } })
    expect(soldierInput).toHaveValue(0)
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0)
  })

  it('a hex already over capacity from stale placements shows max=0, not negative', () => {
    // 12 size-points already used by Mage on a hexCapacity=10 hex (stale/inconsistent
    // state) — maxCount's Math.max(0, cap) must prevent a negative `max` attribute.
    renderMenu({
      placements: [{ type: 'Mage', col: 1, row: 4, count: 6 }], // 6 * size 2 = 12 > 10
      hexCapacity: 10,
    })
    const [soldierInput] = screen.getAllByRole('spinbutton')
    expect(soldierInput).toHaveAttribute('max', '0')
  })

  it('empty roster: unit with no roster entry has max 0, not undefined/NaN', () => {
    renderMenu({ roster: {} })
    const inputs = screen.getAllByRole('spinbutton')
    inputs.forEach(input => expect(input).toHaveAttribute('max', '0'))
  })
})
