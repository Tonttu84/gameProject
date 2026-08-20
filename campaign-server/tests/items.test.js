import { describe, expect, test } from 'vitest'
import {
  findItem,
  heldItemIds,
  holdsItem,
  storedItems,
  storedItemsOfKind,
  grantItem,
  hasBanner,
  bannerTier,
  squadBanner,
  squadAbilities,
  bindItemToSquad,
} from '../services/items.js'
import { ITEM_CATALOG, SQUAD_RANKS, SQUAD_BANNER_RANK } from '../utils/campaignConfig.js'

// Slice 6's item store and banner tier (docs/CAMPAIGN_PLAN.md 6-8..6-14).

const prestigeFor = (label) => SQUAD_RANKS.find((r) => r.label === label).min
const BANNER = ITEM_CATALOG.find((row) => row.kind === 'banner')

const squad = (over = {}) => ({ id: 1, name: 'The Household', prestige: 0, ...over })
const campaignWith = (over = {}) => ({ items: [], squads: [squad()], ...over })
const seasoned = (over = {}) => squad({ prestige: prestigeFor(SQUAD_BANNER_RANK), ...over })

describe('the item catalog', () => {
  test('every row declares where it goes and whether that is permanent', () => {
    // 17's flexibility rule, as a test: two kinds already differ on BOTH axes,
    // so a path inferring either from the kind is known wrong before it is
    // written. A row that forgets to say is the bug this catches.
    for (const row of ITEM_CATALOG) {
      expect(['squad', 'character']).toContain(row.target)
      expect(typeof row.permanent).toBe('boolean')
      expect(typeof row.kind).toBe('string')
    }
  })

  test('a banner grants abilities, never flat stats', () => {
    // The user ruled banners out of the stat business (2026-08-20): they hand
    // an ability to the squad, which is why the ability system exists at all.
    for (const row of ITEM_CATALOG.filter((r) => r.kind === 'banner')) {
      expect(Array.isArray(row.abilities)).toBe(true)
      expect(row.abilities.length).toBeGreaterThan(0)
      expect(row).not.toHaveProperty('effects')
      expect(row).not.toHaveProperty('stat')
    }
  })

  test('an unknown id resolves to null rather than throwing', () => {
    expect(findItem('banner_of_nothing')).toBeNull()
  })
})

describe('the store', () => {
  test('a won item lands in the store', () => {
    const campaign = campaignWith()
    expect(grantItem(campaign, BANNER.id)).toBe(true)
    expect(campaign.items).toEqual([BANNER.id])
    expect(storedItems(campaign).map((r) => r.id)).toEqual([BANNER.id])
  })

  test('an item already held is refused — uniqueness belongs to the ITEM', () => {
    const campaign = campaignWith()
    grantItem(campaign, BANNER.id)
    expect(grantItem(campaign, BANNER.id)).toBe(false)
    expect(campaign.items).toEqual([BANNER.id])
  })

  test('an item already BOUND is still held, so it cannot be won again', () => {
    // The trap: a bound banner is out of the store, so a store-only check would
    // cheerfully hand out a second copy of a unique relic.
    const campaign = campaignWith({ squads: [seasoned({ banner: BANNER.id })] })
    expect(holdsItem(campaign, BANNER.id)).toBe(true)
    expect(heldItemIds(campaign)).toContain(BANNER.id)
    expect(grantItem(campaign, BANNER.id)).toBe(false)
  })

  test('an unknown id is never granted', () => {
    const campaign = campaignWith()
    expect(grantItem(campaign, 'banner_of_nothing')).toBe(false)
    expect(campaign.items).toEqual([])
  })

  test('the store filters by the kind a slot accepts', () => {
    // 6-14: the SLOT declares what it accepts and the store filters to that,
    // which is what lets a character's head slot reuse this later.
    const campaign = campaignWith({ items: [BANNER.id] })
    expect(storedItemsOfKind(campaign, 'banner').map((r) => r.id)).toEqual([BANNER.id])
    expect(storedItemsOfKind(campaign, 'helm')).toEqual([])
  })

  test('an id whose row has left the catalog degrades to nothing', () => {
    const campaign = campaignWith({ items: ['banner_retired', BANNER.id] })
    expect(storedItems(campaign).map((r) => r.id)).toEqual([BANNER.id])
  })

  test('a campaign written before the field existed reads as empty, not broken', () => {
    expect(storedItems({})).toEqual([])
    expect(heldItemIds({})).toEqual([])
    expect(holdsItem({}, BANNER.id)).toBe(false)
  })
})

describe('the banner tier', () => {
  test('below the banner rung a squad carries the plain banner', () => {
    expect(hasBanner(squad({ prestige: prestigeFor('Blooded') }))).toBe(false)
    expect(bannerTier(squad({ prestige: prestigeFor('Blooded') }))).toBe('plain')
  })

  test('the banner rung grants the basic banner, and every rank above keeps it', () => {
    expect(hasBanner(seasoned())).toBe(true)
    expect(bannerTier(seasoned())).toBe('basic')
    expect(bannerTier(squad({ prestige: prestigeFor('Renowned') }))).toBe('basic')
    expect(bannerTier(squad({ prestige: prestigeFor('Legendary') }))).toBe('basic')
  })

  test('a bound relic REPLACES the basic banner rather than stacking', () => {
    expect(bannerTier(seasoned({ banner: BANNER.id }))).toBe('item')
  })

  test('a charter with no prestige field at all reads as plain', () => {
    expect(hasBanner({})).toBe(false)
    expect(bannerTier({})).toBe('plain')
  })

  test('the tier is DERIVED — nothing stores it', () => {
    // 6-8's whole point: retune the ladder and the tier follows, because no
    // document froze it at the moment of crossing.
    const s = seasoned()
    expect(s).not.toHaveProperty('bannerTier')
    expect(bannerTier(s)).toBe('basic')
  })
})

describe('the abilities a banner grants', () => {
  test('only the item tier grants anything', () => {
    // Plain is inert because spell cost does not exist; basic's bonus is
    // DEFERRED on purpose (decision 16). Neither is missing — do not invent one.
    expect(squadAbilities(squad())).toEqual([])
    expect(squadAbilities(seasoned())).toEqual([])
  })

  test('a bound banner hands over its ability names', () => {
    expect(squadAbilities(seasoned({ banner: BANNER.id }))).toEqual(BANNER.abilities)
    expect(squadBanner(seasoned({ banner: BANNER.id })).id).toBe(BANNER.id)
  })

  test('a banner whose row has left the catalog grants nothing rather than throwing', () => {
    expect(squadAbilities(seasoned({ banner: 'banner_retired' }))).toEqual([])
    expect(squadBanner(seasoned({ banner: 'banner_retired' }))).toBeNull()
  })
})

describe('binding', () => {
  test('binding moves the item out of the store, for good', () => {
    const target = seasoned()
    const campaign = campaignWith({ items: [BANNER.id], squads: [target] })
    const result = bindItemToSquad(campaign, target, BANNER.id)
    expect(result.error).toBeUndefined()
    expect(target.banner).toBe(BANNER.id)
    expect(campaign.items).toEqual([])
    // Still held, just not in the store — that is the invariant the whole
    // holder-side design rests on.
    expect(holdsItem(campaign, BANNER.id)).toBe(true)
  })

  test('a squad below the banner rung is refused — the basic banner opens the slot', () => {
    const target = squad({ prestige: prestigeFor('Blooded') })
    const campaign = campaignWith({ items: [BANNER.id], squads: [target] })
    expect(bindItemToSquad(campaign, target, BANNER.id).error).toMatch(/Seasoned/)
    expect(target.banner).toBeUndefined()
    expect(campaign.items).toEqual([BANNER.id])
  })

  test('a squad that already carries a banner is refused — bound is bound', () => {
    const target = seasoned({ banner: BANNER.id })
    const campaign = campaignWith({ items: [BANNER.id], squads: [target] })
    expect(bindItemToSquad(campaign, target, BANNER.id).error).toMatch(/already carries/)
  })

  test('an item that is not in the store cannot be bound', () => {
    const target = seasoned()
    const campaign = campaignWith({ items: [], squads: [target] })
    expect(bindItemToSquad(campaign, target, BANNER.id).error).toMatch(/not in the store/)
    expect(target.banner).toBeUndefined()
  })

  test('an unknown item is refused', () => {
    const target = seasoned()
    const campaign = campaignWith({ items: [], squads: [target] })
    expect(bindItemToSquad(campaign, target, 'banner_of_nothing').error).toMatch(/no such item/)
  })
})
