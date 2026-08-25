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
  equipCharacterItem: vi.fn(),
  unequipCharacterItem: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, setChosenSpells } from '../services/api'
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
const EMBER = { spell: 'fireball', label: 'Ember', description: 'A single bolt of fire at range.' }
const MIST = { spell: 'mist', label: 'Mist', description: 'A cold fog gathers.' }
const SNARE = { spell: 'briar_snare', label: 'Briar Snare', description: 'Briars erupt underfoot.' }

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
    const { chosenSpells: _none, ...noCaster } = character()
    await open({ ...noCaster, chosenSpells: undefined })
    expect(screen.queryByTestId('sheet-spell-1-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sheet-nospells-1')).not.toBeInTheDocument()
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
