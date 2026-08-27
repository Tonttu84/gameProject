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

// The constructions block (slice C2) as campaignView ships it: one open row,
// one level-locked battlefield row, one already standing.
const constructionsFixture = {
  rows: [
    {
      id: 'works_smokehouse', name: 'Smokehouse and Salt Stores',
      blurb: 'Racks over slow fires.',
      effects: ['Your foraging ×1.1'],
      level: 1, mithril: 3, pathsText: 'Nature 1',
      smiths: [{ id: 7, name: 'Aldric', forgedToday: false }],
      levelMet: true, mithrilMet: true, built: false,
    },
    {
      id: 'works_flanking_bastions', name: 'Flanking Bastions',
      blurb: 'Stone teeth at the shoulders of the line.',
      effects: ['Walls 8 hexsides of your front for every pitched battle'],
      level: 2, mithril: 6, pathsText: 'Earth 2',
      smiths: [],
      levelMet: false, mithrilMet: true, built: false,
    },
    {
      id: 'works_warding_beacons', name: 'Warding Beacons',
      blurb: 'Iron cages on high poles.',
      effects: ['The enemy strips the countryside slower'],
      level: 1, mithril: 3, pathsText: 'Fire 1',
      smiths: [{ id: 7, name: 'Aldric', forgedToday: false }],
      levelMet: true, mithrilMet: true, built: true,
    },
  ],
}

// The foundry block (slice C3) as campaignView ships it: the golem, open —
// no binding line and no standing state, because a body is neither unique nor
// permanent-in-place; the row never closes.
const foundryFixture = {
  rows: [
    {
      id: 'crafted_golem', name: 'Golem', unit: 'Golem',
      blurb: 'A man of stone, hewn and woken.',
      level: 3, mithril: 15, pathsText: 'Earth 2',
      smiths: [{ id: 7, name: 'Aldric', forgedToday: false }],
      levelMet: true, mithrilMet: true,
    },
  ],
}

const forgeWith = ({
  forge = forgeFixture,
  constructions = constructionsFixture,
  foundry = foundryFixture,
  request = {},
  ...props
} = {}) => {
  useCampaignStore.setState({
    campaign: { ...campaignFixture, forge, constructions, foundry, characters },
  })
  useUiStore.setState({ forgeRequest: request })
  return render(<ForgePanel onForge={vi.fn()} onConstruct={vi.fn()} onCraft={vi.fn()} {...props} />)
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

  it('says so in a sentence when he qualifies for nothing — items, works and foundry alike', () => {
    const none = {
      ...forgeFixture,
      rows: forgeFixture.rows.map((row) => ({ ...row, smiths: [] })),
    }
    const noWorks = {
      rows: constructionsFixture.rows.map((row) => ({ ...row, smiths: [] })),
    }
    const noUnits = {
      rows: foundryFixture.rows.map((row) => ({ ...row, smiths: [] })),
    }
    forgeWith({ forge: none, constructions: noWorks, foundry: noUnits, request: { smithId: 7 } })
    expect(screen.getByTestId('forge-empty')).toHaveTextContent('Aldric commands no paths')
  })
})

describe('The Works — constructions on the same screen (slice C2)', () => {
  it('shows the ladder like the items: locked rows locked, standing rows standing', () => {
    forgeWith()
    expect(screen.getByTestId('forge-works-head')).toBeInTheDocument()
    expect(screen.getByTestId('work-row-req-works_smokehouse')).toHaveTextContent('Nature 1 · 3 mithril')
    expect(screen.getByTestId('work-row-gate-works_flanking_bastions')).toHaveTextContent('Construction 2')
    // A built row closes into its standing state — no gates, no picker.
    expect(screen.getByTestId('work-standing-works_warding_beacons')).toHaveTextContent('It stands.')
    expect(screen.queryByTestId('work-row-req-works_warding_beacons')).not.toBeInTheDocument()
  })

  it('opens a row into its phrased effect lines and the smith picker', async () => {
    forgeWith()
    await userEvent.click(screen.getByTestId('work-row-toggle-works_smokehouse'))
    expect(screen.getByTestId('work-row-detail-works_smokehouse')).toHaveTextContent('Your foraging ×1.1')
    expect(screen.getByTestId('work-go-works_smokehouse-7')).toHaveTextContent('Set Aldric to the work')
  })

  it('builds through the guarded action with the builder and the row', async () => {
    const onConstruct = vi.fn()
    forgeWith({ onConstruct })
    await userEvent.click(screen.getByTestId('work-row-toggle-works_smokehouse'))
    await userEvent.click(screen.getByTestId('work-go-works_smokehouse-7'))
    expect(onConstruct).toHaveBeenCalledWith(7, 'works_smokehouse')
  })

  it('a standing row offers no picker even when opened', async () => {
    forgeWith()
    await userEvent.click(screen.getByTestId('work-row-toggle-works_warding_beacons'))
    expect(screen.getByTestId('work-row-detail-works_warding_beacons')).toHaveTextContent('countryside slower')
    expect(screen.queryByTestId('work-go-works_warding_beacons-7')).not.toBeInTheDocument()
  })

  it('the smith-first door filters the works to his paths too', () => {
    const hisWorks = {
      rows: constructionsFixture.rows.map((row) =>
        row.id === 'works_smokehouse' ? row : { ...row, smiths: [] },
      ),
    }
    forgeWith({ constructions: hisWorks, request: { smithId: 7 } })
    expect(screen.getByTestId('work-row-works_smokehouse')).toBeInTheDocument()
    expect(screen.queryByTestId('work-row-works_warding_beacons')).not.toBeInTheDocument()
  })
})

describe('The Foundry — crafted units on the same screen (slice C3)', () => {
  it('shows the golem under its own head, gates phrased like everything else', () => {
    forgeWith()
    expect(screen.getByTestId('forge-foundry-head')).toBeInTheDocument()
    expect(screen.getByTestId('foundry-row-req-crafted_golem')).toHaveTextContent('Earth 2 · 15 mithril')
    // levelMet true in the fixture, so no gate badge — the Study's rule again.
    expect(screen.queryByTestId('foundry-row-gate-crafted_golem')).not.toBeInTheDocument()
  })

  it('a level-locked golem is shown locked, never hidden — the ladder reads as a ladder', () => {
    const locked = {
      rows: [{ ...foundryFixture.rows[0], levelMet: false, smiths: [] }],
    }
    forgeWith({ foundry: locked })
    expect(screen.getByTestId('foundry-row-gate-crafted_golem')).toHaveTextContent('Construction 3')
  })

  it('crafts through the guarded action with the smith and the row', async () => {
    const onCraft = vi.fn()
    forgeWith({ onCraft })
    await userEvent.click(screen.getByTestId('foundry-row-toggle-crafted_golem'))
    expect(screen.getByTestId('foundry-row-detail-crafted_golem')).toHaveTextContent('stone')
    await userEvent.click(screen.getByTestId('foundry-go-crafted_golem-7'))
    expect(onCraft).toHaveBeenCalledWith(7, 'crafted_golem')
  })

  it('the smith-first door filters the foundry to his paths too', () => {
    const notHis = { rows: [{ ...foundryFixture.rows[0], smiths: [] }] }
    forgeWith({ foundry: notHis, request: { smithId: 7 } })
    expect(screen.queryByTestId('foundry-row-crafted_golem')).not.toBeInTheDocument()
    // The head stays: his door still offers the items his paths qualify.
    expect(screen.queryByTestId('forge-foundry-head')).not.toBeInTheDocument()
  })

  it('a spent smith is spent at the foundry exactly as at the forge', async () => {
    const spent = {
      rows: [{
        ...foundryFixture.rows[0],
        smiths: [{ id: 7, name: 'Aldric', forgedToday: true }],
      }],
    }
    forgeWith({ foundry: spent })
    await userEvent.click(screen.getByTestId('foundry-row-toggle-crafted_golem'))
    const button = screen.getByTestId('foundry-go-crafted_golem-7')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('already forged')
  })
})
