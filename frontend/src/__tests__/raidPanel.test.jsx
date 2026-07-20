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
  // destroy_detachment has no numeric reward (rewardRange is null server-side).
  reward: null,
  rewardReveal: 0,
  resolved: false,
  outcome: null,
}

// Raids are their own screen now, reached after the omens — so the fixture
// needs an already-accepted augury for marchToRaids() to walk past the tent.
// scoutingPoints defaults to a value comfortably above both action costs
// (add=8, reveal=3) so tests don't trip disabled buttons unless they mean to.
const withRaid = (opportunities, assignment = {}, scoutingPoints = 20) => ({
  ...campaignFixture,
  augury: consultedAugury,
  raid: { opportunities, assignment, scoutingPoints, scoutCost: { addTarget: 8, reveal: 3 } },
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

  it('clamps the party against the capacity budget and disables the combined launch', async () => {
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

    // 14 Soldiers (7.5 each) cost 105 > 100: over budget, launch disabled.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '14' } })
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 105 / 100')
    expect(screen.getByTestId('raid-launch-all')).toBeDisabled()

    // 13 cost 97.5: within budget — the combined launch posts exactly the
    // party, keyed by opportunity id (the batch shape the server expects).
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '13' } })
    expect(screen.getByTestId('raid-cost-d1-0')).toHaveTextContent('Party cost: 98 / 100')
    fireEvent.click(screen.getByTestId('raid-launch-all'))
    await waitFor(() =>
      expect(postCampaignRaids).toHaveBeenCalledWith('c1', { 'd1-0': { Soldier: 13 } }),
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

  it('units out foraging shrink what the party-builder offers', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...withRaid([OPPORTUNITY]),
        forage: { ...campaignFixture.forage, assignment: { Soldier: 295 } },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    // 300 − 295 foraging = 5 available; the input clamps to it.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '10' } })
    expect(screen.getByTestId('raid-input-d1-0-Soldier')).toHaveValue(5)
  })

  it('troops already committed to a raid today shrink what the party-builder offers', async () => {
    // raid.assignment (server ledger, own resources — no hidden info) works
    // exactly like forage.assignment for this purpose.
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY], { Soldier: 291 })])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '10' } })
    expect(screen.getByTestId('raid-input-d1-0-Soldier')).toHaveValue(9)
  })

  it('an illegal double-assignment is impossible: the shared pool clamps the second card', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY, OPPORTUNITY_2])])
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    // Draft 250 of the 300 Soldiers into the first raid.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '250' } })
    expect(screen.getByTestId('raid-input-d1-0-Soldier')).toHaveValue(250)

    // Only 50 Soldiers are left in the shared pool — trying to also draft 60
    // into the second raid (which would double-book 60 of the same troops)
    // clamps down to what's actually left, not what was typed.
    fireEvent.change(screen.getByTestId('raid-input-d1-1-Soldier'), { target: { value: '60' } })
    expect(screen.getByTestId('raid-input-d1-1-Soldier')).toHaveValue(50)

    // Emptying the first card's draft frees the pool back up for the second.
    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('raid-input-d1-1-Soldier'), { target: { value: '60' } })
    expect(screen.getByTestId('raid-input-d1-1-Soldier')).toHaveValue(60)
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

    fireEvent.change(screen.getByTestId('raid-input-d1-0-Soldier'), { target: { value: '10' } })
    fireEvent.change(screen.getByTestId('raid-input-d1-1-Soldier'), { target: { value: '5' } })
    fireEvent.click(screen.getByTestId('raid-launch-all'))

    // ONE call, both opportunities' parties together — not one call per card.
    await waitFor(() => expect(postCampaignRaids).toHaveBeenCalledTimes(1))
    expect(postCampaignRaids).toHaveBeenCalledWith('c1', {
      'd1-0': { Soldier: 10 },
      'd1-1': { Soldier: 5 },
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
    // destroy_detachment has no numeric reward — nothing to list or reveal.
    expect(screen.queryByTestId('raid-reward-d1-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('raid-enemy-d1-1')).toHaveTextContent('Enemy: 40–70 Soldier')
  })

  it('revealing the reward spends points and swaps the range for the exact value', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY])])
    scoutRaidTarget.mockResolvedValue({
      campaign: withRaid([{ ...OPPORTUNITY, reward: { food: 2000, materials: 80 }, rewardReveal: 1 }], {}, 17),
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
      campaign: withRaid([{ ...OPPORTUNITY, enemy: { Soldier: 11 }, enemyReveal: 1 }], {}, 17),
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
    scoutRaidTarget.mockResolvedValue({ campaign: withRaid([OPPORTUNITY, OPPORTUNITY_2], {}, 12) })
    render(<App />)
    await screen.findByText(/War Council/)
    await marchToRaids()

    fireEvent.click(screen.getByTestId('raid-scout-add'))
    await waitFor(() => expect(scoutRaidTarget).toHaveBeenCalledWith('c1', { action: 'add_target' }))
    expect(await screen.findByTestId('raid-card-d1-1')).toBeInTheDocument()
    expect(screen.getByTestId('raid-points')).toHaveTextContent('Scouting points: 12')
  })

  it('disables scout/reveal buttons once points fall short of their cost', async () => {
    getCampaigns.mockResolvedValue([withRaid([OPPORTUNITY], {}, 1)])
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
