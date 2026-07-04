/**
 * Deployment-orders tests spanning the grid and the campaign screen.
 *
 *  - HexGrid draws a hold indicator on any placed hex whose stack carries a
 *    hold order (holdTurns > 0), so a player can see standing orders without
 *    reopening the ReachMenu.  No badge when the order is 0 (advance).
 *  - The Deployment tutorial intro explains hold orders.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import HexGrid from '../components/HexGrid'

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

const renderGrid = (props = {}) =>
  render(
    <HexGrid
      info={props.info ?? makeInfo()}
      map={props.map ?? { hexes: [] }}
      placements={props.placements ?? []}
      onPlacementsChange={props.onPlacementsChange ?? vi.fn()}
      roster={props.roster ?? { Soldier: 10, Mage: 5 }}
      disabled={props.disabled ?? false}
    />
  )

describe('HexGrid: hold indicators on placed hexes', () => {
  it('draws a hold badge showing the turn count when a placement holds', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 2 }],
    })
    const badge = screen.getByTestId('hold-badge-1-4-Soldier')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('2')
  })

  it('draws no hold badge for a placement that advances immediately (holdTurns 0)', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 }],
    })
    expect(screen.queryByTestId('hold-badge-1-4-Soldier')).not.toBeInTheDocument()
  })

  it('badges each holding stack on a hex independently', () => {
    renderGrid({
      placements: [
        { type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 2 },
        { type: 'Mage',    col: 1, row: 4, count: 1, holdTurns: 0 },
      ],
    })
    expect(screen.getByTestId('hold-badge-1-4-Soldier')).toBeInTheDocument()
    expect(screen.queryByTestId('hold-badge-1-4-Mage')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Deployment tutorial mentions hold orders
// ---------------------------------------------------------------------------

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getTicks: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  consultCampaignAugury: vi.fn(),
  rerollCampaignAugury: vi.fn(),
  setCampaignForage: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getCampaigns } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'

const appInfo = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [{ type: 'Soldier', symbol: 'S', placementSize: 1 }],
}

describe('Deployment tutorial: explains hold orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.localStorage.setItem(
      'loggedGameUser',
      JSON.stringify({ token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }),
    )
    getInfo.mockResolvedValue(appInfo)
    getMap.mockResolvedValue({ hexes: [] })
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
  })

  afterEach(() => window.localStorage.clear())

  it('the deployment intro has a line about hold orders', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    fireEvent.click(screen.getByRole('button', { name: /muster for battle/i }))
    await waitFor(() => expect(screen.getByTestId('tutorial-placement')).toBeInTheDocument())
    expect(screen.getByTestId('tutorial-placement')).toHaveTextContent(/hold/i)
  })
})
