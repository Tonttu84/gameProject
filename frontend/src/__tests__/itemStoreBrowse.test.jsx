/**
 * The storage page (docs/CAMPAIGN_PLAN.md, SLICE 17).
 *
 * The store screen already existed as SLOT MODE — opened from a banner slot,
 * filtered to what the slot takes. 17 gives it its second mode and its own
 * door: `The Stores` in the HUD opens the same screen UNFILTERED and READ-ONLY,
 * so a player can find out what they hold without hunting for a slot that
 * happens to accept it. Slot mode's own tests are in banners.test.jsx; these
 * cover the browse half and the two rules that bind both.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../services/api', () => ({
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
  setCampaignEffort: vi.fn(),
  postCampaignBattle: vi.fn(),
  endCampaignDay: vi.fn(),
  postCampaignChoice: vi.fn(),
  bindSquadBanner: vi.fn(),
}))

import { getInfo, getMap, getCampaigns, bindSquadBanner } from '../services/api'
import App from '../App'
import useUiStore from '../stores/useUiStore'
import { campaignFixture } from './fixtures/campaign'

const info = {
  grid: { width: 16, height: 30, hexCapacity: 640 },
  playerZone: { rowMin: 0, rowMax: 7 },
  enemyZone: { rowMin: 22, rowMax: 29 },
  terrain: [{ name: 'Open', color: '#5a6441' }],
  units: [],
}

// Rows as the SERVER sends them (17-5): already phrased. The client composes
// none of these sentences, which is why the fixtures carry them — a test that
// invented its own wording here would be testing nothing.
const BANNER = {
  id: 'banner_unbroken_line',
  kind: 'banner',
  name: 'The Unbroken Line',
  blurb: 'Karrowgate\'s own standard, carried off the wall.',
  target: 'squad',
  permanent: true,
  effect: 'The squad does not break: it holds where another would rout, whatever the odds.',
  where: 'Flown by a squad, in its banner slot — a charter must be Seasoned before the slot opens.',
  binding: 'Once it is given, it stays: it cannot be taken back, and nothing else will ever carry it.',
}

// A second kind, which no banner slot would accept. Browse shows it anyway —
// that is the difference between the two modes.
const HELM = {
  id: 'helm_of_ash',
  kind: 'helm',
  name: 'Helm of Ash',
  blurb: 'A grim thing.',
  target: 'character',
  permanent: false,
  effect: 'It carries no power of its own — not yet.',
  where: 'Carried by a character.',
  binding: 'It can be taken back later and given to something else.',
}

const withItems = (items, over = {}) => ({ ...campaignFixture, items, ...over })

const openStores = async (campaign) => {
  getCampaigns.mockResolvedValue([campaign])
  render(<App />)
  await screen.findByText(/War Council/)
  fireEvent.click(screen.getByTestId('hud-stores'))
  return screen.findByTestId('item-store')
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem(
    'loggedGameUser',
    JSON.stringify({ token: 'jwt-token', username: 'tonttu', name: 'Tonttu T' }),
  )
  getInfo.mockResolvedValue(info)
  getMap.mockResolvedValue({ hexes: [] })
})

describe('the door (17-7)', () => {
  it('is in the HUD on an empty store, unchanged and uncounted', async () => {
    getCampaigns.mockResolvedValue([withItems([])])
    render(<App />)
    await screen.findByText(/War Council/)
    // The feature a player could otherwise finish a campaign without finding.
    const door = screen.getByTestId('hud-stores')
    expect(door).toHaveTextContent('The Stores')
    // No badge, no number: it reads the same whether the store holds nothing…
    expect(door.textContent.trim()).toBe('The Stores')
  })

  it('reads exactly the same with something in it', async () => {
    getCampaigns.mockResolvedValue([withItems([BANNER, HELM])])
    render(<App />)
    await screen.findByText(/War Council/)
    expect(screen.getByTestId('hud-stores').textContent.trim()).toBe('The Stores')
  })
})

describe('browsing (17-4)', () => {
  it('takes over the screen and shows everything held, of every kind', async () => {
    await openStores(withItems([BANNER, HELM]))
    expect(screen.getByTestId(`store-item-${BANNER.id}`)).toBeInTheDocument()
    // Unfiltered — this is the whole difference from slot mode, where a helm
    // could never appear on a banner slot's list.
    expect(screen.getByTestId(`store-item-${HELM.id}`)).toBeInTheDocument()
    // A real takeover: the phase underneath is gone.
    expect(screen.queryByText(/Foraging/)).toBeNull()
  })

  it('says so plainly when the stores are empty', async () => {
    await openStores(withItems([]))
    expect(screen.getByTestId('item-store-empty')).toHaveTextContent(/stores are empty/i)
  })

  it('shows only what is on nothing — a bound banner is not here (17-2)', async () => {
    // The bound relic lives on its charter's page; the store is, strictly, the
    // home of what is on nothing. The server already leaves it out of `items`,
    // and this is the client half of the same rule.
    const bound = withItems([])
    bound.squads = bound.squads.map((s) =>
      s.id === 1 ? { ...s, banner: 'item', bannerItem: BANNER } : s,
    )
    await openStores(bound)
    expect(screen.queryByTestId(`store-item-${BANNER.id}`)).toBeNull()
    expect(screen.getByTestId('item-store-empty')).toBeInTheDocument()
  })

  it('opens a row into the detail the server phrased, and closes it again', async () => {
    await openStores(withItems([BANNER]))
    expect(screen.queryByTestId(`store-detail-${BANNER.id}`)).toBeNull()

    fireEvent.click(screen.getByTestId(`store-open-${BANNER.id}`))
    expect(screen.getByTestId(`store-effect-${BANNER.id}`)).toHaveTextContent(BANNER.effect)
    expect(screen.getByTestId(`store-where-${BANNER.id}`)).toHaveTextContent(BANNER.where)
    expect(screen.getByTestId(`store-binding-${BANNER.id}`)).toHaveTextContent(BANNER.binding)

    // Inline expansion, not a sub-page: the same click closes it (13-8 — a page
    // swap is UI state, and there is no router to push onto).
    fireEvent.click(screen.getByTestId(`store-open-${BANNER.id}`))
    expect(screen.queryByTestId(`store-detail-${BANNER.id}`)).toBeNull()
  })

  it('is READ-ONLY: nothing on the page assigns anything (17-3)', async () => {
    // Assignment happens at the target's screen, always. The store never grows
    // a target picker, so there is exactly one code path per mutation.
    await openStores(withItems([BANNER, HELM]))
    fireEvent.click(screen.getByTestId(`store-open-${BANNER.id}`))
    expect(screen.queryByTestId(`store-choose-${BANNER.id}`)).toBeNull()
    expect(screen.queryByTestId(`store-confirm-${BANNER.id}`)).toBeNull()
    expect(bindSquadBanner).not.toHaveBeenCalled()
  })

  it('Back returns to the phase underneath, having posted nothing', async () => {
    await openStores(withItems([BANNER]))
    fireEvent.click(screen.getByTestId('item-store-back'))
    await screen.findByText(/War Council/)
    expect(bindSquadBanner).not.toHaveBeenCalled()
  })
})

describe('at a pending fate, the two modes split (17-6)', () => {
  const pendingChoice = {
    slot: 0,
    title: 'Refugees at the Palisade',
    description: 'A column of burned-out villagers begs shelter at the camp gates.',
    options: [
      { id: 'turn_away', label: 'Turn them away', effectText: ['Nothing changes.'] },
      { id: 'take_in', label: 'Take them in', effectText: ['More mouths.'] },
    ],
  }
  const owed = (items) => withItems(items, { day: 2, pendingChoices: [pendingChoice] })

  it('browse renders ABOVE the choice cards, and its door stays visible', async () => {
    // Read-only, so there is nothing here the server could refuse — and the
    // standing rule is that a read-only screen stays open.
    getCampaigns.mockResolvedValue([owed([BANNER])])
    render(<App />)
    await screen.findByTestId('reveal-beat-choice-0')

    const door = screen.getByTestId('hud-stores')
    // The Army's door is gone while a fate is owed; this one is not.
    expect(screen.queryByTestId('hud-army')).toBeNull()

    fireEvent.click(door)
    expect(await screen.findByTestId('item-store')).toBeInTheDocument()
    expect(screen.getByTestId(`store-item-${BANNER.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId('reveal-beat-choice-0')).toBeNull()

    // …and Back drops the player onto the decision they still owe.
    fireEvent.click(screen.getByTestId('item-store-back'))
    expect(await screen.findByTestId('reveal-beat-choice-0')).toBeInTheDocument()
  })

  it('slot mode stays BELOW them: an owed fate hides it', async () => {
    // POST /squads/:id/banner carries rejectIfChoicePending, so a Give button
    // rendered over the choice cards could only answer 409. This is the claim
    // the old comment in App.jsx made and never tested.
    getCampaigns.mockResolvedValue([owed([BANNER])])
    render(<App />)
    await screen.findByTestId('reveal-beat-choice-0')

    // No door leads here while a fate is owed — which is the point — so the
    // request is opened directly, the way the charter page's slot would.
    act(() => {
      useUiStore.getState().openItemStore({ accepts: 'banner', squadId: 1, squadName: '1st Cohort' })
    })
    expect(await screen.findByTestId('reveal-beat-choice-0')).toBeInTheDocument()
    expect(screen.queryByTestId('item-store')).toBeNull()
  })
})
