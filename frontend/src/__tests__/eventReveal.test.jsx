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
  enemy: { bossFightDue: true },
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
    expect(screen.getByTestId('reveal-beat-enemy')).toHaveTextContent(/give you battle/)
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
  // A deferred fate names the TRUE threat and what it will cost (2026-08-10).
  // The truth is already public by the time the tent renders — it surfaces at
  // accept — and the counter card on the raid board has always read trueEvent,
  // so showing the shown-vision here had the two screens contradicting each
  // other while the player decided whether to raid it.
  it('a deferred fate names the true threat and its cost, not the bluff', () => {
    const report = {
      day: 3,
      kind: 'fates',
      augury: [
        {
          odds: 0.4,
          deferred: true,
          threat: { title: 'Doom', description: '…', effect: ['Food −1 t'] },
        },
      ],
      entries: [],
    }
    render(<EventRevealScreen report={report} onContinue={() => {}} />)

    expect(screen.getByTestId('fate-threat-0')).toHaveTextContent('Coming: Doom — Food −1 t')
    // Still no verdict: whether it lands waits for end-day, which is what
    // leaves a raid able to unmake it.
    expect(screen.getByTestId('fate-deferred')).toBeInTheDocument()
    expect(screen.queryByText(/The augur foretold/)).not.toBeInTheDocument()
  })

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

  // Two choice fates in ONE reveal (now common — ~7 of ~20 pool events carry
  // choices): each must block the advance, resolve, and hand off to the next.
  // The campaign-loop E2E wedged here on the SECOND choice (baggage_plague then
  // merchant_caravan), so pin the client handles a run of them.
  it('resolves two choice fates in one reveal, one after the other', async () => {
    const onChoose = vi.fn(async (slot) => ({ slot, label: `chose-${slot}` }))
    const choiceFate = (predId, actId, actTitle, opts) => ({
      predicted: { id: predId, title: 'Foretold' },
      actual: { id: actId, title: actTitle },
      wasAccurate: false,
      pendingChoice: { options: opts },
    })
    const report = {
      day: 3,
      kind: 'fates',
      augury: [
        choiceFate('a', 'baggage_plague', 'Plague in the Baggage Train', [
          { id: 'quarantine', label: 'Quarantine' },
          { id: 'march_on', label: 'March on' },
        ]),
        choiceFate('b', 'merchant_caravan', 'A Merchant Caravan', [
          { id: 'buy_provisions', label: 'Buy up their provisions' },
          { id: 'sell_for_materials', label: 'Trade rations' },
        ]),
      ],
      entries: [],
    }
    render(<EventRevealScreen report={report} onChoose={onChoose} onContinue={() => {}} />)

    // Fate-0: its choice blocks the advance until picked.
    expect(screen.getByTestId('reveal-next')).toBeDisabled()
    fireEvent.click(screen.getByTestId('choice-quarantine'))
    await screen.findByTestId('choice-outcome-0')
    expect(screen.getByTestId('reveal-next')).toBeEnabled()

    // Advance to fate-1: it must block AND resolve too — not wedge the reveal.
    fireEvent.click(screen.getByTestId('reveal-next'))
    expect(await screen.findByTestId('choice-buy_provisions')).toBeInTheDocument()
    expect(screen.getByTestId('reveal-next')).toBeDisabled()
    fireEvent.click(screen.getByTestId('choice-buy_provisions'))
    await screen.findByTestId('choice-outcome-1')
    expect(screen.getByTestId('reveal-next')).toBeEnabled()

    // The third argument is the CHARTER a mission fate spends (decision 12).
    // Null here, and on every fate that does not ask for one — which is most of
    // them; the picker only appears when the server sends an offer.
    expect(onChoose).toHaveBeenCalledWith(0, 'quarantine', null)
    expect(onChoose).toHaveBeenCalledWith(1, 'buy_provisions', null)
  })

  // Every card states what it does (user, 2026-08-10). A branch used to carry
  // label + prose only, so the decision could be made on tone alone. The line
  // is formatted server-side (describeEffect) precisely so the client cannot
  // invent one — an option with nothing to say renders no line rather than an
  // empty one.
  it('prices each branch by its stated effect, and skips the line when there is none', () => {
    const report = {
      day: 5, kind: 'fates',
      augury: [{
        predicted: { id: 'a', title: 'Foretold' },
        actual: { id: 'breach_threatens', title: 'A Breach Threatens' },
        wasAccurate: true,
        pendingChoice: {
          options: [
            {
              id: 'into_the_breach', label: 'Throw men into the breach', description: 'Shoulder to shoulder.',
              effectText: ['Food −2 t', 'Soldier ×0.98', 'Karrowgate thinks the better of you'],
            },
            { id: 'cannot_spare', label: 'You cannot spare them', description: 'They hold it alone.', effectText: [] },
          ],
        },
      }],
      entries: [],
    }
    render(<EventRevealScreen report={report} onChoose={vi.fn()} onContinue={() => {}} />)

    expect(screen.getByTestId('choice-effect-into_the_breach')).toHaveTextContent(
      'Food −2 t, Soldier ×0.98, Karrowgate thinks the better of you',
    )
    expect(screen.getByTestId('choice-cannot_spare')).toBeInTheDocument()
    expect(screen.queryByTestId('choice-effect-cannot_spare')).not.toBeInTheDocument()
  })

  // The exact shape the campaign-loop E2E wedged on: choice → DEFERRED → choice.
  // Resolving fate-0's choice, advancing PAST the deferred fate-1 (threat only,
  // no gate), then resolving fate-2's choice must all work — the deferred card
  // in the middle must not throw off the later choice's index/gating.
  it('handles choice → deferred → choice in one reveal', async () => {
    const onChoose = vi.fn(async (slot) => ({ slot, label: `chose-${slot}` }))
    const report = {
      day: 4,
      kind: 'fates',
      augury: [
        {
          predicted: { id: 'a', title: 'A' }, actual: { id: 'sellswords', title: 'Sellswords at the Camp' }, wasAccurate: true,
          pendingChoice: { options: [{ id: 'hire', label: 'Hire the company' }, { id: 'decline', label: 'Send them on' }] },
        },
        { predicted: { id: 'b', title: 'B' }, odds: 0.3, deferred: true },
        {
          predicted: { id: 'c', title: 'C' }, actual: { id: 'horses', title: 'A Captured Herd' }, wasAccurate: false,
          pendingChoice: { options: [{ id: 'mount_veterans', label: 'Mount your veterans as cavalry' }, { id: 'sell_herd', label: 'Sell the herd' }] },
        },
      ],
      entries: [],
    }
    render(<EventRevealScreen report={report} onChoose={onChoose} onContinue={() => {}} />)

    // Fate-0 choice → resolve.
    fireEvent.click(screen.getByTestId('choice-hire'))
    await screen.findByTestId('choice-outcome-0')
    fireEvent.click(screen.getByTestId('reveal-next'))

    // Fate-1 is deferred: threat only, and it must NOT block the advance.
    expect(await screen.findByTestId('fate-deferred')).toBeInTheDocument()
    expect(screen.getByTestId('reveal-next')).toBeEnabled()
    fireEvent.click(screen.getByTestId('reveal-next'))

    // Fate-2 choice → must be resolvable, indexed correctly past the deferred one.
    fireEvent.click(await screen.findByTestId('choice-mount_veterans'))
    await screen.findByTestId('choice-outcome-2')
    expect(screen.getByTestId('reveal-next')).toBeEnabled()
    expect(onChoose).toHaveBeenCalledWith(2, 'mount_veterans', null)
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
