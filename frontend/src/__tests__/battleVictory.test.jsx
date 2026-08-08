/**
 * Winning a battle — the most common gameplay loop, mirror image of
 * battleDefeat.test.jsx: fight, see the Victory result with survivors,
 * "Press On" into the fortnight report (nextDay flow → endCampaignDay),
 * and no second battle the same turn — battleFoughtToday from the battle
 * response disables Fight! and drops the "(no battle)" End-Turn suffix.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

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
// 3 Soldiers the test places (no squads — same shape as battleDefeat.test.jsx).
// The pitched-battle day: Fight! only appears (and End Turn is withheld) once
// bossFightDue — that's the only time a full-army battle is offered.
const campaign = { ...campaignFixture, augury: consultedAugury, bossFightDue: true, roster: { Soldier: 3 }, squads: [] }

// The refreshed view after a won battle: campaign continues (still active),
// one Soldier fell, and today's battle is spent.
const wonCampaign = {
  ...campaign,
  battleFoughtToday: true,
  roster: { Soldier: 2 },
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
    winner: 'blue',
    tickCount: 3,
    blue_survivors: { Soldier: 2 },
    red_survivors: {},
    campaign: wonCampaign,
  })
})

const fightAndWin = async () => {
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToDeployment()
  fireEvent.click(screen.getByTestId('hex-0-4'))
  fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: /place/i }))
  fireEvent.click(screen.getByRole('button', { name: /fight!/i }))
  await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())
}

describe('winning a battle', () => {
  it('shows the Victory result with the surviving roster and a Press On button', async () => {
    await fightAndWin()

    await screen.findByRole('heading', { name: 'Victory' })
    // Scope to the survivors column: the refreshed roster ("2 Soldier" in the
    // placement UI behind the result panel) renders the same text.
    const survivorsCol = screen.getByText(/your survivors \(2\)/i).closest('div')
    expect(within(survivorsCol).getByText('2 Soldier')).toBeInTheDocument()
    // The winner branch continues the campaign — Press On, not the defeat wording.
    expect(screen.getByRole('button', { name: /press on/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retreat & regroup/i })).not.toBeInTheDocument()
  })

  it('Press On ends the turn: the day report shows, then the next council', async () => {
    endCampaignDay.mockResolvedValue({
      report: {
        day: 1,
        entries: ['The enemy host falls back in disorder.'],
        upkeep: { foodConsumed: 12432, deserters: 0 },
        augury: [],
      },
      campaign: { ...wonCampaign, day: 2, battleFoughtToday: false },
    })
    await fightAndWin()
    await screen.findByRole('heading', { name: 'Victory' })

    fireEvent.click(screen.getByRole('button', { name: /press on/i }))

    await waitFor(() => expect(endCampaignDay).toHaveBeenCalledWith('c1'))
    await screen.findByTestId('day-report')
    // Beats: upkeep first (no fates fired), then the summary card carries the
    // log entries and the continue button.
    fireEvent.click(screen.getByTestId('reveal-next'))
    expect(screen.getByText('The enemy host falls back in disorder.')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('report-continue'))
    await screen.findByText(/Turn 2 — War Council/)
  })

  it('battleFoughtToday gates the placement UI: Fight! disabled, End Turn loses "(no battle)"', async () => {
    // A campaign that already fought today (e.g. reloaded after the battle).
    getCampaigns.mockResolvedValue([wonCampaign])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToDeployment()

    // Field the whole remaining army so battleFoughtToday is the ONLY gate
    // (an empty field or units in camp would disable Fight! on their own).
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))

    expect(screen.getByRole('button', { name: /fight!/i })).toBeDisabled()
    expect(screen.getByTestId('end-day')).toHaveTextContent('End Turn')
    expect(screen.getByTestId('end-day')).not.toHaveTextContent('(no battle)')
  })
})
