/**
 * THE CHARACTER SHEET (docs/CAMPAIGN_PLAN.md, decision 9-16) — one page per
 * character, reached from the company roll: the stats with their modifiers
 * folded in, every slot the body has and what fills it, equip and unequip
 * against the store, the posting and the hang-back order.
 *
 * What these tests are about is what the page SHOWS and what it POSTS. Every
 * number and every sentence on it is the server's — `sheet` rows arrive
 * resolved, `slots` arrive phrased, worn items carry the store's own lines
 * (17-5) — so the fixtures here are shaped exactly like the wire, and the rules
 * behind them are tested in campaign-server's characters/campaigns suites.
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
  equipCharacterItem: vi.fn(),
  unequipCharacterItem: vi.fn(),
}))

import {
  getInfo, getMap, getCampaigns, attachCharacter, setCharacterHangBack,
  equipCharacterItem, unequipCharacterItem,
} from '../services/api'
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

// The body plan as the server phrases it (9-16): the slots that exist, in
// order, with their player-facing words. Two hands, because a stacking piece of
// kit in one of two positions is the case that made `index` load-bearing (9-6).
const HUMANOID = [
  { slot: 'head', label: 'head', count: 1 },
  { slot: 'torso', label: 'body', count: 1 },
  { slot: 'legs', label: 'legs', count: 1 },
  { slot: 'hand', label: 'hand', count: 2 },
  { slot: 'misc', label: 'kit', count: 1 },
]

const SHEET = [
  { stat: 'maxHP', label: 'stamina', base: 10, delta: 0, value: 10 },
  { stat: 'attack', label: 'attack', base: 6, delta: 0, value: 6 },
  { stat: 'defence', label: 'defence', base: 4, delta: 1, value: 5 },
  { stat: 'speed', label: 'speed', base: 3, delta: -1, value: 2 },
]

const HELM = {
  slot: 'head', index: 0, id: 'gear_iron_helm', name: 'Iron Helm',
  blurb: 'Plain, heavy and dented in three places.',
  permanent: false, unique: false,
  effect: 'It gives its bearer +1 defence.',
  where: 'Worn by a character, in a head slot.',
  binding: 'It can be taken back later and given to something else.',
}

// The store row for the same helm, as the stores send it: `slot` rides along so
// a typed slot can filter to what fits it (9-16).
const HELM_IN_STORE = {
  id: 'gear_iron_helm', kind: 'gear', slot: 'head', name: 'Iron Helm',
  blurb: 'Plain, heavy and dented in three places.', target: 'character',
  permanent: false,
  effect: 'It gives its bearer +1 defence.',
  where: 'Worn by a character, in a head slot.',
  binding: 'It can be taken back later and given to something else.',
}

const BLADE_IN_STORE = {
  id: 'gear_soldiers_blade', kind: 'gear', slot: 'hand', name: "Soldier's Blade",
  blurb: 'An arming sword off the muster rolls.', target: 'character',
  permanent: false,
  effect: 'It gives its bearer +1 attack.',
  where: 'Worn by a character, in a hand slot.',
  binding: 'It can be taken back later and given to something else.',
}

const character = (over = {}) => ({
  id: 1,
  name: 'Isolde',
  type: 'Mage',
  squadId: null,
  hangBack: true,
  alive: true,
  diedDay: null,
  slots: HUMANOID,
  items: [],
  mods: {},
  sheet: SHEET,
  paths: [
    { path: 'fire', label: 'Fire', level: 2 },
    { path: 'water', label: 'Water', level: 1 },
  ],
  awayBlocker: null,
  ...over,
})

const withCharacter = (over = {}, campaignOver = {}) => ({
  ...campaignFixture,
  characters: [character(over)],
  items: [],
  ...campaignOver,
})

const open = async (campaign, id = 1) => {
  getCampaigns.mockResolvedValue([campaign])
  render(<App />)
  await screen.findByText(/War Council/)
  await openCharacterSheet(id)
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
})

describe('the paths a caster commands (docs/CAMPAIGN_PLAN.md "▶ SLICE 2", S2-13)', () => {
  it('names them beside the character, so the hire gamble pays off the turn you take it', async () => {
    await open(withCharacter())
    // Phrased and ordered by the SERVER (17-5) — this page joins the rows it is
    // handed and holds no copy of the engine's vocabulary to name a path with.
    expect(await screen.findByTestId('sheet-paths-1')).toHaveTextContent('Fire 2 · Water 1')
  })

  it('a caster who commands nothing says so rather than showing an empty line', async () => {
    await open(withCharacter({ paths: [] }))
    expect(await screen.findByTestId('sheet-nopaths-1')).toBeInTheDocument()
  })

  it('a character the server sent no paths for is treated as commanding nothing', async () => {
    await open(withCharacter({ paths: undefined }))
    expect(await screen.findByTestId('sheet-nopaths-1')).toBeInTheDocument()
  })
})

describe('the sheet', () => {
  it('shows the numbers with what the kit is worth beside them', async () => {
    await open(withCharacter())
    // The TOTAL is the number: the question a sheet answers is "how good are
    // they", and the modifier is the follow-up. Both come from the server —
    // this page folds no arithmetic of its own.
    expect(screen.getByTestId('sheet-stat-1-defence')).toHaveTextContent('5')
    expect(screen.getByTestId('sheet-delta-1-defence')).toHaveTextContent('+1')
    expect(screen.getByTestId('sheet-delta-1-speed')).toHaveTextContent('−1')
    // A stat nothing moved says nothing at all — a column of ±0 is noise.
    expect(screen.getByTestId('sheet-delta-1-attack')).toHaveTextContent('')
    // 9-5's vocabulary, in the server's words rather than the engine's.
    expect(screen.getByTestId('sheet-stat-1-maxHP')).toHaveTextContent('stamina')
  })

  it('says so plainly when the catalog knows nothing about the type', async () => {
    // Null, never a table of zeroes: "nothing is known" and "everything is
    // zero" are different sentences, and the screen says the first.
    await open(withCharacter({ sheet: null, slots: null }))
    expect(screen.getByTestId('sheet-unknown-1')).toHaveTextContent('Mage')
    expect(screen.getByTestId('sheet-noslots-1')).toBeInTheDocument()
  })

  it('draws every slot the body has, one row per position', async () => {
    await open(withCharacter({ items: [HELM] }))
    expect(screen.getByTestId('sheet-worn-1-head-0')).toHaveTextContent('Iron Helm')
    // The item's lines are the STORE's lines (17-5) — one wording site.
    expect(screen.getByTestId('sheet-effect-1-head-0')).toHaveTextContent('+1 defence')
    expect(screen.getByTestId('sheet-empty-1-torso-0')).toBeInTheDocument()
    // Two hands are two rows, and the second one is reachable (9-6).
    expect(screen.getByTestId('sheet-slot-1-hand-0')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-slot-1-hand-1')).toBeInTheDocument()
    // A slot the creature does not have is never drawn — the server sends only
    // the ones that exist.
    expect(screen.queryByTestId('sheet-slot-1-wing-0')).toBeNull()
  })

  it('names where a character stands, by squad name rather than by id', async () => {
    await open(withCharacter({ squadId: 1 }))
    expect(screen.getByTestId('sheet-standing-1')).toHaveTextContent('1st Cohort')
  })
})

describe('filling a slot', () => {
  it('opens the store filtered to what THAT slot takes', async () => {
    // Every piece of gear is kind `gear`, so a head slot that filtered on kind
    // alone would offer the blade too (9-16).
    await open(withCharacter({}, { items: [HELM_IN_STORE, BLADE_IN_STORE] }))
    fireEvent.click(screen.getByTestId('sheet-fill-1-head-0'))

    const store = await screen.findByTestId('item-store')
    expect(store).toHaveTextContent('Isolde')
    expect(store).toHaveTextContent('head slot')
    expect(screen.getByTestId('store-item-gear_iron_helm')).toBeInTheDocument()
    expect(screen.queryByTestId('store-item-gear_soldiers_blade')).toBeNull()
  })

  it('posts the slot, the position and the id the store offered', async () => {
    equipCharacterItem.mockResolvedValue(withCharacter({ items: [HELM] }))
    await open(withCharacter({}, { items: [HELM_IN_STORE, BLADE_IN_STORE] }))
    // The SECOND hand: `index` is not a detail, it is which of two identical
    // blades comes off later (9-6).
    fireEvent.click(screen.getByTestId('sheet-fill-1-hand-1'))
    fireEvent.click(await screen.findByTestId('store-choose-gear_soldiers_blade'))

    await waitFor(() => expect(equipCharacterItem).toHaveBeenCalledTimes(1))
    expect(equipCharacterItem).toHaveBeenCalledWith(campaignFixture.id, 1, {
      slot: 'hand', index: 1, itemId: 'gear_soldiers_blade',
    })
    // …and the store closes back onto the sheet the slot was clicked from: the
    // squad screen was never unmounted underneath it (13-7's pattern).
    expect(await screen.findByTestId('character-sheet-1')).toBeInTheDocument()
  })

  it('does not warn about permanence for kit that comes off again', async () => {
    // The confirm step is keyed on the ROW's `permanent` (9-16), not on which
    // kind of slot asked: a warning that a helm can never be taken back would
    // be a lie, and the banner's own confirm is unaffected (banners.test.jsx).
    equipCharacterItem.mockResolvedValue(withCharacter({ items: [HELM] }))
    await open(withCharacter({}, { items: [HELM_IN_STORE] }))
    fireEvent.click(screen.getByTestId('sheet-fill-1-head-0'))
    fireEvent.click(await screen.findByTestId('store-choose-gear_iron_helm'))

    expect(screen.queryByTestId('store-warn-gear_iron_helm')).toBeNull()
    await waitFor(() => expect(equipCharacterItem).toHaveBeenCalledTimes(1))
  })

  it('takes a piece off from the sheet, by slot and position', async () => {
    // 17-3/17-2: unassign belongs to the HOLDER's screen, never to the store —
    // the holder is the only thing that knows where a piece is worn.
    unequipCharacterItem.mockResolvedValue(withCharacter())
    await open(withCharacter({ items: [HELM] }))
    fireEvent.click(screen.getByTestId('sheet-unequip-1-head-0'))

    await waitFor(() => expect(unequipCharacterItem).toHaveBeenCalledTimes(1))
    expect(unequipCharacterItem).toHaveBeenCalledWith(campaignFixture.id, 1, {
      slot: 'head', index: 0,
    })
  })

  it('offers no way to remove a piece that cannot be removed', async () => {
    // A button that can only be refused is worse than no button. The row
    // declares its own permanence, so the day a permanent piece of gear is
    // authored, the sheet already tells the truth about it.
    // `binding` is derived from `permanent` server-side, so a fixture that
    // flips one flips the other — the sentence IS the server's.
    await open(withCharacter({
      items: [{
        ...HELM,
        permanent: true,
        binding: 'Once it is given, it stays: it cannot be taken back, and nothing else will ever carry it.',
      }],
    }))
    expect(screen.queryByTestId('sheet-unequip-1-head-0')).toBeNull()
    expect(screen.getByTestId('sheet-stuck-1-head-0')).toHaveTextContent('cannot be taken back')
  })
})

describe('giving orders', () => {
  it('posts a character to a charter, by id', async () => {
    attachCharacter.mockResolvedValue(withCharacter())
    await open(withCharacter())
    fireEvent.change(screen.getByTestId('sheet-squad-1'), { target: { value: '2' } })
    await waitFor(() => expect(attachCharacter).toHaveBeenCalledWith(campaignFixture.id, 1, 2))
  })

  // Detaching is what makes riding along at full risk a fair deal (5-8), so the
  // way home has to be on the screen and not only in the API.
  it('brings a character home by choosing camp', async () => {
    attachCharacter.mockResolvedValue(withCharacter())
    await open(withCharacter({ squadId: 1 }))
    fireEvent.change(screen.getByTestId('sheet-squad-1'), { target: { value: '' } })
    await waitFor(() => expect(attachCharacter).toHaveBeenCalledWith(campaignFixture.id, 1, null))
  })

  it('toggles hang-back, whatever the character’s type', async () => {
    setCharacterHangBack.mockResolvedValue(withCharacter())
    await open(withCharacter())
    const toggle = screen.getByTestId('sheet-hangback-1')
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(setCharacterHangBack).toHaveBeenCalledWith(campaignFixture.id, 1, false))
  })
})

describe('when nothing can be changed', () => {
  it('locks the whole sheet while the bearer is away, in the server’s words', async () => {
    // 9-8/9-9: equipping AND posting are both refused out there, so the page
    // greys out together rather than in halves — otherwise the equipment lock
    // is advisory (detach, re-kit, re-attach is three clicks).
    await open(withCharacter({
      squadId: 1,
      items: [HELM],
      awayBlocker: 'Isolde is out raiding with 1st Cohort',
    }))
    expect(screen.getByTestId('sheet-away-1')).toHaveTextContent('out raiding')
    expect(screen.getByTestId('sheet-unequip-1-head-0')).toBeDisabled()
    expect(screen.getByTestId('sheet-fill-1-torso-0')).toBeDisabled()
    expect(screen.getByTestId('sheet-squad-1')).toBeDisabled()
    expect(screen.getByTestId('sheet-hangback-1')).toBeDisabled()
  })

  it('shows the dead with what they were still carrying, and no orders at all', async () => {
    // 5-9: the record survives with everything on it, because a later recovery
    // has to have something to find.
    await open(withCharacter({ alive: false, diedDay: 4, items: [HELM] }))
    expect(screen.getByTestId('sheet-standing-1')).toHaveTextContent('day 4')
    expect(screen.getByTestId('sheet-worn-1-head-0')).toHaveTextContent('Iron Helm')
    expect(screen.queryByTestId('sheet-squad-1')).toBeNull()
    expect(screen.queryByTestId('sheet-hangback-1')).toBeNull()
    expect(screen.getByTestId('sheet-unequip-1-head-0')).toBeDisabled()
  })
})

describe('finding the way out', () => {
  it('walks back the way it was walked in', async () => {
    await open(withCharacter())
    fireEvent.click(screen.getByTestId('squad-screen-company'))
    expect(await screen.findByTestId('character-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('squad-screen-roll'))
    expect(await screen.findByTestId('squad-roll')).toBeInTheDocument()
  })

  it('does not crash on a character who is gone from under it', async () => {
    // A fresh campaign or a 404 recovery can empty the rolls under the page;
    // the company is one click away and that is the whole answer.
    getCampaigns.mockResolvedValue([withCharacter()])
    render(<App />)
    await screen.findByText(/War Council/)
    await openCharacterSheet(1)

    const { default: store } = await import('../stores/useCampaignStore')
    store.setState({ campaign: { ...campaignFixture, characters: [] } })
    expect(await screen.findByTestId('sheet-missing')).toBeInTheDocument()
  })
})
