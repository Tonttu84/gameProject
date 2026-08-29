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
import useCampaignStore from '../stores/useCampaignStore'

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
  // S4: the engine's six hexside names, in its own declaration order. The wall
  // painter draws its toggles straight off this rather than holding a copy.
  hexDirections: ['NE', 'E', 'SE', 'SW', 'W', 'NW'],
  enemyPreset: {
    schools: { evocation: 1, conjuration: 2, enchantment: 1, construction: 0 },
    channels: 3,
  },
  limits: {
    maxPathLevel: 9, maxSchoolLevel: 9, maxChannels: 99, openSchoolLevel: 9, maxRuns: 20,
    maxWallSides: 120, maxWallDurability: 5000, maxReinforcements: 20, maxReinforceCount: 500,
  },
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

    // S4's two extras are SCENARIO-level (F1/F3) — one wall list for the field
    // and one wave list for both sides — so they ride the file beside the
    // launch numbers rather than inside either side's block.
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    fireEvent.click(screen.getByTestId('lab-wall-SE'))
    fireEvent.change(screen.getByTestId('lab-wall-durability-SE'), { target: { value: '250' } })
    fireEvent.click(screen.getByTestId('lab-reinforce-add'))
    fireEvent.change(screen.getByTestId('lab-reinforce-count-0'), { target: { value: '40' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-tick-0'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-message-0'), {
      target: { value: 'The gates open!' },
    })

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
    // BUMPED BY S4: the format grew the walls and the waves, and the version
    // is what a file is refused by, so a format change has to move it.
    expect(scenario.version).toBe(2)
    expect(scenario.runs).toBe(6)
    expect(scenario.seed).toBe(20260829)
    expect(scenario.walls).toEqual([{ q: 2, r: 4, dir: 'SE', durability: 250 }])
    expect(scenario.reinforcements).toEqual([
      { side: 'blue', unit_type: 'Soldier', count: 40, tick: 4, message: 'The gates open!' },
    ])
    expect(saved.revoked).toBe('blob:lab-scenario')

    // Now tear the setup down completely — both sides, the magic and the
    // launch numbers — so nothing that comes back could have merely survived.
    fireEvent.click(screen.getByTestId('lab-clear'))
    // Clearing the placements drops the selection with them, so the wall panel
    // needs its hex picked again before the rampart can be taken down.
    fireEvent.click(screen.getByTestId('lab-hex-4-4'))
    fireEvent.click(screen.getByTestId('lab-wall-SE'))
    fireEvent.click(screen.getByTestId('lab-reinforce-remove-0'))
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

    // …and S4's two scenario-level lists, which belong to neither side.
    expect(screen.getByTestId('lab-wall-line-2-4-SE')).toBeInTheDocument()
    expect(screen.getByTestId('lab-reinforce-count-0')).toHaveValue(40)
    expect(screen.getByTestId('lab-reinforce-message-0')).toHaveValue('The gates open!')
  })

  it('still reads a v1 file, taking its silence about walls as none (F6)', async () => {
    await openLab()
    placeSoldiers(3)

    // A file saved before S4 existed. It is not a shape this build would read
    // WRONGLY — a build that could paint no walls has nothing to say about them
    // — so refusing it would throw away every fixture already saved to buy
    // nothing.
    importFile(JSON.stringify({
      version: 1,
      blue: {
        army: { Zombie: 2 },
        placements: [{ type: 'Zombie', col: 5, row: 5, count: 2 }],
        magic: { schools: { evocation: 4 }, channels: 2 },
      },
      red: { army: {}, placements: [], magic: { schools: {}, channels: 0 } },
      runs: 3,
      seed: null,
    }))

    expect(await screen.findByTestId('lab-glyph-blue-5-5-Zombie')).toHaveTextContent('Z2')
    expect(screen.getByTestId('lab-channels')).toHaveValue(2)
    expect(screen.getByTestId('lab-runs')).toHaveValue(3)
    // Nothing walled and nothing scheduled — the empty both lists are born as.
    expect(screen.queryByTestId('lab-wall-line-2-4-SE')).not.toBeInTheDocument()
    expect(screen.queryByTestId('lab-reinforce-0')).not.toBeInTheDocument()
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
      expect(screen.getByTestId('auth-notice')).toHaveTextContent(/versions 1 and 2 are read here/))
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

// ── S4: the walls, the waves and the prefill (SB-9 / SB-13) ──────────────────
//
// Two BattleInput fields with no other way to be posed as a question — the
// campaign injects walls off its own fort presets and a wave only when the
// garrison sallies — plus the bonus the interview parked: the player's own
// campaign, composed into blue.
describe('painting walls (SB-9 / F1)', () => {
  // Any passable hex may be SELECTED, not only one in the side being edited: a
  // rampart stands where it stands and both armies meet it, so the panel has to
  // reach the middle of the field. Placement stays zone-gated.
  const selectHex = (col, row) => fireEvent.click(screen.getByTestId(`lab-hex-${col}-${row}`))

  it('paints a side on, and paints the same side off again', async () => {
    await openLab()
    selectHex(4, 4)

    fireEvent.click(screen.getByTestId('lab-wall-SE'))
    // Drawn on the edge SHARED by the hex and its neighbour — the very
    // wallSegment the campaign's deployment grid draws its fort with (F2).
    expect(screen.getByTestId('lab-wall-line-2-4-SE')).toBeInTheDocument()
    expect(screen.getByTestId('lab-wall-SE')).toHaveTextContent('walled')

    // The same click takes it down: painting is a toggle, and there is no
    // state in between for a separate "remove" to be about.
    fireEvent.click(screen.getByTestId('lab-wall-SE'))
    expect(screen.queryByTestId('lab-wall-line-2-4-SE')).not.toBeInTheDocument()
  })

  it('offers all six of the engine\'s directions, and no seventh', async () => {
    await openLab()
    selectHex(4, 4)

    for (const dir of reference.hexDirections)
      expect(screen.getByTestId(`lab-wall-${dir}`)).toBeInTheDocument()
    expect(screen.queryByTestId('lab-wall-NORTH')).not.toBeInTheDocument()
  })

  it('belongs to the FIELD, not to a side — it survives the side tab', async () => {
    await openLab()
    selectHex(4, 4)
    fireEvent.click(screen.getByTestId('lab-wall-SE'))

    fireEvent.click(screen.getByTestId('lab-side-red'))
    expect(screen.getByTestId('lab-wall-line-2-4-SE')).toBeInTheDocument()
    // …and an enemy-zone hex paints into the same one list.
    selectHex(3, 25)
    fireEvent.click(screen.getByTestId('lab-wall-W'))
    expect(screen.getByTestId('lab-wall-line--9-25-W')).toBeInTheDocument()
  })

  it('rides the launch, with an unset durability left off entirely', async () => {
    await openLab()
    placeSoldiers(2)
    selectHex(5, 5)
    fireEvent.click(screen.getByTestId('lab-wall-SE'))
    fireEvent.click(screen.getByTestId('lab-wall-SW'))
    fireEvent.change(screen.getByTestId('lab-wall-durability-SW'), { target: { value: '250' } })

    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith(expect.objectContaining({
      // Saying nothing is how the engine's own DEFAULT_FORT_DURABILITY is asked
      // for — the same absence rule the caster fields keep one layer down.
      fortified_sides: [
        { q: 3, r: 5, dir: 'SE' },
        { q: 3, r: 5, dir: 'SW', durability: 250 },
      ],
    })))
  })

  it('sends no fortified_sides at all when nothing is painted', async () => {
    await openLab()
    placeSoldiers(2)
    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalled())
    expect('fortified_sides' in postSandboxBattle.mock.calls[0][0]).toBe(false)
  })
})

describe('scheduling reinforcements (SB-9 / F3)', () => {
  it('adds a row, edits it, and drops it again', async () => {
    await openLab()
    fireEvent.click(screen.getByTestId('lab-reinforce-add'))

    // A row that is legal the moment it appears: the side being edited, the
    // first type in the catalog, one body on turn one.
    expect(screen.getByTestId('lab-reinforce-side-0')).toHaveValue('blue')
    expect(screen.getByTestId('lab-reinforce-count-0')).toHaveValue(1)
    expect(screen.getByTestId('lab-reinforce-tick-0')).toHaveValue(1)

    fireEvent.click(screen.getByTestId('lab-reinforce-remove-0'))
    expect(screen.queryByTestId('lab-reinforce-0')).not.toBeInTheDocument()
  })

  it('carries both sides in ONE list, each row naming whose it is', async () => {
    await openLab()
    placeSoldiers(2)

    fireEvent.click(screen.getByTestId('lab-reinforce-add'))
    fireEvent.change(screen.getByTestId('lab-reinforce-type-0'), { target: { value: 'Cavalry' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-count-0'), { target: { value: '25' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-tick-0'), { target: { value: '6' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-message-0'), {
      target: { value: 'Horsemen on the ridge!' },
    })

    fireEvent.click(screen.getByTestId('lab-reinforce-add'))
    fireEvent.change(screen.getByTestId('lab-reinforce-side-1'), { target: { value: 'red' } })
    fireEvent.change(screen.getByTestId('lab-reinforce-type-1'), { target: { value: 'Zombie' } })

    fireEvent.click(screen.getByTestId('lab-launch'))

    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalledWith(expect.objectContaining({
      // The SIDE stays a word on this wire (F3) — the route turns blue and red
      // into the engine's team integers, so the browser holds no team number.
      // An empty message is left off, like every other empty field the lab
      // sends.
      reinforcements: [
        {
          side: 'blue', unit_type: 'Cavalry', count: 25, tick: 6,
          message: 'Horsemen on the ridge!',
        },
        { side: 'red', unit_type: 'Zombie', count: 1, tick: 1 },
      ],
    })))
  })

  it('reads its bounds off the server, and sends nothing when there are no waves', async () => {
    await openLab()
    placeSoldiers(2)
    fireEvent.click(screen.getByTestId('lab-reinforce-add'))
    expect(screen.getByTestId('lab-reinforce-count-0')).toHaveAttribute('max', '500')

    fireEvent.click(screen.getByTestId('lab-reinforce-remove-0'))
    fireEvent.click(screen.getByTestId('lab-launch'))
    await waitFor(() => expect(postSandboxBattle).toHaveBeenCalled())
    expect('reinforcements' in postSandboxBattle.mock.calls[0][0]).toBe(false)
  })
})

describe('prefilling blue from the campaign (SB-13 / F5)', () => {
  // The campaign view as the server serves it, cut down to the fields the
  // prefill reads: the roster, the characters (with their PHRASED paths and
  // their chosen script), and the research levels.
  const campaign = {
    id: 'campaign-1',
    status: 'active',
    roster: { Soldier: 12, Mage: 1 },
    research: {
      schools: {
        evocation: { level: 3 }, conjuration: { level: 1 },
        enchantment: { level: 2 }, construction: { level: 0 },
      },
    },
    characters: [
      {
        id: 'c1', name: 'Elrid', type: 'Mage', alive: true,
        paths: [{ path: 'fire', label: 'Fire', level: 3 }, { path: 'air', label: 'Air', level: 1 }],
        chosenSpells: { chosen: [{ spell: 'fireball', label: 'Ember' }] },
      },
      // Dead men stay on the rolls (5-9) and off the field.
      { id: 'c2', name: 'Maro', type: 'Mage', alive: false, paths: [], chosenSpells: { chosen: [] } },
      { id: 'c3', name: 'Bram', type: 'Soldier', alive: true, paths: null },
    ],
  }

  // What the server's own spread answers with for that army: the two Mage
  // bodies (the roster's one plus the living character) on one hex, the
  // thirteen foot on another.
  const spread = [
    ...Array.from({ length: 2 }, () => ({ unit_type: 'Mage', q: 2, r: 4 })),
    ...Array.from({ length: 13 }, () => ({ unit_type: 'Soldier', q: 3, r: 5 })),
  ]

  const openWithCampaign = async () => {
    await openLab()
    // Seeded straight into the store: the lab needs no campaign to open (SB-1),
    // so this fixture is the only campaign in the test at all.
    useCampaignStore.setState({ campaign })
    return screen.findByTestId('lab-prefill')
  }

  it('is offered only when a campaign is loaded', async () => {
    await openLab()
    // SB-1 again: the lab opens with no campaign at all, so there is nothing
    // for the prefill to read and the control is simply not there.
    expect(screen.queryByTestId('lab-prefill')).not.toBeInTheDocument()

    useCampaignStore.setState({ campaign })
    expect(await screen.findByTestId('lab-prefill')).toBeInTheDocument()
  })

  it('composes the roster plus one body per LIVING character, and places them', async () => {
    autoPlaceSandbox.mockResolvedValue({ placement: spread })
    await openWithCampaign()

    fireEvent.click(screen.getByTestId('lab-prefill'))

    // A character is not a roster count (5-1), so the Mage who leads the army
    // is a body ADDED to the twelve foot and the roster's own Mage — and the
    // dead one is not.
    await waitFor(() => expect(autoPlaceSandbox).toHaveBeenCalledWith('blue', {
      Soldier: 13, Mage: 2,
    }))
    expect(await screen.findByTestId('lab-glyph-blue-4-4-Mage')).toHaveTextContent('M2')
    expect(screen.getByTestId('lab-glyph-blue-5-5-Soldier')).toHaveTextContent('S13')
    expect(screen.getByTestId('lab-recruit-Soldier')).toHaveValue(13)
  })

  it('sets the school levels from the research already paid for', async () => {
    autoPlaceSandbox.mockResolvedValue({ placement: spread })
    await openWithCampaign()

    fireEvent.click(screen.getByTestId('lab-prefill'))

    await waitFor(() => expect(screen.getByTestId('lab-school-evocation')).toHaveValue(3))
    expect(screen.getByTestId('lab-school-enchantment')).toHaveValue(2)
    expect(screen.getByTestId('lab-school-construction')).toHaveValue(0)
    // THE CHANNEL POOL IS LEFT ALONE, deliberately: a campaign's pool is
    // decided by which bannered squads take the field, and the lab fields loose
    // troops with no squads at all.
    expect(screen.getByTestId('lab-channels')).toHaveValue(0)
    // …and red is untouched, because the prefill is blue's own data.
    fireEvent.click(screen.getByTestId('lab-side-red'))
    expect(screen.getByTestId('lab-school-evocation')).toHaveValue(9)
  })

  it("attaches a caster character's paths and script to a body of his type", async () => {
    autoPlaceSandbox.mockResolvedValue({ placement: spread })
    await openWithCampaign()

    fireEvent.click(screen.getByTestId('lab-prefill'))
    await screen.findByTestId('lab-caster-Mage-4-4-0')

    // Matched to bodies of his own type IN PLACEMENT ORDER — the same rule
    // withCasterPaths follows server-side, because the only thing that tells
    // two Mages apart is the order they were laid out in. Elrid takes body #1;
    // the roster's own Mage behind him is left at the engine's own choice.
    fireEvent.click(screen.getByTestId('lab-caster-Mage-4-4-0'))
    expect(await screen.findByTestId('lab-path-fire')).toHaveValue(3)
    expect(screen.getByTestId('lab-path-air')).toHaveValue(1)
    expect(screen.getByTestId('lab-script-remove-fireball')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('lab-caster-Mage-4-4-1'))
    expect(await screen.findByTestId('lab-path-fire')).toHaveValue(0)
    expect(screen.queryByTestId('lab-script-remove-fireball')).not.toBeInTheDocument()
  })
})
