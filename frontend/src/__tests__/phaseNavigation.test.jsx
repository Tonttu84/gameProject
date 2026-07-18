/**
 * Back-navigation across the phased turn (Prepare → Omens → Raids → Deploy).
 * The forward march is pinned elsewhere (campaignFlow, the nav helper); this
 * pins that the flow can also be walked BACKWARDS — Omens → Prepare and
 * Raids → Omens — as pure phase-state changes that undo no committed server
 * action (docs/CAMPAIGN_PLAN.md, phased-turn slices 2–3).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

import { getInfo, getMap, getCampaigns } from '../services/api'
import App from '../App'
import { marchToRaids } from './helpers/nav'
import { campaignFixture, consultedAugury } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
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
  getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
})

describe('phased-turn back navigation', () => {
  it('Omens → Back to the Council returns to the War Council', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    // On the tent: the read-only context is shown, the council is gone.
    expect(screen.getByTestId('omens-context')).toBeInTheDocument()
    expect(screen.queryByTestId('to-omens')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('back-to-prepare'))
    // Back on the council: the "Read the Omens" exit is here again.
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('to-omens')).toBeInTheDocument()
    expect(screen.queryByTestId('omens-context')).not.toBeInTheDocument()
  })

  it('Raids → Back to the Omens returns to the augur’s tent', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    // On the raids screen: the deploy exit is here.
    expect(await screen.findByTestId('to-deploy')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('back-to-omens'))
    // Back at the tent: the read-only context returns, the raids exit is gone.
    expect(await screen.findByTestId('omens-context')).toBeInTheDocument()
    expect(screen.queryByTestId('to-deploy')).not.toBeInTheDocument()
  })
})

// Each phased screen exposes only its own actions — the whole point of the
// split. raidPanel.test.jsx pins the raids' side of this; here we pin that the
// Prepare (council) and Omens (tent) screens don't leak each other's controls.
describe('phased-turn screen scope', () => {
  it('the council (Prepare) has the camp/forage actions but nothing from the tent or the raids', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    // Its own actions…
    expect(screen.getByTestId('forage-panel')).toBeInTheDocument()
    expect(screen.getByTestId('camp-panel')).toBeInTheDocument()
    // …and no augury/raids controls bled in from later screens.
    expect(screen.queryByTestId('omens-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('augury-continue')).not.toBeInTheDocument()
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })

  it('the tent (Omens) has only the augury — no forage, camp, or raids controls', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    fireEvent.click(screen.getByTestId('to-omens'))

    // Its own context…
    expect(screen.getByTestId('omens-context')).toBeInTheDocument()
    // …and none of the council's or raids' actions.
    expect(screen.queryByTestId('forage-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('camp-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })
})
