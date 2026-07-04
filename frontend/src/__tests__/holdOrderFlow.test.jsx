/**
 * Hold orders through the REAL campaign placement path.
 *
 * holdOrder.test.jsx exercises ReachMenu in isolation, which is how a broken
 * or invisible hold-orders experience in the actual campaign flow went
 * undetected in the 2026-07-03 playtest. This suite drives App end-to-end:
 * war council → muster → hex click → ReachMenu → Fight!, and pins that the
 * hold_turns value the player sets is what POST /api/campaigns/:id/battles
 * receives — one entry per placed unit, axial-converted hex.
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

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [{ type: 'Soldier', symbol: 'S', placementSize: 1 }],
}

// Augur already consulted → the council goes straight to "Muster for Battle".
const campaign = { ...campaignFixture, augury: consultedAugury }

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
    blue_survivors: { Soldier: 3 },
    red_survivors: {},
    campaign: { ...campaign, battleFoughtToday: true },
  })
})

const placeSoldiers = async ({ count, holdTurns }) => {
  render(<App />)
  await screen.findByText(/War Council/)
  fireEvent.click(screen.getByRole('button', { name: /muster for battle/i }))

  // Hex (col 0, row 4) is in the player zone; axial: q = 0 - floor(4/2) = -2.
  fireEvent.click(screen.getByTestId('hex-0-4'))
  fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: String(count) } })
  if (holdTurns !== undefined)
    fireEvent.change(screen.getByTestId('hold-turns-Soldier'), { target: { value: String(holdTurns) } })
  fireEvent.click(screen.getByRole('button', { name: /place/i }))

  fireEvent.click(screen.getByRole('button', { name: /fight!/i }))
  await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())
  return postCampaignBattle.mock.calls[0]
}

describe('hold orders in the campaign placement flow', () => {
  it('the hold turns set in the placement menu reach the battle payload', async () => {
    const [id, body] = await placeSoldiers({ count: 3, holdTurns: 4 })
    expect(id).toBe('c1')
    expect(body.player_placement).toEqual([
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 4 },
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 4 },
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 4 },
    ])
  })

  it('an untouched hold input sends hold_turns 0, not undefined', async () => {
    const [, body] = await placeSoldiers({ count: 2 })
    expect(body.player_placement).toEqual([
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 0 },
      { unit_type: 'Soldier', q: -2, r: 4, hold_turns: 0 },
    ])
  })
})
