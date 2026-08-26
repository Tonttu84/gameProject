/**
 * THE FORGE — Construction slice C1 (docs/CAMPAIGN_PLAN.md "THE CONSTRUCTION
 * INTERVIEW", C-1..C-8).
 *
 * The rendering CONTRACT, in the Study test's mold: the server resolves every
 * gate (level, paths, mithril, the once-per-turn stamp) and phrases every
 * sentence; this screen lays that out and re-derives nothing. Both doors are
 * pinned — the item-first list and the smith-first filter — because they are
 * one component whose two modes must not drift (the ItemStorePanel precedent).
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ForgePanel from '../components/ForgePanel'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { campaignFixture } from './fixtures/campaign'

// The view block as campaignView ships it: one open row, one level-locked row,
// so both faces of the ladder render. Aldric qualifies for both; the locked
// row's smith list is empty exactly as the server would send it (no living
// mage commands Earth 2 here).
const forgeFixture = {
  level: 1,
  rows: [
    {
      id: 'forged_emberedge', name: 'Emberedge',
      blurb: 'A blade quenched in forge-fire.',
      effect: 'It gives its bearer +2 attack.',
      where: 'Worn by a character, in a hand slot.',
      binding: 'It can be taken back later and given to something else.',
      level: 1, mithril: 4, pathsText: 'Fire 1',
      smiths: [{ id: 7, name: 'Aldric', forgedToday: false }],
      levelMet: true, mithrilMet: true, held: false,
    },
    {
      id: 'forged_artificial_heart', name: 'Artificial Heart',
      blurb: 'A heart of mithril and clockwork.',
      effect: 'It gives its bearer +4 stamina.',
      where: 'Worn by a character, in a body slot.',
      binding: 'Once it is given, it stays: it cannot be taken back, and nothing else will ever carry it.',
      level: 2, mithril: 8, pathsText: 'Earth 2',
      smiths: [],
      levelMet: false, mithrilMet: true, held: false,
    },
  ],
}

const characters = [
  { id: 7, name: 'Aldric', type: 'Mage', alive: true, forgedToday: false },
  { id: 8, name: 'Odo', type: 'Priest', alive: true, forgedToday: false },
]

const forgeWith = ({ forge = forgeFixture, request = {}, ...props } = {}) => {
  useCampaignStore.setState({
    campaign: { ...campaignFixture, forge, characters },
  })
  useUiStore.setState({ forgeRequest: request })
  return render(<ForgePanel onForge={vi.fn()} {...props} />)
}

describe('The Forge — the item-first door', () => {
  it('shows every craftable row, locked ones locked, with the gates phrased by the server', () => {
    forgeWith()
    expect(screen.getByTestId('forge-row-forged_emberedge')).toBeInTheDocument()
    expect(screen.getByTestId('forge-row-req-forged_emberedge')).toHaveTextContent('Fire 1 · 4 mithril')
    // The ladder reads as a ladder: the level-2 row is shown, with its school
    // gate stated only where it is what blocks the work (the Study's rule).
    expect(screen.getByTestId('forge-row-gate-forged_artificial_heart')).toHaveTextContent('Construction 2')
    expect(screen.queryByTestId('forge-row-gate-forged_emberedge')).not.toBeInTheDocument()
    expect(screen.getByTestId('forge-stock')).toHaveTextContent('Mithril 10')
  })

  it('opens a row into its sentences, its binding line, and the smith picker', async () => {
    forgeWith()
    await userEvent.click(screen.getByTestId('forge-row-toggle-forged_emberedge'))
    expect(screen.getByTestId('forge-row-detail-forged_emberedge')).toHaveTextContent('+2 attack')
    // The binding warning shows BEFORE the fortnight is spent (C-2), not only
    // at the moment of equipping.
    expect(screen.getByTestId('forge-binding-forged_emberedge')).toHaveTextContent('can be taken back')
    expect(screen.getByTestId('forge-go-forged_emberedge-7')).toHaveTextContent('Set Aldric to the work')
  })

  it('forges through the guarded action with the smith and the row', async () => {
    const onForge = vi.fn()
    forgeWith({ onForge })
    await userEvent.click(screen.getByTestId('forge-row-toggle-forged_emberedge'))
    await userEvent.click(screen.getByTestId('forge-go-forged_emberedge-7'))
    expect(onForge).toHaveBeenCalledWith(7, 'forged_emberedge')
  })

  it('a spent smith is shown spent rather than vanished, and his button is dead', async () => {
    const spent = {
      ...forgeFixture,
      rows: [{
        ...forgeFixture.rows[0],
        smiths: [{ id: 7, name: 'Aldric', forgedToday: true }],
      }, forgeFixture.rows[1]],
    }
    forgeWith({ forge: spent })
    await userEvent.click(screen.getByTestId('forge-row-toggle-forged_emberedge'))
    const button = screen.getByTestId('forge-go-forged_emberedge-7')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('already forged')
  })

  it('a locked turn renders the record, not live buttons', async () => {
    forgeWith({ locked: true })
    expect(screen.getByTestId('forge-locked')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('forge-row-toggle-forged_emberedge'))
    expect(screen.getByTestId('forge-go-forged_emberedge-7')).toBeDisabled()
  })
})

describe('The Forge — the smith-first door', () => {
  it('filters to the rows his paths qualify him for and names him in the head', () => {
    forgeWith({ request: { smithId: 7 } })
    expect(screen.getByRole('heading', { name: 'The Forge — Aldric' })).toBeInTheDocument()
    expect(screen.getByTestId('forge-row-forged_emberedge')).toBeInTheDocument()
    // The heart asks Earth 2, which Aldric does not command — his door does
    // not offer it.
    expect(screen.queryByTestId('forge-row-forged_artificial_heart')).not.toBeInTheDocument()
  })

  it('says so in a sentence when he qualifies for nothing', () => {
    const none = {
      ...forgeFixture,
      rows: forgeFixture.rows.map((row) => ({ ...row, smiths: [] })),
    }
    forgeWith({ forge: none, request: { smithId: 7 } })
    expect(screen.getByTestId('forge-empty')).toHaveTextContent('Aldric commands no paths')
  })
})
