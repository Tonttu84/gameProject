/**
 * Placing an UNATTACHED character at deploy (docs/CAMPAIGN_PLAN.md, 13-18).
 *
 * The last thing slice 5a left reachable only through the API: a caster who is
 * posted to no squad had no way onto the field from the screen, even though the
 * battle route has accepted `character_id` entries since 5a shipped.
 *
 * The two halves of the rule, and both are tested here: an UNATTACHED character
 * is placed by hand, and an ATTACHED one is not offered at all — they ride with
 * their squad and the server seats them on its hex (5-8), so offering them here
 * would field the same person twice.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
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
  setCampaignEffort: vi.fn(),
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
  units: [
    { type: 'Soldier', symbol: 'S', placementSize: 1 },
    { type: 'Mage', symbol: 'M', placementSize: 1 },
  ],
}

const ISOLDE = { id: 1, name: 'Isolde', type: 'Mage', squadId: null, hangBack: true, alive: true, diedDay: null }
const BARNABAS = { id: 2, name: 'Barnabas', type: 'Priest', squadId: 1, hangBack: true, alive: true, diedDay: null }
const CERIDWEN = { id: 3, name: 'Ceridwen', type: 'Mage', squadId: null, hangBack: false, alive: false, diedDay: 4 }

const squad = { id: 1, name: '1st Cohort', composition: { Soldier: 2 } }

const campaign = (characters) => ({
  ...campaignFixture,
  augury: consultedAugury,
  bossFightDue: true,
  roster: { Soldier: 2 },
  squads: [squad],
  characters,
})

const deployWith = async (characters) => {
  getCampaigns.mockResolvedValue([campaign(characters)])
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToDeployment()
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
  postCampaignBattle.mockResolvedValue({
    id: 'b1',
    winner: 'blue',
    tickCount: 0,
    blue_survivors: { Soldier: 2 },
    red_survivors: {},
    campaign: { ...campaign([ISOLDE]), battleFoughtToday: true },
  })
})

describe('placing a lone character', () => {
  it('offers only the living and the unposted', async () => {
    await deployWith([ISOLDE, BARNABAS, CERIDWEN])
    fireEvent.click(screen.getByTestId('hex-0-4'))

    expect(screen.getByTestId('character-row-1')).toHaveTextContent('Isolde')
    // Posted to the 1st Cohort: they ride with it, and placing them here too
    // would put the same person on the field twice.
    expect(screen.queryByTestId('character-row-2')).toBeNull()
    // …and there is nothing to order a dead mage.
    expect(screen.queryByTestId('character-row-3')).toBeNull()
  })

  it('sends one entry carrying the character_id', async () => {
    await deployWith([ISOLDE])
    // Hex (col 0, row 4) is in the player zone; axial q = 0 − floor(4/2) = −2.
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.click(screen.getByTestId('squad-place-1'))
    fireEvent.click(screen.getByTestId('character-place-1'))

    fireEvent.click(screen.getByRole('button', { name: /fight!/i }))
    await waitFor(() => expect(postCampaignBattle).toHaveBeenCalled())

    const [, body] = postCampaignBattle.mock.calls[0]
    expect(body.player_placement).toContainEqual({
      unit_type: 'Mage', q: -2, r: 4, hold_turns: 0, character_id: 1,
    })
    // One entry, not one per body of a type: a character is an individual.
    expect(body.player_placement.filter((e) => e.character_id != null)).toHaveLength(1)
  })

  it('marks them on the hex and counts them apart from the troops', async () => {
    await deployWith([ISOLDE])
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.click(screen.getByTestId('character-place-1'))

    expect(screen.getByTestId('character-marker-0-4-1')).toHaveTextContent('Isolde')
    expect(screen.getByTestId('placement-characters')).toHaveTextContent('1 character')
  })

  // A character is not a roster body (5-1), so the "whole army must take the
  // field" gate has nothing to weigh them against — the server draws the same
  // line. Leaving a caster in camp must therefore not lock the battle.
  it('leaving them in camp does not hold up the battle', async () => {
    await deployWith([ISOLDE])
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.click(screen.getByTestId('squad-place-1'))

    expect(screen.queryByTestId('placement-in-camp')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fight!/i })).toBeEnabled()
  })

  it('moves them from hex to hex, and takes them off again', async () => {
    await deployWith([ISOLDE])
    fireEvent.click(screen.getByTestId('hex-0-4'))
    fireEvent.click(screen.getByTestId('character-place-1'))

    // Somewhere else in the zone: the marker follows, it does not multiply.
    fireEvent.click(screen.getByTestId('hex-1-5'))
    fireEvent.click(screen.getByTestId('character-place-1'))
    expect(screen.queryByTestId('character-marker-0-4-1')).toBeNull()
    expect(screen.getByTestId('character-marker-1-5-1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('character-remove-1'))
    expect(screen.queryByTestId('character-marker-1-5-1')).toBeNull()
  })
})
