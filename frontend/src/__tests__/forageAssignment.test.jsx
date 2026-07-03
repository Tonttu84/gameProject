/**
 * Forager assignment UI: the ForagePanel on the war council screen previews
 * capacity from the server-provided kg-per-unit values, posts the assignment
 * through the API, and the HUD reflects the turn scale (kg food, land left).
 * All numbers come from the campaign view — the client computes nothing.
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
  setCampaignForage: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, setCampaignForage } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
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
  getCampaigns.mockResolvedValue([campaignFixture])
})

describe('forager assignment', () => {
  it('renders the ring gauges and previews capacity as counts change', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('forage-ring-0')).toHaveTextContent('20000 kg left')
    expect(screen.getByTestId('forage-ring-2')).toHaveTextContent('55000 kg left')

    fireEvent.change(screen.getByTestId('forage-input-Soldier'), { target: { value: '100' } })
    // 100 Soldiers × 30 kg (server-provided kgPerUnit)
    expect(screen.getByTestId('forage-capacity')).toHaveTextContent('100 foragers — up to 3000 kg')

    fireEvent.change(screen.getByTestId('forage-input-LightCavalry'), { target: { value: '5' } })
    expect(screen.getByTestId('forage-capacity')).toHaveTextContent('105 foragers — up to 3450 kg')
  })

  it('clamps the count to the roster', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.change(screen.getByTestId('forage-input-Cavalry'), { target: { value: '999' } })
    // Only 10 Cavalry owned → clamped, 10 × 60 kg
    expect(screen.getByTestId('forage-capacity')).toHaveTextContent('10 foragers — up to 600 kg')
  })

  it('sends the assignment through the API and shows the saved state', async () => {
    setCampaignForage.mockResolvedValue({
      ...campaignFixture,
      forage: {
        ...campaignFixture.forage,
        assignment: { Soldier: 100 },
        capacityKg: 3000,
      },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.change(screen.getByTestId('forage-input-Soldier'), { target: { value: '100' } })
    fireEvent.click(screen.getByTestId('forage-submit'))

    await waitFor(() =>
      expect(setCampaignForage).toHaveBeenCalledWith('c1', { Soldier: 100 }),
    )
    expect(await screen.findByText('Foragers assigned')).toBeInTheDocument()
  })

  it('the HUD shows kg stores, per-turn need, and land remaining', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByText(/Food: 50000 kg/)).toHaveTextContent('−12432/turn')
    expect(screen.getByTestId('hud-land')).toHaveTextContent('Land: 100% left')
  })
})
