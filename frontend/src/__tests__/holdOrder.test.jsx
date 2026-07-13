/**
 * Deployment-orders tests for the placement UI (ReachMenu).
 *
 * The count stepper and the ORDERS section live in separate sections. The
 * order control only appears once something is actually placed on the hex
 * (an empty square has nothing to order) — and it is per-SQUARE, not per
 * unit type: every loose unit placed on this hex shares one hold value
 * (only a squad carries its own separate order). Today the only order is
 * "hold turns"; the orders section is shaped so more order types can slot in.
 *
 * When "Place" is committed the current holdTurns value is forwarded as the
 * 5th argument of onPlace(col, row, type, count, holdTurns) for every placed
 * type. "Clear" resets hold to 0. The placement entry shape stored in
 * HexGrid is: { type, col, row, count, holdTurns }.
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

describe('Deployment orders: the Orders section only appears once something is placed', () => {
  it('shows no order control and a hint when nothing is placed', () => {
    renderMenu()
    expect(screen.queryByTestId('hold-turns')).not.toBeInTheDocument()
    expect(screen.getByTestId('orders-empty')).toBeInTheDocument()
  })

  it('shows the order control once any unit is placed', () => {
    renderMenu()
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '2' } })
    expect(screen.getByTestId('hold-turns')).toBeInTheDocument()
    expect(screen.queryByTestId('orders-empty')).not.toBeInTheDocument()
  })

  it('the hold control carries a visible label (not just a bare box)', () => {
    renderMenu({ placements: [{ type: 'Soldier', col: 1, row: 4, count: 2, holdTurns: 0 }] })
    expect(screen.getByTestId('hold-turns')).toHaveAccessibleName(/hold/i)
  })

  it('the control initialises from the square\'s existing hold order', () => {
    renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 5 }],
    })
    expect(screen.getByTestId('hold-turns')).toHaveValue(5)
  })
})

describe('Deployment orders: Place commits one holdTurns value for every placed type', () => {
  it('Place passes holdTurns=0 for every unit type when no orders are touched', () => {
    const { onPlace } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    // All counts are 0, holdTurns are 0
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0, 0)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 0, 0)
  })

  it('Place applies the single hold order to every placed type', () => {
    const { onPlace } = renderMenu({ roster: { Soldier: 10, Mage: 5 } })
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('count-Mage'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('hold-turns'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 3, 4)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 1, 4)
  })

  it('negative hold-turns input is clamped to 0', () => {
    const { onPlace } = renderMenu()
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('hold-turns'), { target: { value: '-2' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 3, 0)
  })
})

describe('Deployment orders: Clear resets holdTurns to 0', () => {
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
