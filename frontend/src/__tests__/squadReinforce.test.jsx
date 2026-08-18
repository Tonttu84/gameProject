/**
 * Squad reinforcement (docs/CAMPAIGN_PLAN.md "SLICE 3 — reinforcement"): the
 * Recruit screen's other sink. A hire adds bodies to the ARMY; a reinforcement
 * moves loose bodies into a CHARTER, once a fortnight per squad, bounded by the
 * archetype's pooled intake and paid in gold/materials (horses for riders).
 *
 * The server owns every rule — this panel previews them from `caps`, `intake`,
 * `loose` and `reinforceRecipes` off the wire, so the tests here are about what
 * the screen shows, what it bounds, and what it posts. The rules themselves are
 * covered in campaign-server's squadReinforce.test.js / campaigns.test.js.
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
  reinforceSquad: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, openRecruit, reinforceSquad } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'
import { marchToRaids } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// The starting squads sit exactly at their caps, so every case here first takes
// losses off one — the state a battle or a raid leaves behind — and funds the
// purse, since a fresh campaign starts at 0 gold.
const mauled = (overrides = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  resources: { ...campaignFixture.resources, gold: 100, materials: 100, horses: 10 },
  squads: campaignFixture.squads.map((s) =>
    s.id === 1 ? { ...s, composition: { Soldier: 30 } } : s,
  ),
  loose: { ...campaignFixture.loose, Soldier: 270 },
  recruit: { fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] },
  ...overrides,
})

const toRecruitScreen = async (campaign) => {
  getCampaigns.mockResolvedValue([campaign])
  openRecruit.mockResolvedValue(campaign)
  render(<App />)
  await screen.findByText(/War Council/)
  await marchToRaids()
  fireEvent.click(await screen.findByTestId('to-recruit'))
  await screen.findByTestId('reinforce-panel')
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

describe('squad reinforcement panel', () => {
  it('reads each charter against its per-type caps, its intake and the loose pool', async () => {
    await toRecruitScreen(mauled())

    const cohort = screen.getByTestId('reinforce-squad-1')
    // The inspect-screen reading of decision 3, one slice early: held/cap per
    // permitted type, including a permitted type the squad holds none of.
    expect(cohort).toHaveTextContent('30/40 Soldier')
    expect(cohort).toHaveTextContent('0/10 Pikeman')
    expect(cohort).toHaveTextContent('270 unassigned')
    expect(screen.getByTestId('reinforce-intake-1')).toHaveTextContent('0 of 10')
    // Prestige rank rides along — it is what will gate the upgrades later.
    expect(cohort).toHaveTextContent('Untested')
  })

  it('prices the draft from the recipes the server ships, not a second copy', async () => {
    await toRecruitScreen(mauled())

    fireEvent.change(screen.getByTestId('reinforce-input-1-Soldier'), { target: { value: '4' } })
    // 4 × (2 gold, 2 materials) — the Soldier row of SQUAD_REINFORCE_POOL.
    expect(screen.getByTestId('reinforce-cost-1')).toHaveTextContent('8 gold, 8 materials')
    expect(screen.getByTestId('reinforce-intake-1')).toHaveTextContent('4 of 10')
  })

  // 4c: a squad's upgrades can raise what every body it takes on costs, and
  // that surcharge is per SQUAD, not in the global recipe table. The preview has
  // to add it or it understates a drilled squad's bill — and the panel's whole
  // contract is that what it shows is what the route will charge.
  it('adds the squad’s own reinforcement surcharge on top of the recipe', async () => {
    await toRecruitScreen(
      mauled({
        squads: campaignFixture.squads.map((s) =>
          s.id === 1
            ? { ...s, composition: { Soldier: 30 }, reinforceSurcharge: { gold: 1 } }
            : s,
        ),
      }),
    )

    fireEvent.change(screen.getByTestId('reinforce-input-1-Soldier'), { target: { value: '4' } })
    // 4 × (2 gold, 2 materials) from the recipe, plus 4 × 1 gold from the row.
    expect(screen.getByTestId('reinforce-cost-1')).toHaveTextContent('12 gold, 8 materials')
  })

  it('a squad with no surcharge pays exactly the recipe, with nothing added', async () => {
    await toRecruitScreen(mauled())
    fireEvent.change(screen.getByTestId('reinforce-input-1-Soldier'), { target: { value: '4' } })
    expect(screen.getByTestId('reinforce-cost-1')).toHaveTextContent('8 gold, 8 materials')
  })

  it('posts the whole map at once — one atomic request per squad', async () => {
    const campaign = mauled({
      squads: campaignFixture.squads.map((s) =>
        s.id === 3 ? { ...s, composition: { Cavalry: 4, LightCavalry: 4 } } : s,
      ),
    })
    reinforceSquad.mockResolvedValue(campaign)
    await toRecruitScreen(campaign)

    fireEvent.change(screen.getByTestId('reinforce-input-3-Cavalry'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('reinforce-input-3-LightCavalry'), { target: { value: '1' } })
    // vanguard's intake is 2 over two permitted types — the case a single-type
    // call could not serve without breaking once-per-turn.
    expect(screen.getByTestId('reinforce-cost-3')).toHaveTextContent('9 gold, 7 materials, 2 horses')

    fireEvent.click(screen.getByTestId('reinforce-submit-3'))
    await waitFor(() =>
      expect(reinforceSquad).toHaveBeenCalledWith('c1', 3, {
        reinforce: { Cavalry: 1, LightCavalry: 1 },
      }),
    )
  })

  it('bounds each input by the cap, the pooled intake AND the loose pool', async () => {
    const campaign = mauled({
      // 2 Soldier short of the cap, but only 1 unassigned body to draw on.
      squads: campaignFixture.squads.map((s) =>
        s.id === 1 ? { ...s, composition: { Soldier: 38 } } : s,
      ),
      loose: { ...campaignFixture.loose, Soldier: 1 },
    })
    await toRecruitScreen(campaign)

    const soldiers = screen.getByTestId('reinforce-input-1-Soldier')
    expect(soldiers).toHaveAttribute('max', '1') // loose pool, not the 2 of headroom
    fireEvent.change(soldiers, { target: { value: '9' } })
    expect(soldiers).toHaveValue(1)
  })

  it('the intake is POOLED: spending it on one type leaves none for the other', async () => {
    await toRecruitScreen(
      mauled({
        squads: campaignFixture.squads.map((s) =>
          s.id === 3 ? { ...s, composition: { Cavalry: 2, LightCavalry: 2 } } : s,
        ),
      }),
    )

    // vanguard: intake 2, both types 4 short of their caps. Two Cavalry is the
    // whole fortnight's absorption — a per-type allowance would have let the
    // squad take four, which is decision C's bookkeeping accident.
    fireEvent.change(screen.getByTestId('reinforce-input-3-Cavalry'), { target: { value: '2' } })
    expect(screen.getByTestId('reinforce-input-3-LightCavalry')).toHaveAttribute('max', '0')
  })

  it('a squad that has already taken replacements says so instead of offering more', async () => {
    await toRecruitScreen(
      mauled({
        squads: campaignFixture.squads.map((s) =>
          s.id === 1 ? { ...s, composition: { Soldier: 30 }, reinforcedToday: true } : s,
        ),
      }),
    )

    expect(screen.getByTestId('reinforce-done-1')).toBeInTheDocument()
    expect(screen.queryByTestId('reinforce-input-1-Soldier')).not.toBeInTheDocument()
    // …and its neighbours are unaffected: the ledger is per charter.
    expect(screen.getByTestId('reinforce-input-2-Archer')).toBeInTheDocument()
  })

  it('refuses to arm the button when the stores cannot cover the draft', async () => {
    await toRecruitScreen(mauled({ resources: { ...campaignFixture.resources, gold: 3, materials: 100 } }))

    fireEvent.change(screen.getByTestId('reinforce-input-1-Soldier'), { target: { value: '4' } })
    const submit = screen.getByTestId('reinforce-submit-1')
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('title', 'Not enough stores for these replacements')
  })

  it('is independent of the day’s hire: it is here once recruiting is resolved', async () => {
    await toRecruitScreen(mauled())
    // The fixture's hire is already spent (hiredToday), and replacements are
    // still on offer — the two sinks neither gate nor consume each other.
    expect(screen.getByTestId('recruit-done')).toBeInTheDocument()
    expect(screen.getByTestId('reinforce-submit-1')).toBeInTheDocument()
  })
})
