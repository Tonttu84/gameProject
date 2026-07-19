/**
 * Event reveal screen — the end-of-turn report dealt out one card per click:
 * forage → each fate → upkeep → enemy → summary. Cards stay up once revealed;
 * the continue button only arrives with the summary card. (The fate-card
 * CONTENT — rungs, scout badges — is pinned in dayReportRungs.test.jsx.)
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EventRevealScreen from '../components/EventRevealScreen'
import useUiStore from '../stores/useUiStore'

const fullReport = {
  day: 4,
  forage: {
    posture: 'Contested',
    harvested: { food: 21000, materials: 2000 },
    rings: [],
    clashes: [{ ring: 1, winner: 'enemy', playerLosses: { Archer: 2 }, enemyLosses: {} }],
  },
  augury: [
    {
      predicted: { id: 'plague', title: 'Plague' },
      actual: { id: 'supply', title: 'Supply Cache', description: 'An abandoned depot.' },
      wasAccurate: false,
    },
    {
      predicted: { id: 'quiet', title: 'Quiet Fortnight' },
      actual: { id: 'quiet', title: 'Quiet Fortnight', description: 'Nothing stirs.' },
      wasAccurate: true,
    },
  ],
  upkeep: { foodConsumed: 12432, deserters: 40 },
  enemy: { stance: 'offering_battle', battleOffer: true },
  entries: ['Came to pass: Supply Cache.', '40 soldiers deserted — the stores are empty.'],
}

const reveal = () => fireEvent.click(screen.getByTestId('reveal-next'))

describe('EventRevealScreen: one card per click', () => {
  it('deals forage → fates → upkeep → enemy → summary in order, keeping revealed cards up', () => {
    render(<EventRevealScreen report={fullReport} onContinue={() => {}} />)

    // Only the first beat (forage) is on the table.
    expect(screen.getByTestId('reveal-beat-forage')).toHaveTextContent('21 t')
    expect(screen.getByTestId('reveal-beat-forage')).toHaveTextContent('Contested')
    expect(screen.getByTestId('reveal-beat-forage')).toHaveTextContent(/scattered/)
    expect(screen.queryByTestId('reveal-beat-fate-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('report-continue')).not.toBeInTheDocument()

    reveal()
    expect(screen.getByTestId('reveal-beat-fate-0')).toHaveTextContent('Supply Cache')
    expect(screen.queryByTestId('reveal-beat-fate-1')).not.toBeInTheDocument()

    reveal()
    expect(screen.getByTestId('reveal-beat-fate-1')).toHaveTextContent('Quiet Fortnight')
    // Earlier cards are still up.
    expect(screen.getByTestId('reveal-beat-forage')).toBeInTheDocument()
    expect(screen.getByTestId('reveal-beat-fate-0')).toBeInTheDocument()

    reveal()
    expect(screen.getByTestId('reveal-beat-upkeep')).toHaveTextContent('12.4 t')
    expect(screen.getByTestId('reveal-beat-upkeep')).toHaveTextContent('40 soldiers deserted')

    reveal()
    expect(screen.getByTestId('reveal-beat-enemy')).toHaveTextContent(/offer the field/)
    expect(screen.queryByTestId('report-continue')).not.toBeInTheDocument()

    reveal()
    expect(screen.getByTestId('reveal-beat-summary')).toHaveTextContent('Came to pass: Supply Cache.')
    // All cards dealt: the deal button is gone, the continue button is here.
    expect(screen.queryByTestId('reveal-next')).not.toBeInTheDocument()
    expect(screen.getByTestId('report-continue')).toBeInTheDocument()
  })

  it('continue hands back to the council callback', () => {
    const onContinue = vi.fn()
    render(<EventRevealScreen report={{ day: 2, entries: [], augury: [] }} onContinue={onContinue} />)
    // No forage/upkeep/enemy blocks: the summary is the one and only beat.
    fireEvent.click(screen.getByTestId('report-continue'))
    expect(onContinue).toHaveBeenCalled()
  })

  // Regression: a DEFERRED fate (a counter-raid target) can also be a choice
  // event, so acceptFates puts BOTH `deferred` and a `pendingChoice` on its
  // reveal card. The deferred FateBeat shows only the threat (no options), so
  // the reveal must NOT gate its advance on that pendingChoice — otherwise
  // reveal-next goes disabled with nothing to click and the tent deadlocks (a
  // real stuck-reveal the campaign-loop E2E hit once choice density rose). The
  // decision is owed later via the pendingChoices overlay, not here.
  it('a deferred fate that also owes a choice never deadlocks the reveal', () => {
    const report = {
      day: 3,
      kind: 'fates',
      augury: [
        {
          predicted: { id: 'baggage_plague', title: 'Plague in the Baggage Train' },
          odds: 0.4,
          deferred: true,
          pendingChoice: { options: [{ id: 'quarantine', label: 'Quarantine' }] },
        },
      ],
      entries: [],
    }
    render(<EventRevealScreen report={report} onContinue={() => {}} />)
    // The deferred card shows the pending threat, not its options…
    expect(screen.getByTestId('fate-deferred')).toBeInTheDocument()
    expect(screen.queryByTestId('choice-quarantine')).not.toBeInTheDocument()
    // …and the reveal can still advance (not stuck on a choice it can't show).
    expect(screen.getByTestId('reveal-next')).toBeEnabled()
  })

  it('shows the tutorial intro only when the flag is on', () => {
    const { unmount } = render(<EventRevealScreen report={fullReport} onContinue={() => {}} />)
    expect(screen.getByTestId('tutorial-reveal')).toBeInTheDocument()
    unmount()

    useUiStore.getState().toggleTutorial()
    render(<EventRevealScreen report={fullReport} onContinue={() => {}} />)
    expect(screen.queryByTestId('tutorial-reveal')).not.toBeInTheDocument()
  })
})
