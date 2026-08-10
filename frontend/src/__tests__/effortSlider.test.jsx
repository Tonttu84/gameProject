/**
 * The effort slider UI (S2, docs/CAMPAIGN_PLAN.md "Effort slider"): the
 * ForagePanel on the war council screen previews the split's food/materials/
 * scouting-points/meter effect from the server-provided scalars, posts the
 * chosen share through the API, and the HUD reflects the turn scale (kg
 * food, land left). All numbers come from the campaign view — the client
 * computes nothing but simple multiplication.
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

import { getInfo, getMap, getCampaigns, setCampaignEffort } from '../services/api'
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

describe('effort slider', () => {
  it('renders the ring gauges and the committed split', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('forage-ring-0')).toHaveTextContent('80 t left')
    expect(screen.getByTestId('forage-ring-2')).toHaveTextContent('220 t left')
    expect(screen.getByTestId('effort-slider')).toHaveValue('0.5') // campaignFixture.forage.share
  })

  it('previews food, materials, and screening points as the slider drags — no server round-trip', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    // pool 1112, kgPerPoint 16: at share 0.5, capacity 1112×0.5×16 = 8896 kg
    // → food 0.8×8896 = 7116.8 t → "7.1 t"; materials 0.2×8896 ≈ "1.8 t".
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('7.1 t')
    expect(screen.getByTestId('effort-preview-materials')).toHaveTextContent('1.8 t')
    expect(screen.getByTestId('effort-preview-scouting')).toHaveTextContent('556 screening points')

    fireEvent.change(screen.getByTestId('effort-slider'), { target: { value: '1' } })
    // Full forage: 1112×16 = 17792 kg → food 14233.6 → "14.2 t"; scouting 0.
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('14.2 t')
    expect(screen.getByTestId('effort-preview-scouting')).toHaveTextContent('0 screening points')
    // Nothing was sent to the server just from dragging.
    expect(setCampaignEffort).not.toHaveBeenCalled()
  })

  it('interpolates the meter preview linearly between the two server-provided endpoints', async () => {
    render(<App />)
    await screen.findByText(/War Council/)

    // fixture: meterFillAtNoForage 10, meterFillAtFullForage 20 — at share 0.5
    // the interpolated preview is 15.
    expect(screen.getByTestId('effort-preview-meter')).toHaveTextContent('+15')

    fireEvent.change(screen.getByTestId('effort-slider'), { target: { value: '1' } })
    expect(screen.getByTestId('effort-preview-meter')).toHaveTextContent('+20')
  })

  it('shows the enemy drain as unknown when the recon band withholds it', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    // campaignFixture.forage.enemyDrainKg is null (below Outmatched).
    expect(screen.getByTestId('effort-enemy-drain')).toHaveTextContent('unknown')
  })

  it('reveals the enemy drain once the recon band clears Outmatched', async () => {
    getCampaigns.mockResolvedValue([
      { ...campaignFixture, forage: { ...campaignFixture.forage, enemyDrainKg: 9000 } },
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('effort-enemy-drain')).toHaveTextContent('9 t/turn')
  })

  it('sends the share through the API and shows the saved state', async () => {
    setCampaignEffort.mockResolvedValue({
      ...campaignFixture,
      forage: { ...campaignFixture.forage, share: 0.8 },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    // No confirming press: moving the slider IS the commit (2026-08-10). The
    // write is debounced, so it lands shortly after the change rather than
    // synchronously with it.
    fireEvent.change(screen.getByTestId('effort-slider'), { target: { value: '0.8' } })

    await waitFor(() => expect(setCampaignEffort).toHaveBeenCalledWith('c1', 0.8))
    expect(await screen.findByText('Effort set')).toBeInTheDocument()
  })

  it('a drag across the track is ONE write, of where it came to rest', async () => {
    // A range input fires per step while dragging. Without the debounce a
    // single sweep would be a dozen writes to a route that seals the turn's
    // split — so the sweep below must collapse to one call, at the final value.
    setCampaignEffort.mockResolvedValue({
      ...campaignFixture,
      forage: { ...campaignFixture.forage, share: 0.9 },
    })
    render(<App />)
    await screen.findByText(/War Council/)

    const slider = screen.getByTestId('effort-slider')
    for (const value of ['0.6', '0.7', '0.8', '0.9']) {
      fireEvent.change(slider, { target: { value } })
    }

    await waitFor(() => expect(setCampaignEffort).toHaveBeenCalledWith('c1', 0.9))
    expect(setCampaignEffort).toHaveBeenCalledTimes(1)
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

// ── Standing forage pressures (S3) ───────────────────────────────────────────
// The server sends the bend as COEFFICIENTS (kgPerPoint already carries the
// combined factor, flatKg the additive half) precisely so the preview stays
// honest while the slider moves, rather than as one precomputed total.
describe('forage modifiers in the preview', () => {
  const withForage = (over) =>
    getCampaigns.mockResolvedValue([
      { ...campaignFixture, forage: { ...campaignFixture.forage, ...over } },
    ])

  it('applies the folded factor at every slider position', async () => {
    // kgPerPoint 16 × the 0.5 factor the server already folded in = 8.
    withForage({ kgPerPoint: 8 })
    render(<App />)
    await screen.findByText(/War Council/)

    // 1112 × 0.5 × 8 = 4448 kg → food 0.8 × 4448 = 3558.4 → "3.6 t".
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('3.6 t')
    fireEvent.change(screen.getByTestId('effort-slider'), { target: { value: '1' } })
    // 1112 × 8 = 8896 → food 7116.8 → "7.1 t" — half the unmodified figure.
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('7.1 t')
  })

  it('adds flatKg once, on top of the interpolated capacity', async () => {
    withForage({ flatKg: 1104 })
    render(<App />)
    await screen.findByText(/War Council/)
    // 1112 × 0.5 × 16 + 1104 = 10000 kg → food 8000 → "8 t".
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('8 t')
  })

  it('never previews a negative harvest', async () => {
    // A pressure big enough to swallow the whole sweep floors at zero — the
    // same clamp resolveForaging applies server-side.
    withForage({ flatKg: -999999 })
    render(<App />)
    await screen.findByText(/War Council/)
    // tons() renders anything under a tonne in kg, so a floored sweep reads
    // "0 kg" rather than "0 t".
    expect(screen.getByTestId('effort-preview-food')).toHaveTextContent('0 kg')
  })

  it('lists whatever pressures the server sent, marking the permanent ones', async () => {
    withForage({
      modifiers: [
        { id: 'foraging_riders', label: 'Harried by enemy horse', target: 'playerYield', turnsLeft: null },
        { id: 'spoiled', label: 'Spoiled stores', target: 'playerYield', turnsLeft: 1 },
      ],
    })
    render(<App />)
    await screen.findByText(/War Council/)

    expect(screen.getByTestId('effort-modifier-foraging_riders'))
      .toHaveTextContent('Harried by enemy horse')
    expect(screen.getByTestId('effort-modifier-foraging_riders'))
      .toHaveTextContent('for the rest of the campaign')
    // Singular at one turn left — the countdown reads as prose, not a stat.
    expect(screen.getByTestId('effort-modifier-spoiled')).toHaveTextContent('1 turn left')
  })

  it('renders no list at all when nothing is bending the foraging', async () => {
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.queryByTestId('effort-modifiers')).toBeNull()
  })
})
