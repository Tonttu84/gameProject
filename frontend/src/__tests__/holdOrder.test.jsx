/**
 * Hold-order tests for the placement UI.
 *
 * Each unit type in ReachMenu gets a hold-turns input.  When "Place" is
 * committed the current holdTurns value is forwarded as the 5th argument of
 * onPlace(col, row, type, count, holdTurns).  "Clear" resets hold to 0.
 *
 * The placement entry shape stored in HexGrid is:
 *   { type, col, row, count, holdTurns }
 */

import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReachMenu from '../components/ReachMenu'

const defaultUnits = [
  { type: 'Soldier', symbol: 'S', placementSize: 1 },
  { type: 'Mage',    symbol: 'M', placementSize: 2 },
]

const renderMenu = (props = {}) => {
  const onPlace = vi.fn()
  const onClose = vi.fn()
  return {
    onPlace,
    onClose,
    ...render(
      <ReachMenu
        hex={props.hex ?? { col: 1, row: 4 }}
        placements={props.placements ?? []}
        roster={props.roster ?? { Soldier: 10, Mage: 5 }}
        units={props.units ?? defaultUnits}
        hexTerrain={props.hexTerrain ?? 'Open'}
        hexCapacity={props.hexCapacity ?? 10}
        onPlace={props.onPlace ?? onPlace}
        onClose={props.onClose ?? onClose}
      />
    ),
  }
}

describe('Hold order: ReachMenu renders hold-turns inputs', () => {
  it('renders a hold-turns input for each unit type', () => {
    renderMenu()
    expect(screen.getByTestId('hold-turns-Soldier')).toBeInTheDocument()
    expect(screen.getByTestId('hold-turns-Mage')).toBeInTheDocument()
  })

  it('holdTurns defaults to 0 when no prior placement exists', () => {
    renderMenu()
    expect(screen.getByTestId('hold-turns-Soldier')).toHaveValue(0)
    expect(screen.getByTestId('hold-turns-Mage')).toHaveValue(0)
  })

  it('holdTurns is initialised from the existing placement entry', () => {
    renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 5 }],
    })
    expect(screen.getByTestId('hold-turns-Soldier')).toHaveValue(5)
    // Mage has no placement — should still default to 0
    expect(screen.getByTestId('hold-turns-Mage')).toHaveValue(0)
  })
})

describe('Hold order: Place commits holdTurns via onPlace', () => {
  it('Place passes holdTurns=0 when hold-turns input is untouched', () => {
    const { onPlace } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    // All counts are 0, holdTurns are 0
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0, 0)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 0, 0)
  })

  it('Place passes holdTurns from hold-turns input', () => {
    const { onPlace } = renderMenu({ roster: { Soldier: 10, Mage: 5 } })
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('hold-turns-Soldier'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 3, 4)
  })

  it('negative hold-turns input is clamped to 0', () => {
    const { onPlace } = renderMenu()
    fireEvent.change(screen.getByTestId('hold-turns-Soldier'), { target: { value: '-2' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0, 0)
  })
})

describe('Hold order: Clear resets holdTurns to 0', () => {
  it('Clear calls onPlace with count=0 and holdTurns=0 for every unit type', () => {
    const { onPlace, onClose } = renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 5 }],
    })
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0, 0)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 0, 0)
    expect(onClose).toHaveBeenCalled()
  })
})
