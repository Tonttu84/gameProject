/**
 * Events with choices (resolve-then-choose), client side. A fired choice-fate
 * arrives in the day report as `slot.pendingChoice.options` (cards only — the
 * branch effects live server-side): the reveal screen swaps that fate's
 * advance control for option buttons, posts the pick, shows the chosen label,
 * and only then lets the reveal continue. A reload while a decision is owed
 * finds `campaign.pendingChoices` on the view and reopens the choice cards
 * directly — the server 409s everything else anyway.
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
  setCampaignEffort: vi.fn(),
  spendCampaign: vi.fn(),
  postCampaignBattle: vi.fn(),
  postCampaignRaids: vi.fn(),
  endCampaignDay: vi.fn(),
  postCampaignChoice: vi.fn(),
}))

import {
  getInfo,
  getMap,
  getCampaigns,
  endCampaignDay,
  postCampaignChoice,
} from '../services/api'
import App from '../App'
import { marchToRecruit } from './helpers/nav'
import { campaignFixture, consultedAugury } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

const OPTIONS = [
  { id: 'turn_away', label: 'Turn them away', description: 'They trudge on; the stores stay whole.' },
  { id: 'take_in', label: 'Take them in — more mouths, more hands', description: 'Feeding them costs stores; the able-bodied muster as militia.' },
]

const pendingChoiceView = {
  slot: 0,
  title: 'Refugees at the Palisade',
  description: 'A column of burned-out villagers begs shelter at the camp gates.',
  options: OPTIONS,
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('a choice-fate in the day report', () => {
  const endDayWithChoice = async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
    endCampaignDay.mockResolvedValue({
      report: {
        day: 1,
        entries: ['Came to pass: Refugees at the Palisade — a decision awaits you.'],
        augury: [
          {
            predicted: { id: 'refugees', title: 'Refugees at the Palisade' },
            actual: {
              id: 'refugees',
              title: 'Refugees at the Palisade',
              description: 'A column of burned-out villagers begs shelter at the camp gates.',
            },
            wasAccurate: true,
            pendingChoice: { options: OPTIONS },
          },
        ],
      },
      campaign: { ...campaignFixture, day: 2, pendingChoices: [pendingChoiceView] },
    })
    render(<App />)
    await screen.findByText(/War Council/)
    // A quiet turn ends from Recruiting (its exit IS end-day; the deployment
    // screen only opens on the pitched-battle day).
    await marchToRecruit()
    fireEvent.click(await screen.findByTestId('to-deploy'))
    await screen.findByTestId('reveal-beat-fate-0')
  }

  it('shows the option cards and blocks the reveal until the player chooses', async () => {
    await endDayWithChoice()

    expect(screen.getByTestId('choice-turn_away')).toHaveTextContent('Turn them away')
    expect(screen.getByTestId('choice-take_in')).toHaveTextContent('more mouths, more hands')
    // The fortnight can't move on around an unmade decision.
    expect(screen.getByTestId('reveal-next')).toBeDisabled()
  })

  it('posts the pick, shows the outcome, and lets the reveal continue', async () => {
    postCampaignChoice.mockResolvedValue({
      campaign: { ...campaignFixture, day: 2, pendingChoices: [] },
      resolved: { slot: 0, choice: 'take_in', label: 'Take them in — more mouths, more hands' },
    })
    await endDayWithChoice()

    fireEvent.click(screen.getByTestId('choice-take_in'))
    // Fourth argument: the charter a mission fate spends (decision 12),
    // undefined on a fate that asks for none.
    await waitFor(() => expect(postCampaignChoice).toHaveBeenCalledWith('c1', 0, 'take_in', null))

    // The chosen branch is on record; the buttons are gone, the reveal moves.
    const outcome = await screen.findByTestId('choice-outcome-0')
    expect(outcome).toHaveTextContent('Take them in')
    expect(screen.queryByTestId('choice-turn_away')).not.toBeInTheDocument()
    expect(screen.getByTestId('reveal-next')).toBeEnabled()

    fireEvent.click(screen.getByTestId('reveal-next')) // summary
    fireEvent.click(screen.getByTestId('report-continue'))
    await screen.findByText(/Turn 2 — War Council/)
  })
})

describe('reload with a decision owed', () => {
  it('reopens the choice cards straight from the view and returns to the council once resolved', async () => {
    getCampaigns.mockResolvedValue([
      { ...campaignFixture, day: 2, pendingChoices: [pendingChoiceView] },
    ])
    postCampaignChoice.mockResolvedValue({
      campaign: { ...campaignFixture, day: 2, pendingChoices: [] },
      resolved: { slot: 0, choice: 'turn_away', label: 'Turn them away' },
    })
    render(<App />)

    // No report survives a reload — the owed decision alone brings the cards up.
    const card = await screen.findByTestId('reveal-beat-choice-0')
    expect(card).toHaveTextContent('Refugees at the Palisade')

    fireEvent.click(screen.getByTestId('choice-turn_away'))
    await waitFor(() => expect(postCampaignChoice).toHaveBeenCalledWith('c1', 0, 'turn_away', null))

    // Nothing pending anymore: the overlay yields back to the council.
    await screen.findByText(/Turn 2 — War Council/)
  })
})
