/**
 * Bug-report affordance tests.
 *
 * A "Report a bug" button sits in the auth bar for logged-in players. It opens
 * a textarea modal that POSTs to the login-only /api/bug-reports route via
 * api.submitBugReport(message, screen); the server stamps the trusted context,
 * so the client only claims which screen it was on. Logged-out users never see
 * the button (the route would reject them anyway).
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../services/api', () => ({
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
  submitBugReport: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, submitBugReport } from '../services/api'
import App from '../App'
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

const renderLoggedIn = async () => {
  window.localStorage.setItem('loggedGameUser', JSON.stringify(sessionUser))
  const view = render(<App />)
  await screen.findByText(/War Council/)
  return view
}

describe('Bug report button', () => {
  it('is hidden when logged out', async () => {
    render(<App />)
    await screen.findByText(/The Campaign Awaits/)
    expect(screen.queryByTestId('bug-report-open')).not.toBeInTheDocument()
  })

  it('submits the message with the current screen and shows a thanks state', async () => {
    submitBugReport.mockResolvedValue({ id: 'r1', createdAt: '2026-07-04' })
    await renderLoggedIn()

    fireEvent.click(screen.getByTestId('bug-report-open'))
    fireEvent.change(screen.getByTestId('bug-report-text'), {
      target: { value: 'the forage meter is wrong' },
    })
    fireEvent.click(screen.getByTestId('bug-report-submit'))

    await waitFor(() =>
      // War Council screen → phase 'setup'.
      expect(submitBugReport).toHaveBeenCalledWith('the forage meter is wrong', 'setup'),
    )
    expect(await screen.findByText(/Thanks/)).toBeInTheDocument()
  })

  it('trims whitespace and disables submit for an empty message', async () => {
    await renderLoggedIn()
    fireEvent.click(screen.getByTestId('bug-report-open'))

    // Empty → submit disabled, nothing sent.
    expect(screen.getByTestId('bug-report-submit')).toBeDisabled()
    fireEvent.change(screen.getByTestId('bug-report-text'), { target: { value: '   ' } })
    expect(screen.getByTestId('bug-report-submit')).toBeDisabled()
    expect(submitBugReport).not.toHaveBeenCalled()
  })

  it('surfaces the server error (e.g. rate limit) and keeps the form open', async () => {
    submitBugReport.mockRejectedValue({
      response: { data: { error: 'too many bug reports — please try again later' } },
    })
    await renderLoggedIn()

    fireEvent.click(screen.getByTestId('bug-report-open'))
    fireEvent.change(screen.getByTestId('bug-report-text'), { target: { value: 'again' } })
    fireEvent.click(screen.getByTestId('bug-report-submit'))

    expect(await screen.findByTestId('bug-report-error')).toHaveTextContent(/too many bug reports/)
    // Still on the form, not the thanks state.
    expect(screen.getByTestId('bug-report-text')).toBeInTheDocument()
  })

  it('cancel closes the modal without sending', async () => {
    await renderLoggedIn()
    fireEvent.click(screen.getByTestId('bug-report-open'))
    fireEvent.click(screen.getByTestId('bug-report-cancel'))

    expect(screen.queryByTestId('bug-report-modal')).not.toBeInTheDocument()
    expect(screen.getByTestId('bug-report-open')).toBeInTheDocument()
    expect(submitBugReport).not.toHaveBeenCalled()
  })
})
