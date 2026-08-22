/**
 * The squad screen (docs/CAMPAIGN_PLAN.md, decision 13 — slice B).
 *
 * The hub the squad overhaul was built toward: a roll of the whole army (13-9),
 * a page per charter (13-8/13-10), reachable from the HUD in every phase (13-7),
 * and — the thing that turns it from a scoreboard into a planning tool — the
 * FORECAST of tonight's automatic refill (13-6).
 *
 * Every number here is the server's: caps, intake, rank, the next rung's
 * threshold and the forecast all arrive resolved in the view. So these tests
 * are about what the screen SHOWS and where it lets the player go, never about
 * arithmetic the client is not allowed to do. The refill's own rules live in
 * campaign-server's squadReinforce.test.js.
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
  bindSquadBanner: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, openRecruit } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'
import { openArmy, openCharter, marchToRaids } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// A mauled 1st Cohort with a refill forecast on it — what the server sends
// when tonight's pass will actually take somebody on.
const mauled = (over = {}) => ({
  ...campaignFixture,
  squads: campaignFixture.squads.map((s) =>
    s.id === 1
      ? {
          ...s,
          composition: { Soldier: 25 },
          prestige: 18,
          rank: 'Blooded',
          nextRank: { label: 'Seasoned', at: 25 },
          refill: {
            outputs: { Soldier: 10 },
            cost: { gold: 20, materials: 20 },
            bodies: 10,
            blocked: null,
          },
        }
      : s,
  ),
  ...over,
})

const start = async (campaign) => {
  getCampaigns.mockResolvedValue([campaign])
  openRecruit.mockResolvedValue(campaign)
  render(<App />)
  await screen.findByText(/War Council/)
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

describe('reaching the screen (13-7)', () => {
  it('opens from the HUD and gives the phase back on Back', async () => {
    await start(campaignFixture)
    await openArmy()
    // A takeover: the council is gone underneath rather than beside it.
    expect(screen.queryByText(/War Council/)).toBeNull()

    fireEvent.click(screen.getByTestId('squad-screen-back'))
    await screen.findByText(/War Council/)
  })

  // The door is on the HUD precisely so it is never a phase's property: squads
  // are picked for raids, placed at deploy and posted to in prepare.
  it('opens from a later phase too, and returns to THAT phase', async () => {
    await start({ ...campaignFixture, augury: consultedAugury })
    await marchToRaids()

    await openArmy()
    fireEvent.click(screen.getByTestId('squad-screen-back'))
    expect(await screen.findByText('Targets of Opportunity')).toBeInTheDocument()
  })
})

describe('the roll (13-9)', () => {
  it('lists every charter with its rank and strength against its caps', async () => {
    await start(campaignFixture)
    await openArmy()
    // 40 of 50: the composition summed against the caps summed, which is what
    // "at muster" means for a charter whose composition is counts by type.
    expect(screen.getByTestId('roll-strength-1')).toHaveTextContent('Untested — 40 of 50 at muster')
    expect(screen.getByTestId('roll-strength-3')).toHaveTextContent('12 of 12 at muster')
  })

  it('shows the loose pool the refills eat', async () => {
    await start(campaignFixture)
    await openArmy()
    expect(screen.getByTestId('roll-loose')).toHaveTextContent('260 Soldier')
  })

  // 13-11: free, or out raiding today — and NOT decision 12's "tied up for X
  // turns", which nothing in the game can yet put a squad into.
  it('marks a squad already sent raiding today', async () => {
    await start({
      ...campaignFixture,
      raid: { ...campaignFixture.raid, squadAssignment: [2] },
    })
    await openArmy()
    expect(screen.getByTestId('roll-availability-2')).toHaveTextContent('Out raiding today')
    expect(screen.getByTestId('roll-availability-1')).toHaveTextContent('In camp, ready')
  })
})

describe('a charter’s page (13-10)', () => {
  it('shows every mustered type as a row, count against cap', async () => {
    await start(mauled())
    await openCharter(1)
    expect(screen.getByTestId('charter-row-1-Soldier')).toHaveTextContent('25 of 40')
    // A capped type the charter holds NONE of is still a row: the room is the
    // point, and it is where the refill will go.
    expect(screen.getByTestId('charter-row-1-Pikeman')).toHaveTextContent('0 of 10')
  })

  // 13-14: the rank word, the raw number, the next rung's threshold — and
  // nothing whatsoever about what that rung will be worth.
  it('states the rank and the next rung without promising what it grants', async () => {
    await start(mauled())
    await openCharter(1)
    const rank = screen.getByTestId('charter-rank-1')
    expect(rank).toHaveTextContent('Blooded — 18 prestige')
    expect(rank).toHaveTextContent('next rung (Seasoned) at 25')
  })

  it('calls the top of the ladder an end, not an unreachable target', async () => {
    await start({
      ...campaignFixture,
      squads: campaignFixture.squads.map((s) =>
        s.id === 1 ? { ...s, prestige: 80, rank: 'Legendary', nextRank: null } : s,
      ),
    })
    await openCharter(1)
    expect(screen.getByTestId('charter-rank-1')).toHaveTextContent('the top of the ladder')
  })
})

describe('the refill forecast (13-6)', () => {
  it('says who joins tonight and what it costs, before it happens', async () => {
    await start(mauled())
    await openCharter(1)
    const line = screen.getByTestId('charter-refill-1')
    expect(line).toHaveTextContent('10 Soldier join')
    expect(line).toHaveTextContent('20 gold, 20 materials')
    // …and on the row itself, so the player sees WHERE the bodies land.
    expect(screen.getByTestId('charter-joining-1-Soldier')).toHaveTextContent('+10 joining')
  })

  // It is a PREDICTION: the charters ahead in the roll spend first (13-4) and a
  // raid fought this afternoon moves the purse. A forecast rendered as a promise
  // reads as a bug the first time that happens.
  it('says out loud that it is a prediction', async () => {
    await start(mauled())
    await openCharter(1)
    expect(screen.getByTestId('charter-forecast-note-1')).toHaveTextContent(/as things stand/i)
  })

  // 13-6's other half: "nothing: the loose pool is empty" — the screen names the
  // gate that closed rather than leaving a blank where the forecast would be.
  it('names the gate when nobody will join', async () => {
    await start(campaignFixture) // blocked: 'pool' on the 1st Cohort
    await openCharter(1)
    expect(screen.getByTestId('charter-refill-1')).toHaveTextContent(/loose ranks hold none/i)
    expect(screen.queryByTestId('charter-forecast-note-1')).toBeNull()
  })

  it('reads a charter at strength as the good news it is', async () => {
    await start(campaignFixture) // the Vanguard is at its caps in both types
    await openCharter(3)
    expect(screen.getByTestId('charter-refill-3')).toHaveTextContent('At full strength')
  })

  it('names an empty treasury as an empty treasury', async () => {
    await start(
      mauled({
        squads: mauled().squads.map((s) =>
          s.id === 1
            ? { ...s, refill: { outputs: {}, cost: {}, bodies: 0, blocked: 'cost' } }
            : s,
        ),
      }),
    )
    await openCharter(1)
    expect(screen.getByTestId('charter-refill-1')).toHaveTextContent(/treasury cannot pay/i)
  })
})

describe('the ways on (13-15/13-16)', () => {
  it('leads to the company screen, and back to the roll', async () => {
    await start({
      ...campaignFixture,
      characters: [
        { id: 1, name: 'Isolde', type: 'Mage', squadId: 1, hangBack: true, alive: true, diedDay: null },
      ],
    })
    await openCharter(1)
    expect(screen.getByTestId('charter-character-1')).toHaveTextContent('Isolde')

    fireEvent.click(screen.getByTestId('charter-to-company-1'))
    await screen.findByTestId('character-panel')
    fireEvent.click(screen.getByTestId('squad-screen-roll'))
    await screen.findByTestId('squad-roll')
  })

  it('says plainly when no character is posted', async () => {
    await start(campaignFixture)
    await openCharter(1)
    expect(screen.getByTestId('charter-character-1')).toHaveTextContent('Nobody is posted here')
  })
})

// ── While a fate is owed, the door is shut ───────────────────────────────────
//
// Every action this screen offers — upgrades, banner binding, attachment,
// hang-back — is a route the server guards with rejectIfChoicePending. A screen
// reachable while a choice is pending would therefore be a screen of buttons
// that answer 409, so the HUD hides its door and the choice cards win the
// takeover. These tests exist because the ordering in App.jsx was previously
// justified by a COMMENT that had the server's behaviour backwards.
describe('a pending choice outranks the screen', () => {
  const owed = (over = {}) => ({
    ...campaignFixture,
    day: 2,
    pendingChoices: [{
      slot: 0,
      title: 'Refugees at the Palisade',
      description: 'A column of burned-out villagers begs shelter at the camp gates.',
      options: [
        { id: 'take_them_in', label: 'Take them in' },
        { id: 'turn_them_away', label: 'Turn them away' },
      ],
    }],
    ...over,
  })

  it('hides the HUD door rather than offering buttons that cannot work', async () => {
    getCampaigns.mockResolvedValue([owed()])
    render(<App />)
    await screen.findByTestId('reveal-beat-choice-0')
    expect(screen.queryByTestId('hud-army')).toBeNull()
  })

  // The item store is opened FROM a charter page, so it renders OVER the squad
  // screen — but it yields to the choice cards for the same reason the squad
  // screen does: POST /squads/:id/banner is choice-gated like the rest.
  //
  // The store is opened through the ui store directly, because the only way in
  // through the UI is the charter page this very test says is unreachable. An
  // assertion that a store nobody opened is absent would pass on an empty page.
  it('takes the screen back from an item store already open', async () => {
    const { default: useUiStore } = await import('../stores/useUiStore')
    useUiStore.getState().openItemStore({ squadId: 1, kind: 'banner', target: 'squad' })
    getCampaigns.mockResolvedValue([owed()])
    render(<App />)

    await screen.findByTestId('reveal-beat-choice-0')
    expect(useUiStore.getState().storeRequest).not.toBeNull() // still open underneath
    expect(screen.queryByTestId('item-store')).toBeNull()
  })
})
