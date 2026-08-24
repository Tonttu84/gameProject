/**
 * The company's characters (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS"):
 * named individuals rather than roster counts, postable to a squad, tellable to
 * hang back, and losable for good.
 *
 * The panel is a SCREEN of its own now, reached from the squad screen (13-16):
 * the charter page names who is posted and offers the way through, and the
 * whole roll — the living, their postings, and the fallen — lives here. Since
 * 9b it is a ROLL and nothing else: the orders it used to carry are given on
 * each character's own sheet (characterSheet.test.jsx), so what these tests
 * cover is what it SHOWS and where its buttons LEAD. The rules live in
 * campaign-server's characters/campaigns tests.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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
}))

import { getInfo, getMap, getCampaigns, attachCharacter, setCharacterHangBack } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'
import { openArmy } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const CHARACTERS = [
  { id: 1, name: 'Isolde', type: 'Mage', squadId: null, hangBack: true, alive: true, diedDay: null },
  { id: 2, name: 'Barnabas', type: 'Priest', squadId: 1, hangBack: true, alive: true, diedDay: null },
  { id: 3, name: 'Ceridwen', type: 'Mage', squadId: null, hangBack: false, alive: false, diedDay: 4 },
]

const withCharacters = (characters = CHARACTERS) => ({ ...campaignFixture, characters })

// The company screen, reached the way the player reaches it: the HUD's door to
// the army, then the roll's button to the company.
const toCompany = async (campaign) => {
  getCampaigns.mockResolvedValue([campaign])
  render(<App />)
  await screen.findByText(/War Council/)
  await openArmy()
  fireEvent.click(await screen.findByTestId('roll-to-company'))
  await screen.findByTestId('character-panel')
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

describe('character panel', () => {
  it('names the living and says where each of them stands', async () => {
    await toCompany(withCharacters())
    expect(screen.getByTestId('character-1')).toHaveTextContent('Isolde')
    expect(screen.getByTestId('character-posting-1')).toHaveTextContent('In camp')
    // An attached one reads as with its squad, by NAME rather than by id.
    expect(screen.getByTestId('character-posting-2')).toHaveTextContent('1st Cohort')
  })

  // 9b: the roll LEADS, it no longer acts. The orders moved to the sheet, where
  // the context that should inform them lives; a form on the list and a form on
  // the page would be the "managed in three places" 13-1 exists to end.
  it('leads to each character’s own sheet, and posts nothing itself', async () => {
    await toCompany(withCharacters())
    expect(screen.queryByTestId('character-squad-1')).toBeNull()
    expect(screen.queryByTestId('character-hangback-1')).toBeNull()

    fireEvent.click(screen.getByTestId('character-open-1'))
    expect(await screen.findByTestId('character-sheet-1')).toBeInTheDocument()
    expect(attachCharacter).not.toHaveBeenCalled()
    expect(setCharacterHangBack).not.toHaveBeenCalled()
  })

  // The roll MARKS who is out, the way the squad roll marks a charter that is
  // away — the reason is the server's phrase, and the sheet carries the rest.
  it('marks a character who is away, in the server’s words', async () => {
    await toCompany(withCharacters([
      { ...CHARACTERS[1], awayBlocker: 'Barnabas is out raiding with 1st Cohort' },
      CHARACTERS[0],
    ]))
    expect(screen.getByTestId('character-away-2')).toHaveTextContent('out raiding')
    expect(screen.queryByTestId('character-away-1')).toBeNull()
  })

  // 5-9: the dead are kept, and shown. A name that vanishes reads as a bug
  // rather than as a loss — and a later recovery needs them still on the rolls.
  it('keeps the fallen on the roll, with the day they fell', async () => {
    await toCompany(withCharacters())
    expect(screen.getByTestId('character-dead-3')).toHaveTextContent('Ceridwen')
    expect(screen.getByTestId('character-dead-3')).toHaveTextContent('4')
    // …and their sheet opens too: what a body was still carrying when it was
    // left behind (5-9) is exactly what a later recovery is for.
    fireEvent.click(screen.getByTestId('character-open-3'))
    expect(await screen.findByTestId('character-sheet-3')).toBeInTheDocument()
  })

  it('shows no fallen section when nobody has died', async () => {
    await toCompany(withCharacters(CHARACTERS.filter((c) => c.alive)))
    expect(screen.queryByTestId('character-fallen')).toBeNull()
  })

  // A screen the player navigated to must say something when it is empty — a
  // blank page reads as a broken screen, where a panel that rendered nothing
  // simply was not there.
  it('says so plainly for a company with no characters', async () => {
    getCampaigns.mockResolvedValue([withCharacters([])])
    render(<App />)
    await screen.findByText(/War Council/)
    await openArmy()
    fireEvent.click(await screen.findByTestId('roll-to-company'))
    expect(await screen.findByTestId('character-panel-empty')).toBeInTheDocument()
  })

  // 13-9: an unposted caster is a resource going to waste, so the ROLL names
  // them — the shortfall and its cause on one page.
  it('names the unposted on the roll itself, and the fallen on the way in', async () => {
    getCampaigns.mockResolvedValue([withCharacters()])
    render(<App />)
    await screen.findByText(/War Council/)
    await openArmy()
    expect(screen.getByTestId('roll-unposted')).toHaveTextContent('Isolde')
    // Barnabas is posted to the 1st Cohort, so he is not loose.
    expect(screen.getByTestId('roll-unposted')).not.toHaveTextContent('Barnabas')
    expect(screen.getByTestId('roll-to-company')).toHaveTextContent('1 fallen')
  })
})
