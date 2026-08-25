/**
 * THE STUDY — the research screen (docs/CAMPAIGN_PLAN.md, "SLICE 3").
 *
 * What is pinned here is the rendering CONTRACT, not the arithmetic: the server
 * decides what is unlocked, what the next level costs and what everything is
 * called, and this screen's whole job is to lay that out without re-deriving or
 * re-phrasing any of it (17-5). So every test below feeds a research block
 * shaped exactly as campaignView ships one and asserts what reaches the page.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StudyPanel from '../components/StudyPanel'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { campaignFixture } from './fixtures/campaign'

// One school of each interesting shape: a focused one part-way to its next
// level, one holding a locked and an unlocked spell, and an empty one.
const researchFixture = {
  focus: 'evocation',
  allies: 0,
  rate: 30,
  schools: {
    evocation: {
      label: 'Evocation',
      level: 1,
      points: 20,
      nextCost: 60,
      spells: [
        {
          spell: 'fireball', form: 'minor', label: 'Ember',
          description: 'A single bolt of fire at range.',
          requires: [{ path: 'fire', label: 'Fire', level: 1 }],
          schoolLevel: 1, unlocked: true, fatigue: 8, castingTime: 1,
        },
        {
          spell: 'fireball', form: 'major', label: 'Fireball',
          description: 'A detonation at range.',
          requires: [{ path: 'fire', label: 'Fire', level: 3 }],
          schoolLevel: 3, unlocked: false, fatigue: 22, castingTime: 2,
        },
      ],
    },
    conjuration: {
      label: 'Conjuration', level: 0, points: 0, nextCost: 30, spells: [],
    },
    enchantment: {
      label: 'Enchantment', level: 0, points: 0, nextCost: 30, spells: [],
    },
    construction: {
      label: 'Construction', level: 0, points: 0, nextCost: 30, spells: [],
    },
  },
}

const studyWith = (over = {}, props = {}) => {
  useCampaignStore.setState({
    campaign: { ...campaignFixture, research: { ...researchFixture, ...over } },
  })
  return render(<StudyPanel onFocus={vi.fn()} {...props} />)
}

describe('The Study', () => {
  it('shows every school with its level and its progress toward the next', () => {
    studyWith()
    expect(screen.getByTestId('study-level-evocation')).toHaveTextContent('Level 1')
    // The bank and the price both come from the server; the screen only prints
    // them, so 30 × n never gets re-derived in a component.
    expect(screen.getByTestId('study-progress-evocation')).toHaveTextContent('20 / 60')
    for (const school of ['evocation', 'conjuration', 'enchantment', 'construction'])
      expect(screen.getByTestId(`study-school-${school}`)).toBeInTheDocument()
  })

  it('marks the focused school as studied and offers no button to re-pick it', () => {
    studyWith()
    expect(screen.getByTestId('study-focused-evocation')).toBeInTheDocument()
    expect(screen.queryByTestId('study-focus-evocation')).not.toBeInTheDocument()
    // ...while the others can still be chosen.
    expect(screen.getByTestId('study-focus-conjuration')).toBeInTheDocument()
  })

  it('directs study at a school through the guarded action', async () => {
    const onFocus = vi.fn()
    studyWith({}, { onFocus })
    await userEvent.click(screen.getByTestId('study-focus-conjuration'))
    expect(onFocus).toHaveBeenCalledWith('conjuration')
  })

  it('S2-12: past Prepare the focus is settled, and the screen says so', () => {
    const onFocus = vi.fn()
    studyWith({}, { onFocus, locked: true })
    expect(screen.getByTestId('study-locked')).toBeInTheDocument()
    expect(screen.getByTestId('study-focus-conjuration')).toBeDisabled()
  })

  it('S3-6: a row is locked by the SCHOOL gate, and names it when it is', () => {
    studyWith()
    const ember = screen.getByTestId('study-spell-fireball-minor')
    const fireball = screen.getByTestId('study-spell-fireball-major')
    expect(ember).toHaveClass('unlocked')
    expect(fireball).toHaveClass('locked')

    // Both state the PATH requirement; only the locked one states the school
    // level it is waiting on — on an unlocked row that is a number already paid.
    expect(ember).toHaveTextContent('Fire 1')
    expect(fireball).toHaveTextContent('Fire 3')
    expect(screen.getByTestId('study-spell-gate-fireball-major')).toHaveTextContent('Evocation 3')
    expect(screen.queryByTestId('study-spell-gate-fireball-minor')).not.toBeInTheDocument()
  })

  it('S3-4: the menu shows names, and the description opens on click', async () => {
    studyWith()
    // Collapsed: no description anywhere on the page.
    expect(screen.queryByTestId('study-spell-detail-fireball-minor')).not.toBeInTheDocument()
    expect(screen.queryByText('A single bolt of fire at range.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('study-spell-toggle-fireball-minor'))
    const detail = screen.getByTestId('study-spell-detail-fireball-minor')
    expect(detail).toHaveTextContent('A single bolt of fire at range.')
    // The mechanical numbers ride with it — both are the server's, unphrased.
    expect(detail).toHaveTextContent('Fatigue 8')
    expect(detail).toHaveTextContent('1 tick')

    await userEvent.click(screen.getByTestId('study-spell-toggle-fireball-minor'))
    expect(screen.queryByTestId('study-spell-detail-fireball-minor')).not.toBeInTheDocument()
  })

  it('S3-5: Construction renders like any school, saying it holds nothing', () => {
    studyWith()
    expect(screen.getByTestId('study-school-construction')).toHaveTextContent('Construction')
    expect(screen.getByTestId('study-empty-construction')).toBeInTheDocument()
    // ...and is still focusable — an empty school is not a special case (user:
    // "just make it normal").
    expect(screen.getByTestId('study-focus-construction')).toBeEnabled()
  })

  it('states what a turn of study adds', () => {
    studyWith()
    expect(screen.getByTestId('study-rate')).toHaveTextContent('30')
    // No parenthetical where nobody has been lent to you — S2-11's allies are
    // the quiet background source, and a "(0 lent)" would advertise a mechanic
    // the player has not met yet.
    expect(screen.getByTestId('study-rate')).not.toHaveTextContent('lent')
  })

  it('names lent allies once a fate has sent one (S2-11)', () => {
    studyWith({ allies: 2, rate: 50 })
    expect(screen.getByTestId('study-rate')).toHaveTextContent('50')
    expect(screen.getByTestId('study-rate')).toHaveTextContent('2 lent to you')
  })

  it('shows Mastered where a school has no next level to buy', () => {
    studyWith({
      schools: {
        ...researchFixture.schools,
        evocation: { ...researchFixture.schools.evocation, level: 9, nextCost: null, points: 0 },
      },
    })
    expect(screen.getByTestId('study-progress-evocation')).toHaveTextContent('Mastered')
  })

  it('Back closes the takeover', async () => {
    studyWith()
    useUiStore.setState({ studyOpen: true })
    await userEvent.click(screen.getByTestId('study-back'))
    expect(useUiStore.getState().studyOpen).toBe(false)
  })
})
