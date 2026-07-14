/**
 * Raid opportunities (Stage 4 Part 2): the war council's RaidPanel lists the
 * turn's scouted targets with their strength band + capacity budget, builds a
 * party clamped live against the budget (cost = size × (40 − speed) / 40,
 * from the engine-exported speed on info.units), launches through the raid
 * route, and replays a resolved raid through the one ReplayView.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getBattle: vi.fn(),
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
  postCampaignRaid: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getBattle, getTicks, getCampaigns, postCampaignRaid } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  // speed/placementSize are the engine-exported stats the party-builder costs
  // units with: Soldier 10 × 39/40 = 9.75, LightCavalry 20 × 37/40 = 18.5.
  units: [
    { type: 'Soldier', symbol: 'X', placementSize: 10, category: 'Foot', forbiddenTerrain: [], speed: 1 },
    { type: 'LightCavalry', symbol: 'l', placementSize: 20, category: 'Mounted', forbiddenTerrain: ['Forest', 'Marsh'], speed: 3 },
  ],
}

const OPPORTUNITY = {
  id: 'd1-0',
  type: 'loot_supplies',
  title: 'Supply Train',
  description: 'Laden wagons under light guard.',
  strengthBand: 'a handful',
  capacity: 100,
  resolved: false,
  outcome: null,
}

const withRaid = (opportunities) => ({
  ...campaignFixture,
  raid: { opportunities },
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

describe('raid panel — opportunities', () => {
  it('lists the opportunity with its strength band, budget, and the scouting band', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('raid-panel')).toBeInTheDocument()
    expect(screen.getByText('Supply Train')).toBeInTheDocument()
    expect(screen.getByTestId('raid-strength-d1-0')).toHaveTextContent(
      'The scouts judge it a handful. Party budget: 100.',
    )
    // The banded label is the only scouting fact shown — house style.
    expect(screen.getByTestId('raid-band')).toHaveTextContent('Scouting: Contested')
  })

  it('renders nothing when the turn dealt no opportunities', async () => {
    getCampaigns.mockResolvedValue([withRaid([])])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })

  it('clamps the party against the capacity budget and launches within it', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    postCampaignRaid.mockResolvedValue({
      winner: 'blue',
      campaign: withRaid([
        { ...OPPORTUNITY, resolved: true, outcome: { winner: 'blue', battleId: 'b9' } },
      ]),
    })
    render(<App />)
    await screen.findByText(/War Council/)

    // 11 Soldiers cost 107.25 > 100: over budget, launch disabled.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '11' } })
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 108 / 100')
    expect(screen.getByTestId('raid-launch-d1-0')).toBeDisabled()

    // 10 cost 97.5: within budget — the launch posts exactly the party.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '10' } })
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 98 / 100')
    fireEvent.click(screen.getByTestId('raid-launch-d1-0'))
    await waitFor(() =>
      expect(postCampaignRaid).toHaveBeenCalledWith('c1', 'd1-0', { Soldier: 10 }),
    )

    // The refreshed view resolves the card: outcome + replay button.
    expect(await screen.findByTestId('raid-outcome-d1-0')).toHaveTextContent('The raid succeeded.')
    expect(screen.getByTestId('raid-watch-d1-0')).toBeInTheDocument()
  })

  it('an empty party cannot launch', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('raid-launch-d1-0')).toBeDisabled()
  })

  it('units out foraging shrink what the party-builder offers', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...withRaid([OPPORTUNITY]),
        forage: { ...campaignFixture.forage, assignment: { Soldier: 295 } },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    // 300 − 295 foraging = 5 available; the input clamps to it.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '10' } })
    expect(screen.getByTestId('raid-input-d1-0-Soldier')).toHaveValue(5)
  })

  it('watching a resolved raid fetches the battle and opens the replay', async () => {
    getCampaigns.mockResolvedValue([
      withRaid([{ ...OPPORTUNITY, resolved: true, outcome: { winner: 'red', battleId: 'b9' } }]),
    ])
    getBattle.mockResolvedValue({ id: 'b9', tickCount: 3 })
    getTicks.mockResolvedValue([])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('raid-outcome-d1-0')).toHaveTextContent('The raid was beaten back.')
    fireEvent.click(screen.getByTestId('raid-watch-d1-0'))
    await waitFor(() => expect(getBattle).toHaveBeenCalledWith('b9'))
    // The one ReplayView takes over; Back returns to the council.
    expect(await screen.findByText('Back to the council')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Back to the council'))
    expect(await screen.findByText(/War Council/)).toBeInTheDocument()
  })
})
