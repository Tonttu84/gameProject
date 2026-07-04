/**
 * Deployment-orders tests for the placement UI (ReachMenu).
 *
 * The count stepper and the per-placement ORDERS live in separate sections.
 * Orders only appear for units actually placed on the hex (count > 0) — an
 * unplaced roster type has no order to give.  Today the only order is
 * "hold turns"; the orders section is shaped so more order types can slot in.
 *
 * When "Place" is committed the current holdTurns value is forwarded as the
 * 5th argument of onPlace(col, row, type, count, holdTurns).  "Clear" resets
 * hold to 0.  The placement entry shape stored in HexGrid is:
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

describe('Deployment orders: the Orders section only lists placed units', () => {
  it('shows no order controls and a hint when nothing is placed', () => {
    renderMenu()
    expect(screen.queryByTestId('hold-turns-Soldier')).not.toBeInTheDocument()
    expect(screen.queryByTestId('hold-turns-Mage')).not.toBeInTheDocument()
    expect(screen.getByTestId('orders-empty')).toBeInTheDocument()
  })

  it('shows an order control for a unit once it is placed', () => {
    renderMenu()
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '2' } })
    expect(screen.getByTestId('hold-turns-Soldier')).toBeInTheDocument()
    // Mage still unplaced — no order control for it.
    expect(screen.queryByTestId('hold-turns-Mage')).not.toBeInTheDocument()
    expect(screen.queryByTestId('orders-empty')).not.toBeInTheDocument()
  })

  it('the hold control carries a visible label (not just a bare box)', () => {
    renderMenu({ placements: [{ type: 'Soldier', col: 1, row: 4, count: 2, holdTurns: 0 }] })
    expect(screen.getByTestId('hold-turns-Soldier')).toHaveAccessibleName(/hold/i)
  })

  it('a control shown for a placed unit initialises from its placement entry', () => {
    renderMenu({
      placements: [{ type: 'Soldier', col: 1, row: 4, count: 3, holdTurns: 5 }],
    })
    expect(screen.getByTestId('hold-turns-Soldier')).toHaveValue(5)
    // Mage has no placement — no control at all.
    expect(screen.queryByTestId('hold-turns-Mage')).not.toBeInTheDocument()
  })
})

describe('Deployment orders: Place commits holdTurns via onPlace', () => {
  it('Place passes holdTurns=0 for every unit type when no orders are touched', () => {
    const { onPlace } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    // All counts are 0, holdTurns are 0
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 0, 0)
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Mage', 0, 0)
  })

  it('Place passes the holdTurns set in the orders section', () => {
    const { onPlace } = renderMenu({ roster: { Soldier: 10, Mage: 5 } })
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('hold-turns-Soldier'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /place/i }))
    expect(onPlace).toHaveBeenCalledWith(1, 4, 'Soldier', 3, 4)
  })

  it('negative hold-turns input is clamped to 0', () => {
    const { onPlace } = renderMenu()
    fireEvent.change(screen.getByTestId('count-Soldier'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('hold-turns-Soldier'), { target: { value: '-2' } })
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
