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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getUnits: vi.fn(),
  getTicks: vi.fn(),
  getCampaigns: vi.fn(),
  postSandboxBattle: vi.fn(),
  autoPlaceSandbox: vi.fn(),
  getSandboxReference: vi.fn(),
  postSandboxCastable: vi.fn(),
  launchSampleBattle: vi.fn(),
  getBattle: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  createCampaign: vi.fn(),
}))

import {
  getInfo, getMap, getUnits, getTicks, getCampaigns, postSandboxBattle, autoPlaceSandbox,
  getSandboxReference, postSandboxCastable,
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
  { name: 'Mage', symbol: 'M', size: 10, category: 'Foot', forbiddenTerrain: [], roles: ['Player'] },
]

// GET /api/sandbox/reference, as the server serves it: the vocabulary PHRASED
// (17-5 — the lab holds no copy of "Fire"), the caster types derived from
// isCasterType, SB-8's preset read off the live balance constants, and the
// bounds the spinners clamp to.
const reference = {
  paths: [
    { key: 'fire', label: 'Fire' }, { key: 'earth', label: 'Earth' },
    { key: 'water', label: 'Water' }, { key: 'air', label: 'Air' },
    { key: 'high', label: 'High' }, { key: 'low', label: 'Low' },
    { key: 'nature', label: 'Nature' }, { key: 'death', label: 'Death' },
    { key: 'holy', label: 'Holy' }, { key: 'unholy', label: 'Unholy' },
  ],
  schools: [
    { key: 'evocation', label: 'Evocation' }, { key: 'conjuration', label: 'Conjuration' },
    { key: 'enchantment', label: 'Enchantment' }, { key: 'construction', label: 'Construction' },
  ],
  casterTypes: ['Mage', 'Priest', 'Necromancer'],
  enemyPreset: {
    schools: { evocation: 1, conjuration: 2, enchantment: 1, construction: 0 },
    channels: 3,
  },
  limits: { maxPathLevel: 9, maxSchoolLevel: 9, maxChannels: 99, openSchoolLevel: 9, maxRuns: 20 },
}

// The lab's own default magic block: every school at the engine's own open
// level and no pool, which is what a battle sent no block at all is fought
// with. It rides on EVERY launch, so it is worth naming once.
const openMagic = {
  schools: { evocation: 9, conjuration: 9, enchantment: 9, construction: 9 },
  channels: 0,
}

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
  getSandboxReference.mockResolvedValue(reference)
  postSandboxCastable.mockResolvedValue({ options: [] })
})

// A logged-in player with NO campaign at all — the strongest statement of SB-1:
// if the lab needed campaign state, this fixture could not open it.
const openLab = async () => {
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  render(<App />)
  fireEvent.click(await screen.findByTestId('open-lab'))
  await screen.findByTestId('lab-palette')
  // The caster vocabulary is a second fetch on the same open (S2), and every
  // magic control below is drawn from it — so the lab is not "open" for a test
  // until it has landed.
  return screen.findByTestId('lab-school-evocation')
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

  it('offers a hex its own stack back, not that stack twice over', async () => {
    // Re-opening a hex that already holds 6 of a 10-strong army must offer 10 —
    // its own 6 plus the 4 still in the wings. Counting the stack on top of a
    // budget that already excludes it offered 16, and the extra 6 were bodies
    // the army did not have.
    await openLab()
    compose('Soldier', 10)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 6)

    expect(screen.getByTestId('lab-place-Soldier')).toHaveAttribute('max', '10')
  })

  it('reports bodies placed beyond an army that was composed back down', async () => {
    // Lowering a composed count leaves the placements alone — they are what
    // actually fights — so the palette says so rather than showing "-4".
    await openLab()
    compose('Soldier', 10)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 10)
    compose('Soldier', 6)

    expect(screen.getByTestId('lab-unplaced')).toHaveTextContent('4 placed beyond the composed army')
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
      // Both blocks always ride along (D1), and both are the engine's own
      // defaults until a spinner moves — so this launch is byte-for-byte the
      // battle S1 fought, which is the point of starting open.
      magic: { blue: openMagic, red: openMagic },
      // S3's two launch numbers, at their defaults: one battle, drawn fresh.
      runs: 1,
      seed: null,
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

// ── S2: the casters ─────────────────────────────────────────────────────────
//
// This is where the original ask is met: per-caster paths and scripts that
// DEFAULT to the engine's own choice, the school levels and channel pool per
// side, and SB-8's preset. What is pinned is the per-BODY grain (SB-6) — two
// casters in one stack are two men — and the absence rule that makes the
// default free: an untouched caster crosses the wire carrying nothing.

// The bodies of a caster stack, placed on the currently edited side.
const placeCasters = (n) => {
  compose('Mage', n)
  fireEvent.click(screen.getByTestId('lab-hex-4-4'))
  placeHere('Mage', n)
}

const openBody = (index) =>
  fireEvent.click(screen.getByTestId(`lab-caster-Mage-4-4-${index}`))

const setPath = (path, level) =>
  fireEvent.change(screen.getByTestId(`lab-path-${path}`), { target: { value: String(level) } })

describe("the side's magic (D1)", () => {
  it("starts at the engine's own open default, so touching nothing changes nothing", async () => {
    await openLab()
    expect(screen.getByTestId('lab-school-evocation')).toHaveValue(9)
    expect(screen.getByTestId('lab-channels')).toHaveValue(0)
  })

  it('sets a school level and a pool per side, not once for the field', async () => {
    await openLab()
    fireEvent.change(screen.getByTestId('lab-school-enchantment'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('lab-channels'), { target: { value: '4' } })

    fireEvent.click(screen.getByTestId('lab-side-red'))
    expect(screen.getByTestId('lab-school-enchantment')).toHaveValue(9)
    expect(screen.getByTestId('lab-channels')).toHaveValue(0)

    fireEvent.click(screen.getByTestId('lab-side-blue'))
    expect(screen.getByTestId('lab-school-enchantment')).toHaveValue(2)
    expect(screen.getByTestId('lab-channels')).toHaveValue(4)
  })

  it("loads the campaign host's real numbers on demand (SB-8)", async () => {
    await openLab()
    fireEvent.click(screen.getByTestId('lab-side-red'))
    fireEvent.click(screen.getByTestId('lab-enemy-preset'))

    // Straight off the live ENEMY_SCHOOLS/ENEMY_CHANNELS the server served —
    // the lab authors no tier table of its own, so a balance retune moves this
    // button for free.
    expect(screen.getByTestId('lab-school-conjuration')).toHaveValue(2)
    expect(screen.getByTestId('lab-school-construction')).toHaveValue(0)
    expect(screen.getByTestId('lab-channels')).toHaveValue(3)
  })
})

describe('the casters panel (SB-6)', () => {
  it('lists ONE ROW PER BODY, each addressable by its place in the stack', async () => {
    await openLab()
    placeCasters(3)

    expect(screen.getByTestId('lab-caster-Mage-4-4-0')).toHaveTextContent('Mage · (4,4) #1')
    expect(screen.getByTestId('lab-caster-Mage-4-4-1')).toHaveTextContent('Mage · (4,4) #2')
    expect(screen.getByTestId('lab-caster-Mage-4-4-2')).toHaveTextContent('Mage · (4,4) #3')
  })

  it('leaves non-casters out of it entirely', async () => {
    await openLab()
    compose('Soldier', 4)
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    placeHere('Soldier', 4)

    expect(screen.queryByTestId('lab-caster-Soldier-4-4-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('lab-casters')).toHaveTextContent(/No casters placed/)
  })

  it("editing body #2's paths does not touch body #1 — that difference IS the point", async () => {
    await openLab()
    placeCasters(2)

    openBody(1)
    setPath('fire', 4)
    expect(screen.getByTestId('lab-path-fire')).toHaveValue(4)

    openBody(0)
    expect(screen.getByTestId('lab-path-fire')).toHaveValue(0)
  })

  it('drops the config of a body the stack no longer has', async () => {
    await openLab()
    placeCasters(2)
    openBody(1)
    setPath('fire', 4)

    // Shrink the stack to one (the hex menu is still open on 4,4): #2 is gone,
    // so his configuration is gone with him — keeping it would silently
    // re-attach it to a different man the next time the stack grew.
    placeHere('Mage', 1)
    expect(screen.queryByTestId('lab-caster-Mage-4-4-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lab-caster-editor')).not.toBeInTheDocument()

    placeHere('Mage', 2)
    openBody(1)
    expect(screen.getByTestId('lab-path-fire')).toHaveValue(0)
  })

  it('offers exactly what the server says he can cast, and refetches as a path rises (D3)', async () => {
    postSandboxCastable.mockResolvedValue({
      options: [{ spell: 'fireball', label: 'Ember', description: 'A bolt.' }],
    })
    await openLab()
    placeCasters(1)
    openBody(0)

    // The question is asked with HIS paths and HIS SIDE's schools — one rules
    // site, on the server, which is what keeps the lab from holding a second
    // reading of M-6's gate.
    await waitFor(() => expect(postSandboxCastable).toHaveBeenCalledWith({
      paths: {}, schools: openMagic.schools,
    }))

    setPath('fire', 3)
    await waitFor(() => expect(postSandboxCastable).toHaveBeenLastCalledWith({
      paths: { fire: 3 }, schools: openMagic.schools,
    }))

    await waitFor(() => expect(screen.getByTestId('lab-script-add')).toHaveTextContent('Ember'))
    fireEvent.change(screen.getByTestId('lab-script-add'), { target: { value: 'fireball' } })
    expect(screen.getByTestId('lab-script-remove-fireball')).toBeInTheDocument()
  })
})

describe('what the launch carries (D1 / D2)', () => {
  it('attaches per-body paths and scripts, and omits what was never set', async () => {
    postSandboxCastable.mockResolvedValue({
      options: [{ spell: 'fireball', label: 'Ember', description: 'A bolt.' }],
    })
    await openLab()
    placeCasters(2)

    // Only the SECOND body is configured; the first is left as the engine
    // would have him.
    openBody(1)
    setPath('fire', 3)
    await waitFor(() => expect(screen.getByTestId('lab-script-add')).toHaveTextContent('Ember'))
    fireEvent.change(screen.getByTestId('lab-script-add'), { target: { value: 'fireball' } })

    fireEvent.change(screen.getByTestId('lab-school-evocation'), { target: { value: '4' } })
    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith({
      player_placement: [
        // Body #1 carries NOTHING — absence is how the engine's own default is
        // asked for (SB-7), and an empty bag would overwrite his craft's seed.
        { unit_type: 'Mage', q: 2, r: 4 },
        { unit_type: 'Mage', q: 2, r: 4, paths: { fire: 3 }, script: ['fireball'] },
      ],
      enemy_placement: [],
      magic: {
        blue: { schools: { ...openMagic.schools, evocation: 4 }, channels: 0 },
        red: openMagic,
      },
      runs: 1,
      seed: null,
    }))
  })

  it("sends a caster back to the engine's own choice on demand", async () => {
    await openLab()
    placeCasters(1)
    openBody(0)
    setPath('death', 2)
    fireEvent.click(screen.getByTestId('lab-caster-reset'))

    fireEvent.click(screen.getByTestId('lab-launch'))
    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith(
      expect.objectContaining({
        player_placement: [{ unit_type: 'Mage', q: 2, r: 4 }],
      }),
    ))
  })
})


// ── S3: the batch, the seed and the scenario file ───────────────────────────
//
// SB-10 and SB-11. One battle is one sample from a noisy distribution, so a
// launch is a BATCH and the readout is a win rate; the seed answers the other
// question (why did THAT happen) and therefore cannot be batched — which the
// screen says out loud rather than letting a spinner promise ten samples it
// would only ever draw once. SB-11's file is browser-local: no route, no
// schema, and a setup that can be checked into the repo as a fixture.

// A batch as the server sends it back, riding alongside the same summary S1
// returned — additive, so the replay path above is untouched.
const batchSummary = {
  ...summary,
  batch: {
    runs: 4,
    requested: 4,
    seed: null,
    wins: { blue: 3, red: 1, draw: 0 },
    averageSurvivors: { blue: { Soldier: 2.5, Mage: 0.25 }, red: { Zombie: 1 } },
  },
}

const setRuns = (n) =>
  fireEvent.change(screen.getByTestId('lab-runs'), { target: { value: String(n) } })
const setSeed = (text) =>
  fireEvent.change(screen.getByTestId('lab-seed'), { target: { value: text } })

// A pair of soldiers on the field, which is the smallest setup that can launch.
const placeSoldiers = (n = 2) => {
  compose('Soldier', n)
  fireEvent.click(screen.getByTestId('lab-hex-4-4'))
  placeHere('Soldier', n)
}

describe('the batch and the seed (SB-10)', () => {
  it('sends the runs the spinner names, bounded by the server-served ceiling', async () => {
    await openLab()
    placeSoldiers()

    expect(screen.getByTestId('lab-runs')).toHaveAttribute('max', '20')
    setRuns(5)
    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith(
      expect.objectContaining({ runs: 5, seed: null }),
    ))
  })

  it('sends the seed as a number, and an emptied field as no seed at all', async () => {
    await openLab()
    placeSoldiers()

    setSeed('20260829')
    fireEvent.click(screen.getByTestId('lab-launch'))
    await waitFor(() => expect(postSandboxBattle).toHaveBeenLastCalledWith(
      expect.objectContaining({ seed: 20260829 }),
    ))

    // The replay took over, as every launch does; Back lands on the setup that
    // produced it, seed and all.
    await screen.findByText(/Battle Replay/)
    fireEvent.click(screen.getByTestId('replay-back'))
    await screen.findByTestId('lab-palette')

    // Blank is the ABSENCE, not zero — a fresh draw, which is the engine's own
    // behaviour when nothing is set.
    setSeed('')
    fireEvent.click(screen.getByTestId('lab-launch'))
    await waitFor(() => expect(postSandboxBattle).toHaveBeenLastCalledWith(
      expect.objectContaining({ seed: null }),
    ))
  })

  it('holds the runs spinner at one while a seed is set, and says why (E2)', async () => {
    await openLab()
    placeSoldiers()
    setRuns(6)
    expect(screen.getByTestId('lab-runs')).toBeEnabled()
    expect(screen.queryByTestId('lab-seed-note')).not.toBeInTheDocument()

    setSeed('7')
    // A repeated draw sequence is one battle copied, so ten seeded runs would
    // be a win rate read off a single sample.
    expect(screen.getByTestId('lab-runs')).toBeDisabled()
    expect(screen.getByTestId('lab-seed-note')).toHaveTextContent(/fights once/)

    setSeed('')
    expect(screen.getByTestId('lab-runs')).toBeEnabled()
  })

  it('reads the aggregate back: wins, the rate, and average survivors (E3)', async () => {
    postSandboxBattle.mockResolvedValue(batchSummary)
    await openLab()
    placeSoldiers()
    setRuns(4)
    fireEvent.click(screen.getByTestId('lab-launch'))

    // The replay is the batch's FIRST run and takes over the screen exactly as
    // a single launch always has; the aggregate is waiting underneath it.
    await screen.findByText(/Battle Replay/)
    fireEvent.click(screen.getByTestId('replay-back'))

    const readout = await screen.findByTestId('lab-batch')
    expect(readout).toHaveTextContent('4 of 4 runs')
    expect(screen.getByTestId('lab-batch-wins')).toHaveTextContent('Blue 3 (75%)')
    expect(screen.getByTestId('lab-batch-wins')).toHaveTextContent('Red 1 (25%)')
    expect(screen.getByTestId('lab-batch-survivors-blue')).toHaveTextContent('Soldier 2.5')
    expect(screen.getByTestId('lab-batch-survivors-red')).toHaveTextContent('Zombie 1.0')
    expect(screen.queryByTestId('lab-batch-incomplete')).not.toBeInTheDocument()
  })

  it('says when a batch ended early, and still reports what it got (E4)', async () => {
    postSandboxBattle.mockResolvedValue({
      ...batchSummary,
      batch: { ...batchSummary.batch, runs: 2, requested: 9, incomplete: 'game battle: timed out' },
    })
    await openLab()
    placeSoldiers()
    fireEvent.click(screen.getByTestId('lab-launch'))
    await screen.findByText(/Battle Replay/)
    fireEvent.click(screen.getByTestId('replay-back'))

    expect(await screen.findByTestId('lab-batch')).toHaveTextContent('2 of 9 runs')
    expect(screen.getByTestId('lab-batch-incomplete')).toHaveTextContent(/timed out/)
  })
})

describe('the scenario file (SB-11)', () => {
  // The browser's half of a download, which jsdom has neither of: the object
  // URL is captured so the test can read the very Blob the player would have
  // saved, and the anchor's click is stubbed because jsdom cannot navigate.
  const captureDownload = () => {
    const saved = {}
    global.URL.createObjectURL = vi.fn((blob) => { saved.blob = blob; return 'blob:lab-scenario' })
    global.URL.revokeObjectURL = vi.fn((url) => { saved.revoked = url })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    return saved
  }

  // jsdom has FileReader but not Blob.text(), so this is how the test reads the
  // very bytes the player's file would have held.
  const blobText = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })

  // The anchor spy is on a shared prototype, so it goes back the way it was
  // rather than leaving every later click stubbed.
  afterEach(() => vi.restoreAllMocks())

  const importFile = (text) =>
    fireEvent.change(screen.getByTestId('lab-import'), {
      target: { files: [new File([text], 'lab-scenario.json', { type: 'application/json' })] },
    })

  // Both sides composed, placed, magicked and scripted — everything the store
  // holds that IS the scenario (S1's armies and placements, S2's per-side magic
  // and per-body caster configs, S3's two launch numbers).
  const buildSetup = async () => {
    postSandboxCastable.mockResolvedValue({
      options: [{ spell: 'fireball', label: 'Ember', description: 'A bolt.' }],
    })
    placeSoldiers(3)
    // The menu is still open on that hex, so the Mage joins the same stack
    // without a second click (which would toggle the hex shut).
    compose('Mage', 1)
    placeHere('Mage', 1)
    openBody(0)
    setPath('fire', 3)
    await waitFor(() => expect(screen.getByTestId('lab-script-add')).toHaveTextContent('Ember'))
    fireEvent.change(screen.getByTestId('lab-script-add'), { target: { value: 'fireball' } })
    fireEvent.change(screen.getByTestId('lab-channels'), { target: { value: '5' } })

    fireEvent.click(screen.getByTestId('lab-side-red'))
    compose('Zombie', 4)
    fireEvent.click(screen.getByTestId('lab-hex-3-25'))
    placeHere('Zombie', 4)
    fireEvent.change(screen.getByTestId('lab-school-evocation'), { target: { value: '2' } })
    fireEvent.click(screen.getByTestId('lab-side-blue'))

    setRuns(6)
    setSeed('20260829')
  }

  it('exports a versioned file and imports it back, setup for setup', async () => {
    const saved = captureDownload()
    await openLab()
    await buildSetup()

    fireEvent.click(screen.getByTestId('lab-export'))
    const text = await blobText(saved.blob)
    const scenario = JSON.parse(text)
    // A plain JSON file with a format version — checkable into the repo as a
    // fixture, and refusable by a build that does not know the shape.
    expect(scenario.version).toBe(1)
    expect(scenario.runs).toBe(6)
    expect(scenario.seed).toBe(20260829)
    expect(saved.revoked).toBe('blob:lab-scenario')

    // Now tear the setup down completely — both sides, the magic and the
    // launch numbers — so nothing that comes back could have merely survived.
    fireEvent.click(screen.getByTestId('lab-clear'))
    compose('Soldier', 0)
    compose('Mage', 0)
    fireEvent.change(screen.getByTestId('lab-channels'), { target: { value: '0' } })
    setSeed('')
    setRuns(1)
    fireEvent.click(screen.getByTestId('lab-side-red'))
    fireEvent.click(screen.getByTestId('lab-clear'))
    fireEvent.click(screen.getByTestId('lab-side-blue'))
    expect(screen.queryByTestId('lab-glyph-blue-4-4-Soldier')).not.toBeInTheDocument()

    importFile(text)

    // Both armies, both placements, the magic, the launch numbers…
    expect(await screen.findByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S3')
    expect(screen.getByTestId('lab-glyph-blue-4-4-Mage')).toHaveTextContent('M1')
    expect(screen.getByTestId('lab-recruit-Soldier')).toHaveValue(3)
    expect(screen.getByTestId('lab-channels')).toHaveValue(5)
    expect(screen.getByTestId('lab-runs')).toHaveValue(6)
    expect(screen.getByTestId('lab-seed')).toHaveValue('20260829')

    // …and the CASTER CONFIG, which is the half that would be easiest to lose:
    // it rides on the stack it belongs to, because it is a fact about the i-th
    // body of that stack and means nothing anywhere else.
    openBody(0)
    expect(screen.getByTestId('lab-path-fire')).toHaveValue(3)
    expect(screen.getByTestId('lab-script-remove-fireball')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lab-side-red'))
    expect(screen.getByTestId('lab-glyph-red-3-25-Zombie')).toHaveTextContent('Z4')
    expect(screen.getByTestId('lab-school-evocation')).toHaveValue(2)
  })

  it('leaves the standing setup untouched when the file is malformed', async () => {
    await openLab()
    placeSoldiers(3)
    fireEvent.change(screen.getByTestId('lab-channels'), { target: { value: '5' } })

    importFile('{ this is not a scenario')
    expect(await screen.findByTestId('auth-notice')).toHaveTextContent(/could not be read as JSON/)

    // NOTHING was applied — a wrong file that wiped an army before failing
    // would be the worst outcome this feature could have.
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S3')
    expect(screen.getByTestId('lab-channels')).toHaveValue(5)
  })

  it('refuses a scenario whose shape or version this build does not know', async () => {
    await openLab()
    placeSoldiers(3)

    const good = {
      version: 1,
      blue: { army: { Soldier: 1 }, placements: [], magic: { schools: {}, channels: 0 } },
      red: { army: {}, placements: [], magic: { schools: {}, channels: 0 } },
      runs: 1, seed: null,
    }

    importFile(JSON.stringify({ ...good, version: 99 }))
    await waitFor(() =>
      expect(screen.getByTestId('auth-notice')).toHaveTextContent(/version 1 expected/))
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S3')

    // A side whose placements are not a list of stacks: refused whole, rather
    // than applied as far as the first bad row. Waited for by its TEXT, since
    // the notice bar from the refusal above is already on screen.
    importFile(JSON.stringify({ ...good, red: { ...good.red, placements: [{ type: 'Zombie' }] } }))
    await waitFor(() => expect(screen.getByTestId('auth-notice')).toHaveTextContent(/malformed/))
    expect(screen.getByTestId('lab-glyph-blue-4-4-Soldier')).toHaveTextContent('S3')
    expect(screen.getByTestId('lab-recruit-Soldier')).toHaveValue(3)
  })
})
