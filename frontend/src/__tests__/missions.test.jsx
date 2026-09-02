/**
 * Missions, client side (docs/CAMPAIGN_PLAN.md "DECISION 12 — MISSIONS").
 *
 * A mission fate asks for a charter as well as a branch: the card offers TWO
 * (12-1), shows a LOCKED near-miss when only one qualifies, and the option that
 * spends a charter stays disabled until one is picked. Away, the charter says so
 * on both squad screens and vanishes from the raid board.
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
  spendCampaign: vi.fn(),
  postCampaignBattle: vi.fn(),
  postCampaignRaids: vi.fn(),
  endCampaignDay: vi.fn(),
  postCampaignChoice: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, postCampaignChoice } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}
const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

const OPTIONS = [
  {
    id: 'hold_the_ford',
    label: 'Send a charter to hold the ford',
    description: 'They will be gone a good while.',
    effectText: ['A charter marches out for 3 turns — +12 prestige when it returns'],
  },
  {
    id: 'leave_it_unwatched',
    label: 'Leave the fords unwatched',
    description: 'Every man stays where you can use him.',
    effectText: ['No consequence'],
  },
]

const pending = (missionOffer) => ({
  slot: 0,
  title: 'The Ford Must Be Held',
  description: 'Riders bring word that the enemy has been probing the fords.',
  options: OPTIONS,
  missionOffer,
})

const TWO_FREE = {
  picks: [
    { id: 1, name: '1st Cohort', rank: 'Blooded' },
    { id: 2, name: 'Skirmishers', rank: 'Untested' },
  ],
  locked: null,
}

const ONE_FREE = {
  picks: [{ id: 1, name: '1st Cohort', rank: 'Blooded' }],
  locked: { id: 3, name: 'Vanguard Riders', blocker: 'mission' },
}

const openWithOffer = async (missionOffer) => {
  getCampaigns.mockResolvedValue([
    { ...campaignFixture, day: 2, pendingChoices: [pending(missionOffer)] },
  ])
  render(<App />)
  return screen.findByTestId('reveal-beat-choice-0')
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('the charter picker (12-1)', () => {
  it('offers two charters, named and ranked', async () => {
    await openWithOffer(TWO_FREE)
    expect(screen.getByTestId('mission-pick-1')).toHaveTextContent('1st Cohort')
    expect(screen.getByTestId('mission-pick-1')).toHaveTextContent('Blooded')
    expect(screen.getByTestId('mission-pick-2')).toHaveTextContent('Skirmishers')
  })

  it('shows the LOCKED near-miss, named, with why it cannot go', async () => {
    // The lock is what teaches the mechanic — a blank slot would teach nothing,
    // and 12-2 fixes the word: a charter is "on a mission", never "tied up".
    await openWithOffer(ONE_FREE)
    const locked = screen.getByTestId('mission-locked-3')
    expect(locked).toHaveTextContent('Vanguard Riders')
    expect(locked).toHaveTextContent(/already on a mission/i)
    expect(locked.tagName).not.toBe('BUTTON')
  })

  it('holds the mission branch back until a charter is picked', async () => {
    // The server refuses a mission pick that names nobody, so an enabled button
    // here could only buy a 400.
    await openWithOffer(TWO_FREE)
    expect(screen.getByTestId('choice-hold_the_ford')).toBeDisabled()
    // The refusal branch spends no charter and is live from the start.
    expect(screen.getByTestId('choice-leave_it_unwatched')).toBeEnabled()

    fireEvent.click(screen.getByTestId('mission-pick-2'))
    expect(screen.getByTestId('choice-hold_the_ford')).toBeEnabled()
  })

  it('sends the charter the player picked', async () => {
    postCampaignChoice.mockResolvedValue({
      campaign: { ...campaignFixture, day: 2, pendingChoices: [] },
      resolved: { slot: 0, choice: 'hold_the_ford', label: 'Send a charter to hold the ford' },
    })
    await openWithOffer(TWO_FREE)

    fireEvent.click(screen.getByTestId('mission-pick-2'))
    fireEvent.click(screen.getByTestId('choice-hold_the_ford'))
    await waitFor(() =>
      // The fifth argument is the COMPANY a charter fate enrols (R1); null on
      // a mission fate, and on every other fate that asks for no company.
      expect(postCampaignChoice).toHaveBeenCalledWith('c1', 0, 'hold_the_ford', 2, null))
  })

  it('lets the player change their mind before committing', async () => {
    postCampaignChoice.mockResolvedValue({
      campaign: { ...campaignFixture, day: 2, pendingChoices: [] },
      resolved: { slot: 0, choice: 'hold_the_ford', label: 'Send a charter' },
    })
    await openWithOffer(TWO_FREE)

    fireEvent.click(screen.getByTestId('mission-pick-1'))
    fireEvent.click(screen.getByTestId('mission-pick-2'))
    expect(screen.getByTestId('mission-pick-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mission-pick-1')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByTestId('choice-hold_the_ford'))
    await waitFor(() =>
      // The fifth argument is the COMPANY a charter fate enrols (R1); null on
      // a mission fate, and on every other fate that asks for no company.
      expect(postCampaignChoice).toHaveBeenCalledWith('c1', 0, 'hold_the_ford', 2, null))
  })

  it('shows no picker at all on a fate that asks for no charter', async () => {
    // Which is most of them: the picker is driven by the server's offer, so an
    // ordinary choice-fate is untouched by any of this.
    await openWithOffer(null)
    expect(screen.queryByTestId('mission-picker')).not.toBeInTheDocument()
    expect(screen.getByTestId('choice-leave_it_unwatched')).toBeEnabled()
  })
})

describe('a charter that is away', () => {
  const withMission = (squads) => ({
    ...campaignFixture,
    squads: squads ?? campaignFixture.squads,
  })

  const openArmy = async (campaign) => {
    getCampaigns.mockResolvedValue([campaign])
    render(<App />)
    await screen.findByText(/War Council/)
    fireEvent.click(await screen.findByTestId('hud-army'))
    return screen.findByTestId('squad-roll')
  }

  it('says so on the roll, with the day it is back (13-11\'s third state)', async () => {
    const squads = campaignFixture.squads.map((s, i) =>
      (i === 0 ? { ...s, mission: { untilDay: 9 } } : s))
    await openArmy(withMission(squads))
    expect(screen.getByTestId(`roll-availability-${squads[0].id}`))
      .toHaveTextContent('On a mission until day 9')
    // The others still read as they did.
    expect(screen.getByTestId(`roll-availability-${squads[1].id}`))
      .toHaveTextContent('In camp, ready')
  })

  it('says so on its charter page, and what it costs you', async () => {
    const squads = campaignFixture.squads.map((s, i) =>
      (i === 0 ? { ...s, mission: { untilDay: 9 } } : s))
    await openArmy(withMission(squads))
    fireEvent.click(screen.getByTestId(`roll-open-${squads[0].id}`))
    const line = await screen.findByTestId(`charter-availability-${squads[0].id}`)
    expect(line).toHaveTextContent('back on day 9')
    expect(line).toHaveTextContent(/will not raid or stand in the line/i)
  })
})
