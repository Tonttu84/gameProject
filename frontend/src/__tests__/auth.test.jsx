/**
 * Frontend auth flow tests.
 *
 * The auth bar sits under the HUD: logged out it renders LoginForm (login /
 * register modes), logged in it shows the username and a logout button. The
 * session ({ token, username, name }) is persisted in localStorage under
 * 'loggedGameUser' and rehydrated on mount; api.setToken() is what actually
 * feeds the Bearer token to postBattle. The Fight button requires a login.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  getInfo: vi.fn(),
  getMap: vi.fn(),
  postBattle: vi.fn(),
  getTicks: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
}))

import { getInfo, getMap, login, register, setToken } from '../services/api'
import App from '../App'
import LoginForm from '../components/LoginForm'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

const sessionUser = { token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

const renderApp = async () => {
  render(<App />)
  await screen.findByText(/Morning Council/)
}

describe('LoginForm', () => {
  it('submits credentials and reports the user up on success', async () => {
    login.mockResolvedValue(sessionUser)
    const onLogin = vi.fn()
    render(<LoginForm onLogin={onLogin} />)

    fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'tonttu' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'salainen' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({ username: 'tonttu', password: 'salainen' }),
    )
    expect(register).not.toHaveBeenCalled()
    expect(onLogin).toHaveBeenCalledWith(sessionUser)
  })

  it('register mode registers first, then logs in with the same credentials', async () => {
    register.mockResolvedValue({ id: 'u1', username: 'tonttu' })
    login.mockResolvedValue(sessionUser)
    const onLogin = vi.fn()
    render(<LoginForm onLogin={onLogin} />)

    fireEvent.click(screen.getByTestId('login-toggle'))
    fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'tonttu' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'salainen' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(sessionUser))
    expect(register).toHaveBeenCalledWith({ username: 'tonttu', password: 'salainen' })
    expect(login).toHaveBeenCalledWith({ username: 'tonttu', password: 'salainen' })
  })

  it('shows the server error message on a failed login', async () => {
    login.mockRejectedValue({ response: { data: { error: 'invalid username or password' } } })
    render(<LoginForm onLogin={vi.fn()} />)

    fireEvent.click(screen.getByTestId('login-submit'))
    expect(await screen.findByText('invalid username or password')).toBeInTheDocument()
  })
})

describe('App auth state', () => {
  it('login stores the session and shows the username', async () => {
    login.mockResolvedValue(sessionUser)
    await renderApp()

    fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'tonttu' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'salainen' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    expect(await screen.findByTestId('auth-username')).toHaveTextContent('Logged in as tonttu')
    expect(setToken).toHaveBeenCalledWith('jwt-token')
    expect(JSON.parse(window.localStorage.getItem('loggedGameUser'))).toEqual(sessionUser)
  })

  it('rehydrates a stored session without calling login', async () => {
    window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
    await renderApp()

    expect(screen.getByTestId('auth-username')).toHaveTextContent('Logged in as tonttu')
    expect(setToken).toHaveBeenCalledWith('jwt-token')
    expect(login).not.toHaveBeenCalled()
  })

  it('Fight is gated on login: disabled with a hint logged out, no hint logged in', async () => {
    const { container } = render(<App />)
    await screen.findByText(/Morning Council/)

    // setup → augury → placement
    fireEvent.click(screen.getByText('Consult the Augur'))
    fireEvent.click(container.querySelector('.event-card'))

    const fight = screen.getByText('Fight!')
    expect(fight).toBeDisabled()
    expect(screen.getByText('Log in to fight')).toBeInTheDocument()

    // Log in from the placement screen — the hint disappears (the button
    // stays disabled only because nothing is placed yet).
    login.mockResolvedValue(sessionUser)
    fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'tonttu' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'salainen' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    await screen.findByTestId('auth-username')
    expect(screen.queryByText('Log in to fight')).not.toBeInTheDocument()
  })

  it('logout clears the stored session and the token', async () => {
    window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
    await renderApp()

    fireEvent.click(screen.getByTestId('logout-button'))

    expect(screen.queryByTestId('auth-username')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('loggedGameUser')).toBeNull()
    expect(setToken).toHaveBeenLastCalledWith(null)
    expect(screen.getByTestId('login-submit')).toBeInTheDocument()
  })
})
