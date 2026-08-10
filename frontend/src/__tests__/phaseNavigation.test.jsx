/**
 * Back-navigation across the phased turn (Prepare → Omens → Raids → Recruit →
 * Deploy). The forward march is pinned elsewhere (campaignFlow, the nav
 * helper); this pins what going BACK means since the turn became a one-way
 * march (docs/CAMPAIGN_PLAN.md "Effort slider", decision 12): an earlier screen
 * can still be LOOKED at, but it is a record — its controls are dead, its
 * advance button is replaced by the way back to where the turn stands, and the
 * server refuses its writes regardless.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
  setCampaignEffort: vi.fn(),
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
    // Awaited — advancing a phase is a server round trip now.
    expect(await screen.findByTestId('omens-context')).toBeInTheDocument()
    expect(screen.queryByTestId('to-omens')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('back-to-prepare'))
    // Back on the council — but the turn has moved past it, so it is a record:
    // no second "Read the Omens", the effort slider is dead, and the only
    // button is the one that returns to where the turn actually stands.
    await screen.findByText(/War Council/)
    expect(screen.queryByTestId('omens-context')).not.toBeInTheDocument()
    expect(screen.queryByTestId('to-omens')).not.toBeInTheDocument()
    expect(screen.getByTestId('phase-committed')).toBeInTheDocument()
    // The slider itself is the control now — there is no submit button to
    // disable, so "dead" means the input is disabled and says so.
    expect(screen.getByTestId('effort-slider')).toBeDisabled()
    expect(screen.getByTestId('effort-status')).toHaveTextContent('Effort is committed')
    expect(screen.getByTestId('fortify-button')).toBeDisabled()

    // …and it leads forward again, never sideways.
    fireEvent.click(screen.getByTestId('back-to-current-phase'))
    expect(await screen.findByTestId('omens-context')).toBeInTheDocument()
  })

  it('Raids → Back to the Omens returns to the augur’s tent', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    // On the raids screen: the recruit exit is here.
    expect(await screen.findByTestId('to-recruit')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('back-to-omens'))
    // Back at the tent: the read-only context returns, the raids exit is gone.
    expect(await screen.findByTestId('omens-context')).toBeInTheDocument()
    expect(screen.queryByTestId('to-recruit')).not.toBeInTheDocument()
  })

  // Recruit is the one door that only opens forwards: entering it draws the
  // day's offer and closes the camp server-side (rejectIfRecruiting), so every
  // action on the screens behind it would 400. Rather than offer a back button
  // that leads somewhere dead, there isn't one — the hire is the only exit.
  // recruitPanel.test.jsx pins the rest of that contract.
  it('Recruit has no way back — the camp is closed once recruiting begins', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    fireEvent.click(screen.getByTestId('to-recruit'))

    // On the recruit screen: the deploy exit is here, and nothing else is.
    expect(await screen.findByTestId('to-deploy')).toBeInTheDocument()
    expect(screen.queryByTestId('back-to-raids')).not.toBeInTheDocument()
    expect(screen.queryByTestId('back-to-omens')).not.toBeInTheDocument()
    expect(screen.queryByTestId('back-to-prepare')).not.toBeInTheDocument()
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
    expect(await screen.findByTestId('omens-context')).toBeInTheDocument()
    // …and none of the council's or raids' actions.
    expect(screen.queryByTestId('forage-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('camp-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })

  it('the Recruit screen has only recruiting — no forage, camp, or raid controls', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    fireEvent.click(screen.getByTestId('to-recruit'))

    // Its own exit is here…
    expect(await screen.findByTestId('to-deploy')).toBeInTheDocument()
    // …and none of the earlier screens' controls bled in.
    expect(screen.queryByTestId('forage-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('camp-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })
})
