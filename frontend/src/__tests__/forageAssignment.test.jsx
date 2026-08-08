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

    expect(screen.getByTestId('forage-ring-0')).toHaveTextContent('20 t left')
    expect(screen.getByTestId('forage-ring-2')).toHaveTextContent('55 t left')

    fireEvent.change(screen.getByTestId('forage-input-Soldier'), { target: { value: '100' } })
    // 100 Soldiers × 30 kg (server-provided kgPerUnit), shown in tonnes
    expect(screen.getByTestId('forage-capacity')).toHaveTextContent('100 foragers — up to 3 t')

    fireEvent.change(screen.getByTestId('forage-input-Cavalry'), { target: { value: '10' } })
    expect(screen.getByTestId('forage-capacity')).toHaveTextContent('110 foragers — up to 3.6 t')
  })

  it('clamps the count to the roster', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.change(screen.getByTestId('forage-input-Cavalry'), { target: { value: '999' } })
    // Only 10 Cavalry owned → clamped, 10 × 60 kg — sub-tonne amounts show as kg
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

  // Playtest bug 2026-07-03: the forage menu offered troop types the player
  // doesn't own. Steppers must only render for roster lines with units in
  // them, even if the view sends extra kgPerUnit rows or 0-count lines.
  it('only owned unit types get a forage stepper', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...campaignFixture,
        roster: { ...campaignFixture.roster, Priest: 0 },
        forage: {
          ...campaignFixture.forage,
          kgPerUnit: { ...campaignFixture.forage.kgPerUnit, Zombie: 30 },
        },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('forage-input-Soldier')).toBeInTheDocument()
    expect(screen.queryByTestId('forage-input-Priest')).not.toBeInTheDocument() // 0 owned
    expect(screen.queryByTestId('forage-input-Zombie')).not.toBeInTheDocument() // not in roster
  })

  it('the HUD shows stores in tonnes, per-turn need, and land remaining', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByText(/Food: 50 t/)).toHaveTextContent('−12.4 t/turn')
    expect(screen.getByTestId('hud-land')).toHaveTextContent('Land: 100% left')
  })

  // The 2026-07-03 playtest screen showed "Food: 0.1 t (−0 t/turn)" from a
  // stale doc whose view had no foodNeedPerTurn — the `?? 0` coercion made a
  // wiring hole look like a calm zero. A missing value must LOOK broken, and
  // sub-tonne stores must show as kg, never "0.1 t".
  it('a missing food need renders as broken (?? t), not as an innocent −0', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...campaignFixture,
        resources: { food: 100, materials: 0 }, // no foodNeedPerTurn
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByText(/Food: 100 kg/)).toHaveTextContent('−?? t/turn')
  })
})
