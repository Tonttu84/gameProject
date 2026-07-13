/**
 * authNotice is a transient toast banner (App.jsx), not a persistent state —
 * it must clear itself automatically rather than staying on screen forever.
 * Fullstack Open-style: showing a notice (re)starts a timer that clears it;
 * a fresh notice shown before the old timer fires resets the clock instead
 * of being cut short by the earlier one.
 *
 * Fake timers are installed from the very start of each test (before
 * render), so the setTimeout showAuthNotice schedules is captured by the
 * SAME fake clock we later advance — a timer created under real timers
 * can't be advanced by faking the clock afterward. advanceTimersByTimeAsync
 * also drains pending microtasks on each tick, which is what lets the
 * mocked getInfo/getMap/launchSampleBattle promises resolve without any
 * real wall-clock time passing.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

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
  launchSampleBattle: vi.fn(),
}))

import { getInfo, getMap, launchSampleBattle } from '../services/api'
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
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

// The failed "Watch a battle" demo is the simplest notice trigger — no login
// needed, no other in-flight timers to interfere with.
const triggerNotice = async () => {
  launchSampleBattle.mockRejectedValue(new Error('server down'))
  fireEvent.click(screen.getByTestId('watch-demo'))
  await flush()
}

describe('authNotice auto-dismiss', () => {
  it('clears itself automatically after the timeout — not left on screen forever', async () => {
    render(<App />)
    await flush()
    await triggerNotice()
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(9999) })
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument() // not yet — just under 10s

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByTestId('auth-notice')).not.toBeInTheDocument()
  })

  it('a fresh notice resets the timer instead of being cut short by the old one', async () => {
    render(<App />)
    await flush()
    await triggerNotice()

    await act(async () => { await vi.advanceTimersByTimeAsync(7000) }) // most of the first timer
    await triggerNotice() // second notice, resets the clock

    // 11s since the FIRST notice, but only 4s since the second — still up.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.getByTestId('auth-notice')).toBeInTheDocument()

    // 10s since the second notice — now it clears.
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(screen.queryByTestId('auth-notice')).not.toBeInTheDocument()
  })
})
