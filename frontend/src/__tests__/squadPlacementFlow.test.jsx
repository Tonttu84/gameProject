/**
 * Squad placement through the REAL campaign placement path (playtest item 1).
 *
 * Mirrors holdOrderFlow.test.jsx's approach but for squads: war council →
 * muster → hex click → ReachMenu's Squads section → Fight!, pinning that
 * placing a squad expands into one player_placement entry per member, each
 * carrying squad_id/squad_name/hold_turns and the axial-converted hex —
 * exactly what the campaign server's battle route expects (Stage B).
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

import { getInfo, getMap, getCampaigns, postCampaignBattle } from '../services/api'
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

const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }
// Roster owns exactly the one squad's units — fight requires the whole army
// on the field, and this test isn't exercising loose troops.
const campaign = {
  ...campaignFixture,
  augury: consultedAugury,
  roster: { Soldier: 2 },
  squads: [squad],
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
    tickCount: 0,
    blue_survivors: { Soldier: 2 },
    red_survivors: {},
    campaign: { ...campaign, battleFoughtToday: true },
  })
})

describe('squad placement in the campaign placement flow', () => {
  it('placing a squad and fighting sends one tagged entry per member', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToDeployment()

    // Hex (col 0, row 4) is in the player zone; axial: q = 0 - floor(4/2) = -2.
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.click(screen.getByTestId('squad-place-1'))
    fireEvent.change(screen.getByTestId('squad-hold-1'), { target: { value: '3' } })

    // Fight unlocks once the whole army — here, just the one squad — is on
    // the field; no "still in camp" counter.
    expect(screen.queryByTestId('placement-in-camp')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /fight!/i }))

    await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())
    const [id, body] = postCampaignBattle.mock.calls[0]
    expect(id).toBe('c1')
    expect(body.player_placement).toEqual([
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 3, squad_id: 1, squad_name: '1st Cohort' },
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 3, squad_id: 1, squad_name: '1st Cohort' },
    ])
  })

  it('an unplaced squad counts toward "still in camp"', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToDeployment()

    expect(screen.getByTestId('placement-in-camp')).toHaveTextContent('2 still in camp')
    expect(screen.getByRole('button', { name: /fight!/i })).toBeDisabled()
  })
})
