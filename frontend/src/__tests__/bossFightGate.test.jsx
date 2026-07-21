/**
 * The pitched-battle gate (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop",
 * Stage B frontend follow-up). Before the hidden meter fills, the enemy offers
 * no full-army battle: the server 400s POST /:id/battles, so the client must
 * not present Fight! at all. On the pitched-battle day (bossFightDue) the fight
 * is both offered AND mandatory — Fight! appears and the "end without battle"
 * escape is withheld until the field is decided. The player is warned on the
 * Council screen too, so forage/raid commitments that day are made knowing the
 * decisive fight is coming.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

import { getInfo, getMap, getCampaigns } from '../services/api'
import App from '../App'
import { marchToRaids, marchToDeployment } from './helpers/nav'
import { campaignFixture, consultedAugury } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const quietDay = { ...campaignFixture, augury: consultedAugury, bossFightDue: false }
const pitchedDay = { ...campaignFixture, augury: consultedAugury, bossFightDue: true }

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

describe('the pitched-battle gate', () => {
  it('a quiet day offers no battle: no Fight!, no warning, End Turn stays', async () => {
    getCampaigns.mockResolvedValue([quietDay])
    render(<App />)
    await screen.findByText(/War Council/)
    // The Council does not warn of a pitched battle when none is due.
    expect(screen.queryByTestId('pitched-battle-warning')).not.toBeInTheDocument()

    await marchToDeployment()
    // No full-army battle exists yet — the button would only hit the server's 400.
    expect(screen.queryByRole('button', { name: /fight!/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('pitched-battle-deploy')).not.toBeInTheDocument()
    // The turn ends normally, explicitly without a battle.
    expect(screen.getByTestId('end-day')).toHaveTextContent('End Turn (no battle)')
  })

  it('the pitched-battle day offers a mandatory Fight! and withholds End Turn', async () => {
    getCampaigns.mockResolvedValue([pitchedDay])
    render(<App />)
    await screen.findByText(/War Council/)
    // Warned at the Council, so forage/raid choices that day are informed.
    expect(screen.getByTestId('pitched-battle-warning')).toBeInTheDocument()

    // …and again on the Raids screen, where raiders are actually committed.
    await marchToRaids()
    expect(screen.getByTestId('pitched-battle-raids')).toBeInTheDocument()

    fireEvent.click(await screen.findByTestId('to-deploy'))
    expect(screen.getByRole('button', { name: /fight!/i })).toBeInTheDocument()
    expect(screen.getByTestId('pitched-battle-deploy')).toBeInTheDocument()
    // The battle is mandatory: no "end without fighting" escape until it's fought.
    expect(screen.queryByTestId('end-day')).not.toBeInTheDocument()
  })
})
