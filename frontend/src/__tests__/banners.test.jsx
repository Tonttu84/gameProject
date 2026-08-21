/**
 * Banners and the item store (docs/CAMPAIGN_PLAN.md, SLICE 6).
 *
 * The flow the interview settled (6-14): a Seasoned squad shows a BANNER SLOT;
 * clicking it opens the store filtered to what the slot accepts; choosing one
 * raises a confirmation naming the permanence; only then does the bind post.
 *
 * The SLOT declares what it accepts and the store filters to that — so these
 * tests are as much about the store showing nothing it should not as about the
 * happy path. The rules themselves live in campaign-server's items.test.js.
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
  hireRecruit: vi.fn(),
  openRecruit: vi.fn(),
  takeSquadUpgrade: vi.fn(),
  bindSquadBanner: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, openRecruit, bindSquadBanner } from '../services/api'
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

const BANNER = {
  id: 'banner_unbroken_line',
  kind: 'banner',
  name: 'The Unbroken Line',
  blurb: 'While it flies over them, the squad does not break.',
  target: 'squad',
}

// A helm nobody can put on a banner slot — the store must not offer it.
const HELM = { id: 'helm_of_ash', kind: 'helm', name: 'Helm of Ash', blurb: 'A grim thing.', target: 'character' }

const atRecruit = (over = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  recruit: { fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] },
  items: [],
  squads: campaignFixture.squads.map((s) => ({
    ...s,
    upgrades: [],
    upgradeSlots: 0,
    upgradePicks: 0,
    banner: 'plain',
    bannerItem: null,
    upgradeOffer: null,
  })),
  ...over,
})

// A campaign whose 1st Cohort has reached the rung that grants the basic
// banner and opens the slot.
const seasoned = (over = {}) => {
  const base = atRecruit(over)
  return {
    ...base,
    squads: base.squads.map((s) =>
      s.id === 1 ? { ...s, prestige: 25, rank: 'Seasoned', banner: 'basic' } : s,
    ),
  }
}

const toRecruitScreen = async (campaign) => {
  getCampaigns.mockResolvedValue([campaign])
  openRecruit.mockResolvedValue(campaign)
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
  await screen.findByTestId('recruit-panel')
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

describe('the banner slot', () => {
  it('is not offered to a squad that has not reached the rung', async () => {
    await toRecruitScreen(atRecruit())
    expect(screen.queryByTestId('banner-slot-1')).toBeNull()
  })

  it('opens at Seasoned, beside the basic banner it comes with', async () => {
    await toRecruitScreen(seasoned())
    expect(screen.getByTestId('upgrade-banner-1')).toHaveTextContent('Carries its own banner.')
    expect(screen.getByTestId('banner-slot-1')).toBeInTheDocument()
  })

  it('shows a bound relic in place of the basic banner, with no slot left', async () => {
    // The item tier REPLACES the basic banner rather than stacking, so the row
    // must not read as a squad carrying two.
    const bound = seasoned({ items: [] })
    bound.squads = bound.squads.map((s) =>
      s.id === 1 ? { ...s, banner: 'item', bannerItem: BANNER } : s,
    )
    await toRecruitScreen(bound)
    expect(screen.getByTestId('upgrade-banner-1')).toHaveTextContent(BANNER.name)
    expect(screen.getByTestId('upgrade-banner-1')).not.toHaveTextContent('Carries its own banner.')
    expect(screen.queryByTestId('banner-slot-1')).toBeNull()
  })
})

describe('the store, opened from a slot', () => {
  it('takes over the screen and shows what the slot accepts', async () => {
    await toRecruitScreen(seasoned({ items: [BANNER, HELM] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))

    const store = await screen.findByTestId('item-store')
    expect(store).toHaveTextContent('1st Cohort')
    expect(screen.getByTestId(`store-item-${BANNER.id}`)).toBeInTheDocument()
    // The slot declares what it accepts; the store filters to that.
    expect(screen.queryByTestId(`store-item-${HELM.id}`)).toBeNull()
    // It really is a takeover — the recruit screen is gone underneath.
    expect(screen.queryByTestId('recruit-panel')).toBeNull()
  })

  it('says so plainly when the stores hold nothing that would serve', async () => {
    await toRecruitScreen(seasoned({ items: [HELM] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))
    expect(await screen.findByTestId('item-store-empty')).toBeInTheDocument()
  })

  it('Back returns to the phase underneath, having posted nothing', async () => {
    await toRecruitScreen(seasoned({ items: [BANNER] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))
    fireEvent.click(await screen.findByTestId('item-store-back'))
    await screen.findByTestId('recruit-panel')
    expect(bindSquadBanner).not.toHaveBeenCalled()
  })
})

describe('binding', () => {
  it('names the permanence before it will post', async () => {
    // The step exists because there is no undo endpoint to pair with it.
    await toRecruitScreen(seasoned({ items: [BANNER] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))
    fireEvent.click(await screen.findByTestId(`store-choose-${BANNER.id}`))

    expect(screen.getByTestId(`store-warn-${BANNER.id}`)).toHaveTextContent(/cannot be taken back/i)
    expect(bindSquadBanner).not.toHaveBeenCalled()
  })

  it('posts the id the server offered, to the squad whose slot was clicked', async () => {
    const after = seasoned({ items: [] })
    after.squads = after.squads.map((s) =>
      s.id === 1 ? { ...s, banner: 'item', bannerItem: BANNER } : s,
    )
    bindSquadBanner.mockResolvedValue(after)

    await toRecruitScreen(seasoned({ items: [BANNER] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))
    fireEvent.click(await screen.findByTestId(`store-choose-${BANNER.id}`))
    fireEvent.click(screen.getByTestId(`store-confirm-${BANNER.id}`))

    await waitFor(() => expect(bindSquadBanner).toHaveBeenCalledWith('c1', 1, BANNER.id))
    // And the store closes on success, back to the phase underneath.
    await screen.findByTestId('recruit-panel')
  })

  it('backing out of the confirmation posts nothing', async () => {
    await toRecruitScreen(seasoned({ items: [BANNER] }))
    fireEvent.click(screen.getByTestId('banner-slot-1'))
    fireEvent.click(await screen.findByTestId(`store-choose-${BANNER.id}`))
    fireEvent.click(screen.getByTestId(`store-cancel-${BANNER.id}`))

    expect(screen.queryByTestId(`store-warn-${BANNER.id}`)).toBeNull()
    expect(bindSquadBanner).not.toHaveBeenCalled()
  })
})
