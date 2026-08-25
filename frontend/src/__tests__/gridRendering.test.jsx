/**
 * The VISUAL layer of the two hex renderers — terrain, zone tinting, layout
 * geometry, ramparts, and the in-hex stacking order.
 *
 * Everything else about these components is already covered by behaviour
 * suites: zoneEnforcement.test.jsx clicks hexes, deploymentOrders.test.jsx
 * reads hold badges, scoutingReveal.test.jsx checks revealed enemy glyphs, and
 * replay.test.jsx exercises scrubbing plus the unit colour/opacity cues. What
 * none of them touch is what the grid actually LOOKS like: a wrong terrain
 * colour, a zone tint that stopped tinting, a rampart drawn on the wrong edge
 * or a row that lost its brick offset would all pass the existing suites.
 *
 * Since rendering now lives entirely in the browser (SFML retired 2026-07-07),
 * these fills and coordinates are the renderer — there is no second
 * implementation to check them against.
 *
 * The last block is the one that pins ReplayView.jsx's "Same geometry as
 * HexGrid.jsx (kept in sync — extract if a third user appears)" comment: two
 * copies of hexCenter/hexPoints agreeing is a claim, and it is now a test.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getTicks: vi.fn(async () => []),
}))

import HexGrid from '../components/HexGrid'
import ReplayView from '../components/ReplayView'
import usePlacementStore from '../stores/usePlacementStore'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'

// ---------------------------------------------------------------------------
// Fixtures — a 4 × 6 grid: player zone rows 4-5, enemy zone rows 0-1, so rows
// 2-3 are the no-man's-land between them and every fill branch is reachable.
// ---------------------------------------------------------------------------

const HEX_SIZE = 20
const SQRT3 = Math.sqrt(3)

const makeInfo = (overrides = {}) => ({
  grid: { width: 4, height: 6, hexCapacity: 10 },
  playerZone: { rowMin: 4, rowMax: 5 },
  enemyZone: { rowMin: 0, rowMax: 1 },
  units: [
    { type: 'Soldier', symbol: 'S', placementSize: 1 },
    { type: 'Archer', symbol: 'A', placementSize: 1 },
  ],
  terrain: [
    { name: 'Open', color: '#5a6441' },
    { name: 'Forest', color: '#2d4a1e' },
  ],
  ...overrides,
})

const renderGrid = ({ info, map, placements, squads, squadPlacements,
  characters, characterPlacements, fortifiedSides, roster } = {}) => {
  useCampaignStore.setState({
    campaign: {
      id: 'c1',
      roster: roster ?? { Soldier: 10, Archer: 10 },
      squads: squads ?? [],
      characters: characters ?? [],
      forage: { assignment: {} },
      fortification: { sides: fortifiedSides ?? [] },
      enemy: { placements: [] },
    },
  })
  usePlacementStore.setState({
    placements: placements ?? [],
    squadPlacements: squadPlacements ?? {},
    characterPlacements: characterPlacements ?? {},
  })
  useUiStore.setState({ phase: 'placement' })
  return render(<HexGrid info={info ?? makeInfo()} map={map ?? { hexes: [] }} />)
}

const renderReplay = ({ info, map } = {}) =>
  render(
    <ReplayView
      battleId="battle1"
      tickCount={1}
      info={info ?? makeInfo()}
      map={map ?? { hexes: [] }}
      onBack={vi.fn()}
    />,
  )

// A regular polygon's vertices average to its centre, so the centroid of the
// drawn points recovers the hex centre the renderer used — without this test
// file having to know the vertex ORDER, which is the renderer's own business.
const centroid = (polygon) => {
  const pts = polygon.getAttribute('points').trim().split(/\s+/)
    .map((p) => p.split(',').map(Number))
  return {
    x: pts.reduce((a, [x]) => a + x, 0) / pts.length,
    y: pts.reduce((a, [, y]) => a + y, 0) / pts.length,
  }
}

const hexCenter = (col, row) => ({
  x: HEX_SIZE * 1.5 * row + HEX_SIZE,
  y: HEX_SIZE * SQRT3 * (col + 0.5 * (row % 2)) + HEX_SIZE,
})

const hexFill = (col, row) =>
  screen.getByTestId(`hex-${col}-${row}`).querySelector('polygon').getAttribute('fill')

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Terrain colours
// ---------------------------------------------------------------------------

describe('HexGrid: terrain colours come from the /api/info catalog', () => {
  // Map JSON is keyed by AXIAL coords: offset (col,row) → q = col - floor(row/2).
  // Player-zone row 4 → q = col - 2.
  it('a named terrain draws its catalog colour', () => {
    renderGrid({ map: { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: false }] } })
    expect(hexFill(1, 4)).toBe('#2d4a1e')
  })

  it('a hex with no map entry is Open — only non-default hexes are exported', () => {
    renderGrid()
    expect(hexFill(2, 4)).toBe('#5a6441')
  })

  it('a terrain the catalog does not know falls back to the Open green', () => {
    // A map from a newer engine than the /api/info the client loaded: the hex
    // must still draw, in the default colour, rather than render fill=undefined.
    renderGrid({ map: { hexes: [{ q: -1, r: 4, terrain: 'Tundra', impassable: false }] } })
    expect(hexFill(1, 4)).toBe('#5a6441')
  })

  it('impassable beats terrain — a Forest cliff is still drawn as rock', () => {
    renderGrid({ map: { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: true }] } })
    expect(hexFill(1, 4)).toBe('#1a1a1a')
  })
})

// ---------------------------------------------------------------------------
// 2. Zone tinting
// ---------------------------------------------------------------------------

describe('HexGrid: zone tinting reads the deployment zones off the fill', () => {
  // blendColor(#5a6441, …): the player's own ground is untinted; the enemy's
  // is blended 50% toward (60,0,0) → #4b3221; the strip between the zones is
  // blended 45% toward black → #323724. Three distinguishable greens, so the
  // player can see where they may deploy without reading a legend.
  it('the player zone keeps the terrain colour unblended', () => {
    renderGrid()
    expect(hexFill(0, 4)).toBe('#5a6441')
    expect(hexFill(0, 5)).toBe('#5a6441')
  })

  it('the enemy zone is tinted red', () => {
    renderGrid()
    expect(hexFill(0, 0)).toBe('#4b3221')
    expect(hexFill(3, 1)).toBe('#4b3221')
  })

  it('the ground between the zones is darkened, not tinted', () => {
    renderGrid()
    expect(hexFill(0, 2)).toBe('#323724')
    expect(hexFill(0, 3)).toBe('#323724')
  })

  it('the tint is applied to the hex\'s own terrain, not to a fixed green', () => {
    // Forest in the enemy zone: row 1 → q = col - 0.
    renderGrid({ map: { hexes: [{ q: 1, r: 1, terrain: 'Forest', impassable: false }] } })
    expect(hexFill(1, 1)).toBe('#35250f') // blend(#2d4a1e, 60,0,0, 0.5)
    expect(hexFill(2, 1)).toBe('#4b3221') // the Open neighbour, same zone
  })

  it('an impassable hex is not tinted by its zone — rock reads the same everywhere', () => {
    renderGrid({
      map: {
        hexes: [
          { q: 1, r: 1, terrain: 'Open', impassable: true }, // enemy zone
          { q: -1, r: 4, terrain: 'Open', impassable: true }, // player zone
        ],
      },
    })
    expect(hexFill(1, 1)).toBe('#1a1a1a')
    expect(hexFill(1, 4)).toBe('#1a1a1a')
  })
})

// ---------------------------------------------------------------------------
// 3. Layout geometry
// ---------------------------------------------------------------------------

describe('HexGrid: layout geometry', () => {
  it('draws one hex per grid cell', () => {
    const { container } = renderGrid()
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(4 * 6)
  })

  it('sizes the svg from the grid, with the engine\'s row→x / col→y transpose', () => {
    // The map is drawn on its side relative to the engine's coords so it
    // matches combat orientation: grid.HEIGHT drives the svg WIDTH.
    const { container } = renderGrid()
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '220') // ceil(20*1.5*6 + 40)
    expect(svg).toHaveAttribute('height', '196') // ceil(20*√3*4.5 + 40)
  })

  // Vertices are serialised with toFixed(2), so a centroid recovers the centre
  // to about 5e-3 — precision 2 is the most these can honestly assert.
  it('advancing a row moves the hex along x, advancing a column along y', () => {
    renderGrid()
    const a = centroid(screen.getByTestId('hex-0-0').querySelector('polygon'))
    const nextRow = centroid(screen.getByTestId('hex-0-2').querySelector('polygon'))
    const nextCol = centroid(screen.getByTestId('hex-2-0').querySelector('polygon'))
    expect(nextRow.x - a.x).toBeCloseTo(2 * HEX_SIZE * 1.5, 2)
    expect(nextRow.y).toBeCloseTo(a.y, 2)
    expect(nextCol.y - a.y).toBeCloseTo(2 * HEX_SIZE * SQRT3, 2)
    expect(nextCol.x).toBeCloseTo(a.x, 2)
  })

  it('odd rows are offset half a hex — the brick pattern that makes it a hex grid', () => {
    renderGrid()
    const even = centroid(screen.getByTestId('hex-0-0').querySelector('polygon'))
    const odd = centroid(screen.getByTestId('hex-0-1').querySelector('polygon'))
    expect(odd.y - even.y).toBeCloseTo(0.5 * HEX_SIZE * SQRT3, 2)
  })

  it('every hex is a regular hexagon of six vertices at the hex radius', () => {
    renderGrid()
    const polygon = screen.getByTestId('hex-1-4').querySelector('polygon')
    const pts = polygon.getAttribute('points').trim().split(/\s+/)
    expect(pts).toHaveLength(6)
    const c = centroid(polygon)
    pts.forEach((p) => {
      const [x, y] = p.split(',').map(Number)
      expect(Math.hypot(x - c.x, y - c.y)).toBeCloseTo(HEX_SIZE, 1)
    })
  })

  it('the zone labels sit outside their zones, on opposite sides of the map', () => {
    renderGrid()
    const player = screen.getByText(/player deployment zone/)
    const enemy = screen.getByText(/enemy territory/)
    // x = 30·row + 20, so the player zone (rows 4-5) is to the RIGHT of the
    // enemy zone (rows 0-1); each label clears its own zone by one hex.
    expect(Number(player.getAttribute('x'))).toBe(hexCenter(0, 5).x + HEX_SIZE)
    expect(Number(enemy.getAttribute('x'))).toBe(hexCenter(0, 0).x - HEX_SIZE)
    expect(player.getAttribute('transform')).toMatch(/^rotate\(-90,/)
  })
})

// ---------------------------------------------------------------------------
// 4. Fortification ramparts
// ---------------------------------------------------------------------------

describe('HexGrid: a rampart is drawn on the shared edge', () => {
  // campPanel.test.jsx already checks that a fortified side produces a line at
  // all. What it cannot see is WHERE: wallSegment derives the edge from the two
  // hex centres rather than from vertex order, and a sign error there would
  // draw the wall through the middle of a hex with the testid still present.
  const sides = [{ q: 1, r: 3, dir: 'SE' }]

  const drawn = () => {
    const line = screen.getByTestId('fort-side-1-3-SE')
    return {
      x1: Number(line.getAttribute('x1')), y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')), y2: Number(line.getAttribute('y2')),
    }
  }

  it('the rampart\'s midpoint is the midpoint between the two hex centres', () => {
    renderGrid({ fortifiedSides: sides })
    const seg = drawn()
    // SE = axial (0,+1): the defended hex (1,3) and its neighbour (1,4), in
    // offset coords (col = q + floor(r/2)) → (2,3) and (3,4).
    const a = hexCenter(2, 3)
    const b = hexCenter(3, 4)
    expect((seg.x1 + seg.x2) / 2).toBeCloseTo((a.x + b.x) / 2, 4)
    expect((seg.y1 + seg.y2) / 2).toBeCloseTo((a.y + b.y) / 2, 4)
  })

  it('it lies across that edge — perpendicular to the line between the centres', () => {
    renderGrid({ fortifiedSides: sides })
    const seg = drawn()
    const a = hexCenter(2, 3)
    const b = hexCenter(3, 4)
    const dot = (seg.x2 - seg.x1) * (b.x - a.x) + (seg.y2 - seg.y1) * (b.y - a.y)
    expect(dot).toBeCloseTo(0, 4)
  })

  it('it is one hex edge long', () => {
    renderGrid({ fortifiedSides: sides })
    const seg = drawn()
    expect(Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)).toBeCloseTo(HEX_SIZE, 4)
  })

  it('a direction the client does not know draws nothing rather than NaN', () => {
    // Forward compatibility with a server that grows a seventh direction name:
    // wallSegment returns null and the map still renders.
    const { container } = renderGrid({ fortifiedSides: [{ q: 1, r: 3, dir: 'UP' }] })
    expect(screen.queryByTestId('fort-side-1-3-UP')).not.toBeInTheDocument()
    expect(container.querySelectorAll('line')).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid^="hex-"]')).toHaveLength(24)
  })
})

// ---------------------------------------------------------------------------
// 5. In-hex stacking
// ---------------------------------------------------------------------------

describe('HexGrid: what shares a hex stacks vertically, centred', () => {
  const squads = [{ id: 7, name: 'Vanguard', composition: { Soldier: 2 } }]
  const characters = [{ id: 3, name: 'Isolde', type: 'Mage', squadId: null, alive: true }]

  it('two placed types are drawn one above the other, 9px apart and centred', () => {
    renderGrid({
      placements: [
        { type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 },
        { type: 'Archer', col: 1, row: 4, count: 2, holdTurns: 0 },
      ],
    })
    const y = hexCenter(1, 4).y
    expect(Number(screen.getByText('S3').getAttribute('y'))).toBeCloseTo(y - 4.5, 4)
    expect(Number(screen.getByText('A2').getAttribute('y'))).toBeCloseTo(y + 4.5, 4)
  })

  it('a lone type sits on the hex centre', () => {
    renderGrid({ placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 }] })
    expect(Number(screen.getByText('S3').getAttribute('y'))).toBeCloseTo(hexCenter(1, 4).y, 4)
  })

  it('loose units, then squads, then characters — one stack, in that order', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 }],
      squads,
      squadPlacements: { 7: { col: 1, row: 4, holdTurns: 0, squadName: 'Vanguard' } },
      characters,
      characterPlacements: { 3: { col: 1, row: 4 } },
    })
    const y = hexCenter(1, 4).y
    const at = (el) => Number(el.getAttribute('y'))
    expect(at(screen.getByText('S3'))).toBeCloseTo(y - 9, 4)
    expect(at(screen.getByTestId('squad-marker-1-4-7'))).toBeCloseTo(y, 4)
    expect(at(screen.getByTestId('character-marker-1-4-3'))).toBeCloseTo(y + 9, 4)
  })

  it('no two things in one hex are drawn on the same row', () => {
    // The case that used to collide outright: one loose type under two squads
    // put the loose glyph and the first squad marker on the identical y,
    // because each group centred on its own count instead of the hex's total.
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 0 }],
      squads: [
        { id: 7, name: 'Vanguard', composition: { Soldier: 1 } },
        { id: 8, name: 'Rearguard', composition: { Soldier: 1 } },
      ],
      squadPlacements: {
        7: { col: 1, row: 4, holdTurns: 0, squadName: 'Vanguard' },
        8: { col: 1, row: 4, holdTurns: 0, squadName: 'Rearguard' },
      },
    })
    const ys = [
      screen.getByText('S3'),
      screen.getByTestId('squad-marker-1-4-7'),
      screen.getByTestId('squad-marker-1-4-8'),
    ].map((el) => Number(el.getAttribute('y')))
    expect(new Set(ys).size).toBe(3)
    // Evenly spaced and centred on the hex, whatever the mix.
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    expect((ys[0] + ys[2]) / 2).toBeCloseTo(hexCenter(1, 4).y, 4)
    expect(ys[1] - ys[0]).toBeCloseTo(9, 4)
    expect(ys[2] - ys[1]).toBeCloseTo(9, 4)
  })

  it('the hold badge sits to the right of the row it belongs to', () => {
    renderGrid({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 2 }],
    })
    const badge = screen.getByTestId('hold-badge-1-4')
    expect(Number(badge.getAttribute('x'))).toBeCloseTo(hexCenter(1, 4).x + HEX_SIZE * 0.55, 4)
    expect(Number(badge.getAttribute('y'))).toBe(Number(screen.getByText('S3').getAttribute('y')))
    expect(badge.getAttribute('text-anchor')).toBe('start')
  })

  it('selecting a hex outlines it — a second polygon over the same points', () => {
    renderGrid()
    const hex = screen.getByTestId('hex-1-4')
    expect(hex.querySelectorAll('polygon')).toHaveLength(1)
    fireEvent.click(hex)
    const polygons = hex.querySelectorAll('polygon')
    expect(polygons).toHaveLength(2)
    expect(polygons[1]).toHaveAttribute('fill', 'none')
    expect(polygons[1]).toHaveAttribute('stroke', '#6688ff')
    expect(polygons[1].getAttribute('points')).toBe(polygons[0].getAttribute('points'))
    // An unselected neighbour keeps its single polygon.
    expect(screen.getByTestId('hex-2-4').querySelectorAll('polygon')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 6. ReplayView terrain
// ---------------------------------------------------------------------------

describe('ReplayView: the battlefield underneath the replay', () => {
  // ReplayView draws the same map the placement grid did, minus the zone tints
  // — during the battle the zones no longer mean anything. Nothing in
  // replay.test.jsx looks at the terrain layer at all.
  const polygons = (container) => container.querySelectorAll('polygon')

  it('draws one hex per grid cell, sized like the placement grid', async () => {
    const { container } = renderReplay()
    await waitFor(() => expect(polygons(container).length).toBe(4 * 6))
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '220')
    expect(svg).toHaveAttribute('height', '196')
  })

  it('colours each hex from the terrain catalog, defaulting to Open', async () => {
    const { container } = renderReplay({
      map: { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: false }] },
    })
    await waitFor(() => expect(polygons(container).length).toBe(24))
    // Row-major: index = row * width + col, so offset (1,4) is index 17.
    expect(polygons(container)[17]).toHaveAttribute('fill', '#2d4a1e')
    expect(polygons(container)[18]).toHaveAttribute('fill', '#5a6441')
  })

  it('draws impassable hexes as rock', async () => {
    const { container } = renderReplay({
      map: { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: true }] },
    })
    await waitFor(() => expect(polygons(container).length).toBe(24))
    expect(polygons(container)[17]).toHaveAttribute('fill', '#1a1a1a')
  })

  it('falls back to the Open green for a terrain the catalog does not know', async () => {
    const { container } = renderReplay({
      map: { hexes: [{ q: -1, r: 4, terrain: 'Tundra', impassable: false }] },
    })
    await waitFor(() => expect(polygons(container).length).toBe(24))
    expect(polygons(container)[17]).toHaveAttribute('fill', '#5a6441')
  })

  it('does NOT tint by deployment zone — the zones are over once the battle starts', async () => {
    const { container } = renderReplay()
    await waitFor(() => expect(polygons(container).length).toBe(24))
    const fills = new Set([...polygons(container)].map((p) => p.getAttribute('fill')))
    expect(fills).toEqual(new Set(['#5a6441']))
  })

  it('survives a map the server did not send', async () => {
    const { container } = render(
      <ReplayView battleId="battle1" tickCount={1} info={makeInfo()} onBack={vi.fn()} />,
    )
    await waitFor(() => expect(polygons(container).length).toBe(24))
    expect(polygons(container)[0]).toHaveAttribute('fill', '#5a6441')
  })
})

// ---------------------------------------------------------------------------
// 7. The two renderers agree
// ---------------------------------------------------------------------------

describe('ReplayView and HexGrid draw the same grid', () => {
  // ReplayView.jsx: "Same geometry as HexGrid.jsx (kept in sync — extract if a
  // third user appears)." Two copies of hexCenter/hexPoints kept in sync by a
  // comment is exactly the pair that drifts; if one is edited and the other is
  // not, the replay of a battle stops lining up with the map it was fought on.
  it('places every hex at the same point, in the same order', async () => {
    const info = makeInfo()
    const map = { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: false }] }

    const replay = render(<ReplayView battleId="battle1" tickCount={1} info={info} map={map} onBack={vi.fn()} />)
    await waitFor(() =>
      expect(replay.container.querySelectorAll('polygon').length).toBe(24))
    const replayPoints = [...replay.container.querySelectorAll('polygon')]
      .map((p) => p.getAttribute('points'))
    replay.unmount()

    renderGrid({ info, map })
    const gridPoints = []
    for (let row = 0; row < info.grid.height; row++)
      for (let col = 0; col < info.grid.width; col++)
        gridPoints.push(
          screen.getByTestId(`hex-${col}-${row}`).querySelector('polygon').getAttribute('points'))

    expect(replayPoints).toEqual(gridPoints)
  })

  it('resolves an axial map entry to the same cell in both', async () => {
    // Both compute the offset↔axial conversion themselves (toAxial one way,
    // toOffset the other). The Forest lands on offset (1,4) in each or the
    // terrain the player deployed onto is not the terrain they see replayed.
    const info = makeInfo()
    const map = { hexes: [{ q: -1, r: 4, terrain: 'Forest', impassable: false }] }

    const replay = render(<ReplayView battleId="battle1" tickCount={1} info={info} map={map} onBack={vi.fn()} />)
    await waitFor(() =>
      expect(replay.container.querySelectorAll('polygon').length).toBe(24))
    const forestIdx = [...replay.container.querySelectorAll('polygon')]
      .findIndex((p) => p.getAttribute('fill') === '#2d4a1e')
    expect(forestIdx).toBe(4 * info.grid.width + 1)
    replay.unmount()

    renderGrid({ info, map })
    expect(hexFill(1, 4)).toBe('#2d4a1e')
  })
})
