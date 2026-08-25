/**
 * The Study's door and its place in the screen stack (SLICE 3, S3-3).
 *
 * The screen's own rendering is pinned in study.test.jsx against a fixture;
 * this is the App-level half — that the door exists on the HUD shelf, opens the
 * takeover, and sits on the correct side of the pending-choices overlay.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

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
  setCampaignResearch: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
  postCampaignChoice: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, setCampaignResearch } from '../services/api'
import App from '../App'
import useUiStore from '../stores/useUiStore'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  units: [],
  terrain: [],
}

// The block campaignView ships (S2-1), trimmed to one school with one spell.
const research = {
  focus: 'evocation',
  allies: 0,
  rate: 30,
  schools: {
    evocation: {
      label: 'Evocation', level: 1, points: 20, nextCost: 60,
      spells: [{
        spell: 'fireball', form: 'minor', label: 'Ember',
        description: 'A single bolt of fire at range.',
        requires: [{ path: 'fire', label: 'Fire', level: 1 }],
        schoolLevel: 1, unlocked: true, fatigue: 8, castingTime: 1,
      }],
    },
    conjuration: { label: 'Conjuration', level: 0, points: 0, nextCost: 30, spells: [] },
    enchantment: { label: 'Enchantment', level: 0, points: 0, nextCost: 30, spells: [] },
    construction: { label: 'Construction', level: 0, points: 0, nextCost: 30, spells: [] },
  },
}

const withResearch = (over = {}) => ({ ...campaignFixture, research, ...over })

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

describe('The Study door (S3-3)', () => {
  it('sits on the HUD shelf beside The Army and The Stores', async () => {
    getCampaigns.mockResolvedValue([withResearch()])
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('hud-army')).toBeInTheDocument()
    expect(screen.getByTestId('hud-stores')).toBeInTheDocument()
    const door = screen.getByTestId('hud-study')
    // Unchanging, like the stores' door: no level, no badge.
    expect(door.textContent.trim()).toBe('The Study')
  })

  it('opens the takeover, and Back returns to the phase underneath', async () => {
    getCampaigns.mockResolvedValue([withResearch()])
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('hud-study'))
    expect(await screen.findByTestId('study-page')).toBeInTheDocument()
    expect(screen.getByTestId('study-spell-fireball-minor')).toHaveTextContent('Ember')
    // The council is gone while the takeover is up...
    expect(screen.queryByText(/War Council/)).toBeNull()

    fireEvent.click(screen.getByTestId('study-back'))
    expect(await screen.findByText(/War Council/)).toBeInTheDocument()
  })

  it('directs study through the route, in Prepare', async () => {
    const campaign = withResearch()
    getCampaigns.mockResolvedValue([campaign])
    setCampaignResearch.mockResolvedValue({
      ...campaign,
      research: { ...research, focus: 'conjuration' },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    fireEvent.click(screen.getByTestId('hud-study'))
    fireEvent.click(await screen.findByTestId('study-focus-conjuration'))

    expect(setCampaignResearch).toHaveBeenCalledWith(campaign.id, 'conjuration')
    // The view the server sent back is what the screen now reflects — the
    // client never guesses the new focus ahead of the response.
    expect(await screen.findByTestId('study-focused-conjuration')).toBeInTheDocument()
  })

  it('the door is gone while a fate is owed, like The Army', async () => {
    // S2-12 gates the focus to `prepare`, and a fate is owed well past it — so
    // a Study opened over the choice cards could only offer a button the server
    // refuses. It sits BELOW the overlay, unlike the read-only store browse.
    getCampaigns.mockResolvedValue([withResearch({
      day: 2,
      pendingChoices: [{
        slot: 0,
        title: 'Refugees at the Palisade',
        description: 'A column of burned-out villagers begs shelter at the camp gates.',
        options: [
          { id: 'turn_away', label: 'Turn them away', effectText: ['Nothing changes.'] },
          { id: 'take_in', label: 'Take them in', effectText: ['More mouths.'] },
        ],
      }],
    })])
    render(<App />)
    await screen.findByTestId('reveal-beat-choice-0')

    expect(screen.queryByTestId('hud-study')).toBeNull()
    expect(screen.queryByTestId('hud-army')).toBeNull()
    // ...while the read-only door beside it survives (17-6).
    expect(screen.getByTestId('hud-stores')).toBeInTheDocument()
  })
})

describe('the focus is gated on the SERVER phase, not the screen (S2-12)', () => {
  // The Study is a takeover reachable from EVERY phase, so the screen the
  // player is looking at and the phase the turn is actually in come apart
  // routinely — and only the second is what POST /:id/research answers to.
  // These two cases are where the readings diverge; a plain "campaign is in
  // raids" test cannot tell them apart, because App syncs the UI phase forward
  // to the server's and both readings then agree.

  it('stays settled while the player BACK-STEPS to look at Prepare', async () => {
    // Back-steps are pure looking (the phase they return to is behind the
    // server's, and the sync is forward-only, so it is not yanked back). The
    // screen says 'prepare'; the turn is in 'raids' and the route will refuse.
    getCampaigns.mockResolvedValue([withResearch({ phase: 'raids' })])
    render(<App />)
    await screen.findByTestId('hud-study')

    act(() => { useUiStore.setState({ phase: 'prepare' }) })
    fireEvent.click(screen.getByTestId('hud-study'))
    await screen.findByTestId('study-page')

    expect(screen.getByTestId('study-locked')).toBeInTheDocument()
    expect(screen.getByTestId('study-focus-conjuration')).toBeDisabled()
  })

  it('stays settled on a UI-only screen, whose phase rank is −1', async () => {
    // The day report is rank −1 and the sync leaves it alone. Reading the gate
    // off the SCREEN would leave a live button on the report that can only 409.
    getCampaigns.mockResolvedValue([withResearch({ phase: 'raids' })])
    render(<App />)
    await screen.findByTestId('hud-study')

    act(() => { useUiStore.setState({ phase: 'report' }) })
    fireEvent.click(screen.getByTestId('hud-study'))
    await screen.findByTestId('study-page')

    expect(screen.getByTestId('study-focus-conjuration')).toBeDisabled()
  })

  it('is open in Prepare, which is the phase it belongs to', async () => {
    getCampaigns.mockResolvedValue([withResearch({ phase: 'prepare' })])
    render(<App />)
    await screen.findByText(/War Council/)
    fireEvent.click(screen.getByTestId('hud-study'))
    await screen.findByTestId('study-page')
    expect(screen.queryByTestId('study-locked')).toBeNull()
    expect(screen.getByTestId('study-focus-conjuration')).toBeEnabled()
  })
})
