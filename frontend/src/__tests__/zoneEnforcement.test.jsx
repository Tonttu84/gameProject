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
import usePlacementStore from '../stores/usePlacementStore'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

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
// HexGrid reads placements/roster/etc from the campaign and placement
// stores now, not props — see docs/CAMPAIGN_PLAN.md's 2026-07-16 frontend
// state-management thread.
const renderGrid = (props = {}) => {
  const info = props.info ?? makeInfo()
  const map  = props.map  ?? makeMap()
  useCampaignStore.setState({
    campaign: {
      id: 'c1',
      roster: props.roster ?? defaultRoster,
      squads: [],
      forage: { assignment: {} },
      fortification: { sides: [] },
      enemy: { placements: [] },
    },
  })
  usePlacementStore.setState({ placements: props.placements ?? [], squadPlacements: {} })
  useUiStore.setState({ phase: props.disabled ? 'battling' : 'placement' })
  return render(<HexGrid info={info} map={map} />)
}

// ---------------------------------------------------------------------------
// 1. HexGrid rendering — data-zone attributes
// ---------------------------------------------------------------------------

describe('HexGrid: data-zone attributes', () => {
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
// 2b. Impassable hexes — the map-data guard alongside the zone guard
// ---------------------------------------------------------------------------

describe('HexGrid: impassable hexes', () => {
  // Map JSON is keyed by AXIAL coords: offset (1,4) → q = 1 - floor(4/2) = -1,
  // r = 4 — a hex inside the player zone (rows 4-5).
  const impassableMap = makeMap([{ q: -1, r: 4, terrain: 'Open', impassable: true }])

  it('clicking an impassable player-zone hex does NOT open ReachMenu; a passable neighbour does', () => {
    renderGrid({ map: impassableMap })
    fireEvent.click(screen.getByTestId('hex-1-4'))
    expect(screen.queryByRole('button', { name: /place/i })).not.toBeInTheDocument()
    // Same row, next column — no map entry, so passable — opens the menu.
    fireEvent.click(screen.getByTestId('hex-2-4'))
    expect(screen.getByRole('button', { name: /place/i })).toBeInTheDocument()
  })

  it('an impassable hex is filled #1a1a1a while a passable neighbour keeps its terrain color', () => {
    renderGrid({ map: impassableMap })
    expect(screen.getByTestId('hex-1-4').querySelector('polygon'))
      .toHaveAttribute('fill', '#1a1a1a')
    // Passable player-zone hex draws the terrain catalog color unblended.
    expect(screen.getByTestId('hex-2-4').querySelector('polygon'))
      .toHaveAttribute('fill', '#5a6441')
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
  it('renders a count input for each unit type', () => {
    renderReachMenu()
    expect(screen.getByTestId('count-Soldier')).toBeInTheDocument()
    expect(screen.getByTestId('count-Cavalry')).toBeInTheDocument()
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
    expect(screen.getByTestId('count-Soldier')).not.toBeDisabled()
    expect(screen.getByTestId('count-Cavalry')).toBeDisabled()
  })

  it('terrain-allowed unit input is enabled', () => {
    renderReachMenu({ hexTerrain: 'Open' })
    expect(screen.getByTestId('count-Soldier')).not.toBeDisabled()
    expect(screen.getByTestId('count-Cavalry')).not.toBeDisabled()
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
