/**
 * Raid opportunities (Stage 4 Part 2): the war council's RaidPanel lists the
 * turn's scouted targets with their strength band + capacity budget, builds a
 * party clamped live against the budget (cost = size × (40 − speed) / 40,
 * from the engine-exported speed on info.units), launches through the raid
 * route, and replays a resolved raid through the one ReplayView.
 *
 * Every opportunity's party draws from ONE shared troop pool (roster minus
 * foragers minus whatever's already committed to a raid today minus whatever
 * every OTHER still-open card currently has drafted) and a single combined
 * "Launch raids" button submits every drafted party together in one request
 * — this is the fix for the double-assignment playtest finding (troops could
 * join every raid opportunity the same day). See docs/CAMPAIGN_PLAN.md.
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
  getBattle: vi.fn(),
  getTicks: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  launchSampleBattle: vi.fn(),
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  consultCampaignAugury: vi.fn(),
  rerollCampaignAugury: vi.fn(),
  setCampaignForage: vi.fn(),
  spendCampaign: vi.fn(),
  postCampaignBattle: vi.fn(),
  postCampaignRaids: vi.fn(),
  scoutRaidTarget: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getBattle, getTicks, getCampaigns, postCampaignRaids, scoutRaidTarget } from '../services/api'
import App from '../App'
import { campaignFixture, consultedAugury } from './fixtures/campaign'
import { marchToRaids } from './helpers/nav'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  // speed/placementSize are the engine-exported stats the party-builder costs
  // units with (speed = movement points/tick: foot 10, horse 28):
  // Soldier 10 × 30/40 = 7.5, LightCavalry 20 × 12/40 = 6.
  units: [
    { type: 'Soldier', symbol: 'X', placementSize: 10, category: 'Foot', forbiddenTerrain: [], speed: 10 },
    { type: 'LightCavalry', symbol: 'l', placementSize: 20, category: 'Mounted', forbiddenTerrain: ['Forest', 'Marsh'], speed: 28 },
  ],
}

const OPPORTUNITY = {
  id: 'd1-0',
  type: 'loot_supplies',
  title: 'Supply Train',
  description: 'Laden wagons under light guard.',
  strengthBand: 'a handful',
  capacity: 100,
  source: 'base',
  enemy: { Soldier: [8, 14] },
  enemyReveal: 0,
  reward: { food: [1500, 2500], materials: [50, 100] },
  rewardReveal: 0,
  resolved: false,
  outcome: null,
}

// A second opportunity, high-budget so tests can draft a big party without
// tripping the per-card capacity check — only the shared troop POOL should
// constrain it.
const OPPORTUNITY_2 = {
  id: 'd1-1',
  type: 'destroy_detachment',
  title: 'Isolated Pickets',
  description: 'A far outpost, thinly held.',
  strengthBand: 'a company',
  capacity: 5000,
  source: 'base',
  enemy: { Soldier: [40, 70] },
  enemyReveal: 0,
  // destroy_detachment pays gold (docs/CAMPAIGN_PLAN.md "Recruit phase") — a
  // range like any other numeric reward until scouting points pin it.
  reward: { gold: [30, 50] },
  rewardReveal: 0,
  resolved: false,
  outcome: null,
}

// Squad-only raiding (2026-07-21): parties are whole squads. Two controlled
// squads whose troop types both exist in `info.units` above, so their raid
// cost is exactly assertable: 1st Cohort = 10 Soldier × 7.5 = 75, Outriders =
// 5 LightCavalry × 6 = 30.
const TEST_SQUADS = [
  { id: 1, name: '1st Cohort', composition: { Soldier: 10 } },
  { id: 2, name: 'Outriders', composition: { LightCavalry: 5 } },
]

// Raids are their own screen now, reached after the omens — so the fixture
// needs an already-accepted augury for marchToRaids() to walk past the tent.
// scoutingPoints defaults to a value comfortably above both action costs
// (add=8, reveal=3) so tests don't trip disabled buttons unless they mean to.
// squadAssignment lists squads already spent on a raid today (greyed out).
const withRaid = (opportunities, { squadAssignment = [], scoutingPoints = 20, squads = TEST_SQUADS } = {}) => ({
  ...campaignFixture,
  augury: consultedAugury,
  squads,
  raid: { opportunities, assignment: {}, squadAssignment, scoutingPoints, scoutCost: { addTarget: 8, reveal: 3 } },
})

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

describe('raid panel — opportunities', () => {
  // The reorder that motivated the phase split (docs/CAMPAIGN_PLAN.md,
  // 2026-07-18): raiders are committed AFTER the omens, so a counter-raid is an
  // informed choice. The raids never appear on the council or at the tent.
  it('raids live on their own screen after the omens, not on the council or at the tent', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    render(<App />)
    await screen.findByText(/War Council/)

    // Not on the council (Prepare)…
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('to-omens'))
    // …nor at the tent (Omens)…
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('augury-continue'))
    // …only once the fates are known, on the Raids screen.
    expect(await screen.findByTestId('raid-panel')).toBeInTheDocument()
  })

  it('lists the opportunity with its strength band, budget, and the scouting band', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.getByTestId('raid-panel')).toBeInTheDocument()
    expect(screen.getByText('Supply Train')).toBeInTheDocument()
    expect(screen.getByTestId('raid-strength-d1-0')).toHaveTextContent(
      'The scouts judge it a handful. Party budget: 100.',
    )
    // The banded label is the only scouting fact shown — house style.
    expect(screen.getByTestId('raid-band')).toHaveTextContent('Scouting: Contested')
  })

  it('renders nothing when the turn dealt no opportunities', async () => {
    getCampaigns.mockResolvedValue([withRaid([])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    expect(screen.queryByTestId('raid-panel')).not.toBeInTheDocument()
  })

  it('sums the selected squads against the capacity budget and disables the combined launch', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    postCampaignRaids.mockResolvedValue({
      results: [{ raidId: 'd1-0', winner: 'blue', id: 'b9' }],
      campaign: withRaid([
        { ...OPPORTUNITY, resolved: true, outcome: { winner: 'blue', battleId: 'b9' } },
      ]),
    })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    // Both squads (75 + 30 = 105) exceed the 100 budget: over budget, launch
    // disabled.
    fireEvent.click(screen.getByTestId('raid-squad-d1-0-1'))
    fireEvent.click(screen.getByTestId('raid-squad-d1-0-2'))
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 105 / 100')
    expect(screen.getByTestId('raid-launch-all')).toBeDisabled()

    // Drop Outriders — 1st Cohort alone (75) fits — and the combined launch
    // posts exactly the drafted squad ids, keyed by opportunity id.
    fireEvent.click(screen.getByTestId('raid-squad-d1-0-2'))
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 75 / 100')
    fireEvent.click(screen.getByTestId('raid-launch-all'))
    await waitFor(() =>
      expect(postCampaignRaids).toHaveBeenCalledWith('c1', { 'd1-0': [1] }),
    )

    // The refreshed view resolves the card: outcome + replay button.
    expect(await screen.findByTestId('raid-outcome-d1-0')).toHaveTextContent('The raid succeeded.')
    expect(screen.getByTestId('raid-watch-d1-0')).toBeInTheDocument()
  })

  it('an empty party cannot launch', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    expect(screen.getByTestId('raid-launch-all')).toBeDisabled()
  })

  it('a squad already sent on a raid today is not offered', async () => {
    // raid.squadAssignment (server ledger, own resources — no hidden info): a
    // squad that rode out earlier this turn is spent and never listed.
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY], { squadAssignment: [1] })])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    expect(screen.queryByTestId('raid-squad-d1-0-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('raid-squad-d1-0-2')).toBeInTheDocument()
  })

  it('an illegal double-assignment is impossible: a squad drafted on one card is locked on the other', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY, OPPORTUNITY_2])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    // Draft 1st Cohort onto the first raid…
    fireEvent.click(screen.getByTestId('raid-squad-d1-0-1'))
    // …and it's locked (disabled) on the second — it can't ride two raids.
    expect(screen.getByTestId('raid-squad-d1-1-1')).toBeDisabled()

    // Releasing it from the first card frees it back up for the second.
    fireEvent.click(screen.getByTestId('raid-squad-d1-0-1'))
    expect(screen.getByTestId('raid-squad-d1-1-1')).toBeEnabled()
  })

  it('the combined button launches every drafted party together in one request', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY, OPPORTUNITY_2])])
    postCampaignRaids.mockResolvedValue({
      results: [
        { raidId: 'd1-0', winner: 'blue', id: 'b9' },
        { raidId: 'd1-1', winner: 'red', id: 'b10' },
      ],
      campaign: withRaid([
        { ...OPPORTUNITY, resolved: true, outcome: { winner: 'blue', battleId: 'b9' } },
        { ...OPPORTUNITY_2, resolved: true, outcome: { winner: 'red', battleId: 'b10' } },
      ]),
    })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    fireEvent.click(screen.getByTestId('raid-squad-d1-0-1'))
    fireEvent.click(screen.getByTestId('raid-squad-d1-1-2'))
    fireEvent.click(screen.getByTestId('raid-launch-all'))

    // ONE call, both opportunities' parties together — not one call per card.
    await waitFor(() => expect(postCampaignRaids).toHaveBeenCalledTimes(1))
    expect(postCampaignRaids).toHaveBeenCalledWith('c1', {
      'd1-0': [1],
      'd1-1': [2],
    })
    expect(await screen.findByTestId('raid-outcome-d1-0')).toHaveTextContent('The raid succeeded.')
    expect(screen.getByTestId('raid-outcome-d1-1')).toHaveTextContent('The raid was beaten back.')
  })

  it('watching a resolved raid fetches the battle and opens the replay', async () => {
    getCampaigns.mockResolvedValue([
      withRaid([{ ...OPPORTUNITY, resolved: true, outcome: { winner: 'red', battleId: 'b9' } }]),
    ])
    getBattle.mockResolvedValue({ id: 'b9', tickCount: 3 })
    getTicks.mockResolvedValue([])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.getByTestId('raid-outcome-d1-0')).toHaveTextContent('The raid was beaten back.')
    fireEvent.click(screen.getByTestId('raid-watch-d1-0'))
    await waitFor(() => expect(getBattle).toHaveBeenCalledWith('b9'))
    // The one ReplayView takes over; Back returns to the raids screen.
    expect(await screen.findByText('Back to the raids')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Back to the raids'))
    expect(await screen.findByTestId('raid-panel')).toBeInTheDocument()
  })
})

// Raid mini-game (Stage 4 Part 2.5): a per-turn scouting-points pool buys
// either a new target (add_target) or a field reveal (reward/enemy, range →
// exact), through POST /:id/raids/scout. See docs/CAMPAIGN_PLAN.md.
describe('raid panel — scouting mini-game', () => {
  it('shows the scouting-points pool and per-target reward/enemy ranges', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY, OPPORTUNITY_2])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.getByTestId('raid-points')).toHaveTextContent('Scouting points: 20')
    expect(screen.getByTestId('raid-reward-d1-0')).toHaveTextContent('Reward: 1500–2500 food, 50–100 materials')
    expect(screen.getByTestId('raid-enemy-d1-0')).toHaveTextContent('Enemy: 8–14 Soldier')
    // destroy_detachment pays coin: a gold range, revealable like any other.
    expect(screen.getByTestId('raid-reward-d1-1')).toHaveTextContent('Reward: 30–50 gold')
    expect(screen.getByTestId('raid-reveal-reward-d1-1')).toBeInTheDocument()
    expect(screen.getByTestId('raid-enemy-d1-1')).toHaveTextContent('Enemy: 40–70 Soldier')
  })

  // The horse drove (Stage E): horses are its ONLY numeric reward, so the card
  // must list them and offer the reveal — otherwise it carries no buyable
  // reward intel at all.
  it('a horse drove lists its horses range with a reveal button', async () => {
    getCampaigns.mockResolvedValue([withRaid([{
      ...OPPORTUNITY_2,
      id: 'd1-2',
      type: 'seize_horses',
      title: 'The Horse Drove',
      reward: { horses: [12, 20] },
    }])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.getByTestId('raid-reward-d1-2')).toHaveTextContent('Reward: 12–20 horses')
    expect(screen.getByTestId('raid-reveal-reward-d1-2')).toBeInTheDocument()
  })

  it('revealing the reward spends points and swaps the range for the exact value', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    scoutRaidTarget.mockResolvedValue({
      campaign: withRaid([{ ...OPPORTUNITY, reward: { food: 2000, materials: 80 }, rewardReveal: 1 }], { scoutingPoints: 17 }),
    })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    fireEvent.click(screen.getByTestId('raid-reveal-reward-d1-0'))
    await waitFor(() =>
      expect(scoutRaidTarget).toHaveBeenCalledWith('c1', { action: 'reveal', raidId: 'd1-0', field: 'reward' }),
    )
    expect(await screen.findByTestId('raid-reward-d1-0')).toHaveTextContent('Reward: 2000 food, 80 materials')
    expect(screen.queryByTestId('raid-reveal-reward-d1-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('raid-points')).toHaveTextContent('Scouting points: 17')
  })

  it('revealing the enemy spends points and swaps the range for exact per-type counts', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    scoutRaidTarget.mockResolvedValue({
      campaign: withRaid([{ ...OPPORTUNITY, enemy: { Soldier: 11 }, enemyReveal: 1 }], { scoutingPoints: 17 }),
    })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    fireEvent.click(screen.getByTestId('raid-reveal-enemy-d1-0'))
    await waitFor(() =>
      expect(scoutRaidTarget).toHaveBeenCalledWith('c1', { action: 'reveal', raidId: 'd1-0', field: 'enemy' }),
    )
    expect(await screen.findByTestId('raid-enemy-d1-0')).toHaveTextContent('Enemy: 11 Soldier')
    expect(screen.queryByTestId('raid-reveal-enemy-d1-0')).not.toBeInTheDocument()
  })

  it('scouting a new target appends a card and spends points', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    scoutRaidTarget.mockResolvedValue({ campaign: withRaid([OPPORTUNITY, OPPORTUNITY_2], { scoutingPoints: 12 }) })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    fireEvent.click(screen.getByTestId('raid-scout-add'))
    await waitFor(() => expect(scoutRaidTarget).toHaveBeenCalledWith('c1', { action: 'add_target' }))
    expect(await screen.findByTestId('raid-card-d1-1')).toBeInTheDocument()
    expect(screen.getByTestId('raid-points')).toHaveTextContent('Scouting points: 12')
  })

  it('disables scout/reveal buttons once points fall short of their cost', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY], { scoutingPoints: 1 })])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.getByTestId('raid-scout-add')).toBeDisabled() // costs 8, only 1 point
    expect(screen.getByTestId('raid-reveal-reward-d1-0')).toBeDisabled() // costs 3
    expect(screen.getByTestId('raid-reveal-enemy-d1-0')).toBeDisabled()
  })

  it('a resolved raid shows no intel block (nothing left to scout)', async () => {
    getCampaigns.mockResolvedValue([
      withRaid([{ ...OPPORTUNITY, resolved: true, outcome: { winner: 'blue', battleId: 'b9' } }]),
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    expect(screen.queryByTestId('raid-reward-d1-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('raid-enemy-d1-0')).not.toBeInTheDocument()
  })
})
