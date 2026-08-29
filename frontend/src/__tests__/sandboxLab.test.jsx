/**
 * THE BATTLE LAB — the screen (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE",
 * slice S1).
 *
 * The lab exists because the campaign is the only road to a battle today, and
 * some battles it will essentially never hand you: both shipped battlefield
 * enchantments need Enchantment 2 while ENEMY_SCHOOLS seals the host at 1, so
 * no encounter can currently field either one. What is pinned here is therefore
 * the composing, not the fighting — the engine has its own suite, and the route
 * has campaign-server/tests/sandbox.test.js:
 *
 *   • the door is login-only (SB-2) and free-standing (SB-1) — no campaign is
 *     needed to open it, and opening it touches none;
 *   • the palette offers the WHOLE catalog, enemy-only types included, since
 *     composing the hypothetical enemy is half of the point;
 *   • both sides are placed by hand, one at a time (SB-3/SB-6's premise), with
 *     an auto-place button that goes through the server's own spread;
 *   • the launch sends ONE ENTRY PER BODY in axial coordinates, the shape every
 *     other battle route already speaks;
 *   • the replay comes back into the lab, setup intact, so the next thing to
 *     try is one edit away.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getUnits: vi.fn(),
  getTicks: vi.fn(),
  getCampaigns: vi.fn(),
  postSandboxBattle: vi.fn(),
  autoPlaceSandbox: vi.fn(),
  launchSampleBattle: vi.fn(),
  getBattle: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  createCampaign: vi.fn(),
}))

import {
  getInfo, getMap, getUnits, getTicks, getCampaigns, postSandboxBattle, autoPlaceSandbox,
} from '../services/api'
import App from '../App'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }, { name: 'Forest', color: '#378228' }],
  units: [],
}

// The FULL catalog, as /api/units serves it — including a type no player can
// ever recruit, which is the row this screen exists to be able to place.
const catalog = [
  { name: 'Soldier', symbol: 'X', size: 10, category: 'Foot', forbiddenTerrain: [], roles: ['Player', 'Enemy'] },
  { name: 'Cavalry', symbol: 'C', size: 20, category: 'Mounted', forbiddenTerrain: ['Forest'], roles: ['Player'] },
  { name: 'Zombie', symbol: 'Z', size: 10, category: 'Foot', forbiddenTerrain: [], roles: ['Summon'] },
]

const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

const summary = { id: 'lab-battle-1', winner: 'blue', tickCount: 2 }
const ticks = [
  { index: 0, units: [{ id: 0, type: 'Soldier', team: 'blue', q: 2, r: 4, ox: 0, oy: 0, sz: 0.2 }], log: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
  getUnits.mockResolvedValue(catalog)
  getTicks.mockResolvedValue(ticks)
  getCampaigns.mockResolvedValue([])
  postSandboxBattle.mockResolvedValue(summary)
})

// A logged-in player with NO campaign at all — the strongest statement of SB-1:
// if the lab needed campaign state, this fixture could not open it.
const openLab = async () => {
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  render(<App />)
  fireEvent.click(await screen.findByTestId('open-lab'))
  return screen.findByTestId('lab-palette')
}

// Compose n of a type on the side currently being edited.
const compose = (type, n) =>
  fireEvent.change(screen.getByTestId(`lab-recruit-${type}`), { target: { value: String(n) } })

// Place n of a type on the selected hex.
const placeHere = (type, n) =>
  fireEvent.change(screen.getByTestId(`lab-place-${type}`), { target: { value: String(n) } })

describe('the lab door', () => {
  it('is offered to a logged-in player and hidden from a visitor', async () => {
    render(<App />)
    await screen.findByText(/The Campaign Awaits/)
    expect(screen.queryByTestId('open-lab')).not.toBeInTheDocument()
  })

  it('opens with no campaign in progress, and leaving lands back where it was', async () => {
    await openLab()
    expect(screen.getByText('The Battle Lab')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lab-back'))
    expect(await screen.findByText(/No Campaign In Progress/)).toBeInTheDocument()
  })
})

describe('composing both armies', () => {
  it('offers the whole catalog, enemy-only types included (SB-1)', async () => {
    await openLab()
    expect(getUnits).toHaveBeenCalledOnce()
    for (const unit of catalog)
      expect(screen.getByTestId(`lab-recruit-${unit.name}`)).toBeInTheDocument()
  })

  it('tracks what is composed but not yet placed', async () => {
    await openLab()
    compose('Soldier', 20)
    expect(screen.getByTestId('lab-unplaced')).toHaveTextContent('20 still to place')

    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 20)
    expect(screen.getByTestId('lab-unplaced')).toHaveTextContent(/every composed body/)
  })

  it('places only inside the side being edited, and switches zones with the tab', async () => {
    await openLab()
    compose('Soldier', 5)

    // Blue is the active side: an enemy-zone hex is inert…
    fireEvent.click(screen.getByTestId('lab-hex-3-25'))
    expect(screen.queryByTestId('lab-hex-menu')).not.toBeInTheDocument()
    // …and a player-zone hex opens the menu.
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    expect(screen.getByTestId('lab-hex-menu')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lab-side-red'))
    compose('Zombie', 4)
    fireEvent.click(screen.getByTestId('lab-hex-3-25'))
    placeHere('Zombie', 4)
    expect(screen.getByTestId('lab-glyph-red-3-25-Zombie')).toHaveTextContent('Z4')
  })

  it('refuses a type its terrain forbids, and caps a stack at the hex capacity', async () => {
    getMap.mockResolvedValue({ hexes: [{ q: 2, r: 4, terrain: 'Forest', impassable: false }] })
    await openLab()
    compose('Cavalry', 100)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))

    expect(screen.getByTestId('lab-place-Cavalry')).toBeDisabled()
    expect(screen.getByText(/cannot enter this terrain/)).toBeInTheDocument()

    // An Open hex takes them, but only as many as size-20 bodies fit in 640.
    fireEvent.click(screen.getByTestId('lab-hex-5-5'))
    expect(screen.getByTestId('lab-place-Cavalry')).toHaveAttribute('max', '32')
  })

  it('never offers more of a type than the army still holds', async () => {
    await openLab()
    compose('Soldier', 10)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 6)

    fireEvent.click(screen.getByTestId('lab-hex-5-5'))
    expect(screen.getByTestId('lab-place-Soldier')).toHaveAttribute('max', '4')
  })
})

describe('auto-place (SB-3)', () => {
  it('asks the server to spread the side, and draws what comes back', async () => {
    // Axial, one entry per body — exactly what spreadPlacement returns.
    autoPlaceSandbox.mockResolvedValue({
      placement: [
        { unit_type: 'Soldier', q: 2, r: 4 },
        { unit_type: 'Soldier', q: 2, r: 4 },
        { unit_type: 'Soldier', q: 3, r: 5 },
      ],
    })
    await openLab()
    compose('Soldier', 3)
    fireEvent.click(screen.getByTestId('lab-auto-place'))

    await waitFor(() => expect(autoPlaceSandbox).toHaveBeenCalledWith('blue', { Soldier: 3 }))
    // Two on one hex fold into one stack of 2; the axial pairs land on the
    // offset hexes the grid draws (q + floor(r/2), r).
    // A glyph is the type's INITIAL plus the count, the same shorthand the
    // deployment grid draws — so "S" means Soldier on both screens.
    expect(await screen.findByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S2')
    expect(screen.getByTestId('lab-glyph-blue-5-5-Soldier')).toHaveTextContent('S1')
  })

  it('clears a side without touching the other', async () => {
    await openLab()
    compose('Soldier', 3)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 3)

    fireEvent.click(screen.getByTestId('lab-side-red'))
    compose('Zombie', 2)
    fireEvent.click(screen.getByTestId('lab-hex-3-25'))
    placeHere('Zombie', 2)

    fireEvent.click(screen.getByTestId('lab-clear'))
    expect(screen.queryByTestId('lab-glyph-red-3-25-Zombie')).not.toBeInTheDocument()
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toBeInTheDocument()
  })
})

describe('launching', () => {
  it('stays disabled until something is on the field', async () => {
    await openLab()
    expect(screen.getByTestId('lab-launch')).toBeDisabled()

    compose('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 2)
    expect(screen.getByTestId('lab-launch')).toBeEnabled()
  })

  it('sends one entry per body, in axial coords, and plays the replay', async () => {
    await openLab()
    compose('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 2)

    fireEvent.click(screen.getByTestId('lab-side-red'))
    compose('Zombie', 1)
    fireEvent.click(screen.getByTestId('lab-hex-3-25'))
    placeHere('Zombie', 1)

    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith({
      player_placement: [
        { unit_type: 'Soldier', q: 2, r: 4 },
        { unit_type: 'Soldier', q: 2, r: 4 },
      ],
      enemy_placement: [{ unit_type: 'Zombie', q: -9, r: 25 }],
    }))

    // The one and only renderer, reading ticks back from the DB.
    await screen.findByText(/Battle Replay/)
    await waitFor(() => expect(getTicks).toHaveBeenCalledWith('lab-battle-1', 0, 49))
  })

  it('comes back from the replay into the lab, setup intact', async () => {
    await openLab()
    compose('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-launch'))
    await screen.findByText(/Battle Replay/)

    fireEvent.click(screen.getByTestId('replay-back'))
    expect(await screen.findByTestId('lab-palette')).toBeInTheDocument()
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S2')
  })

  it("surfaces the server's refusal and leaves the setup alone", async () => {
    postSandboxBattle.mockRejectedValue({
      response: { status: 400, data: { error: 'too many units on the player side' } },
    })
    await openLab()
    compose('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 2)
    fireEvent.click(screen.getByTestId('lab-launch'))

    expect(await screen.findByTestId('auth-notice')).toHaveTextContent(/too many units/)
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toBeInTheDocument()
    expect(screen.getByTestId('lab-launch')).toBeEnabled()
  })
})
