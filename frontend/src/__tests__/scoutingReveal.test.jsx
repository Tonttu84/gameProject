/**
 * Stage 4 (1b) — scouting-graduated enemy reveal, client side.
 *
 * The server's campaignView already gates WHAT crosses the boundary by
 * scouting band; the client just renders whatever arrived:
 *   - ScoutReport shows the band plus only the intel fields present on
 *     campaign.enemy (strength/supplies/composition/units).
 *   - HexGrid takes an optional enemyPlacements prop ({type,q,r,count},
 *     axial — the Overwhelming-band reveal) and draws red glyphs on the
 *     enemy-zone hexes, converting axial → offset with col = q + floor(r/2).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ScoutReport from '../components/ScoutReport'
import HexGrid from '../components/HexGrid'
import usePlacementStore from '../stores/usePlacementStore'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

vi.mock('../services/api', () => ({
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
  setCampaignForage: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, getCampaigns } from '../services/api'
import App from '../App'
import { campaignFixture } from './fixtures/campaign'

// ---------------------------------------------------------------------------
// ScoutReport — renders exactly the intel the band let through
// ---------------------------------------------------------------------------

describe('ScoutReport', () => {
  it('Blind: shows the band and that nothing is known', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Blind' }}
        enemy={{ stance: 'camp', battleOffer: false }}
      />,
    )
    expect(screen.getByTestId('scouting-band')).toHaveTextContent('Blind')
    expect(screen.getByText(/see nothing/i)).toBeInTheDocument()
  })

  it('Contested: shows the strength phrase and supply state', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Contested' }}
        enemy={{
          stance: 'camp',
          battleOffer: false,
          strength: 'a large host',
          supplies: 'well-provisioned',
        }}
      />,
    )
    expect(screen.getByTestId('scouting-band')).toHaveTextContent('Contested')
    expect(screen.getByText(/a large host/)).toBeInTheDocument()
    expect(screen.getByText(/well-provisioned/)).toBeInTheDocument()
    expect(screen.queryByText(/see nothing/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('scout-composition')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scout-units')).not.toBeInTheDocument()
  })

  it('Superior: adds the composition percentages', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Superior' }}
        enemy={{
          stance: 'shadowing',
          battleOffer: false,
          strength: 'a large host',
          supplies: 'strained',
          composition: { Foot: 97, Mounted: 3 },
        }}
      />,
    )
    expect(screen.getByTestId('scout-composition')).toHaveTextContent('97% Foot')
    expect(screen.getByTestId('scout-composition')).toHaveTextContent('3% Mounted')
  })

  it('Overwhelming: adds exact counts and notes the revealed deployment', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Overwhelming' }}
        enemy={{
          stance: 'shadowing',
          battleOffer: false,
          strength: 'a strong warband',
          supplies: 'near starving',
          composition: { Foot: 98, Mounted: 2 },
          units: { Soldier: 540, LightCavalry: 20 },
          placements: [{ type: 'Soldier', q: 0, r: 22, count: 5 }],
        }}
      />,
    )
    expect(screen.getByTestId('scout-units')).toHaveTextContent('540 Soldier')
    expect(screen.getByTestId('scout-units')).toHaveTextContent('20 LightCavalry')
    expect(screen.getByText(/drawn on the field/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// HexGrid — revealed enemy placement glyphs
// ---------------------------------------------------------------------------

const gridInfo = {
  grid: { width: 4, height: 6, hexCapacity: 10 },
  playerZone: { rowMin: 4, rowMax: 5 },
  enemyZone: { rowMin: 0, rowMax: 1 },
  units: [{ type: 'Soldier', symbol: 'S', placementSize: 1 }],
  terrain: [{ name: 'Open', color: '#5a6441' }],
}

// HexGrid reads enemyPlacements/roster/etc from the campaign and placement
// stores now, not props — see docs/CAMPAIGN_PLAN.md's 2026-07-16 frontend
// state-management thread.
const renderGrid = (props = {}) => {
  useCampaignStore.setState({
    campaign: {
      id: 'c1',
      roster: props.roster ?? { Soldier: 10 },
      squads: [],
      forage: { assignment: {} },
      fortification: { sides: [] },
      enemy: { placements: props.enemyPlacements ?? [] },
    },
  })
  usePlacementStore.setState({ placements: props.placements ?? [], squadPlacements: {} })
  useUiStore.setState({ phase: props.disabled ? 'battling' : 'placement' })
  return render(<HexGrid info={gridInfo} map={{ hexes: [] }} />)
}

describe('HexGrid: enemyPlacements reveal', () => {
  it('draws a red glyph per revealed stack at the inverse-axial offset hex', () => {
    // axial q=1, r=1 → col = 1 + floor(1/2) = 1, row = 1 (enemy zone).
    renderGrid({ enemyPlacements: [{ type: 'Soldier', q: 1, r: 1, count: 12 }] })
    const glyph = screen.getByTestId('enemy-glyph-1-1-Soldier')
    expect(glyph).toHaveTextContent('S12')
  })

  it('stacks several revealed types on the same hex', () => {
    renderGrid({
      enemyPlacements: [
        { type: 'Soldier', q: 0, r: 0, count: 8 },
        { type: 'Archer', q: 0, r: 0, count: 3 },
      ],
    })
    expect(screen.getByTestId('enemy-glyph-0-0-Soldier')).toHaveTextContent('S8')
    expect(screen.getByTestId('enemy-glyph-0-0-Archer')).toHaveTextContent('A3')
  })

  it('renders no enemy glyphs when the prop is absent (lower bands)', () => {
    renderGrid()
    expect(screen.queryAllByTestId(/^enemy-glyph-/)).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// App wiring — the council shows the report; placement passes the reveal
// ---------------------------------------------------------------------------

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('App: scouting reveal wiring', () => {
  it('the war council shows the scout report from the campaign view', async () => {
    getCampaigns.mockResolvedValue([campaignFixture])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('scouting-band')).toHaveTextContent('Contested')
    expect(screen.getByText(/a large host/)).toBeInTheDocument()
  })

  it('an Overwhelming reveal reaches the placement grid as red glyphs', async () => {
    getCampaigns.mockResolvedValue([
      {
        ...campaignFixture,
        augury: { ...campaignFixture.augury, consulted: true, visions: [] },
        scouting: { band: 'Overwhelming' },
        enemy: {
          ...campaignFixture.enemy,
          composition: { Foot: 100 },
          units: { Soldier: 540 },
          // axial q=0, r=22 → col = 0 + floor(22/2) = 11, row 22 (enemy zone)
          placements: [{ type: 'Soldier', q: 0, r: 22, count: 9 }],
        },
      },
    ])
    render(<App />)
    await screen.findByText(/War Council/)
    fireEvent.click(screen.getByText('Muster for Battle'))
    const glyph = await screen.findByTestId('enemy-glyph-11-22-Soldier')
    expect(glyph).toHaveTextContent('S9')
  })
})
