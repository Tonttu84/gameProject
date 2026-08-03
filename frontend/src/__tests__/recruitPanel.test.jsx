/**
 * Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops", S3):
 * a screen between Raids and Deploy showing up to 2 server-drawn hire options
 * a day. Cost/count are already resolved by campaignView against LIVE
 * resources (never stale) — this panel only submits the pick through
 * POST /:id/recruit/hire, either {entryId} (hire) or {skip: true} (decline).
 * Either way spends the day's one-hire cadence (hiredToday flips true,
 * options clear).
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
  hireRecruit: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, hireRecruit } from '../services/api'
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

// Raids screen needs an already-accepted augury to be reachable via marchToRaids.
const withRecruit = (recruit, { resources, workers } = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  ...(resources && { resources: { ...campaignFixture.resources, ...resources } }),
  ...(workers && { workers }),
  recruit,
})

const toRecruitScreen = async () => {
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
    getCampaigns.mockResolvedValue([
      withRecruit({ fervor: 0, boosted: false, hiredToday: false, options: [MILITIA_OPTION] }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.queryByTestId('recruit-panel')).not.toBeInTheDocument()
    await marchToRaids()
    expect(screen.queryByTestId('recruit-panel')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByTestId('to-recruit'))
    expect(await screen.findByTestId('recruit-panel')).toBeInTheDocument()
  })

  it('shows Fervor, the boosted flag, and each option\'s resolved count/cost', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit({ fervor: 12, boosted: true, hiredToday: false, options: [MILITIA_OPTION, MAGE_OPTION] }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    expect(screen.getByTestId('recruit-fervor')).toHaveTextContent('Recruiting Fervor: 12')
    expect(screen.getByTestId('recruit-fervor')).toHaveTextContent('boosted')
    expect(screen.getByTestId('recruit-card-militia')).toHaveTextContent('20 Militia')
    expect(screen.getByTestId('recruit-cost-militia')).toHaveTextContent('40 food, 20 materials, 20 workers')
    expect(screen.getByTestId('recruit-card-mage')).toHaveTextContent('1 Mage')
    expect(screen.getByTestId('recruit-cost-mage')).toHaveTextContent('100 gold')
  })

  it('shows the caster boost\'s bonus second hire on the card', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit({
        fervor: 80, boosted: true, hiredToday: false,
        options: [{ ...MAGE_OPTION, cost: { gold: 100 }, secondUnit: 'Priest' }],
      }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    expect(screen.getByTestId('recruit-card-mage')).toHaveTextContent('1 Mage + 1 Priest')
  })

  it('hiring an option posts {entryId} and refreshes the view', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit(
        { fervor: 0, boosted: false, hiredToday: false, options: [MILITIA_OPTION] },
        { resources: { materials: 100 } }, // fixture default materials is 0; Militia needs 20
      ),
    ])
    hireRecruit.mockResolvedValue(
      withRecruit({ fervor: 0, boosted: false, hiredToday: true, options: [] }),
    )
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    fireEvent.click(screen.getByTestId('recruit-hire-militia'))
    await waitFor(() => expect(hireRecruit).toHaveBeenCalledWith('c1', { entryId: 'militia' }))
    expect(await screen.findByTestId('recruit-done')).toBeInTheDocument()
    expect(screen.queryByTestId('recruit-card-militia')).not.toBeInTheDocument()
  })

  it('skipping posts {skip: true} and refreshes the view', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit({ fervor: 0, boosted: false, hiredToday: false, options: [MILITIA_OPTION] }, { resources: { materials: 100 } }),
    ])
    hireRecruit.mockResolvedValue(
      withRecruit({ fervor: 0, boosted: false, hiredToday: true, options: [] }),
    )
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    fireEvent.click(screen.getByTestId('recruit-skip'))
    await waitFor(() => expect(hireRecruit).toHaveBeenCalledWith('c1', { skip: true }))
    expect(await screen.findByTestId('recruit-done')).toBeInTheDocument()
  })

  it('an unaffordable option is disabled with a reason', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit(
        { fervor: 0, boosted: false, hiredToday: false, options: [MAGE_OPTION] },
        { resources: { gold: 50 } }, // needs 100
      ),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    const hireButton = screen.getByTestId('recruit-hire-mage')
    expect(hireButton).toBeDisabled()
    expect(hireButton).toHaveAttribute('title', 'Not enough stores to hire this')
  })

  it('hiredToday true shows nothing left to pick and no option cards', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit({ fervor: 0, boosted: false, hiredToday: true, options: [] }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    expect(screen.getByTestId('recruit-done')).toBeInTheDocument()
    expect(screen.queryByTestId('recruit-skip')).not.toBeInTheDocument()
  })

  it('nothing affordable today shows the empty state, not a blank panel', async () => {
    getCampaigns.mockResolvedValue([
      withRecruit({ fervor: 0, boosted: false, hiredToday: false, options: [] }),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await toRecruitScreen()

    expect(screen.getByTestId('recruit-empty')).toBeInTheDocument()
  })
})
