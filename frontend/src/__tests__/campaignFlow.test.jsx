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
  pickCampaignEvent: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import {
  getInfo,
  getMap,
  getCampaigns,
  createCampaign,
  pickCampaignEvent,
  endCampaignDay,
} from '../services/api'
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

    await screen.findByText(/Day 1 — Morning Council/)
    expect(createCampaign).toHaveBeenCalled()
  })

  it('augur pick goes through the API and advances to deployment', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    pickCampaignEvent.mockResolvedValue({ ...campaignFixture, events: [] })
    const { container } = render(<App />)
    await screen.findByText(/Morning Council/)

    fireEvent.click(screen.getByText('Consult the Augur'))
    expect(screen.getByText('The Augur Speaks')).toBeInTheDocument()
    expect(container.querySelectorAll('.event-card')).toHaveLength(3)

    fireEvent.click(container.querySelector('.event-card'))
    await screen.findByText('Fight!')
    expect(pickCampaignEvent).toHaveBeenCalledWith('c1', campaignFixture.events[0].id)
  })

  it('a finished (won) campaign shows the victory screen and a new-campaign button', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, status: 'won', day: 9 }])
    render(<App />)

    await screen.findByText('Victory!')
    expect(screen.getByTestId('start-campaign')).toHaveTextContent('New Campaign')
  })

  it('End Day calls the API and returns to the next morning council', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    pickCampaignEvent.mockResolvedValue({ ...campaignFixture, events: [] })
    endCampaignDay.mockResolvedValue({
      report: { day: 1, entries: [], upkeep: { foodConsumed: 38, deserters: 0 } },
      campaign: { ...campaignFixture, day: 2, resources: { food: 62, materials: 0 } },
    })
    const { container } = render(<App />)
    await screen.findByText(/Morning Council/)

    fireEvent.click(screen.getByText('Consult the Augur'))
    fireEvent.click(container.querySelector('.event-card'))
    fireEvent.click(await screen.findByTestId('end-day'))

    await screen.findByText(/Day 2 — Morning Council/)
    await waitFor(() => expect(endCampaignDay).toHaveBeenCalledWith('c1'))
  })

  it('tutorial intros render when enabled and hide when toggled off', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    render(<App />)
    await screen.findByText(/Morning Council/)

    expect(screen.getByTestId('tutorial-council')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('tutorial-toggle'))
    expect(screen.queryByTestId('tutorial-council')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('tutorialEnabled')).toBe('off')
  })
})
