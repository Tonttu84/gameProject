/**
 * Squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE CATALOG"): what
 * prestige is for. A squad that reaches a rank with a slot free is dealt three
 * rows by the SERVER and keeps one, permanently.
 *
 * The draft is not the client's to make — the server draws it at newDay and
 * seals it on the document, so these tests are about what the screen shows,
 * what it posts, and that it cannot post anything the server did not offer.
 * The rules themselves live in campaign-server's squadUpgrades.test.js.
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
}))

import { getInfo, getMap, getCampaigns, openRecruit, takeSquadUpgrade } from '../services/api'
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

const OFFER = {
  rank: 'Blooded',
  options: [
    { id: 'deeper_ranks', name: 'Deeper Ranks', blurb: 'A fuller muster: +2 to every type.' },
    { id: 'standing_drafts', name: 'Standing Drafts', blurb: '+2 replacements may join each turn.' },
    { id: 'light_baggage', name: 'Light Baggage', blurb: 'Costs a quarter less raid capacity.' },
  ],
}

// A campaign whose 1st Cohort has ranked up and is holding a draft. Everything
// on the wire is server-resolved: the rows arrive with their names and blurbs,
// because the client keeps no copy of the catalog.
const withOffer = (overrides = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  recruit: { fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] },
  squads: campaignFixture.squads.map((s) =>
    s.id === 1
      ? {
          ...s,
          prestige: 10,
          rank: 'Blooded',
          upgrades: [],
          upgradeSlots: 1,
          upgradePicks: 1,
          banner: 'plain',
          upgradeOffer: OFFER,
        }
      : { ...s, upgrades: [], upgradeSlots: 0, upgradePicks: 0, banner: 'plain', upgradeOffer: null },
  ),
  ...overrides,
})

const noOffer = () => ({
  ...campaignFixture,
  augury: consultedAugury,
  recruit: { fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] },
  squads: campaignFixture.squads.map((s) => ({
    ...s, upgrades: [], upgradeSlots: 0, upgradePicks: 0, banner: 'plain', upgradeOffer: null,
  })),
})

const toRecruitScreen = async (campaign, { expectPanel = true } = {}) => {
  getCampaigns.mockResolvedValue([campaign])
  openRecruit.mockResolvedValue(campaign)
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
  // Reinforcement always renders on this screen; wait on it so an absent
  // upgrade panel is a real absence rather than a race.
  await screen.findByTestId('recruit-panel')
  if (expectPanel) await screen.findByTestId('upgrade-panel')
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

describe('squad upgrade panel', () => {
  it('shows nothing at all when no squad has honours or a draft', async () => {
    await toRecruitScreen(noOffer(), { expectPanel: false })
    expect(screen.queryByTestId('upgrade-panel')).toBeNull()
  })

  it('deals the server’s three rows, named and described', async () => {
    await toRecruitScreen(withOffer())

    const card = screen.getByTestId('upgrade-squad-1')
    expect(card).toHaveTextContent('1st Cohort')
    expect(card).toHaveTextContent('Blooded')
    for (const option of OFFER.options) {
      const row = screen.getByTestId(`upgrade-option-1-${option.id}`)
      expect(row).toHaveTextContent(option.name)
      // The blurb is display text off the wire — the client has no catalog to
      // render it from, so an empty one here would mean a broken contract.
      expect(row).toHaveTextContent(option.blurb)
    }
    expect(screen.getByTestId('upgrade-slots-1')).toHaveTextContent('1 of 1')
  })

  it('only the squad holding a draft is offered one', async () => {
    await toRecruitScreen(withOffer())
    expect(screen.getByTestId('upgrade-squad-1')).toBeInTheDocument()
    expect(screen.queryByTestId('upgrade-squad-2')).toBeNull()
    expect(screen.queryByTestId('upgrade-squad-3')).toBeNull()
  })

  // Permanence is the whole cost of an otherwise free upgrade, so the confirm
  // step is deliberate: nothing is posted until a row is actually chosen.
  it('refuses to submit until a row is chosen', async () => {
    await toRecruitScreen(withOffer())
    expect(screen.getByTestId('upgrade-submit-1')).toBeDisabled()
    fireEvent.click(screen.getByTestId('upgrade-submit-1'))
    expect(takeSquadUpgrade).not.toHaveBeenCalled()
  })

  it('posts the chosen row by id, and only that one', async () => {
    const after = {
      ...withOffer(),
      squads: withOffer().squads.map((s) =>
        s.id === 1
          ? {
              ...s,
              upgradePicks: 0,
              upgradeOffer: null,
              upgrades: [{ id: 'deeper_ranks', name: 'Deeper Ranks', blurb: 'A fuller muster: +2 to every type.' }],
              caps: { Soldier: 42, Pikeman: 12 },
            }
          : s,
      ),
    }
    takeSquadUpgrade.mockResolvedValue(after)
    await toRecruitScreen(withOffer())

    fireEvent.click(screen.getByTestId('upgrade-option-1-standing_drafts').querySelector('input'))
    fireEvent.click(screen.getByTestId('upgrade-submit-1'))

    await waitFor(() => expect(takeSquadUpgrade).toHaveBeenCalledTimes(1))
    // The id, never the resolved row: the server re-looks it up against the
    // offer it sealed.
    expect(takeSquadUpgrade).toHaveBeenCalledWith(campaignFixture.id, 1, 'standing_drafts')
  })

  it('once taken, the draft is gone and the honour is listed', async () => {
    const taken = {
      id: 'deeper_ranks', name: 'Deeper Ranks', blurb: 'A fuller muster: +2 to every type.',
    }
    const after = {
      ...withOffer(),
      squads: withOffer().squads.map((s) =>
        s.id === 1 ? { ...s, upgradePicks: 0, upgradeOffer: null, upgrades: [taken] } : s,
      ),
    }
    takeSquadUpgrade.mockResolvedValue(after)
    await toRecruitScreen(withOffer())

    fireEvent.click(screen.getByTestId('upgrade-option-1-deeper_ranks').querySelector('input'))
    fireEvent.click(screen.getByTestId('upgrade-submit-1'))

    await waitFor(() => expect(screen.queryByTestId('upgrade-squad-1')).toBeNull())
    expect(screen.getByTestId('upgrade-held-1-deeper_ranks')).toHaveTextContent('Deeper Ranks')
  })

  // A row may cost more than one honour (4d: the Royal Guard costs two, the
  // second borrowed from the next rank). The card has to SAY so — permanence is
  // the whole cost of an upgrade, so spending a future draft unknowingly is the
  // one thing this panel exists to prevent.
  it('marks a row that costs more than one honour', async () => {
    const dear = { id: 'royal_guard', name: 'Royal Guard', blurb: 'Halberds, and no ordinary soldier again.', slots: 2 }
    const campaign = withOffer()
    campaign.squads = campaign.squads.map((s) =>
      s.id === 1 ? { ...s, upgradeOffer: { rank: 'Blooded', options: [...OFFER.options, dear] } } : s,
    )
    await toRecruitScreen(campaign)

    expect(screen.getByTestId('upgrade-option-cost-1-royal_guard')).toHaveTextContent('Costs 2 honours')
    // A one-slot row says nothing — the note is a warning, not a price tag on
    // every card.
    expect(screen.queryByTestId('upgrade-option-cost-1-deeper_ranks')).toBeNull()
  })

  // The banner is granted free at Seasoned and carries NO bonus — decision 16
  // is deferred on purpose. The screen must say what it is and promise nothing.
  it('names the banner without promising a bonus, and opens the slot', async () => {
    const seasoned = {
      ...noOffer(),
      squads: noOffer().squads.map((s) =>
        s.id === 1 ? { ...s, prestige: 25, rank: 'Seasoned', banner: 'basic' } : s,
      ),
    }
    await toRecruitScreen(seasoned)
    expect(screen.getByTestId('upgrade-banner-1')).toHaveTextContent('Carries its own banner.')
  })
})
