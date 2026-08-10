/**
 * Stage 4 (1c) — recon-sensitive event rungs, client side.
 *
 * The server's day report may carry, per augury slot, the FIRED rung of a
 * recon-sensitive fate (`fired: {title, description, rung}`) plus a
 * `scoutsIntervened` flag. The reveal beat then reads: the augur foretold the
 * Blind rung, the scouts downgraded (or reversed) it — the same event at a
 * lesser rung, never a silent swap. Plain events carry no rung machinery and
 * render exactly as before. A free reveal (anticipated Night Raid) arrives as
 * `enemy.revealed` on the campaign view and ScoutReport says why the book is
 * open.
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EventRevealScreen from '../components/EventRevealScreen'
import ScoutReport from '../components/ScoutReport'

const nightRaidSlot = {
  predicted: { id: 'night_raid', title: 'Night Raid' },
  actual: {
    id: 'night_raid',
    title: 'Night Raid',
    description: 'Raiders slip past the pickets in the dark.',
    severity: 2,
  },
  wasAccurate: true,
}

// A one-slot report's first beat IS the fate card — no clicking needed here;
// the click-through sequencing itself is covered in eventReveal.test.jsx.
const renderReport = (slots) =>
  render(<EventRevealScreen report={{ day: 3, entries: [], augury: slots }} onContinue={() => {}} />)

describe('EventRevealScreen: recon-sensitive rungs', () => {
  it('shows the fired rung as what came to pass and badges the scouts', () => {
    renderReport([
      {
        ...nightRaidSlot,
        fired: {
          title: 'Pickets Hold',
          description: 'The pickets catch the raiders at the ditch.',
          rung: 'warned',
        },
        scoutsIntervened: true,
      },
    ])
    const report = screen.getByTestId('reveal-beat-fate-0')
    // The downgraded rung is what came to pass…
    expect(report).toHaveTextContent('Pickets Hold')
    expect(report).toHaveTextContent('catch the raiders at the ditch')
    // …while the foretold fate still shows — same event, lesser rung.
    expect(report).toHaveTextContent('Night Raid')
    expect(screen.getByTestId('scout-intervened')).toBeInTheDocument()
  })

  it('a blind rung fires as foretold: no intervention badge', () => {
    renderReport([
      {
        ...nightRaidSlot,
        fired: {
          title: 'Night Raid',
          description: 'Raiders slip past the pickets in the dark.',
          rung: 'blind',
        },
        scoutsIntervened: false,
      },
    ])
    expect(screen.getByTestId('reveal-beat-fate-0')).toHaveTextContent('Night Raid')
    expect(screen.queryByTestId('scout-intervened')).not.toBeInTheDocument()
  })

  it('plain events (no rung machinery) render exactly as before', () => {
    renderReport([
      {
        predicted: { id: 'plague', title: 'Plague' },
        actual: { id: 'supply', title: 'Supply Cache', description: 'An abandoned depot.' },
        wasAccurate: false,
      },
    ])
    const report = screen.getByTestId('reveal-beat-fate-0')
    expect(report).toHaveTextContent('Supply Cache')
    expect(report).toHaveTextContent('The augur was wrong.')
    expect(screen.queryByTestId('scout-intervened')).not.toBeInTheDocument()
  })

  it('an unconsulted recon-sensitive fate still shows its fired rung', () => {
    renderReport([
      {
        predicted: null,
        odds: null,
        wasAccurate: null,
        actual: { id: 'ambush', title: 'Enemy Ambush', description: 'Enemy scouts found the camp.' },
        fired: { title: 'Counter-Ambush', description: 'You bait the trap.', rung: 'anticipated' },
        scoutsIntervened: true,
      },
    ])
    const report = screen.getByTestId('reveal-beat-fate-0')
    expect(report).toHaveTextContent('Counter-Ambush')
    expect(screen.getByTestId('scout-intervened')).toBeInTheDocument()
  })
})

// ── Every fate says what it DID (user, 2026-08-10) ──────────────────────────
// The standing rule that no card shows flavour alone had reached the augur's
// tent, the choice branches and the raid board, but not the beat where a fate
// LANDS. The figures were only in the flat "fortnight, in full" list a beat
// later, mixed with upkeep and the enemy's turn — and whether a fate's own
// prose happened to name a number was authoring accident.
describe('EventRevealScreen: the fate card states its mechanical outcome', () => {
  it('shows the effect lines beside what came to pass', () => {
    renderReport([
      {
        ...nightRaidSlot,
        actual: { ...nightRaidSlot.actual, effect: ['Food −2 t', 'Soldier ×0.98'] },
      },
    ])
    const line = screen.getByTestId('fate-effect-0')
    expect(line).toHaveTextContent('Food −2 t, Soldier ×0.98')
  })

  it('shows the FIRED rung\'s effect, not the blind one it replaced', () => {
    renderReport([
      {
        ...nightRaidSlot,
        actual: { ...nightRaidSlot.actual, effect: ['Food −2 t', 'Soldier ×0.98'] },
        fired: {
          title: 'Pickets Hold',
          description: 'They flee with next to nothing.',
          rung: 'warned',
          effect: ['Food −0.5 t'],
        },
        scoutsIntervened: true,
      },
    ])
    // The beat renders `fired ?? actual`, so the line must follow it: the
    // downgraded rung cost half a tonne, not the two the blind rung would have.
    const line = screen.getByTestId('fate-effect-0')
    expect(line).toHaveTextContent('Food −0.5 t')
    expect(line).not.toHaveTextContent('−2 t')
  })

  it('states it on an unconsulted fate too, where there is no prophecy to read', () => {
    renderReport([
      {
        predicted: null,
        odds: null,
        wasAccurate: null,
        actual: { id: 'quarry', title: 'A Workable Seam', description: 'Stone enough.', effect: ['Materials +25'] },
      },
    ])
    expect(screen.getByTestId('fate-effect-0')).toHaveTextContent('Materials +25')
  })

  it('says nothing when there is nothing mechanical to say', () => {
    // A choice-fate carries no effect of its own (the branch cards price
    // themselves) and a bookkeeping flag is the rule's one exemption — neither
    // should render an empty line.
    renderReport([{ ...nightRaidSlot, actual: { ...nightRaidSlot.actual, effect: [] } }])
    expect(screen.queryByTestId('fate-effect-0')).not.toBeInTheDocument()
  })

  it('a deferred slot shows no outcome line — the blow has not fallen', () => {
    renderReport([
      { predicted: { id: 'night_raid', title: 'Night Raid' }, odds: 70, deferred: true },
    ])
    expect(screen.getByTestId('fate-deferred')).toBeInTheDocument()
    expect(screen.queryByTestId('fate-effect-0')).not.toBeInTheDocument()
  })
})

describe('ScoutReport: free reveal (prisoners taken)', () => {
  it('says why the enemy is an open book when enemy.revealed is set', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Superior' }}
        enemy={{
          revealed: true,
          count: { low: 400, high: 400 },
          supplies: 'strained',
          composition: { Foot: 100 },
          units: { Soldier: 400 },
          placements: [{ type: 'Soldier', q: 0, r: 22, count: 5 }],
        }}
      />,
    )
    expect(screen.getByTestId('scout-revealed')).toBeInTheDocument()
    expect(screen.getByTestId('scout-units')).toHaveTextContent('400 Soldier')
  })

  it('stays silent without the flag', () => {
    render(
      <ScoutReport
        scouting={{ band: 'Contested' }}
        enemy={{ count: { low: 400, high: 900 }, supplies: 'strained' }}
      />,
    )
    expect(screen.queryByTestId('scout-revealed')).not.toBeInTheDocument()
  })
})
