/**
 * Hex-capacity guard: a squad occupies real capacity on its hex exactly
 * like loose troops. Before this fix, ReachMenu's capacity math (the
 * header readout, the loose "Troops" max-count clamp, and whether a squad
 * fits) only ever looked at loose stacks — a hex with squads on it could
 * silently exceed Hex::CAPACITY, and the engine drops the overflow units
 * at battle time rather than fighting with them.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReachMenu from '../components/ReachMenu'

const units = [
  { type: 'Soldier', symbol: 'S', placementSize: 10 },
  { type: 'Archer', symbol: 'A', placementSize: 10 },
]

// One squad worth 400 size-points (40 Soldier * 10).
const squads = [{ id: 1, name: '1st Cohort', composition: { Soldier: 40 } }]

const renderMenu = (props = {}) => {
  const onPlace = vi.fn()
  const onClose = vi.fn()
  const onPlaceSquad = vi.fn()
  const onRemoveSquad = vi.fn()
  return {
    onPlace, onClose, onPlaceSquad, onRemoveSquad,
    ...render(
      <ReachMenu
        hex={props.hex ?? { col: 1, row: 4 }}
        placements={props.placements ?? []}
        roster={props.roster ?? { Soldier: 1000, Archer: 1000 }}
        units={props.units ?? units}
        hexTerrain={props.hexTerrain ?? 'Open'}
        hexCapacity={props.hexCapacity ?? 640}
        onPlace={props.onPlace ?? onPlace}
        onClose={props.onClose ?? onClose}
        squads={props.squads ?? squads}
        squadPlacements={props.squadPlacements ?? {}}
        onPlaceSquad={props.onPlaceSquad ?? onPlaceSquad}
        onRemoveSquad={props.onRemoveSquad ?? onRemoveSquad}
      />,
    ),
  }
}

describe('the capacity header includes squads already on this hex', () => {
  it('reads 0/640 with no squads and nothing placed', () => {
    renderMenu()
    expect(screen.getByTestId('reach-capacity')).toHaveTextContent('0 / 640')
  })

  it('a squad on this hex counts toward the total immediately', () => {
    renderMenu({ hex: { col: 1, row: 4 }, squadPlacements: { 1: { col: 1, row: 4, holdTurns: 0 } } })
    expect(screen.getByTestId('reach-capacity')).toHaveTextContent('400 / 640')
  })

  it('flags the over-capacity state visually once the true total exceeds hexCapacity', () => {
    // Squad alone is 400; 25 more Soldiers (250) push it to 650 > 640.
    renderMenu({
      hex: { col: 1, row: 4 },
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 25, holdTurns: 0 }],
      squadPlacements: { 1: { col: 1, row: 4, holdTurns: 0 } },
    })
    expect(screen.getByTestId('reach-capacity')).toHaveClass('reach-capacity-over')
    expect(screen.getByTestId('reach-capacity')).toHaveTextContent('650 / 640')
  })

  it('a squad on a DIFFERENT hex does not count here', () => {
    renderMenu({ hex: { col: 1, row: 4 }, squadPlacements: { 1: { col: 9, row: 9, holdTurns: 0 } } })
    expect(screen.getByTestId('reach-capacity')).toHaveTextContent('0 / 640')
  })
})

describe('loose Troops max-count is clamped by squads already on this hex', () => {
  it('a 400-point squad leaves only 240 points (24 Soldiers) of loose room', () => {
    renderMenu({
      hex: { col: 1, row: 4 },
      squadPlacements: { 1: { col: 1, row: 4, holdTurns: 0 } },
    })
    const input = screen.getByTestId('count-Soldier')
    fireEvent.change(input, { target: { value: '25' } }) // 250 points — would overflow to 650
    expect(input).toHaveValue(24) // clamped to what actually fits (240 points)
  })

  it('with no squads on this hex, the full roster is placeable as before', () => {
    renderMenu({ hex: { col: 1, row: 4 }, squadPlacements: {} })
    const input = screen.getByTestId('count-Soldier')
    fireEvent.change(input, { target: { value: '64' } })
    expect(input).toHaveValue(64) // 640 points — exactly capacity, still fine
  })
})

describe('a squad Place/Move button is disabled when it would not fit', () => {
  it('disables Place when loose troops already occupy the room the squad needs', () => {
    // 30 loose Soldiers (300 points) leaves only 340 free — this squad needs 400.
    renderMenu({
      hex: { col: 1, row: 4 },
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 30, holdTurns: 0 }],
    })
    const button = screen.getByTestId('squad-place-1')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringMatching(/won't fit/i))
  })

  it('enables Place when the squad fits', () => {
    renderMenu({ hex: { col: 1, row: 4 }, placements: [] })
    expect(screen.getByTestId('squad-place-1')).not.toBeDisabled()
  })

  it('a squad already elsewhere is blocked from moving into a hex that is already full', () => {
    const fullOfOthers = [{ id: 2, name: 'Skirmishers', composition: { Archer: 64 } }] // 640 points
    renderMenu({
      hex: { col: 1, row: 4 },
      squads: [...squads, ...fullOfOthers],
      squadPlacements: { 2: { col: 1, row: 4, holdTurns: 0 } }, // Skirmishers already fills the hex
    })
    expect(screen.getByTestId('squad-place-1')).toBeDisabled() // 1st Cohort can't fit
  })

  it('clicking a disabled Place button never calls onPlaceSquad', () => {
    const { onPlaceSquad } = renderMenu({
      hex: { col: 1, row: 4 },
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 30, holdTurns: 0 }],
    })
    fireEvent.click(screen.getByTestId('squad-place-1'))
    expect(onPlaceSquad).not.toHaveBeenCalled()
  })
})
