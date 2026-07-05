/**
 * Campaign flow against the (mocked) server-side campaign API: start a
 * campaign, consult the augur, reach deployment, end the day. All state
 * transitions come from the campaign views the API returns — the component
 * never computes campaign state itself.
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

    await screen.findByText(/Turn 1 — War Council/)
    expect(createCampaign).toHaveBeenCalled()
  })

  it('consulting shows all three visions — and never any odds', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    consultCampaignAugury.mockResolvedValue({ ...campaignFixture, augury: consultedAugury })
    const { container } = render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByText('Visit the Augur'))
    fireEvent.click(await screen.findByTestId('consult-augur'))

    const first = await screen.findByTestId('augury-vision-0')
    expect(consultCampaignAugury).toHaveBeenCalledWith('c1')
    expect(first).toHaveTextContent('Supply Cache')
    expect(first).toHaveTextContent('A gentle omen')
    expect(screen.getByTestId('augury-vision-1')).toHaveTextContent('Harsh Weather')
    expect(screen.getByTestId('augury-vision-2')).toHaveTextContent('Plague')
    // The user is firm: the augury UI states NO odds of its own — the only
    // hint is each omen's gravity.
    expect(container.querySelector('.augury-phase').textContent).not.toMatch(/%/)

    fireEvent.click(screen.getByTestId('augury-continue'))
    await screen.findByText('Fight!')
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
          { id: 'traders', title: 'Traveling Traders', description: 'Merchants sell supplies.', severity: 1 },
          consultedAugury.visions[2],
        ],
      },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByText('Visit the Augur'))
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

  it('an already-consulted campaign goes straight to mustering', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, augury: consultedAugury }])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.queryByText('Visit the Augur')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Muster for Battle'))
    await screen.findByText('Fight!')
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

    fireEvent.click(screen.getByText('Muster for Battle'))
    fireEvent.click(await screen.findByTestId('end-day'))

    // The reveal beat, per fate: the augur foretold Plague but Supply Cache
    // came instead; the quiet fortnight was read true.
    const report = await screen.findByTestId('report-augury')
    expect(report).toHaveTextContent('Plague')
    expect(report).toHaveTextContent('Supply Cache')
    expect(report).toHaveTextContent('The augur was wrong.')
    expect(report).toHaveTextContent('The augur spoke true.')
    await waitFor(() => expect(endCampaignDay).toHaveBeenCalledWith('c1'))

    fireEvent.click(screen.getByTestId('report-continue'))
    await screen.findByText(/Turn 2 — War Council/)
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
