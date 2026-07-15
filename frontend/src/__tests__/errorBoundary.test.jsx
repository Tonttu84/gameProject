/**
 * ErrorBoundary: a render crash anywhere below must show the readable
 * fallback (message + reload) instead of a blank page. Regression net for
 * the zombie-server incident, where a foreign-shaped campaign crashed App
 * with only a console stack to show for it.
 */
import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'

const Bomb = () => {
  throw new Error('kaboom from render')
}

describe('ErrorBoundary', () => {
  // React and the boundary both log the crash; keep test output clean.
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  test('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('all fine')).toBeInTheDocument()
    expect(screen.queryByText('Something broke')).toBeNull()
  })

  test('a crashing child shows the fallback with the error message and a reload button', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    expect(screen.getByText('kaboom from render')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    // The crash never escapes to the page: the children are gone, not blank.
    expect(screen.queryByText('all fine')).toBeNull()
  })
})
