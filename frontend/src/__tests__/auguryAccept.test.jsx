/**
 * Fates come to pass at the tent (the Omens phase screen): after consulting
 * (rerolled or not) the exit is "Accept the Fates" — it posts /augury/accept,
 * the fates reveal plays immediately (while the player still remembers why they
 * rerolled), and Continue leads on to the Raids screen (events before raiders).
 * A counter-raid-targeted fate arrives with `deferred: true` and says the
 * raiders may yet unmake it.
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
  spendCampaign: vi.fn(),
  postCampaignBattle: vi.fn(),
  postCampaignRaids: vi.fn(),
  endCampaignDay: vi.fn(),
  postCampaignChoice: vi.fn(),
  postAcceptFates: vi.fn(),
}))

import {
  getInfo,
  getMap,
  getCampaigns,
  consultCampaignAugury,
  postAcceptFates,
} from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

const unaccepted = { ...consultedAugury, accepted: false }

const fatesReport = {
  day: 1,
  entries: ['Came to pass: Supply Cache.', 'Food +3 t.'],
  augury: [
    {
      predicted: { id: 'supply', title: 'Supply Cache' },
      actual: { id: 'supply', title: 'Supply Cache', description: 'An abandoned depot.' },
      wasAccurate: true,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('accepting the fates at the tent', () => {
  it('a fresh consult ends in Accept the Fates, which plays the reveal and leads on to the raids', async () => {
    getCampaigns.mockResolvedValue([campaignFixture]) // unconsulted
    consultCampaignAugury.mockResolvedValue({ ...campaignFixture, augury: unaccepted })
    postAcceptFates.mockResolvedValue({
      report: fatesReport,
      campaign: { ...campaignFixture, augury: { ...consultedAugury, accepted: true } },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    fireEvent.click(await screen.findByTestId('consult-augur'))

    // The tent's exit is acceptance now, not a straight march to battle.
    const acceptButton = await screen.findByTestId('accept-fates')
    expect(screen.queryByTestId('augury-continue')).not.toBeInTheDocument()

    fireEvent.click(acceptButton)
    await waitFor(() => expect(postAcceptFates).toHaveBeenCalledWith('c1'))

    // The fates reveal plays immediately — prophecy against what came to pass.
    const fate = await screen.findByTestId('reveal-beat-fate-0')
    expect(fate).toHaveTextContent('Supply Cache')
    expect(fate).toHaveTextContent('The augur spoke true.')

    fireEvent.click(screen.getByTestId('reveal-next')) // summary
    fireEvent.click(screen.getByTestId('report-continue'))
    // Fates sealed: the reveal leads on to the raids (events before raiders).
    await screen.findByText('Targets of Opportunity')
    expect(screen.getByTestId('to-recruit')).toBeInTheDocument()
  })

  it('a reloaded consulted-but-unaccepted campaign offers acceptance at the tent', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: unaccepted }])
    postAcceptFates.mockResolvedValue({
      report: fatesReport,
      campaign: { ...campaignFixture, augury: { ...consultedAugury, accepted: true } },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    // No silent march past unsealed fates: the tent shows Accept the Fates
    // (not a continue), and it must be resolved before the raids.
    fireEvent.click(screen.getByTestId('to-omens'))
    expect(screen.queryByTestId('augury-continue')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('accept-fates'))
    await waitFor(() => expect(postAcceptFates).toHaveBeenCalledWith('c1'))
    await screen.findByTestId('reveal-beat-fate-0')
  })

  it('a deferred fate shows only the pending threat — no verdict at the tent', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: unaccepted }])
    postAcceptFates.mockResolvedValue({
      report: {
        day: 1,
        entries: [],
        // The deferred card the server now sends: prophecy + the deferred flag
        // only — no `actual`, no verdict, no scouts line (those wait for
        // end-day, after the raid that may unmake it).
        augury: [{ predicted: { id: 'ambush', title: 'Ambush Foreseen' }, deferred: true }],
      },
      campaign: { ...campaignFixture, augury: { ...consultedAugury, accepted: true } },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    fireEvent.click(await screen.findByTestId('accept-fates'))
    const fate = await screen.findByTestId('reveal-beat-fate-0')
    expect(fate).toContainElement(screen.getByTestId('fate-deferred'))
    // A pending threat carries no resolution at the tent.
    expect(fate).not.toHaveTextContent(/What came to pass/i)
    expect(screen.queryByTestId('scout-intervened')).not.toBeInTheDocument()
  })
})
