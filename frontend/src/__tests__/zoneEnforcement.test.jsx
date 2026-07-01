/**
 * Zone enforcement tests — Step 5 of the deployment UI.
 *
 * Component changes made for testability:
 *   HexGrid.jsx: each hex <g> element now carries:
 *     data-testid="hex-{col}-{row}"
 *     data-zone="player" | "enemy" | (absent when in neither zone)
 *   These attributes are set by the already-present inPlayerZone/inEnemyZone
 *   helpers; the only change is wiring the result to the DOM attribute.
 *
 * Zone validation logic lives entirely inside HexGrid (handleHexClick) and is
 * not exported as a standalone function — we test it through the rendered
 * component's behaviour (clicking an out-of-zone hex must not open ReachMenu).
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HexGrid from '../components/HexGrid'
import ReachMenu from '../components/ReachMenu'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal /api/info shape.
 * Grid is 4 wide × 6 tall.
 * Player zone: rows 4-5 (bottom two rows).
 * Enemy  zone: rows 0-1 (top two rows).
 */
const makeInfo = (overrides = {}) => ({
  grid: { width: 4, height: 6, hexCapacity: 10 },
  playerZone: { rowMin: 4, rowMax: 5 },
  enemyZone:  { rowMin: 0, rowMax: 1 },
  units: [
    { type: 'Soldier', symbol: 'S', placementSize: 1 },
  ],
  terrain: [
    { name: 'Open',  color: '#5a6441' },
    { name: 'Forest', color: '#2d4a1e' },
  ],
  ...overrides,
})

/** Minimal /api/map shape — no special terrain, no impassable hexes. */
const makeMap = (hexes = []) => ({ hexes })

const defaultRoster = { Soldier: 10 }

// Helper: render HexGrid with sane defaults; caller may override any prop.
const renderGrid = (props = {}) => {
  const onPlacementsChange = vi.fn()
  const info = props.info ?? makeInfo()
  const map  = props.map  ?? makeMap()
  return render(
    <HexGrid
      info={info}
      map={map}
      placements={props.placements ?? []}
      onPlacementsChange={props.onPlacementsChange ?? onPlacementsChange}
      roster={props.roster ?? defaultRoster}
      disabled={props.disabled ?? false}
    />
  )
}

// ---------------------------------------------------------------------------
// 1. HexGrid rendering — data-zone attributes
// ---------------------------------------------------------------------------

describe('HexGrid: data-zone attributes', () => {
  it('hexes inside player zone rows get data-zone="player"', () => {
    renderGrid()
    // col=0, row=4 is inside player zone (rowMin:4, rowMax:5)
    const hex = screen.getByTestId('hex-0-4')
    expect(hex).toHaveAttribute('data-zone', 'player')
  })

  it('hexes inside enemy zone rows get data-zone="enemy"', () => {
    renderGrid()
    // col=0, row=0 is inside enemy zone (rowMin:0, rowMax:1)
    const hex = screen.getByTestId('hex-0-0')
    expect(hex).toHaveAttribute('data-zone', 'enemy')
  })

  it('hexes outside any zone have no data-zone attribute', () => {
    renderGrid()
    // row=2 is the neutral mid-zone
    const hex = screen.getByTestId('hex-0-2')
    expect(hex).not.toHaveAttribute('data-zone')
  })

  it('all hexes inside player zone rows carry data-zone="player"', () => {
    renderGrid()
    // rows 4 and 5 across all 4 columns
    for (let col = 0; col < 4; col++) {
      for (const row of [4, 5]) {
        expect(screen.getByTestId(`hex-${col}-${row}`)).toHaveAttribute('data-zone', 'player')
      }
    }
  })

  it('all hexes inside enemy zone rows carry data-zone="enemy"', () => {
    renderGrid()
    for (let col = 0; col < 4; col++) {
      for (const row of [0, 1]) {
        expect(screen.getByTestId(`hex-${col}-${row}`)).toHaveAttribute('data-zone', 'enemy')
      }
    }
  })

  it('when map data has no zone fields, no hexes get data-zone attributes', () => {
    // info without playerZone / enemyZone — simulate a future "no-zones" map.
    // HexGrid destructures info.playerZone / info.enemyZone; if absent the
    // inPlayerZone / inEnemyZone helpers will throw — so we supply sentinel
    // objects with rowMin/rowMax values that can never match a real row.
    const infoNoZones = makeInfo({
      playerZone: { rowMin: -1, rowMax: -2 },  // impossible range
      enemyZone:  { rowMin: -1, rowMax: -2 },
    })
    renderGrid({ info: infoNoZones })
    // No hex should have a data-zone attribute
    const allHexes = screen.getAllByTestId(/^hex-/)
    allHexes.forEach(h => {
      expect(h).not.toHaveAttribute('data-zone')
    })
  })
})

// ---------------------------------------------------------------------------
// 2. HexGrid click guard — zone enforcement
// ---------------------------------------------------------------------------

describe('HexGrid: click guard opens ReachMenu only in player zone', () => {
  it('clicking a hex inside the player zone opens ReachMenu', () => {
    renderGrid()
    // col=1, row=4 — player zone
    fireEvent.click(screen.getByTestId('hex-1-4'))
    // ReachMenu renders a "Place" button when open
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
  })

  it('clicking a hex outside the player zone does NOT open ReachMenu', () => {
    renderGrid()
    // col=1, row=2 — neutral zone
    fireEvent.click(screen.getByTestId('hex-1-2'))
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
  })

  it('clicking a hex in the enemy zone does NOT open ReachMenu', () => {
    renderGrid()
    // col=0, row=1 — enemy zone
    fireEvent.click(screen.getByTestId('hex-0-1'))
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
  })

  it('clicking a player-zone hex while disabled does NOT open ReachMenu', () => {
    renderGrid({ disabled: true })
    fireEvent.click(screen.getByTestId('hex-0-4'))
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
  })

  it('clicking the same player-zone hex twice closes the ReachMenu (toggle)', () => {
    renderGrid()
    const hex = screen.getByTestId('hex-0-4')
    fireEvent.click(hex)
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
    fireEvent.click(hex)
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
  })

  it('after opening ReachMenu on a valid hex, clicking an enemy-zone hex does not move the menu', () => {
    renderGrid()
    // Open menu on player hex
    fireEvent.click(screen.getByTestId('hex-0-4'))
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
    // Click enemy hex — menu should still show (click is ignored)
    fireEvent.click(screen.getByTestId('hex-0-0'))
    // Menu stays open (the guard returned early, selectedHex is unchanged)
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// 3. ReachMenu — unit placement inputs
// ---------------------------------------------------------------------------

/**
 * ReachMenu is only shown by HexGrid after zone validation passes.
 * These tests mount ReachMenu directly to confirm its own rendering logic,
 * and that terrain-forbidden units are disabled regardless of zone.
 */

const defaultUnits = [
  { type: 'Soldier', symbol: 'S', placementSize: 1 },
  { type: 'Cavalry', symbol: 'C', placementSize: 2, forbiddenTerrain: ['Forest'] },
]

const renderReachMenu = (props = {}) => {
  const onPlace = vi.fn()
  const onClose = vi.fn()
  return {
    onPlace,
    onClose,
    ...render(
      <ReachMenu
        hex={props.hex ?? { col: 1, row: 4 }}
        placements={props.placements ?? []}
        roster={props.roster ?? { Soldier: 10, Cavalry: 5 }}
        units={props.units ?? defaultUnits}
        hexTerrain={props.hexTerrain ?? 'Open'}
        hexCapacity={props.hexCapacity ?? 10}
        onPlace={props.onPlace ?? onPlace}
        onClose={props.onClose ?? onClose}
      />
    ),
  }
}

describe('ReachMenu: unit placement inputs', () => {
  it('renders a number input for each unit type', () => {
    renderReachMenu()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs).toHaveLength(2) // Soldier + Cavalry
  })

  it('the Place button calls onPlace for each unit and then onClose', () => {
    const { onPlace, onClose } = renderReachMenu()
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    // onPlace is called once per unit type
    expect(onPlace).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('terrain-forbidden unit input is disabled', () => {
    // Cavalry is forbidden on Forest
    renderReachMenu({ hexTerrain: 'Forest' })
    // The Cavalry input should be disabled
    const inputs = screen.getAllByRole('spinbutton')
    // inputs are ordered by units array: [Soldier, Cavalry]
    expect(inputs[0]).not.toBeDisabled() // Soldier
    expect(inputs[1]).toBeDisabled()     // Cavalry on Forest
  })

  it('terrain-allowed unit input is enabled', () => {
    renderReachMenu({ hexTerrain: 'Open' })
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs[0]).not.toBeDisabled()
    expect(inputs[1]).not.toBeDisabled()
  })

  it('shows available roster count next to each unit', () => {
    renderReachMenu({ roster: { Soldier: 7, Cavalry: 3 } })
    expect(screen.getByText('/7')).toBeInTheDocument()
    expect(screen.getByText('/3')).toBeInTheDocument()
  })

  it('close button calls onClose without placing', () => {
    const { onPlace, onClose } = renderReachMenu()
    fireEvent.click(screen.getByRole('button', { name: /×/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPlace).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 4. Zone validation — pure-logic edge cases exercised through HexGrid
// ---------------------------------------------------------------------------

describe('Zone validation edge cases', () => {
  it('rowMin === rowMax: exactly one row is in the player zone', () => {
    const info = makeInfo({
      playerZone: { rowMin: 3, rowMax: 3 },
      enemyZone:  { rowMin: 0, rowMax: 0 },
    })
    renderGrid({ info })
    // row=3 is in zone
    expect(screen.getByTestId('hex-0-3')).toHaveAttribute('data-zone', 'player')
    // row=2 is not
    expect(screen.getByTestId('hex-0-2')).not.toHaveAttribute('data-zone')
    // row=4 is not
    expect(screen.getByTestId('hex-0-4')).not.toHaveAttribute('data-zone')
  })

  it('clicking the exact rowMin of player zone opens ReachMenu', () => {
    const info = makeInfo({
      playerZone: { rowMin: 3, rowMax: 5 },
      enemyZone:  { rowMin: 0, rowMax: 1 },
    })
    renderGrid({ info })
    fireEvent.click(screen.getByTestId('hex-0-3'))
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
  })

  it('clicking one row above rowMin (out of zone) does NOT open ReachMenu', () => {
    const info = makeInfo({
      playerZone: { rowMin: 3, rowMax: 5 },
      enemyZone:  { rowMin: 0, rowMax: 1 },
    })
    renderGrid({ info })
    fireEvent.click(screen.getByTestId('hex-0-2'))
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
  })

  it('clicking the exact rowMax of player zone opens ReachMenu', () => {
    const info = makeInfo({
      playerZone: { rowMin: 3, rowMax: 5 },
      enemyZone:  { rowMin: 0, rowMax: 1 },
    })
    renderGrid({ info })
    fireEvent.click(screen.getByTestId('hex-0-5'))
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
  })
})
