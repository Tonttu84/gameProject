/**
 * Connection-error screen (App.jsx boot effect): the campaign server boots
 * slower than Vite, so the first getInfo/getMap fetches retry through a
 * 10-retry × 2s window before declaring the server unreachable. Only after
 * the whole window fails does the error screen (with a Retry button) show;
 * a success inside the window recovers silently.
 *
 * Fake timers are installed before render (authNoticeTimeout.test.jsx
 * discipline) so the retry setTimeout chain lives on the fake clock;
 * advanceTimersByTimeAsync drains each rejection's microtasks between
 * timers, letting the chained attempts schedule each other.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

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
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap } from '../services/api'
import App from '../App'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [],
  units: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('connection-error screen', () => {
  it('declares the server unreachable only after the full retry window (10 retries × 2s)', async () => {
    getInfo.mockRejectedValue(new Error('ECONNREFUSED'))
    getMap.mockRejectedValue(new Error('ECONNREFUSED'))
    render(<App />)
    await advance(0) // first attempt fails, first retry scheduled

    expect(screen.getByText(/connecting to game server/i)).toBeInTheDocument()

    // Through 19999 ms: attempt 0 (t=0) + retries at 2s…18s have all failed,
    // the last retry (t=20s) is still pending — no error screen yet.
    await advance(19999)
    expect(screen.getByText(/connecting to game server/i)).toBeInTheDocument()
    expect(screen.queryByText('Connection Error')).not.toBeInTheDocument()
    expect(getInfo).toHaveBeenCalledTimes(10)

    // The 10th retry fires at t=20s and fails — now the screen flips.
    await advance(1)
    expect(screen.getByText('Connection Error')).toBeInTheDocument()
    expect(
      screen.getByText(/could not reach the campaign server/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(getInfo).toHaveBeenCalledTimes(11)

    // The chain ends with the error — no further retries tick on.
    await advance(10000)
    expect(getInfo).toHaveBeenCalledTimes(11)
  })

  it('a success inside the retry window recovers without ever showing the error', async () => {
    getInfo.mockRejectedValueOnce(new Error('booting')).mockResolvedValue(info)
    getMap.mockRejectedValueOnce(new Error('booting')).mockResolvedValue({ hexes: [] })
    render(<App />)
    await advance(0) // first attempt fails
    expect(screen.getByText(/connecting to game server/i)).toBeInTheDocument()

    await advance(2000) // first retry succeeds
    expect(screen.getByText('The Campaign Awaits')).toBeInTheDocument()
    expect(screen.queryByText('Connection Error')).not.toBeInTheDocument()

    // Success ends the chain: no stray retries keep hitting the server.
    await advance(30000)
    expect(getInfo).toHaveBeenCalledTimes(2)
  })
})
