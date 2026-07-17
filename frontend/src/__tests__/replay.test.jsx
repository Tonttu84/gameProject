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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
      { id: 0, type: 'Zombie', team: 'red', q: 3, r: 25, hp: 20, ox: 0, oy: -0.75, sz: 0.2 },
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, ox: 0, oy: 0.75, sz: 0.2 },
    ],
    log: [],
  },
  {
    index: 1,
    units: [
      { id: 0, type: 'Zombie', team: 'red', q: 3, r: 24, hp: 20, ox: 0, oy: -0.75, sz: 0.2 },
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 5, hp: 10, ox: 0, oy: 0.75, sz: 0.2 },
    ],
    log: ['One coward valued his life more than his honor'],
  },
  {
    index: 2,
    units: [{ id: 1, type: 'Soldier', team: 'blue', q: 4, r: 6, hp: 10, ox: 0, oy: 0.75, sz: 0.2 }],
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

// ---------------------------------------------------------------------------
// Auto-advance (Play). Fake timers are installed from the start of each test
// (authNoticeTimeout.test.jsx discipline) so the setInterval useReplay
// schedules lives on the clock we advance; advanceTimersByTimeAsync drains
// the mocked getTicks promises between ticks. PLAY_MS mirrors useReplay.js's
// unexported interval constant.
// ---------------------------------------------------------------------------

const PLAY_MS = 250

describe('useReplay auto-advance (Play)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
  const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  const mountReplay = async (tickCount) => {
    const rendered = renderHook(() => useReplay('battle1', tickCount))
    await flush() // resolve the initial chunk fetch
    expect(rendered.result.current.tick).not.toBeNull()
    return rendered
  }

  it('playing advances one tick per interval', async () => {
    const { result } = await mountReplay(3)
    act(() => result.current.setPlaying(true))
    await advance(PLAY_MS)
    expect(result.current.current).toBe(1)
    await advance(PLAY_MS)
    expect(result.current.current).toBe(2)
  })

  it('pausing stops the advance where it stands', async () => {
    const { result } = await mountReplay(3)
    act(() => result.current.setPlaying(true))
    await advance(PLAY_MS)
    expect(result.current.current).toBe(1)
    act(() => result.current.setPlaying(false))
    await advance(4 * PLAY_MS)
    expect(result.current.current).toBe(1)
  })

  it('playback stops at the final tick instead of wrapping around', async () => {
    const { result } = await mountReplay(3)
    act(() => result.current.setPlaying(true))
    await advance(10 * PLAY_MS) // far past the end
    expect(result.current.current).toBe(2)
    expect(result.current.playing).toBe(false)
  })

  it('prefetches the next chunk as playback nears the boundary', async () => {
    const total = CHUNK_SIZE + 10 // two chunks
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        Array.from({ length: total }, (_, i) => ({ index: i, units: [], log: [] }))
          .filter((t) => t.index >= from && t.index <= to),
      ),
    )
    const { result } = await mountReplay(total)
    // Park just outside the prefetch window (CHUNK_SIZE-5 … boundary).
    act(() => result.current.seek(CHUNK_SIZE - 7))
    expect(getTicks).toHaveBeenCalledTimes(1) // still only chunk 0

    act(() => result.current.setPlaying(true))
    await advance(PLAY_MS) // → CHUNK_SIZE-6: not yet in the window
    expect(getTicks).toHaveBeenCalledTimes(1)

    await advance(PLAY_MS) // → CHUNK_SIZE-5: prefetch fires
    expect(getTicks).toHaveBeenCalledTimes(2)
    expect(getTicks).toHaveBeenCalledWith('battle1', CHUNK_SIZE, 2 * CHUNK_SIZE - 1)
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

  it('squad members render in their squad color; recorded offsets separate them', async () => {
    // Two squadded Soldiers with distinct recorded offsets, one squadless Archer.
    getTicks.mockImplementation((_id, from, to) =>
      Promise.resolve(
        [
          {
            index: 0,
            units: [
              { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'Soldier (4,4)', side: 2, rank: 1, ox: 0.39, oy: 0.59, sz: 0.26 },
              { id: 2, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'Soldier (4,4)', side: 2, rank: 1, ox: 0.53, oy: 0.76, sz: 0.26 },
              { id: 3, type: 'Archer', team: 'blue', q: 4, r: 5, hp: 8, ox: 0, oy: 0.75, sz: 0.2 },
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
    // Distinct offsets → distinct drawn positions.
    const cx = soldiers.map((el) => Number(el.getAttribute('x')))
    const cy = soldiers.map((el) => Number(el.getAttribute('y')))
    expect(cx[0]).not.toBe(cx[1])
    expect(cy[0]).not.toBe(cy[1])
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

// Layout comes exclusively from the engine's recorded offsets (ox/oy/sz,
// FormationLayout via ReplayRecorder) — the DB is the render interface and
// this component owns NO formation geometry. These tests pin the consumption
// contract: position = hexCenter + transposed offset × hex size.
describe('ReplayView layout from recorded offsets', () => {
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

  it('draws a unit at hexCenter + transposed offset × hex size', async () => {
    // Engine flat space is transposed relative to this view (engine x runs
    // along web y): recorded ox moves the glyph in web y, oy in web x.
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, ox: 0.78, oy: -0.25, sz: 0.26 },
    ])
    const p = pos(await screen.findByText('S'))
    expect(p.x).toBeCloseTo(CENTER.x + -0.25 * 20, 5)
    expect(p.y).toBeCloseTo(CENTER.y + 0.78 * 20, 5)
  })

  it('a unit without recorded offsets falls back to the hex center', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10 },
    ])
    const p = pos(await screen.findByText('S'))
    expect(p.x).toBeCloseTo(CENTER.x, 5)
    expect(p.y).toBeCloseTo(CENTER.y, 5)
  })

  it('side/rank are facts, not layout — they must not move the glyph', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, side: 2, rank: 1, ox: 0, oy: 0, sz: 0.2 },
    ])
    const p = pos(await screen.findByText('S'))
    expect(p.x).toBeCloseTo(CENTER.x, 5)
    expect(p.y).toBeCloseTo(CENTER.y, 5)
  })

  it('recorded sz sets the glyph size', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, ox: 0, oy: 0, sz: 0.26 },
      { id: 2, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, ox: 0.2, oy: 0.2, sz: 0.14 },
    ])
    const big = Number((await screen.findByText('S')).getAttribute('font-size'))
    const small = Number(screen.getByText('M').getAttribute('font-size'))
    expect(big).toBeGreaterThan(small)
    expect(small).toBeGreaterThanOrEqual(4) // readability floor
  })

  it('two squads get two distinct palette colors', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'A', ox: 0, oy: 0, sz: 0.2 },
      { id: 2, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, squad: 'B', ox: 0.2, oy: 0, sz: 0.2 },
    ])
    const a = (await screen.findByText('S')).getAttribute('fill')
    const b = screen.getByText('M').getAttribute('fill')
    expect(a).not.toBe(b)
    expect(a).not.toBe('#88aaff') // not the team fallback
    expect(b).not.toBe('#88aaff')
  })

  it('units of one squad split across ranks keep one color', async () => {
    renderTick([
      { id: 1, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard', side: 0, rank: 0, ox: 0, oy: 0.1, sz: 0.14 },
      { id: 2, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard', side: 0, rank: 1, ox: 0.39, oy: -0.68, sz: 0.26 },
      { id: 3, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, squad: 'Ironguard', ox: 0, oy: -0.1, sz: 0.14 },
    ])
    const fills = (await screen.findAllByText('S')).map((el) => el.getAttribute('fill'))
    expect(new Set(fills).size).toBe(1)
  })
})

// Visual-state cues ported from the retired SFML renderer
// (BattleRenderer::renderUnitsInHex): casting → yellow, broken → orange
// (broken wins), and rank-alpha dimming for engaged reserves.
describe('ReplayView visual state cues', () => {
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

  it('a casting unit is drawn yellow', async () => {
    renderTick([{ id: 1, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, cast: 2, ox: 0, oy: 0, sz: 0.2 }])
    expect((await screen.findByText('M')).getAttribute('fill')).toBe('#ffff00')
  })

  it('a broken unit is drawn orange', async () => {
    renderTick([{ id: 1, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, broken: true, ox: 0, oy: 0, sz: 0.2 }])
    expect((await screen.findByText('S')).getAttribute('fill')).toBe('#ff8c00')
  })

  it('broken wins over casting', async () => {
    renderTick([{ id: 1, type: 'Mage', team: 'blue', q: 4, r: 4, hp: 10, broken: true, cast: 2, ox: 0, oy: 0, sz: 0.2 }])
    expect((await screen.findByText('M')).getAttribute('fill')).toBe('#ff8c00')
  })

  it('broken/cast override the squad color', async () => {
    renderTick([{ id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, squad: 'Ironguard', broken: true, ox: 0, oy: 0, sz: 0.2 }])
    expect((await screen.findByText('S')).getAttribute('fill')).toBe('#ff8c00')
  })

  it('an unengaged unit (no side) draws at full opacity', async () => {
    renderTick([{ id: 1, type: 'Soldier', team: 'blue', q: 4, r: 4, hp: 10, ox: 0, oy: 0, sz: 0.2 }])
    expect(Number((await screen.findByText('S')).getAttribute('fill-opacity'))).toBe(1)
  })

  it('engaged reserves dim by rank; the front rank stays solid', async () => {
    // RANK_ALPHA = [140, 255, 200, 160]: rank 1 solid, rank 2/3 dimmer.
    renderTick([
      { id: 1, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, side: 0, rank: 1, ox: 0.4, oy: 0, sz: 0.2 },
      { id: 2, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, side: 0, rank: 2, ox: 0.6, oy: 0, sz: 0.2 },
      { id: 3, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, side: 0, rank: 3, ox: 0.2, oy: 0, sz: 0.2 },
    ])
    const byRank = (await screen.findAllByText('S')).map((el) =>
      Number(el.getAttribute('fill-opacity')),
    )
    expect(byRank[0]).toBeCloseTo(255 / 255, 5)
    expect(byRank[1]).toBeCloseTo(200 / 255, 5)
    expect(byRank[2]).toBeCloseTo(160 / 255, 5)
  })

  it('an engaged off-rank unit falls back to RANK_ALPHA[0]', async () => {
    renderTick([{ id: 1, type: 'Soldier', team: 'red', q: 4, r: 4, hp: 10, side: 0, rank: 0, ox: 0, oy: 0, sz: 0.2 }])
    expect(Number((await screen.findByText('S')).getAttribute('fill-opacity'))).toBeCloseTo(140 / 255, 5)
  })
})

// The Play button wires setPlaying into the view: label flips to Pause while
// running, the slider tracks the auto-advance, and pausing halts it.
describe('ReplayView Play button', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Play runs the clock and moves the slider; Pause halts it', async () => {
    renderView()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // initial chunk fetch
    expect(screen.getByText('Z')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('replay-play'))
    expect(screen.getByTestId('replay-play')).toHaveTextContent('Pause')

    await act(async () => { await vi.advanceTimersByTimeAsync(PLAY_MS) })
    expect(screen.getByTestId('replay-slider')).toHaveValue('1')

    fireEvent.click(screen.getByTestId('replay-play'))
    expect(screen.getByTestId('replay-play')).toHaveTextContent('Play')
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * PLAY_MS) })
    expect(screen.getByTestId('replay-slider')).toHaveValue('1')
  })
})
