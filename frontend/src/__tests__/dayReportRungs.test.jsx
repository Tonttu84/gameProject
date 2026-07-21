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
