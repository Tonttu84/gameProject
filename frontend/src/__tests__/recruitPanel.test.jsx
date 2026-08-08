/**
 * Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
 * a screen between Raids and Deploy showing the day's 2 server-drawn hire
 * options. Entering the phase DRAWS the offer (POST /:id/recruit/open) — it
 * doesn't exist until then, so this turn's raid gold is in the stores when the
 * pool is judged. Opening also closes the camp for the day server-side, which
 * is why this screen has no way back, and why the hire is the only way on:
 * there is no skip, and Deploy stays locked until hiredToday. Cost/count are
 * already resolved by campaignView against LIVE resources (never stale) — the
 * panel only submits the pick.
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
  hireRecruit: vi.fn(),
  openRecruit: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, hireRecruit, openRecruit } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'
import { marchToRaids } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const MILITIA_OPTION = {
  id: 'militia', unit: 'Militia', lane: 'troop', count: 20,
  cost: { food: 40, materials: 20, workers: 20 }, secondUnit: null,
}
const MAGE_OPTION = {
  id: 'mage', unit: 'Mage', lane: 'caster', count: 1,
  cost: { gold: 100 }, secondUnit: null,
}
// The pad that makes the mandatory hire always possible — costs nothing.
const TRAVELLERS_OPTION = {
  id: 'travellers', unit: 'Militia', lane: 'troop', count: 5,
  cost: {}, secondUnit: null,
}

// Raids screen needs an already-accepted augury to be reachable via marchToRaids.
const withRecruit = (recruit, { resources, workers } = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  ...(resources && { resources: { ...campaignFixture.resources, ...resources } }),
  ...(workers && { workers }),
  recruit,
})

// The state before the phase is opened: no offer exists yet.
const UNOPENED = { fervor: 0, boosted: false, hiredToday: false, drawn: false, options: [] }

// Walk to the Recruit screen. Entering it is what draws the offer, so the
// openRecruit response — not the initial campaign — carries the options.
const toRecruitScreen = async (drawnRecruit, opts) => {
  openRecruit.mockResolvedValue(withRecruit({ ...drawnRecruit, drawn: true }, opts))
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
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
})

describe('recruit panel — offer', () => {
  it('recruiting lives on its own screen after the raids, not before', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.queryByTestId('recruit-panel')).not.toBeInTheDocument()
    await marchToRaids()
    expect(screen.queryByTestId('recruit-panel')).not.toBeInTheDocument()

    openRecruit.mockResolvedValue(
      withRecruit({ ...UNOPENED, drawn: true, options: [MILITIA_OPTION] }),
    )
    fireEvent.click(await screen.findByTestId('to-recruit'))
    expect(await screen.findByTestId('recruit-panel')).toBeInTheDocument()
  })

  it('entering the phase is what draws the day\'s offer', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)

    await toRecruitScreen({ ...UNOPENED, options: [MILITIA_OPTION] })

    await waitFor(() => expect(openRecruit).toHaveBeenCalledWith('c1'))
    expect(await screen.findByTestId('recruit-card-militia')).toBeInTheDocument()
  })

  it('shows Fervor, the boosted flag, and each option\'s resolved count/cost', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen({ fervor: 12, boosted: true, hiredToday: false, options: [MILITIA_OPTION, MAGE_OPTION] })

    expect(await screen.findByTestId('recruit-fervor')).toHaveTextContent('Recruiting Fervor: 12')
    expect(screen.getByTestId('recruit-fervor')).toHaveTextContent('boosted')
    expect(screen.getByTestId('recruit-card-militia')).toHaveTextContent('20 Militia')
    expect(screen.getByTestId('recruit-cost-militia')).toHaveTextContent('40 food, 20 materials, 20 workers')
    expect(screen.getByTestId('recruit-card-mage')).toHaveTextContent('1 Mage')
    expect(screen.getByTestId('recruit-cost-mage')).toHaveTextContent('100 gold')
  })

  it('shows the caster boost\'s bonus second hire on the card', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen({
      fervor: 80, boosted: true, hiredToday: false,
      options: [{ ...MAGE_OPTION, cost: { gold: 100 }, secondUnit: 'Priest' }],
    })

    expect(await screen.findByTestId('recruit-card-mage')).toHaveTextContent('1 Mage + 1 Priest')
  })

  it('the free Travellers card is always hireable, whatever the stores hold', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen(
      { ...UNOPENED, options: [TRAVELLERS_OPTION] },
      { resources: { food: 0, materials: 0, gold: 0, horses: 0 } },
    )

    expect(await screen.findByTestId('recruit-hire-travellers')).toBeEnabled()
    expect(screen.getByTestId('recruit-cost-travellers')).toHaveTextContent(/free/i)
  })

  it('hiring an option posts {entryId} and refreshes the view', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    hireRecruit.mockResolvedValue(
      withRecruit({ fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] }),
    )
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen(
      { ...UNOPENED, options: [MILITIA_OPTION] },
      { resources: { materials: 100 } }, // fixture default materials is 0; Militia needs 20
    )

    fireEvent.click(await screen.findByTestId('recruit-hire-militia'))
    await waitFor(() => expect(hireRecruit).toHaveBeenCalledWith('c1', { entryId: 'militia' }))
    expect(await screen.findByTestId('recruit-done')).toBeInTheDocument()
    expect(screen.queryByTestId('recruit-card-militia')).not.toBeInTheDocument()
  })

  it('an unaffordable option is disabled with a reason', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen(
      { ...UNOPENED, options: [MAGE_OPTION] },
      { resources: { gold: 50 } }, // needs 100
    )

    const hireButton = await screen.findByTestId('recruit-hire-mage')
    expect(hireButton).toBeDisabled()
    expect(hireButton).toHaveAttribute('title', 'Not enough stores to hire this')
  })
})

// The hire is the only exit: opening the phase closed the camp server-side, so
// there is nothing to go back to, no way to decline, and no marching off
// without having recruited.
describe('recruit panel — the hire is the only way forward', () => {
  it('offers no way to skip the day\'s hire', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen({ ...UNOPENED, options: [MILITIA_OPTION, TRAVELLERS_OPTION] })

    await screen.findByTestId('recruit-card-militia')
    expect(screen.queryByTestId('recruit-skip')).not.toBeInTheDocument()
  })

  it('offers no way back to the raids — the camp is closed for the day', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen({ ...UNOPENED, options: [MILITIA_OPTION, TRAVELLERS_OPTION] })

    await screen.findByTestId('recruit-card-militia')
    expect(screen.queryByTestId('back-to-raids')).not.toBeInTheDocument()
  })

  it('locks Deploy until the hire is resolved, then releases it', async () => {
    getCampaigns.mockResolvedValue([withRecruit(UNOPENED)])
    hireRecruit.mockResolvedValue(
      withRecruit({ fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] }),
    )
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen(
      { ...UNOPENED, options: [MILITIA_OPTION] },
      { resources: { materials: 100 } },
    )

    expect(await screen.findByTestId('to-deploy')).toBeDisabled()
    fireEvent.click(screen.getByTestId('recruit-hire-militia'))
    await waitFor(() => expect(screen.getByTestId('to-deploy')).toBeEnabled())
  })

  // A mid-turn reload loses the client's screen state, but not the TURN's: the
  // phase is server state (campaign.phase), so the view itself says which
  // screen is owed. Every earlier screen would 409 anyway — the server closed
  // them when the turn marched past.
  it('a reload mid-turn lands on the phase the server says the turn is in', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...withRecruit({ fervor: 0, boosted: false, hiredToday: false, drawn: true, options: [MILITIA_OPTION] }),
        phase: 'recruit',
      },
    ])
    render(<App />)

    expect(await screen.findByTestId('recruit-panel')).toBeInTheDocument()
    expect(screen.queryByText(/War Council/)).not.toBeInTheDocument()
    expect(openRecruit).not.toHaveBeenCalled() // already drawn — re-opening would be a pointless round-trip
  })
})
