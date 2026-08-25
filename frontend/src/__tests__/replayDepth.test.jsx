/**
 * The replay's depth control (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE LOGGING").
 *
 * The engine records every tier and the browser filters (L-1), so this control
 * is the only thing standing between the player and 30,000 roll lines. The
 * rules it has to keep:
 *   - cumulative — Detail includes Basic, Trace includes both;
 *   - it opens on Basic;
 *   - Basic is never removable, which is what makes "spells cast appear on any
 *     level" true by construction rather than by a rule in the filter.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({ getTicks: vi.fn() }))

import { getTicks } from '../services/api'
import ReplayView from '../components/ReplayView'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// One tick carrying a line of each tier, shaped as the recorder writes them.
const tieredTick = [{
  index: 0,
  units: [],
  log: [
    { tier: 'basic',  text: 'Mage (blue) casts Ember' },
    { tier: 'detail', text: 'Mage (blue) begins to channel Ember' },
    { tier: 'trace',  text: 'Soldier (red) is hit for 6' },
  ],
}]

const renderAt = async (ticks) => {
  getTicks.mockResolvedValue(ticks)
  render(
    <ReplayView battleId="b1" tickCount={1} info={info} map={{ hexes: [] }} onBack={vi.fn()} />,
  )
  await waitFor(() => expect(screen.getByTestId('replay-log')).toBeInTheDocument())
}

beforeEach(() => vi.clearAllMocks())

describe('the replay depth control', () => {
  it('opens on Basic, showing only the shallowest tier', async () => {
    await renderAt(tieredTick)
    const log = screen.getByTestId('replay-log')
    expect(log).toHaveTextContent('casts Ember')
    expect(log).not.toHaveTextContent('begins to channel')
    expect(log).not.toHaveTextContent('is hit for')
    expect(screen.getByTestId('replay-depth-basic')).toHaveAttribute('aria-pressed', 'true')
  })

  it('is CUMULATIVE: Detail carries Basic with it', async () => {
    await renderAt(tieredTick)
    fireEvent.click(screen.getByTestId('replay-depth-detail'))
    const log = screen.getByTestId('replay-log')
    expect(log).toHaveTextContent('begins to channel')
    // ...and the cast is still there — a deeper setting ADDS, never swaps.
    expect(log).toHaveTextContent('casts Ember')
    expect(log).not.toHaveTextContent('is hit for')
  })

  it('at Trace shows everything', async () => {
    await renderAt(tieredTick)
    fireEvent.click(screen.getByTestId('replay-depth-trace'))
    const log = screen.getByTestId('replay-log')
    expect(log).toHaveTextContent('casts Ember')
    expect(log).toHaveTextContent('begins to channel')
    expect(log).toHaveTextContent('is hit for')
  })

  it('THE RULE: no depth can hide a cast', async () => {
    // The user's one hard constraint on the ladder. It holds because casts are
    // logged at Basic engine-side and the filter cannot go shallower — there is
    // no setting to test that would remove them, which is the point.
    await renderAt(tieredTick)
    for (const tier of ['basic', 'detail', 'trace']) {
      fireEvent.click(screen.getByTestId(`replay-depth-${tier}`))
      expect(screen.getByTestId('replay-log')).toHaveTextContent('casts Ember')
    }
  })

  it('renders a pre-tier replay, where a line was a bare string', async () => {
    // Battles stored before the ladder shipped carry plain strings. They read as
    // Basic rather than vanishing — a stored replay should never go blank
    // because the engine that wrote it predates the reader.
    await renderAt([{ index: 0, units: [], log: ['a soldier fled the battlefield'] }])
    expect(screen.getByTestId('replay-log')).toHaveTextContent('a soldier fled')
  })

  it('shows an unknown tier rather than dropping it', async () => {
    // A replay from a NEWER engine carrying a fourth tier: noisy is a better
    // failure than silently missing the line that explains the battle.
    await renderAt([{ index: 0, units: [], log: [{ tier: 'forensic', text: 'something new' }] }])
    expect(screen.getByTestId('replay-log')).toHaveTextContent('something new')
  })
})
