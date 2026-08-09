/**
 * Campaign flow against the (mocked) server-side campaign API: start a
 * campaign, consult the augur, walk the turn's screens, end the turn. All state
 * transitions come from the campaign views the API returns — the component
 * never computes campaign state itself.
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
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import {
  getInfo,
  getMap,
  getCampaigns,
  createCampaign,
  consultCampaignAugury,
  rerollCampaignAugury,
  endCampaignDay,
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

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('campaign flow', () => {
  it('with no campaign, Start Campaign creates one and lands on the council', async () => {
    getCampaigns.mockResolvedValue([])
    createCampaign.mockResolvedValue(campaignFixture)
    render(<App />)

    fireEvent.click(await screen.findByTestId('start-campaign'))

    // A fresh campaign opens on the one-time scene-setter; take command to enter.
    fireEvent.click(await screen.findByTestId('take-command'))

    await screen.findByText(/Turn 1 — War Council/)
    expect(createCampaign).toHaveBeenCalled()
  })

  it("consulting shows all three visions, each with the server's odds", async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    consultCampaignAugury.mockResolvedValue({ ...campaignFixture, augury: consultedAugury })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    fireEvent.click(await screen.findByTestId('consult-augur'))

    const first = await screen.findByTestId('augury-vision-0')
    expect(consultCampaignAugury).toHaveBeenCalledWith('c1')
    expect(first).toHaveTextContent('Supply Cache')
    // The header names the SHOWN card's mood × magnitude: a good minor fate,
    // a bad one, a bad major one — severity alone no longer implies good/bad.
    expect(first).toHaveTextContent('A kind omen')
    expect(screen.getByTestId('augury-vision-1')).toHaveTextContent('Harsh Weather')
    expect(screen.getByTestId('augury-vision-1')).toHaveTextContent('A troubling omen')
    expect(screen.getByTestId('augury-vision-2')).toHaveTextContent('Plague')
    expect(screen.getByTestId('augury-vision-2')).toHaveTextContent('A dire omen')
    // The odds ARE the minigame (user, 2026-07-05): each card states the
    // server's roll target verbatim — a 30% dire omen is probably noise, a
    // 90% one is all but certain.
    expect(screen.getByTestId('augury-odds-0')).toHaveTextContent('75% true')
    expect(screen.getByTestId('augury-odds-1')).toHaveTextContent('30% true')
    expect(screen.getByTestId('augury-odds-2')).toHaveTextContent('90% true')
    // When the server reveals a slot's truth (reroll resolved, or the debug
    // flag), the card says whether the vision held and what really comes.
    expect(screen.getByTestId('augury-truth-0')).toHaveTextContent('The vision holds true.')
    expect(screen.getByTestId('augury-truth-1')).toHaveTextContent('In truth: Desertion')
    // Slot 2's truth is not revealed in this fixture — no truth line.
    expect(screen.queryByTestId('augury-truth-2')).not.toBeInTheDocument()

    // Accepting (the fixture is already accepted) leaves the tent for the
    // raids, and on through Recruiting to the turn's last screen.
    fireEvent.click(screen.getByTestId('augury-continue'))
    fireEvent.click(await screen.findByTestId('to-recruit'))
    expect(await screen.findByTestId('to-deploy')).toBeInTheDocument()
  })

  it('clicking a vision rerolls that slot only and spends the reroll', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    consultCampaignAugury.mockResolvedValue({ ...campaignFixture, augury: consultedAugury })
    rerollCampaignAugury.mockResolvedValue({
      ...campaignFixture,
      augury: {
        consulted: true,
        rerollsRemaining: 0,
        visions: [
          consultedAugury.visions[0],
          { id: 'traders', title: 'Traveling Traders', description: 'Merchants sell supplies.', severity: 1, valence: 'good' },
          consultedAugury.visions[2],
        ],
      },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    fireEvent.click(await screen.findByTestId('consult-augur'))
    await screen.findByText('Harsh Weather') // slot 1's first vision
    fireEvent.click(screen.getByTestId('augury-vision-1'))

    // That fate is replaced, not re-read: a wholly different omen in slot 1,
    // the neighbours untouched.
    await screen.findByText('Traveling Traders')
    expect(screen.queryByText('Harsh Weather')).not.toBeInTheDocument()
    expect(screen.getByTestId('augury-vision-0')).toHaveTextContent('Supply Cache')
    expect(rerollCampaignAugury).toHaveBeenCalledWith('c1', 1)
    // The single reroll is spent: fate is sealed, the cards no longer act.
    expect(screen.getByTestId('augury-vision-1')).toBeDisabled()
    fireEvent.click(screen.getByTestId('augury-vision-0'))
    expect(rerollCampaignAugury).toHaveBeenCalledTimes(1)
  })

  it('an already-consulted campaign skips the consult at the tent', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    // Already consulted + accepted: no consult button — straight on to the raids.
    // Each step is a server round trip now, so wait for the tent to render.
    fireEvent.click(await screen.findByTestId('augury-continue'))
    expect(screen.queryByTestId('consult-augur')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('to-recruit'))
    // Recruiting is the last screen of a quiet turn — its exit ends the turn
    // rather than opening deployment (no battle is on offer).
    expect(await screen.findByTestId('to-deploy')).toHaveTextContent('End the Turn')
  })

  it('a finished (won) campaign shows the victory screen and a new-campaign button', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, status: 'won', day: 9 }])
    render(<App />)

    await screen.findByText('Victory!')
    expect(screen.getByTestId('start-campaign')).toHaveTextContent('New Campaign')
  })

  it('End Turn shows the fortnight report with the augury reveal, then the next council', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
    endCampaignDay.mockResolvedValue({
      report: {
        day: 1,
        entries: ['Came to pass: Supply Cache.'],
        upkeep: { foodConsumed: 12432, deserters: 0 },
        augury: [
          {
            predicted: { id: 'plague', title: 'Plague' },
            actual: { id: 'supply', title: 'Supply Cache', description: 'An abandoned depot.' },
            wasAccurate: false,
          },
          {
            predicted: { id: 'quiet', title: 'Quiet Fortnight' },
            actual: { id: 'quiet', title: 'Quiet Fortnight', description: 'Nothing stirs.' },
            wasAccurate: true,
          },
        ],
      },
      campaign: {
        ...campaignFixture,
        day: 2,
        resources: { food: 37568, materials: 0, foodNeedPerTurn: 12432 },
      },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    // A quiet turn ends from Recruiting itself (the deployment screen only
    // opens on the pitched-battle day).
    await marchToRecruit()
    fireEvent.click(await screen.findByTestId('to-deploy'))

    // The reveal deals one card per click: the first fate is on the table
    // (the augur foretold Plague but Supply Cache came instead), the second
    // (read true) only after a click, then upkeep, then the summary.
    const fate0 = await screen.findByTestId('reveal-beat-fate-0')
    expect(fate0).toHaveTextContent('Plague')
    expect(fate0).toHaveTextContent('Supply Cache')
    expect(fate0).toHaveTextContent('The augur was wrong.')
    expect(screen.queryByTestId('reveal-beat-fate-1')).not.toBeInTheDocument()
    await waitFor(() => expect(endCampaignDay).toHaveBeenCalledWith('c1'))

    fireEvent.click(screen.getByTestId('reveal-next'))
    expect(screen.getByTestId('reveal-beat-fate-1')).toHaveTextContent('The augur spoke true.')
    fireEvent.click(screen.getByTestId('reveal-next')) // upkeep
    fireEvent.click(screen.getByTestId('reveal-next')) // summary

    fireEvent.click(screen.getByTestId('report-continue'))
    await screen.findByText(/Turn 2 — War Council/)
  })

  it('a 404 on a campaign action (stale save wiped by a new build) recovers to the start screen', async () => {
    // First load still sees the old campaign; after the 404 the reload
    // returns nothing (the server purged it).
    getCampaigns.mockResolvedValueOnce([campaignFixture]).mockResolvedValue([])
    consultCampaignAugury.mockRejectedValue({
      response: { status: 404, data: { error: 'campaign not found' } },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('to-omens'))
    fireEvent.click(await screen.findByTestId('consult-augur'))

    // No zombie UI: the app reloads campaigns and offers a fresh start.
    await screen.findByText('No Campaign In Progress')
    expect(screen.getByTestId('auth-notice')).toHaveTextContent(/new build wiped old saves/)
    expect(getCampaigns).toHaveBeenCalledTimes(2)
  })

  it('tutorial intros render when enabled and hide when toggled off', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('tutorial-council')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tutorial-toggle'))
    expect(screen.queryByTestId('tutorial-council')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('tutorialEnabled')).toBe('off')
  })
})
