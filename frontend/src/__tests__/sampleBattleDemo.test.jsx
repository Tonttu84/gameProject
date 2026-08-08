/**
 * Demo battle (login screen AND logged-in start screen).
 *
 * Anyone can launch the hardcoded sample battle and watch it in the SAME
 * ReplayView a campaign battle uses. The button hits the unauth
 * POST /api/sample-battle (launchSampleBattle), which runs the scenario through
 * the engine→DB pipeline and returns a summary; ReplayView then reads the ticks
 * back from the DB (getTicks) — the browser is the only renderer.
 * The demo needs no login, so it is offered on the logged-in no-campaign
 * screen too — trapping it behind logout made it "vanish" for a returning
 * player (2026-07-15 playtest finding).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  // The turn's phase is server state now: advancing returns the refreshed
  // view, exactly as the real route does (the campaign with the new phase).
  // Imported lazily inside the call so the hoisted vi.mock factory stays
  // self-contained.
  advanceCampaignPhase: vi.fn(async (_id, phase) => {
    const { default: store } = await import('../stores/useCampaignStore')
    return { ...store.getState().campaign, phase }
  }),
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getTicks: vi.fn(),
  launchSampleBattle: vi.fn(),
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

import { getInfo, getMap, getTicks, launchSampleBattle, getCampaigns } from '../services/api'
import App from '../App'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const sampleSummary = { id: 'demo-battle-1', winner: 'blue', tickCount: 3 }
const ticks = [
  { index: 0, units: [{ id: 0, type: 'Soldier', team: 'blue', q: 4, r: 4, ox: 0, oy: 0, sz: 0.2 }], log: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
  getTicks.mockResolvedValue(ticks)
})

describe('login-screen demo battle', () => {
  it('offers a "Watch a battle" button while logged out', async () => {
    render(<App />)
    await screen.findByText(/The Campaign Awaits/)
    expect(screen.getByTestId('watch-demo')).toBeInTheDocument()
  })

  it('launches the sample battle and plays it in ReplayView (reading ticks from the DB)', async () => {
    launchSampleBattle.mockResolvedValue(sampleSummary)
    render(<App />)
    await screen.findByTestId('watch-demo')

    fireEvent.click(screen.getByTestId('watch-demo'))

    // The one and only render path — a real ReplayView bound to the returned id.
    await screen.findByText(/Battle Replay/)
    expect(launchSampleBattle).toHaveBeenCalledOnce()
    await waitFor(() => expect(getTicks).toHaveBeenCalledWith('demo-battle-1', 0, 49))
  })

  it('returns to the login prompt from the demo', async () => {
    launchSampleBattle.mockResolvedValue(sampleSummary)
    render(<App />)
    await screen.findByTestId('watch-demo')
    fireEvent.click(screen.getByTestId('watch-demo'))

    fireEvent.click(await screen.findByTestId('replay-back'))
    expect(await screen.findByText(/The Campaign Awaits/)).toBeInTheDocument()
  })

  it('surfaces a notice if the launch fails', async () => {
    launchSampleBattle.mockRejectedValue(new Error('server down'))
    render(<App />)
    await screen.findByTestId('watch-demo')
    fireEvent.click(screen.getByTestId('watch-demo'))

    expect(await screen.findByTestId('auth-notice')).toHaveTextContent(/demo battle/i)
    expect(screen.getByText(/The Campaign Awaits/)).toBeInTheDocument()
  })
})

describe('logged-in start-screen demo battle', () => {
  const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

  // Stored session + no campaigns — a returning player on the start screen.
  const renderLoggedIn = async () => {
    getCampaigns.mockResolvedValue([])
    window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
    render(<App />)
    await screen.findByText(/No Campaign In Progress/)
  }

  it('offers "Watch a battle" on the no-campaign start screen', async () => {
    await renderLoggedIn()
    expect(screen.getByTestId('watch-demo')).toBeInTheDocument()
  })

  it('plays the demo and returns to the start screen, still logged in', async () => {
    launchSampleBattle.mockResolvedValue(sampleSummary)
    await renderLoggedIn()

    fireEvent.click(screen.getByTestId('watch-demo'))
    await screen.findByText(/Battle Replay/)
    expect(launchSampleBattle).toHaveBeenCalledOnce()
    await waitFor(() => expect(getTicks).toHaveBeenCalledWith('demo-battle-1', 0, 49))

    fireEvent.click(await screen.findByTestId('replay-back'))
    expect(await screen.findByText(/No Campaign In Progress/)).toBeInTheDocument()
  })
})
