/**
 * CHOSEN SPELLS (docs/CAMPAIGN_PLAN.md "SLICE 4 — SCRIPTING") — the three
 * ordered slots on the character sheet naming what a caster reaches for first.
 *
 * The rules live server-side and are tested there; what these pin is what the
 * page SHOWS and what it POSTS. Two things in particular, because both are easy
 * to get quietly wrong:
 *
 *   • the list it sends is COMPACTED and ordered (S4-1) — position is priority,
 *     so a cleared slot promotes what was under it rather than leaving a hole;
 *   • the section stays live while its owner is AWAY (S4-4), unlike every other
 *     control on this page, because a mage's own judgement is not an order sent
 *     to the field.
 *
 * The SHORTLIST (the casting AI, A-7) is here too, beneath them, because it is
 * the same subject one step later — what he improvises with once the slots are
 * spent — and it shares this file's fixtures rather than copying them.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
  hireRecruit: vi.fn(),
  openRecruit: vi.fn(),
  takeSquadUpgrade: vi.fn(),
  attachCharacter: vi.fn(),
  setCharacterHangBack: vi.fn(),
  setChosenSpells: vi.fn(),
  setShortlist: vi.fn(),
  equipCharacterItem: vi.fn(),
  unequipCharacterItem: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, setChosenSpells, setShortlist } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'
import { openCharacterSheet } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// Rows exactly as the server sends them: resolved and phrased, wearing the
// label of the strongest FORM this caster qualifies for (S4-2).
const EMBER = {
  spell: 'fireball', label: 'Ember', description: 'A single bolt of fire at range.',
  battlefield: false, poolCost: 0,
}
const MIST = {
  spell: 'mist', label: 'Mist', description: 'A cold fog gathers.',
  battlefield: false, poolCost: 0,
}
const SNARE = {
  spell: 'briar_snare', label: 'Briar Snare', description: 'Briars erupt underfoot.',
  battlefield: false, poolCost: 0,
}
// A battlefield enchantment (slice A, E-2/E-3): priced in the ARMY's pool, and
// carrying the finished sentence that says so. The page prints it; it composes
// nothing (17-5).
const POOL_LINE = "Draws 2 from the army's pool — once per battle, and only when scripted."
const WINDS = {
  spell: 'soothing_winds', label: 'Soothing Winds',
  description: 'A kind wind runs the line.',
  battlefield: true, poolCost: 2, poolLine: POOL_LINE,
}

const SHORTLIST_LINE = 'Left empty, Isolde may reach for anything he can cast.'

const character = (over = {}) => ({
  id: 1,
  name: 'Isolde',
  type: 'Mage',
  squadId: null,
  hangBack: true,
  alive: true,
  diedDay: null,
  slots: [{ slot: 'head', label: 'head', count: 1 }],
  items: [],
  mods: {},
  sheet: [{ stat: 'maxHP', label: 'stamina', base: 10, delta: 0, value: 10 }],
  paths: [{ path: 'fire', label: 'Fire', level: 2 }],
  awayBlocker: null,
  chosenSpells: { max: 3, chosen: [], options: [EMBER, MIST, SNARE] },
  // The shortlist block's own view (A-7), sent for the same casters and under
  // the same absence rule. `line` is the server's sentence about what an empty
  // list does; the page prints it and composes nothing (17-5).
  shortlist: { max: 2, chosen: [], options: [EMBER, MIST, SNARE], line: SHORTLIST_LINE },
  ...over,
})

const open = async (over = {}) => {
  getCampaigns.mockResolvedValue([{ ...campaignFixture, characters: [character(over)], items: [] }])
  render(<App />)
  await screen.findByText(/War Council/)
  await openCharacterSheet(1)
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
  setChosenSpells.mockImplementation(async () => ({
    ...campaignFixture, characters: [character()], items: [],
  }))
  setShortlist.mockImplementation(async () => ({
    ...campaignFixture, characters: [character()], items: [],
  }))
})

const pick = (slot, value) =>
  fireEvent.change(screen.getByTestId(`sheet-spell-1-${slot}`), { target: { value } })
const sent = () => setChosenSpells.mock.calls.at(-1)[2]

describe('the slots', () => {
  it('draws one per slot allowed, each offering everything he can cast', async () => {
    await open()
    for (const slot of [0, 1, 2]) {
      const select = screen.getByTestId(`sheet-spell-1-${slot}`)
      expect([...select.options].map((o) => o.textContent)).toEqual(
        ['— nothing in particular —', 'Ember', 'Mist', 'Briar Snare'],
      )
    }
  })

  it('says plainly that the list is a preference, not a repertoire', async () => {
    // The one sentence standing between the player and thinking a badly
    // scripted caster has gone mute (S4-1).
    await open()
    expect(screen.getByTestId('sheet-spellnote-1').textContent)
      .toMatch(/casts as he judges best/i)
  })

  it('shows the chosen spell and its description, in the order chosen', async () => {
    await open({ chosenSpells: { max: 3, chosen: [MIST, EMBER], options: [EMBER, MIST, SNARE] } })
    expect(screen.getByTestId('sheet-spell-1-0').value).toBe('mist')
    expect(screen.getByTestId('sheet-spell-1-1').value).toBe('fireball')
    expect(screen.getByTestId('sheet-spell-1-2').value).toBe('')
    expect(screen.getByTestId('sheet-spellblurb-1-0')).toHaveTextContent('A cold fog gathers.')
  })

  it('says so when there is nothing he can cast yet, rather than drawing empty slots', async () => {
    await open({ chosenSpells: { max: 3, chosen: [], options: [] } })
    expect(screen.getByTestId('sheet-nospells-1')).toBeInTheDocument()
    expect(screen.queryByTestId('sheet-spell-1-0')).not.toBeInTheDocument()
  })

  it('is absent entirely for someone who will never cast', async () => {
    const { chosenSpells: _none, shortlist: _neither, ...noCaster } = character()
    await open({ ...noCaster, chosenSpells: undefined, shortlist: undefined })
    expect(screen.queryByTestId('sheet-spell-1-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sheet-nospells-1')).not.toBeInTheDocument()
    // The checklist goes with them: absence is what tells the sheet not to draw
    // a section at all, for both lists.
    expect(screen.queryByTestId('sheet-shortlist-1')).not.toBeInTheDocument()
  })
})

// The two sentences slice A adds. Both are written server-side and printed
// here word for word (17-5) — what these pin is that the page prints them WHEN
// the row carries them and stays silent when it does not. No test here asserts
// the wording's arithmetic; that is magic.js's, and it is pinned there.
describe('battlefield enchantments (E-2/E-3)', () => {
  it('prints the pool sentence under a scripted battlefield spell', async () => {
    await open({ chosenSpells: { max: 3, chosen: [WINDS], options: [WINDS, EMBER] } })
    expect(screen.getByTestId('sheet-spellpool-1-0')).toHaveTextContent(POOL_LINE)
  })

  it('says nothing about a pool for an ordinary spell', async () => {
    await open({ chosenSpells: { max: 3, chosen: [EMBER], options: [EMBER, MIST, SNARE] } })
    expect(screen.queryByTestId('sheet-spellpool-1-0')).not.toBeInTheDocument()
  })

  it('shows the clash warning verbatim when the server sends one', async () => {
    // A WARNING, not a refusal: the slot is still his and still postable — the
    // engine's once-per-side rule is what actually holds (E-4).
    const warning = 'Bettina has this scripted too — it can only take hold once per battle.'
    await open({
      chosenSpells: { max: 3, chosen: [{ ...WINDS, warning }], options: [WINDS, EMBER] },
    })
    expect(screen.getByTestId('sheet-spellwarn-1-0')).toHaveTextContent(warning)
    expect(screen.getByTestId('sheet-spell-1-0')).not.toBeDisabled()
  })

  it('shows no warning where the server sent none', async () => {
    await open({ chosenSpells: { max: 3, chosen: [WINDS], options: [WINDS, EMBER] } })
    expect(screen.queryByTestId('sheet-spellwarn-1-0')).not.toBeInTheDocument()
  })
})

describe('what it posts (S4-1)', () => {
  it('sends the whole ordered list, not one slot', async () => {
    await open()
    pick(0, 'fireball')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
    expect(sent()).toEqual(['fireball'])
  })

  it('appends into the next free slot without leaving a hole', async () => {
    // Choosing in the THIRD slot while only one is filled must not send a
    // sparse list — position is priority, so it lands second.
    await open({ chosenSpells: { max: 3, chosen: [EMBER], options: [EMBER, MIST, SNARE] } })
    pick(2, 'mist')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
    expect(sent()).toEqual(['fireball', 'mist'])
  })

  it('clearing a slot promotes what was under it', async () => {
    await open({ chosenSpells: { max: 3, chosen: [EMBER, MIST], options: [EMBER, MIST, SNARE] } })
    pick(0, '')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
    expect(sent()).toEqual(['mist'])
  })

  it('picking a spell already chosen MOVES it rather than repeating it', async () => {
    // The server refuses the same spell twice; a move is plainly what the
    // player meant, and reads better than a refusal they must decode.
    await open({ chosenSpells: { max: 3, chosen: [EMBER, MIST], options: [EMBER, MIST, SNARE] } })
    pick(0, 'mist')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
    expect(sent()).toEqual(['mist', 'fireball'])
  })

  it('replacing a filled slot keeps the list the same length', async () => {
    await open({ chosenSpells: { max: 3, chosen: [EMBER, MIST], options: [EMBER, MIST, SNARE] } })
    pick(1, 'briar_snare')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
    expect(sent()).toEqual(['fireball', 'briar_snare'])
  })
})

describe('who may change it (S4-4)', () => {
  it('stays live while the caster is away, unlike everything else on the page', async () => {
    await open({ awayBlocker: 'Away on a mission', squadId: 1 })
    expect(screen.getByTestId('sheet-spell-1-0')).not.toBeDisabled()
    // The gear and the posting are refused out there, and the page says so.
    expect(screen.getByTestId('sheet-away-1')).toBeInTheDocument()
    pick(0, 'fireball')
    await waitFor(() => expect(setChosenSpells).toHaveBeenCalled())
  })

  it('is read-only for the dead — a record takes no orders', async () => {
    await open({ alive: false, diedDay: 4 })
    expect(screen.getByTestId('sheet-spell-1-0')).toBeDisabled()
  })
})

// THE SHORTLIST (docs/CAMPAIGN_PLAN.md "THE CASTING AI", A-7) — the checklist
// beneath the slots. A different control for a different mechanic: the engine
// draws from this by lottery (A-2), so a box is membership and nothing more,
// and the list it posts is unordered.
describe('the shortlist (A-7)', () => {
  const tick = (spell) => fireEvent.click(screen.getByTestId(`sheet-shortlist-1-${spell}`))
  const fenced = () => setShortlist.mock.calls.at(-1)[2]

  it('offers a box per spell he can improvise with, ticked where he is fenced', async () => {
    await open({ shortlist: { max: 2, chosen: [MIST], options: [EMBER, MIST], line: SHORTLIST_LINE } })
    expect(screen.getByTestId('sheet-shortlist-1-mist')).toBeChecked()
    expect(screen.getByTestId('sheet-shortlist-1-fireball')).not.toBeChecked()
  })

  it('prints the server\'s sentence about an empty list, and composes none of its own', async () => {
    // The one thing about this control a player cannot guess by looking: empty
    // is the WIDEST setting, not the narrowest.
    await open()
    expect(screen.getByTestId('sheet-shortlistnote-1')).toHaveTextContent(SHORTLIST_LINE)
  })

  it('ticking sends the whole list, with the new id on it', async () => {
    await open({ shortlist: { max: 2, chosen: [EMBER], options: [EMBER, MIST], line: SHORTLIST_LINE } })
    tick('mist')
    await waitFor(() => expect(setShortlist).toHaveBeenCalled())
    expect(fenced()).toEqual(['fireball', 'mist'])
  })

  it('unticking sends the list without it — clearing is just a shorter list', async () => {
    await open({ shortlist: { max: 2, chosen: [EMBER, MIST], options: [EMBER, MIST], line: SHORTLIST_LINE } })
    tick('fireball')
    await waitFor(() => expect(setShortlist).toHaveBeenCalled())
    expect(fenced()).toEqual(['mist'])
  })

  it('at the cap the unticked boxes disable, and the ticked ones still untick', async () => {
    // Greyed rather than gone: what he could still have been fenced to is worth
    // seeing, and a list that reflows as it fills is worse to use than one that
    // greys. Unticking must stay possible or the cap is a trap.
    await open({
      shortlist: { max: 2, chosen: [EMBER, MIST], options: [EMBER, MIST, SNARE], line: SHORTLIST_LINE },
    })
    expect(screen.getByTestId('sheet-shortlist-1-briar_snare')).toBeDisabled()
    expect(screen.getByTestId('sheet-shortlist-1-fireball')).not.toBeDisabled()
  })

  it('draws nothing at all when there is nothing he could improvise with', async () => {
    // A caster whose only castable spell is a battlefield global has an EMPTY
    // options list server-side (E-3), and an empty checklist is a control that
    // can do nothing — so it is not drawn.
    await open({ shortlist: { max: 2, chosen: [], options: [], line: SHORTLIST_LINE } })
    expect(screen.queryByTestId('sheet-shortlist-1')).not.toBeInTheDocument()
  })

  it('stays live while the caster is away, like the slots above it (S4-4)', async () => {
    await open({ awayBlocker: 'Away on a mission', squadId: 1 })
    expect(screen.getByTestId('sheet-shortlist-1-fireball')).not.toBeDisabled()
  })

  it('is read-only for the dead — a record takes no orders', async () => {
    await open({ alive: false, diedDay: 4 })
    expect(screen.getByTestId('sheet-shortlist-1-fireball')).toBeDisabled()
  })
})
