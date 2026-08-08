/**
 * Frontend auth flow tests.
 *
 * The auth bar sits under the HUD: logged out it renders LoginForm (login /
 * register modes), logged in it shows the username and a logout button. The
 * session ({ token, username, name }) is persisted in localStorage under
 * 'loggedGameUser' and rehydrated on mount; api.setToken() is what actually
 * feeds the Bearer token to the protected campaign calls. All campaign state
 * lives server-side, so logged-out users only see the login prompt.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
  // The turn's phase is server state now: advancing returns the refreshed
  // view, exactly as the real route does (the campaign with the new phase).
  // Imported lazily inside the call so the hoisted vi.mock factory stays
  // self-contained.
  advanceCampaignPhase: vi.fn(async (_id, phase) => {
    const { default: store } = await import('../stores/useCampaignStore')
    return { ...store.getState().campaign, phase }
  }),
  getInfo: vi.fn(),
  getMap: vi.fn(),
  getTicks: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn(),
  getCampaigns: vi.fn(),
  createCampaign: vi.fn(),
  consultCampaignAugury: vi.fn(),
  rerollCampaignAugury: vi.fn(),
  setCampaignForage: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
}))

import { getInfo, getMap, login, register, setToken, getCampaigns } from '../services/api'
import App from '../App'
import LoginForm from '../components/LoginForm'
import { campaignFixture } from './fixtures/campaign'

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
  getCampaigns.mockResolvedValue([campaignFixture])
})

// Renders App with a stored session and an active campaign — lands on the
// War Council like a returning player.
const renderApp = async () => {
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  const view = render(<App />)
  await screen.findByText(/War Council/)
  return view
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
  it('logged out: shows the login prompt, no campaign UI', async () => {
    render(<App />)
    await screen.findByText(/The Campaign Awaits/)
    expect(screen.queryByText(/War Council/)).not.toBeInTheDocument()
    expect(getCampaigns).not.toHaveBeenCalled()
  })

  it('login stores the session, sets the token, and loads the campaign', async () => {
    login.mockResolvedValue(sessionUser)
    render(<App />)
    await screen.findByText(/The Campaign Awaits/)

    fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'tonttu' } })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'salainen' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    expect(await screen.findByTestId('auth-username')).toHaveTextContent('Logged in as tonttu')
    await screen.findByText(/War Council/)
    expect(setToken).toHaveBeenCalledWith('jwt-token')
    expect(JSON.parse(window.localStorage.getItem('loggedGameUser'))).toEqual(sessionUser)
  })

  it('rehydrates a stored session without calling login', async () => {
    await renderApp()

    expect(screen.getByTestId('auth-username')).toHaveTextContent('Logged in as tonttu')
    expect(setToken).toHaveBeenCalledWith('jwt-token')
    expect(login).not.toHaveBeenCalled()
  })

  it('logout clears the stored session and the token', async () => {
    await renderApp()

    fireEvent.click(screen.getByTestId('logout-button'))

    expect(screen.queryByTestId('auth-username')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('loggedGameUser')).toBeNull()
    expect(setToken).toHaveBeenLastCalledWith(null)
    expect(screen.getByTestId('login-submit')).toBeInTheDocument()
    expect(screen.getByText(/The Campaign Awaits/)).toBeInTheDocument()
  })
})
