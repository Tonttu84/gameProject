/**
 * A battle that annihilates the army ends the campaign (status 'lost' comes
 * back on the battle response) — playtest bug 2026-07-05: the player got the
 * war council back with 0 soldiers and no way to start a new campaign.
 *
 * The result screen must still get its beat (survivors, replay) before the
 * game-over screen, and continuing must NOT call end-day — the server refuses
 * actions on a finished campaign.
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
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  consultCampaignAugury: vi.fn(),
  rerollCampaignAugury: vi.fn(),
  setCampaignForage: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, postCampaignBattle, endCampaignDay } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'
import { marchToDeployment } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [{ type: 'Soldier', symbol: 'S', placementSize: 1 }],
}

// Fight requires the whole army on the field; this campaign owns exactly the
// 3 Soldiers the test places. No squads — the fixture's STARTING_SQUADS
// would otherwise reference units this shrunk roster doesn't have.
// bossFightDue: the pitched-battle day is the only day Fight! is offered.
const campaign = { ...campaignFixture, augury: consultedAugury, bossFightDue: true, roster: { Soldier: 3 }, squads: [] }

const lostCampaign = {
  ...campaign,
  status: 'lost',
  battleFoughtToday: true,
  roster: Object.fromEntries(Object.keys(campaign.roster).map((t) => [t, 0])),
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem(
    'loggedGameUser',
    JSON.stringify({ token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }),
  )
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
  getCampaigns.mockResolvedValue([campaign])
  postCampaignBattle.mockResolvedValue({
    id: 'b1',
    winner: 'red',
    tickCount: 3,
    blue_survivors: {},
    red_survivors: { Zombie: 5 },
    campaign: lostCampaign,
  })
})

const fightAndLose = async () => {
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToDeployment()
  fireEvent.click(screen.getByTestId('hex-0-4'))
  fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: /place/i }))
  fireEvent.click(screen.getByRole('button', { name: /fight!/i }))
  await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())
}

describe('losing the whole army in battle', () => {
  it('still shows the battle result screen, replay offer included', async () => {
    await fightAndLose()

    // The result beat, not the game-over screen yet.
    await screen.findByText(/your survivors/i)
    expect(screen.getByRole('button', { name: /watch replay/i })).toBeInTheDocument()
    expect(screen.queryByTestId('start-campaign')).not.toBeInTheDocument()
  })

  it('continuing goes to the defeat screen with a new-campaign button — no end-day call', async () => {
    await fightAndLose()
    await screen.findByText(/your survivors/i)

    fireEvent.click(screen.getByRole('button', { name: /retreat & regroup/i }))

    await screen.findByRole('heading', { name: 'Defeat' })
    expect(screen.getByTestId('start-campaign')).toHaveTextContent('New Campaign')
    expect(endCampaignDay).not.toHaveBeenCalled()
  })
})
