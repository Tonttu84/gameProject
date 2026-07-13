/**
 * Squad placement tests for ReachMenu's "Squads" section (playtest item 1).
 *
 * A squad is placed as a whole (no per-type quantity to type — unlike the
 * "Troops" section) and applies immediately rather than being staged behind
 * a "Place" commit button: clicking "Place here"/"Move here" calls
 * onPlaceSquad(col, row, squadId, squadName, holdTurns) right away, and a
 * squad already on THIS hex shows a hold-turns input + Remove button instead.
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReachMenu from '../components/ReachMenu'

const defaultUnits = [{ type: 'Soldier', symbol: 'S', placementSize: 1 }]

const squads = [
  { id: 1, name: '1st Cohort', composition: { Soldier: 40 } },
  { id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 } },
]

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
        roster={props.roster ?? { Soldier: 10 }}
        units={props.units ?? defaultUnits}
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

describe('ReachMenu: Squads section', () => {
  it('is absent when the campaign has no squads', () => {
    renderMenu({ squads: [] })
    expect(screen.queryByText(/squads/i)).not.toBeInTheDocument()
  })

  it('lists every campaign squad with its composition', () => {
    renderMenu()
    expect(screen.getByText('1st Cohort')).toBeInTheDocument()
    expect(screen.getByText('40 Soldier')).toBeInTheDocument()
    expect(screen.getByText('Vanguard Riders')).toBeInTheDocument()
    expect(screen.getByText('6 Cavalry, 6 LightCavalry')).toBeInTheDocument()
  })

  it('an unplaced squad shows "Place here" and applies immediately on click', () => {
    const { onPlaceSquad } = renderMenu({ hex: { col: 2, row: 5 } })
    fireEvent.click(screen.getByTestId('squad-place-1'))
    expect(onPlaceSquad).toHaveBeenCalledWith(2, 5, 1, '1st Cohort', 0)
  })

  it('a squad placed on this hex shows a hold-turns input and a Remove button, not Place', () => {
    renderMenu({
      hex: { col: 2, row: 5 },
      squadPlacements: { 1: { col: 2, row: 5, holdTurns: 3 } },
    })
    expect(screen.queryByTestId('squad-place-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('squad-hold-1')).toHaveValue(3)
    expect(screen.getByTestId('squad-remove-1')).toBeInTheDocument()
  })

  it('changing the hold-turns input re-applies the placement with the new value', () => {
    const { onPlaceSquad } = renderMenu({
      hex: { col: 2, row: 5 },
      squadPlacements: { 1: { col: 2, row: 5, holdTurns: 0 } },
    })
    fireEvent.change(screen.getByTestId('squad-hold-1'), { target: { value: '5' } })
    expect(onPlaceSquad).toHaveBeenCalledWith(2, 5, 1, '1st Cohort', 5)
  })

  it('clicking Remove calls onRemoveSquad with the squad id', () => {
    const { onRemoveSquad } = renderMenu({
      hex: { col: 2, row: 5 },
      squadPlacements: { 1: { col: 2, row: 5, holdTurns: 0 } },
    })
    fireEvent.click(screen.getByTestId('squad-remove-1'))
    expect(onRemoveSquad).toHaveBeenCalledWith(1)
  })

  it('a squad placed elsewhere shows "Move here" and its current location', () => {
    renderMenu({
      hex: { col: 2, row: 5 }, // viewing a DIFFERENT hex than where the squad sits
      squadPlacements: { 1: { col: 9, row: 1, holdTurns: 0 } },
    })
    expect(screen.getByTestId('squad-place-1')).toHaveTextContent(/move here/i)
    expect(screen.getByText('at (9,1)')).toBeInTheDocument()
  })

  it('"Move here" re-applies the placement at the new hex, resetting hold to 0', () => {
    const { onPlaceSquad } = renderMenu({
      hex: { col: 2, row: 5 },
      squadPlacements: { 1: { col: 9, row: 1, holdTurns: 4 } },
    })
    fireEvent.click(screen.getByTestId('squad-place-1'))
    expect(onPlaceSquad).toHaveBeenCalledWith(2, 5, 1, '1st Cohort', 0)
  })
})
