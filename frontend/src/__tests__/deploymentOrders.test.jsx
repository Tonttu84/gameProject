/**
 * Deployment-orders tests on the placement grid.
 *
 *  - HexGrid draws a hold indicator on any placed hex that carries a hold
 *    order (holdTurns > 0), so a player can see standing orders without
 *    reopening the ReachMenu. Hold is per-square (one badge per hex, not
 *    per stack) — only a squad carries its own separate order. No badge
 *    when the order is 0 (advance).
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import HexGrid from '../components/HexGrid'
import usePlacementStore from '../stores/usePlacementStore'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

// ---------------------------------------------------------------------------
// HexGrid hold indicators
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

// HexGrid reads placements/roster/etc from the campaign and placement
// stores now, not props — see docs/CAMPAIGN_PLAN.md's 2026-07-16 frontend
// state-management thread.
const renderGrid = (props = {}) => {
  useCampaignStore.setState({
    campaign: {
      id: 'c1',
      roster: props.roster ?? { Soldier: 10, Mage: 5 },
      squads: [],
      forage: { assignment: {} },
      fortification: { sides: [] },
      enemy: { placements: [] },
    },
  })
  usePlacementStore.setState({ placements: props.placements ?? [], squadPlacements: {} })
  useUiStore.setState({ phase: props.disabled ? 'battling' : 'placement' })
  return render(
    <HexGrid info={props.info ?? makeInfo()} map={props.map ?? { hexes: [] }} />
  )
}

describe('HexGrid: hold indicators on placed hexes', () => {
  it('draws a hold badge showing the turn count when a placement holds', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 2 }],
    })
    const badge = screen.getByTestId('hold-badge-1-4')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')
  })

  it('draws no hold badge for a placement that advances immediately (holdTurns 0)', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 }],
    })
    expect(screen.queryByTestId('hold-badge-1-4')).not.toBeInTheDocument()
  })

  it('draws one hold badge for the whole square, not one per stack', () => {
    renderGrid({
      placements: [
        { type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 2 },
        { type: 'Mage',    col: 1, row: 4, count: 1, holdTurns: 2 },
      ],
    })
    expect(screen.getAllByTestId('hold-badge-1-4')).toHaveLength(1)
  })
})
