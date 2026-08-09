/**
 * Tutorial-intro coverage for the screens the phased-turn refactor left without
 * one: the game-over screen, the post-battle result, the reload-recovery
 * "Decisions Await" screen, and the replay viewer. Each shows its intro only
 * when the tutorial flag is on (default on) and hides it when toggled off —
 * the same contract campaignFlow/eventReveal pin for the screens that already
 * had intros.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

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

import { getInfo, getMap, getCampaigns, getTicks } from '../services/api'
import App from '../App'
import BattleResult from '../components/BattleResult'
import EventRevealScreen from '../components/EventRevealScreen'
import ReplayView from '../components/ReplayView'
import useUiStore from '../stores/useUiStore'
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
  getTicks.mockResolvedValue([{ index: 0, units: [], log: [] }])
})

describe('tutorial coverage for the phased-turn screens', () => {
  it('the game-over screen shows its intro, and hides it when the flag is off', async () => {
    getCampaigns.mockResolvedValue([{ ...campaignFixture, status: 'won', day: 9 }])
    const { unmount } = render(<App />)
    await screen.findByText('Victory!')
    expect(screen.getByTestId('tutorial-gameover')).toBeInTheDocument()
    unmount()

    useUiStore.getState().toggleTutorial()
    render(<App />)
    await screen.findByText('Victory!')
    expect(screen.queryByTestId('tutorial-gameover')).not.toBeInTheDocument()
  })

  it('the battle-result screen shows its intro, gated on the flag', () => {
    const result = { winner: 'blue', blue_survivors: { Soldier: 4 }, red_survivors: {} }
    const { unmount } = render(<BattleResult result={result} onNextDay={() => {}} />)
    expect(screen.getByTestId('tutorial-result')).toBeInTheDocument()
    unmount()

    useUiStore.getState().toggleTutorial()
    render(<BattleResult result={result} onNextDay={() => {}} />)
    expect(screen.queryByTestId('tutorial-result')).not.toBeInTheDocument()
  })

  it('the Decisions Await (choices-only) screen shows its intro, gated on the flag', () => {
    const pendingChoices = [
      { slot: 0, title: 'A Fork in the Road', description: 'Choose.', options: [{ id: 'a', label: 'A' }] },
    ]
    const { unmount } = render(
      <EventRevealScreen pendingChoices={pendingChoices} onChoose={() => {}} />,
    )
    expect(screen.getByTestId('tutorial-decisions')).toBeInTheDocument()
    unmount()

    useUiStore.getState().toggleTutorial()
    render(<EventRevealScreen pendingChoices={pendingChoices} onChoose={() => {}} />)
    expect(screen.queryByTestId('tutorial-decisions')).not.toBeInTheDocument()
  })

  it('the replay viewer shows its intro, gated on the flag', () => {
    const { unmount } = render(
      <ReplayView battleId="b1" tickCount={1} info={info} map={{ hexes: [] }} onBack={() => {}} />,
    )
    expect(screen.getByTestId('tutorial-replay')).toBeInTheDocument()
    unmount()

    useUiStore.getState().toggleTutorial()
    render(<ReplayView battleId="b1" tickCount={1} info={info} map={{ hexes: [] }} onBack={() => {}} />)
    expect(screen.queryByTestId('tutorial-replay')).not.toBeInTheDocument()
  })
})
