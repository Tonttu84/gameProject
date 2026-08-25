/**
 * ReplayView against a REAL recorded battle.
 *
 * The other replay tests (replay.test.jsx, replayDepth.test.jsx) drive
 * ReplayView from hand-written ticks — three units, a couple of log lines,
 * every optional field chosen by whoever wrote the fixture. That proves the
 * component's own logic and nothing about the pipeline it sits at the end of.
 *
 * This one closes the loop the 2026-07-07 deferred item asked for: battle →
 * recorded replay → ReplayView. `fixtures/recordedReplay.json` is a real
 * 31-tick fight (17 units, a squad on each side, cavalry, a Mage who actually
 * casts) recorded by the engine and shaped exactly as
 * GET /api/battles/:id/ticks serves it. So the numbers below — offsets, ranks,
 * squad names, log tiers — are the engine's, not an author's guess at them,
 * and a change to what ReplayRecorder emits shows up here as a rendering
 * failure rather than as a fixture nobody updated.
 *
 * The other half of the round trip (engine → DB → route, and whether this
 * fixture still matches what the binary emits today) is
 * campaign-server/tests/replayRoundTrip.test.js — the campaign server is the
 * only layer that can see both the engine and the wire.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({ getTicks: vi.fn() }))

import { getTicks } from '../services/api'
import ReplayView from '../components/ReplayView'
import recorded from './fixtures/recordedReplay.json'

const TICKS = recorded.ticks

// Same geometry ReplayView uses; duplicated here on purpose so a change to the
// component's layout constants has to be made twice, deliberately, rather than
// sliding through because the test imported the thing it is checking.
const HEX_SIZE = 20
const SQRT3 = Math.sqrt(3)
const glyphXY = (u) => {
  const col = u.q + Math.floor(u.r / 2)
  const row = u.r
  return {
    x: HEX_SIZE * 1.5 * row + HEX_SIZE + (u.oy ?? 0) * HEX_SIZE,
    y: HEX_SIZE * SQRT3 * (col + 0.5 * (row % 2)) + HEX_SIZE + (u.ox ?? 0) * HEX_SIZE,
  }
}

const info = {
  grid: { width: recorded.cols, height: recorded.rows, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const renderView = () =>
  render(
    <ReplayView
      battleId="recorded"
      tickCount={TICKS.length}
      info={info}
      map={{ hexes: [] }}
      onBack={vi.fn()}
    />,
  )

// Scrub to a tick and wait for its units to be on screen. useReplay fetches in
// chunks, so a seek past the loaded range resolves asynchronously.
const seekTo = async (index) => {
  fireEvent.change(screen.getByTestId('replay-slider'), { target: { value: String(index) } })
  await waitFor(() =>
    expect(document.querySelectorAll('svg text')).toHaveLength(TICKS[index].units.length),
  )
}

beforeEach(() => {
  getTicks.mockImplementation((_id, from, to) =>
    Promise.resolve(TICKS.filter((t) => t.index >= from && t.index <= to)),
  )
})

describe('ReplayView over a real recorded battle', () => {
  it('renders every tick of the recording, one glyph per recorded unit', async () => {
    renderView()
    await waitFor(() => expect(screen.getAllByText(/^[A-Z]$/)).not.toHaveLength(0))

    // Every tick, not a sampled one: a real recording is where units die,
    // squads break up and stacks collapse onto one hex, and the count is what
    // catches a glyph silently dropped on the way through.
    for (let i = 0; i < TICKS.length; i++) {
      await seekTo(i)
      expect(document.querySelectorAll('svg text')).toHaveLength(TICKS[i].units.length)
    }
  })

  it('places each unit where the engine recorded it — centre + FormationLayout offset', async () => {
    renderView()
    // Tick 8: both sides are in contact, so units carry real in-hex offsets
    // rather than the lone-unit default, and several share a hex.
    await seekTo(8)

    const texts = [...document.querySelectorAll('svg text')]
    for (const u of TICKS[8].units) {
      const { x, y } = glyphXY(u)
      const match = texts.find(
        (t) =>
          Math.abs(Number(t.getAttribute('x')) - x) < 1e-6 &&
          Math.abs(Number(t.getAttribute('y')) - y) < 1e-6 &&
          t.textContent === u.type[0],
      )
      // The transpose (engine flat x → this view's y) is the thing being
      // pinned: get it backwards and a real battle renders sideways, which is
      // exactly the bug a hand fixture of two units on one row cannot show.
      expect(match, `no glyph for ${u.type} #${u.id} at (${u.q},${u.r})`).toBeDefined()
    }
  })

  // Glyph belonging to one recorded unit, found by where the engine put it.
  const glyphFor = (u) => {
    const { x, y } = glyphXY(u)
    return [...document.querySelectorAll('svg text')].find(
      (t) =>
        Math.abs(Number(t.getAttribute('x')) - x) < 1e-6 &&
        Math.abs(Number(t.getAttribute('y')) - y) < 1e-6 &&
        t.textContent === u.type[0],
    )
  }

  it('colours the two recorded squads apart, and the routing unit orange', async () => {
    renderView()
    // Tick 12: both squads are in contact, a loner is routing, and the ranks
    // behind the front are seated — the tick where every visual cue is live.
    await seekTo(12)
    const units = TICKS[12].units

    const bySquad = {}
    for (const u of units.filter((x) => x.squad && !x.broken))
      (bySquad[u.squad] ??= new Set()).add(glyphFor(u).getAttribute('fill'))
    const names = Object.keys(bySquad)
    expect(names).toHaveLength(2) // Ash Company and Host of the Vale, from the input

    // One colour per squad, and the two squads not the same colour: in a stack
    // this is the only thing telling two formations apart.
    for (const n of names) expect(bySquad[n].size).toBe(1)
    const [a, b] = names.map((n) => [...bySquad[n]][0])
    expect(a).not.toBe(b)
    expect([a, b]).not.toContain('#88aaff') // nor the team colours a loner gets
    expect([a, b]).not.toContain('#ff8888')

    // Loners keep their team colour — the recording has archers, a mage and
    // cavalry outside any squad.
    const loner = units.find((u) => !u.squad && !u.broken && u.team === 'blue')
    expect(glyphFor(loner).getAttribute('fill')).toBe('#88aaff')

    // Broken beats every other colour, squad palette included.
    const routing = units.find((u) => u.broken)
    expect(routing).toBeDefined()
    expect(glyphFor(routing).getAttribute('fill')).toBe('#ff8c00')
  })

  it('dims the ranks the engine seated behind the front', async () => {
    renderView()
    await seekTo(12)
    const units = TICKS[12].units

    const opacity = (u) => Number(glyphFor(u).getAttribute('fill-opacity'))
    const atRank = (r) => units.filter((u) => u.rank === r)
    expect(atRank(1).length).toBeGreaterThan(0)
    expect(atRank(2).length).toBeGreaterThan(0) // the recording really did stack up

    // Frontline solid, second rank dimmer, and every unit at a rank drawn the
    // same as its peers — read off real seating, not a rank typed into a
    // fixture by hand.
    for (const u of atRank(1)) expect(opacity(u)).toBe(1)
    const second = new Set(atRank(2).map(opacity))
    expect(second.size).toBe(1)
    expect([...second][0]).toBeLessThan(1)

    // Nothing off the line is dimmed: a unit the engine never seated is at
    // full strength wherever it stands.
    for (const u of units.filter((x) => x.side === undefined)) expect(opacity(u)).toBe(1)
  })

  it('filters the recorded log by depth, and never hides a cast', async () => {
    renderView()
    await seekTo(8)

    const lines = TICKS[8].log
    const tiers = new Set(lines.map((l) => l.tier))
    expect(tiers).toEqual(new Set(['basic', 'detail', 'trace'])) // all three, as recorded

    const shown = () =>
      [...screen.getByTestId('replay-log').children].map((el) => el.textContent)

    expect(shown()).toHaveLength(lines.filter((l) => l.tier === 'basic').length)

    fireEvent.click(screen.getByTestId('replay-depth-detail'))
    expect(shown()).toHaveLength(
      lines.filter((l) => l.tier === 'basic' || l.tier === 'detail').length,
    )

    fireEvent.click(screen.getByTestId('replay-depth-trace'))
    expect(shown()).toHaveLength(lines.length)

    // The rule the tier ladder exists to make structural (L-2): a cast is
    // logged at Basic engine-side, so no depth the player can pick hides it.
    const casts = TICKS.flatMap((t) => t.log).filter((l) => l.text.includes(' casts '))
    expect(casts.length).toBeGreaterThan(0)
    expect(casts.every((l) => l.tier === 'basic')).toBe(true)
  })

  it('narrates the deaths the recording actually contains', async () => {
    // A unit that leaves the roster between two ticks must have a line saying
    // so — the log and the glyph count telling the same story is the whole
    // point of recording both.
    for (let i = 1; i < TICKS.length; i++) {
      const before = new Set(TICKS[i - 1].units.map((u) => u.id))
      const gone = [...before].filter((id) => !TICKS[i].units.some((u) => u.id === id))
      if (gone.length === 0) continue
      const narrated = TICKS[i].log.filter((l) => / fell$| flees the field/.test(l.text))
      expect(narrated.length, `tick ${i} lost ${gone.length} units silently`).toBeGreaterThan(0)
    }
  })
})
