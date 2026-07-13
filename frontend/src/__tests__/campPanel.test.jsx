/**
 * Camp works (Stage 3 materials sink): the CampPanel on the war council raises
 * the abstract fortification level and musters militia, gated on the cost/cap
 * the campaign view reports; the HUD shows the level; and the placement grid
 * draws the walled sides the view exposes so the player deploys behind them.
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

describe('camp panel — militia', () => {
  it('posts the militia purchase with the chosen count', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    spendCampaign.mockResolvedValue(withMaterials())
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.change(screen.getByTestId('militia-input'), { target: { value: '5' } })
    const btn = screen.getByTestId('militia-button')
    expect(btn).toHaveTextContent('Raise 5 militia (10 food, 5 materials, 5 workers)')
    fireEvent.click(btn)
    await waitFor(() =>
      expect(spendCampaign).toHaveBeenCalledWith('c1', { action: 'militia', count: 5 }),
    )
  })

  it('disables the militia buy when the workforce is exhausted', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 2000, available: 0 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('militia-button')).toBeDisabled()
  })

  // The input used to accept 99999999; now it clamps to what the camp can
  // actually pay for, so the previewed cost never exceeds the stores. Here
  // food is the binding constraint (10 food ÷ 2 = 5 militia).
  it('clamps the militia count to the max the camp can afford', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...withMaterials(),
        resources: { ...campaignFixture.resources, food: 10, materials: 200 },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.change(screen.getByTestId('militia-input'), { target: { value: '99999999' } })
    expect(screen.getByTestId('militia-input')).toHaveValue(5)
    const btn = screen.getByTestId('militia-button')
    expect(btn).toHaveTextContent('Raise 5 militia (10 food, 5 materials, 5 workers)')
    expect(btn).not.toBeDisabled()
  })

  // Mirror the fortify button's title: a disabled buy explains the reason so
  // the player knows which resource is short.
  it('titles the disabled militia button with why it is blocked', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 2000, available: 0 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('militia-button')).toHaveAttribute('title', 'Not enough workers')
  })
})

describe('camp panel — workers & side layout', () => {
  it('shows the workforce readout as available / total', async () => {
    getCampaigns.mockResolvedValue([
      withMaterials({}, { total: 2000, used: 500, available: 1500 }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('camp-workers')).toHaveTextContent('1500 / 2000')
  })

  it('renders fortifications and militia as separate stacked boxes', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('camp-fort-box')).toBeInTheDocument()
    expect(screen.getByTestId('camp-militia-box')).toBeInTheDocument()
  })

  it('shows the fort worker cost alongside the materials cost', async () => {
    getCampaigns.mockResolvedValue([withMaterials()])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('fortify-button')).toHaveTextContent('500 workers')
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
    render(
      <HexGrid
        info={info}
        map={{ hexes: [] }}
        placements={[]}
        onPlacementsChange={() => {}}
        roster={{}}
        fortifiedSides={sides}
      />,
    )
    for (const s of sides)
      expect(screen.getByTestId(`fort-side-${s.q}-${s.r}-${s.dir}`)).toBeInTheDocument()
    // No stray walls when none are passed.
    expect(screen.queryByTestId('fort-side-0-0-NE')).not.toBeInTheDocument()
  })
})
