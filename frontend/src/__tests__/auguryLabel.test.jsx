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

const vision = (over) => ({
  id: 'x',
  title: 'An Event',
  description: '...',
  odds: 0.5,
  ...over,
})

const panelWith = (visions) =>
  render(
    <AuguryPanel
      augury={{ consulted: true, rerollsRemaining: 0, visions }}
      onConsult={() => {}}
      onReroll={() => {}}
      onContinue={() => {}}
    />,
  )

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
