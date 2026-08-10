/**
 * Playtest item 4: the augur's header labels the SHOWN card's flavour — its
 * mood (valence, from the server view) crossed with its magnitude (severity).
 * A minor BAD fate no longer reads as "gentle", and neutral fates (a comet,
 * rains that foul both sides) get their own mood-free words.
 */

import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuguryPanel from '../components/AuguryPanel'
import useCampaignStore from '../stores/useCampaignStore'

const vision = (over) => ({
  id: 'x',
  title: 'An Event',
  description: '...',
  odds: 0.5,
  ...over,
})

// What a fate MECHANICALLY does, beside the flavour that says how it feels
// (user, 2026-08-10). The strings are built server-side by describeEffect, so
// the panel's only job is to show them — and to show nothing when there is
// nothing to say, since hidden-state effects describe as an empty list.
describe('a vision states its mechanical cost', () => {
  it('renders the effect text the server sent', () => {
    panelWith([vision({ effectText: ['Food −2 t', 'Soldier −12'] })])
    expect(screen.getByTestId('augury-effect-0')).toHaveTextContent('Food −2 t, Soldier −12')
  })

  it('shows no effect line for a fate whose effect is hidden state', () => {
    panelWith([vision({ effectText: [] })])
    expect(screen.queryByTestId('augury-effect-0')).not.toBeInTheDocument()
  })

  it('names the TRUE fate’s cost when the vision turns out to be a bluff', () => {
    // Being told the reading was false without being told what is actually
    // coming is the vagueness this whole change exists to remove.
    panelWith([
      vision({
        id: 'shown',
        effectText: ['Gold +40'],
        truth: { id: 'real', title: 'Night Raid', effectText: ['Food −2 t'] },
      }),
    ])
    expect(screen.getByTestId('augury-truth-effect-0')).toHaveTextContent('Food −2 t')
  })
})

// AuguryPanel reads augury from the campaign store now, not a prop — see
// docs/CAMPAIGN_PLAN.md's 2026-07-16 frontend state-management thread.
const panelWith = (visions) => {
  useCampaignStore.setState({
    campaign: { id: 'c1', augury: { consulted: true, rerollsRemaining: 0, visions } },
  })
  return render(
    <AuguryPanel onConsult={() => {}} onReroll={() => {}} onContinue={() => {}} />,
  )
}

describe('augury header labels the shown flavour', () => {
  it('crosses valence with magnitude for good and bad omens', () => {
    panelWith([
      vision({ valence: 'good', severity: 1 }),
      vision({ valence: 'bad', severity: 1 }), // minor + BAD → not "gentle"
      vision({ valence: 'bad', severity: 3 }),
    ])
    expect(screen.getByTestId('augury-vision-0')).toHaveTextContent('A kind omen')
    expect(screen.getByTestId('augury-vision-1')).toHaveTextContent('An uneasy omen')
    expect(screen.getByTestId('augury-vision-2')).toHaveTextContent('A dire omen')
  })

  it('labels neutral fates with their own mood-free words across magnitudes', () => {
    panelWith([
      vision({ valence: 'neutral', severity: 1 }),
      vision({ valence: 'neutral', severity: 2 }),
      vision({ valence: 'neutral', severity: 3 }),
    ])
    expect(screen.getByTestId('augury-vision-0')).toHaveTextContent('A faint omen')
    expect(screen.getByTestId('augury-vision-1')).toHaveTextContent('A clouded omen')
    expect(screen.getByTestId('augury-vision-2')).toHaveTextContent('A portentous omen')
  })

  it('falls back to the neutral wording when valence is missing', () => {
    panelWith([vision({ severity: 2 })])
    expect(screen.getByTestId('augury-vision-0')).toHaveTextContent('A clouded omen')
  })
})
