/**
 * Camp works (Stage 3 materials sink): the CampPanel on the war council raises
 * the abstract fortification level, gated on the cost/cap the campaign view
 * reports; the HUD shows the level; and the placement grid draws the walled
 * sides the view exposes so the player deploys behind them. Buying troops is
 * NOT here — that's the Recruit phase (recruitPanel.test.jsx).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getTicks: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  launchSampleBattle: vi.fn(),
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  consultCampaignAugury: vi.fn(),
  rerollCampaignAugury: vi.fn(),
  setCampaignForage: vi.fn(),
  spendCampaign: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, spendCampaign } from '../services/api'
import App from '../App'
import HexGrid from '../components/HexGrid'
import useCampaignStore from '../stores/useCampaignStore'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// A campaign with materials + workers to spend and a next-level cost, so the
// fortify button is enabled by default. Second arg overrides the workforce.
const withMaterials = (over = {}, workers = { total: 2000, used: 0, available: 2000 }) => ({
  ...campaignFixture,
  resources: { ...campaignFixture.resources, materials: 200 },
  workers,
  fortification: { level: 0, atCap: false, nextCost: 50, nextWorkerCost: 500, sides: [], ...over },
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem(
    'loggedGameUser',
    JSON.stringify({ token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }),
  )
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('camp panel — fortifications', () => {
  it('shows the next-level cost and posts the fortify action', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    spendCampaign.mockResolvedValue(
      withMaterials({ level: 1, nextCost: 100, nextWorkerCost: 1000 }),
    )
    render(<App />)
    await screen.findByText(/War Council/)

    const btn = screen.getByTestId('fortify-button')
    expect(btn).toHaveTextContent('Raise to level 1 (50 materials, 500 workers)')
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)
    await waitFor(() =>
      expect(spendCampaign).toHaveBeenCalledWith('c1', { action: 'fortify' }),
    )
    // The refreshed view moves the level and cost forward.
    expect(await screen.findByTestId('fort-level')).toHaveTextContent('Level 1')
    expect(screen.getByTestId('fortify-button')).toHaveTextContent('level 2 (100 materials, 1000 workers)')
  })

  it('disables fortify when materials fall short', async () => {
    getCampaigns.mockResolvedValue([
      { ...campaignFixture, resources: { ...campaignFixture.resources, materials: 10 } },
    ]) // fixture nextCost 50 > 10
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('fortify-button')).toBeDisabled()
  })

  it('shows "maxed" and disables at the cap', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({ level: 2, atCap: true, nextCost: null }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    const btn = screen.getByTestId('fortify-button')
    expect(btn).toHaveTextContent('maxed')
    expect(btn).toBeDisabled()
  })

  // The fort option is always on the council so the player can see it and save
  // toward it: green + clickable when affordable, red + disabled when not.
  it('marks the fortify button affordable (green) when materials suffice', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    render(<App />)
    await screen.findByText(/War Council/)
    const btn = screen.getByTestId('fortify-button')
    expect(btn).toHaveClass('affordable')
    expect(btn).not.toHaveClass('unaffordable')
    expect(btn).not.toBeDisabled()
  })

  it('keeps the fortify button visible but red + disabled when materials fall short', async () => {
    getCampaigns.mockResolvedValue([
      { ...campaignFixture, resources: { ...campaignFixture.resources, materials: 10 } },
    ]) // fixture nextCost 50 > 10
    render(<App />)
    await screen.findByText(/War Council/)
    const btn = screen.getByTestId('fortify-button')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveClass('unaffordable')
    expect(btn).not.toHaveClass('affordable')
    expect(btn).toBeDisabled()
    // still shows the cost so the player knows the target to save toward
    expect(btn).toHaveTextContent('50 materials')
  })

  it('marks a maxed fort neither affordable nor unaffordable', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({ level: 2, atCap: true, nextCost: null }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    const btn = screen.getByTestId('fortify-button')
    expect(btn).not.toHaveClass('affordable')
    expect(btn).not.toHaveClass('unaffordable')
  })

  it('the HUD shows the fortification level', async () => {
    getCampaigns.mockResolvedValue([withMaterials({ level: 1, nextCost: 100 })])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('hud-forts')).toHaveTextContent('Forts: Lv 1')
  })
})

// The militia slider is GONE (docs/CAMPAIGN_PLAN.md "Recruit phase" S4):
// Militia is the base tier of the Recruit phase's offer now, hired from
// RecruitPanel like every other unit type. The camp is fortifications only.
describe('camp panel — no militia purchase', () => {
  it('renders no militia box, input, or button', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('camp-fort-box')).toBeInTheDocument()
    expect(screen.queryByTestId('camp-militia-box')).not.toBeInTheDocument()
    expect(screen.queryByTestId('militia-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('militia-button')).not.toBeInTheDocument()
  })
})

describe('camp panel — workers & side layout', () => {
  it('shows the workforce readout as free / raised', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 500, available: 1500 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('camp-workers')).toHaveTextContent('1500 free / 2000 raised')
  })

  // A Recruit hire takes workers out of the workforce entirely (they become
  // roster soldiers), so "raised" itself drops — unlike fort labour, which
  // keeps the worker around but permanently busy (`used`, not `total`).
  it('reflects a hire as a drop in "raised", not a temporary dip', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...withMaterials({}, { total: 1950, used: 0, available: 1950 }),
        roster: { ...campaignFixture.roster, Militia: 50 },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('camp-workers')).toHaveTextContent('1950 free / 1950 raised')
    expect(screen.queryByTestId('camp-workers-committed')).not.toBeInTheDocument()
  })

  // Playtest report: "2000 workers before, 2000 after, but only 1950
  // available" read as if the pool itself shrank temporarily. `used` reflects
  // ONLY fort labour (a PERMANENT commitment, worker never returns); hires
  // never touch `used` — they shrink `total` instead (see the test above).
  // Spell out what's actually gone for good.
  it('explains committed workers are permanent, not temporarily checked out', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 50, available: 1950 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('camp-workers-committed')).toHaveTextContent(
      '50 committed to fortification work — gone for good',
    )
  })

  it('shows no committed line for a fresh campaign that has spent nothing', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 0, available: 2000 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.queryByTestId('camp-workers-committed')).not.toBeInTheDocument()
  })

  it('marks fortify unaffordable (red, disabled) when workers are short but materials suffice', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 1950, available: 50 }), // 50 < 500 needed
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    const btn = screen.getByTestId('fortify-button')
    expect(btn).toHaveClass('unaffordable')
    expect(btn).toBeDisabled()
  })
})

describe('placement grid — fortified sides', () => {
  it('draws a rampart for each walled side the view exposes', () => {
    const sides = [
      { q: 4, r: 7, dir: 'SE', durability: 100 },
      { q: 4, r: 7, dir: 'SW', durability: 100 },
      { q: 5, r: 7, dir: 'SE', durability: 100 },
    ]
    // HexGrid reads fortifiedSides/roster/etc from the campaign store now,
    // not props — see docs/CAMPAIGN_PLAN.md's 2026-07-16 frontend
    // state-management thread.
    useCampaignStore.setState({
      campaign: {
        id: 'c1',
        roster: {},
        squads: [],
        forage: { assignment: {} },
        fortification: { sides },
        enemy: { placements: [] },
      },
    })
    render(<HexGrid info={info} map={{ hexes: [] }} />)
    for (const s of sides)
      expect(screen.getByTestId(`fort-side-${s.q}-${s.r}-${s.dir}`)).toBeInTheDocument()
    // No stray walls when none are passed.
    expect(screen.queryByTestId('fort-side-0-0-NE')).not.toBeInTheDocument()
  })
})
