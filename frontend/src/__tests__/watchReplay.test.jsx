/**
 * Watch Replay round trip from the battle result screen: the button opens
 * ReplayView (phase 'replay'), Back returns to the result screen with the
 * battle result intact — and the button exists only when the battle actually
 * recorded ticks (tickCount > 0), since there is nothing to play otherwise.
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

import { getInfo, getMap, getTicks, getCampaigns, postCampaignBattle } from '../services/api'
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

// bossFightDue: Fight! is only offered on the pitched-battle day.
const campaign = { ...campaignFixture, augury: consultedAugury, bossFightDue: true, roster: { Soldier: 3 }, squads: [] }

const battleResponse = (tickCount) => ({
  id: 'b1',
  winner: 'blue',
  tickCount,
  blue_survivors: { Soldier: 2 },
  red_survivors: {},
  campaign: { ...campaign, battleFoughtToday: true, roster: { Soldier: 2 } },
})

const replayTicks = [
  {
    index: 0,
    units: [{ id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, ox: 0, oy: 0, sz: 0.2 }],
    log: ['the lines close'],
  },
]

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
  getTicks.mockImplementation((_id, from, to) =>
    Promise.resolve(replayTicks.filter((t) => t.index >= from && t.index <= to)),
  )
})

const fight = async () => {
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToDeployment()
  fireEvent.click(screen.getByTestId('hex-0-4'))
  fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: /place/i }))
  fireEvent.click(screen.getByRole('button', { name: /fight!/i }))
  await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())
  await screen.findByText(/your survivors/i)
}

describe('watch replay round trip', () => {
  it('Watch Replay opens the replay view, Back returns to the intact result screen', async () => {
    postCampaignBattle.mockResolvedValue(battleResponse(3))
    await fight()

    fireEvent.click(screen.getByRole('button', { name: /watch replay/i }))

    // ReplayView takes over: header + its tick 0 fetched from the server.
    await screen.findByText(/Battle Replay/)
    expect(getTicks).toHaveBeenCalledWith('b1', 0, expect.any(Number))
    expect(await screen.findByText('the lines close')).toBeInTheDocument()
    expect(screen.queryByText(/your survivors/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('replay-back'))

    // Back on the result screen, battle result untouched underneath.
    expect(await screen.findByText(/your survivors \(2\)/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /watch replay/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /press on/i })).toBeInTheDocument()
    expect(screen.queryByText(/Battle Replay/)).not.toBeInTheDocument()
  })

  it('offers no Watch Replay button when the battle recorded no ticks', async () => {
    postCampaignBattle.mockResolvedValue(battleResponse(0))
    await fight()

    expect(screen.queryByRole('button', { name: /watch replay/i })).not.toBeInTheDocument()
    // The rest of the result screen still works.
    expect(screen.getByRole('button', { name: /press on/i })).toBeInTheDocument()
  })
})
