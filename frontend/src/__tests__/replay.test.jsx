/**
 * Replay scrubbing tests.
 *
 * useReplay(battleId, tickCount) drives playback state:
 *   { current, tick, seek, next, prev, playing, setPlaying }
 * It fetches ticks from the campaign server in chunks via getTicks(battleId,
 * from, to) and caches them, so scrubbing back never refetches.
 *
 * ReplayView renders the current tick's units on the hex grid (axial q/r →
 * the same offset layout HexGrid uses), a scrub slider, step buttons and the
 * tick's log lines.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor, renderHook } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getTicks: vi.fn(),
}))

import { getTicks } from '../services/api'
import useReplay, { CHUNK_SIZE } from '../hooks/useReplay'
import ReplayView from '../components/ReplayView'

const fixtureTicks = [
  {
    index: 0,
    units: [
      { id: 0, type: 'Zombie', team: 'red', q: 3, r: 25, hp: 20 },
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10 },
    ],
    log: [],
  },
  {
    index: 1,
    units: [
      { id: 0, type: 'Zombie', team: 'red', q: 3, r: 24, hp: 20 },
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 5, hp: 10 },
    ],
    log: ['One coward valued his life more than his honor'],
  },
  {
    index: 2,
    units: [{ id: 1, type: 'Soldier', team: 'blue', q: 4, r: 6, hp: 10 }],
    log: ['Zombie (red) fell'],
  },
]

// getTicks stub that serves any (from, to) slice of fixtureTicks.
const serveFixture = () => {
  getTicks.mockImplementation((_id, from, to) =>
    Promise.resolve(fixtureTicks.filter((t) => t.index >= from && t.index <= to)),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  serveFixture()
})

describe('useReplay', () => {
  it('loads the first chunk on mount and exposes tick 0', async () => {
    const { result } = renderHook(() => useReplay('battle1', 3))
    await waitFor(() => expect(result.current.tick).not.toBeNull())
    expect(result.current.current).toBe(0)
    expect(result.current.tick.units.length).toBe(2)
    expect(getTicks).toHaveBeenCalledWith('battle1', 0, CHUNK_SIZE - 1)
  })

  it('seek clamps to [0, tickCount-1]', async () => {
    const { result } = renderHook(() => useReplay('battle1', 3))
    await waitFor(() => expect(result.current.tick).not.toBeNull())
    act(() => result.current.seek(-5))
    expect(result.current.current).toBe(0)
    act(() => result.current.seek(999))
    expect(result.current.current).toBe(2)
  })

  it('next/prev step one tick and stop at the ends', async () => {
    const { result } = renderHook(() => useReplay('battle1', 3))
    await waitFor(() => expect(result.current.tick).not.toBeNull())
    act(() => result.current.prev())
    expect(result.current.current).toBe(0)
    act(() => result.current.next())
    expect(result.current.current).toBe(1)
    act(() => result.current.next())
    act(() => result.current.next())
    act(() => result.current.next())
    expect(result.current.current).toBe(2)
  })

  it('scrubbing back to a cached tick does not refetch', async () => {
    const { result } = renderHook(() => useReplay('battle1', 3))
    await waitFor(() => expect(result.current.tick).not.toBeNull())
    const callsAfterLoad = getTicks.mock.calls.length
    act(() => result.current.seek(2))
    act(() => result.current.seek(0))
    act(() => result.current.seek(1))
    expect(getTicks.mock.calls.length).toBe(callsAfterLoad)
  })

  it('seeking into an unloaded chunk requests that chunk', async () => {
    const many = CHUNK_SIZE + 10 // two chunks
    const { result } = renderHook(() => useReplay('battle1', many))
    await waitFor(() => expect(result.current.tick).not.toBeNull())
    act(() => result.current.seek(CHUNK_SIZE + 2))
    await waitFor(() =>
      expect(getTicks).toHaveBeenCalledWith('battle1', CHUNK_SIZE, 2 * CHUNK_SIZE - 1),
    )
  })
})

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const renderView = () =>
  render(
    <ReplayView
      battleId="battle1"
      tickCount={3}
      info={info}
      map={{ hexes: [] }}
      onBack={vi.fn()}
    />,
  )

describe('ReplayView', () => {
  it('renders tick 0 units as one glyph per unit on the grid', async () => {
    renderView()
    expect(await screen.findByText('Z')).toBeInTheDocument()
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.getByTestId('replay-slider')).toHaveValue('0')
  })

  it('a stack renders its symbol once per unit — 3 Soldiers are SSS, not S3', async () => {
    // Override tick 0: three Soldiers on one hex.
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        [
          {
            index: 0,
            units: [
              { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10 },
              { id: 2, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10 },
              { id: 3, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 9 },
            ],
            log: [],
          },
        ].filter((t) => t.index >= from && t.index <= to),
      ),
    )
    render(
      <ReplayView battleId="battle1" tickCount={1} info={info} map={{ hexes: [] }} onBack={vi.fn()} />,
    )
    expect(await screen.findAllByText('S')).toHaveLength(3)
    expect(screen.queryByText('S3')).not.toBeInTheDocument()
  })

  it('squad members render in their squad color; engaged units leave the hex center', async () => {
    // Two squadded Soldiers engaged on side 2 (rank 0), one squadless Archer.
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        [
          {
            index: 0,
            units: [
              { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'Soldier (4,4)', side: 2, rank: 0 },
              { id: 2, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'Soldier (4,4)', side: 2, rank: 0 },
              { id: 3, type: 'Archer', team: 'blue', q: 4, r: 5, hp: 8 },
            ],
            log: [],
          },
        ].filter((t) => t.index >= from && t.index <= to),
      ),
    )
    render(
      <ReplayView battleId="battle1" tickCount={1} info={info} map={{ hexes: [] }} onBack={vi.fn()} />,
    )
    const soldiers = await screen.findAllByText('S')
    expect(soldiers).toHaveLength(2)
    // Same squad → same palette color, and NOT the plain team color.
    const fills = soldiers.map((el) => el.getAttribute('fill'))
    expect(fills[0]).toBe(fills[1])
    expect(fills[0]).not.toBe('#88aaff')
    // The squadless Archer keeps its team color.
    expect(screen.getByText('A').getAttribute('fill')).toBe('#88aaff')
    // Engaged units sit toward their hex side, not stacked dead-center.
    const cx = soldiers.map((el) => Number(el.getAttribute('x')))
    const cy = soldiers.map((el) => Number(el.getAttribute('y')))
    expect(cx[0]).not.toBe(cx[1]) // spread along the file
    expect(Math.abs(cy[0])).toBeGreaterThan(0)
  })

  it('step buttons and slider survive a tick with no units', async () => {
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        [{ index: 0, units: [], log: ['nothing left standing'] }].filter(
          (t) => t.index >= from && t.index <= to,
        ),
      ),
    )
    render(
      <ReplayView battleId="battle1" tickCount={1} info={info} map={{ hexes: [] }} onBack={vi.fn()} />,
    )
    expect(await screen.findByText('nothing left standing')).toBeInTheDocument()
  })

  it('scrubbing the slider shows that tick and its log lines', async () => {
    renderView()
    await screen.findByText('Z')
    fireEvent.change(screen.getByTestId('replay-slider'), { target: { value: '2' } })
    await waitFor(() => expect(screen.queryByText('Z')).not.toBeInTheDocument())
    expect(screen.getByText('S')).toBeInTheDocument()
    expect(screen.getByText('Zombie (red) fell')).toBeInTheDocument()
  })

  it('step buttons move one tick at a time', async () => {
    renderView()
    await screen.findByText('Z')
    fireEvent.click(screen.getByTestId('replay-next'))
    expect(screen.getByTestId('replay-slider')).toHaveValue('1')
    expect(await screen.findByText('One coward valued his life more than his honor')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('replay-prev'))
    expect(screen.getByTestId('replay-slider')).toHaveValue('0')
  })
})

// The engine's formation state is easiest to pin HERE: the SFML window can't
// be asserted against, but the React replay renders the same recorder data
// (squad/side/rank) into inspectable SVG coordinates.
describe('ReplayView engagement geometry', () => {
  const renderTick = (units) => {
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        [{ index: 0, units, log: [] }].filter((t) => t.index >= from && t.index <= to),
      ),
    )
    return render(
      <ReplayView battleId="battle1" tickCount={1} info={info} map={{ hexes: [] }} onBack={vi.fn()} />,
    )
  }
  const pos = (el) => ({ x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')) })
  // Same math the component uses for the hex center of axial (4,4):
  // col = q + floor(r/2) = 6, row = 4.
  const CENTER = { x: 20 * 1.5 * 4 + 20, y: 20 * Math.sqrt(3) * 6 + 20 }

  it('an engaged unit sits toward its engaged side, not at the hex center', async () => {
    // Side 2 = SE (axial dq 0, dr 1): the neighbor hex renders at larger x
    // (row→x layout), slightly larger y — the glyph must lean that way.
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, side: 2, rank: 0 },
    ])
    const p = pos(await screen.findByText('S'))
    expect(p.x).toBeGreaterThan(CENTER.x)
    expect(p.y).toBeGreaterThan(CENTER.y)
  })

  it('opposite sides lean opposite ways', async () => {
    // Side 5 = NW (dq 0, dr -1) mirrors side 2 = SE.
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, side: 5, rank: 0 },
    ])
    const p = pos(await screen.findByText('S'))
    expect(p.x).toBeLessThan(CENTER.x)
    expect(p.y).toBeLessThan(CENTER.y)
  })

  it('deeper ranks step back toward the hex center', async () => {
    renderTick([
      { id: 1, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, side: 2, rank: 0 },
      { id: 2, type: 'Priest', team: 'blue', q: 4, r: 4, hp: 10, side: 2, rank: 1 },
    ])
    const front = pos(await screen.findByText('M'))
    const back = pos(screen.getByText('P'))
    const dist = (p) => Math.hypot(p.x - CENTER.x, p.y - CENTER.y)
    expect(dist(back)).toBeLessThan(dist(front))
  })

  it('two squads get two distinct palette colors', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'A' },
      { id: 2, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, squad: 'B' },
    ])
    const a = (await screen.findByText('S')).getAttribute('fill')
    const b = screen.getByText('M').getAttribute('fill')
    expect(a).not.toBe(b)
    expect(a).not.toBe('#88aaff') // not the team fallback
    expect(b).not.toBe('#88aaff')
  })

  it('units of one squad split across ranks keep one color', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard', side: 0, rank: 0 },
      { id: 2, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard', side: 0, rank: 1 },
      { id: 3, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard' },
    ])
    const fills = (await screen.findAllByText('S')).map((el) => el.getAttribute('fill'))
    expect(new Set(fills).size).toBe(1)
  })
})
