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
  describeItem,
  ITEM_ABILITY_TEXT,
  ITEM_STAT_TEXT,
  inertDenials,
} from '../services/items.js'
import {
  ITEM_CATALOG,
  SQUAD_RANKS,
  SQUAD_BANNER_RANK,
  GARRISON_BANNER_RESOLVE,
} from '../utils/campaignConfig.js'
import { applyEffect, describeEffect, eventEligible, EVENT_POOL } from '../services/events.js'
import { applyRaidReward } from '../services/raid.js'

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
  test('binding takes ONE copy out of the store, not every match', () => {
    // The bug 9-6 turned up. `filter(id => id !== itemId)` was correct while
    // banners were the only item and every item was unique; with stacking kit
    // it would destroy the other copies on the first bind.
    const campaign = campaignWith({
      items: ['gear_iron_helm', BANNER.id, 'gear_iron_helm'],
      squads: [seasoned()],
    })
    const bound = bindItemToSquad(campaign, campaign.squads[0], BANNER.id)
    expect(bound.error).toBeUndefined()
    expect(campaign.items).toEqual(['gear_iron_helm', 'gear_iron_helm'])
  })

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

describe('acquisition (6-13) — channel-agnostic', () => {
  test('an event effect puts a won item in the store', () => {
    const campaign = campaignWith()
    const log = applyEffect(campaign, { type: 'item', itemId: BANNER.id })
    expect(campaign.items).toEqual([BANNER.id])
    expect(log.join(' ')).toContain(BANNER.name)
  })

  test('a raid card carrying reward.item grants it, whatever the card is typed as', () => {
    // The generic tail, not a raid TYPE: banners are a kind of loot, not a kind
    // of raid, and the second item kind must not need its own raid type either.
    const campaign = campaignWith({
      resources: { food: 0, materials: 0, gold: 0, horses: 0 },
    })
    const entries = applyRaidReward(
      campaign,
      { type: 'seize_horses', reward: { horses: 0, item: BANNER.id } },
      {},
    )
    expect(campaign.items).toEqual([BANNER.id])
    expect(entries.join(' ')).toContain(BANNER.name)
  })

  test('a second grant of a UNIQUE item is refused through EITHER channel', () => {
    const campaign = campaignWith({ items: [BANNER.id] })
    applyEffect(campaign, { type: 'item', itemId: BANNER.id })
    expect(campaign.items).toEqual([BANNER.id])
  })

  // ── Uniqueness is a property of the ROW (9-6) ─────────────────────────────
  test('ordinary kit STACKS — a second helm is a second helm', () => {
    // Before 9a every item was unique and the refusal was unconditional. It is
    // now gated on the row, because `campaign.items` is a [String] that may
    // simply repeat and two copies of one row ARE identical.
    const campaign = campaignWith()
    expect(grantItem(campaign, 'gear_iron_helm')).toBe(true)
    expect(grantItem(campaign, 'gear_iron_helm')).toBe(true)
    expect(campaign.items).toEqual(['gear_iron_helm', 'gear_iron_helm'])
  })

  test('a unique relic is refused a second time', () => {
    const campaign = campaignWith()
    expect(grantItem(campaign, 'relic_the_long_watch')).toBe(true)
    expect(grantItem(campaign, 'relic_the_long_watch')).toBe(false)
    expect(campaign.items).toEqual(['relic_the_long_watch'])
  })

  test('a relic already WORN counts as held', () => {
    // heldItemIds has to see the store, squads AND characters, or a relic on a
    // champion could be won again while he wears it.
    const campaign = campaignWith({
      characters: [{ id: 1, items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }] }],
    })
    expect(holdsItem(campaign, 'relic_the_long_watch')).toBe(true)
    expect(grantItem(campaign, 'relic_the_long_watch')).toBe(false)
  })

  test('a relic on a DEAD character still counts as held', () => {
    // Their gear is preserved on the record (5-9) so a recovery has something
    // to find — which means it is still held. A relic on a body in a ditch must
    // not also drop from the next enemy captain.
    const campaign = campaignWith({
      characters: [{
        id: 1, alive: false,
        items: [{ slot: 'misc', index: 0, itemId: 'relic_the_long_watch' }],
      }],
    })
    expect(holdsItem(campaign, 'relic_the_long_watch')).toBe(true)
  })

  test('a fate offering ordinary kit stays drawable when one is already held', () => {
    const fate = { id: 'x', effect: { type: 'item', itemId: 'gear_iron_helm' } }
    expect(eventEligible(fate, campaignWith({ items: ['gear_iron_helm'] }))).toBe(true)
  })

  test('a fate granting an item already held is never DRAWN', () => {
    // The other half of uniqueness. The defensive refusal above is what catches
    // a SCHEDULED event, which bypasses the draw entirely; this is what stops
    // the offer being made at all.
    const fate = { id: 'x', effect: { type: 'item', itemId: BANNER.id } }
    expect(eventEligible(fate, campaignWith())).toBe(true)
    expect(eventEligible(fate, campaignWith({ items: [BANNER.id] }))).toBe(false)
    expect(
      eventEligible(fate, campaignWith({ squads: [seasoned({ banner: BANNER.id })] })),
    ).toBe(false)
  })

  test('the card SAYS what it is offering — no card shows flavour alone', () => {
    const lines = describeEffect({ type: 'item', itemId: BANNER.id })
    expect(lines.join(' ')).toContain(BANNER.name)
  })

  test('an item whose row has left the catalog still renders and never throws', () => {
    expect(describeEffect({ type: 'item', itemId: 'banner_retired' })).toEqual(['A magic item'])
    const campaign = campaignWith()
    expect(() => applyEffect(campaign, { type: 'item', itemId: 'banner_retired' })).not.toThrow()
    expect(campaign.items).toEqual([])
  })
})

describe('the garrison standard (6-13)', () => {
  const fate = EVENT_POOL.find((e) => e.id === 'garrison_standard')

  test('exists, and hands over the banner', () => {
    expect(fate).toBeDefined()
    expect(fate.effect).toEqual({ type: 'item', itemId: BANNER.id })
  })

  test('is gated a band above the ordinary garrison gifts', () => {
    expect(fate.requires.minResolve).toBe(GARRISON_BANNER_RESOLVE)
    const ordinary = EVENT_POOL.filter(
      (e) => e.id !== fate.id && e.requires?.minResolve != null,
    ).map((e) => e.requires.minResolve)
    expect(Math.max(...ordinary)).toBeLessThan(GARRISON_BANNER_RESOLVE)
  })

  test('a campaign at the starting resolve cannot draw it', () => {
    expect(eventEligible(fate, { garrison: { resolve: GARRISON_BANNER_RESOLVE - 1 } })).toBe(false)
    expect(eventEligible(fate, { garrison: { resolve: GARRISON_BANNER_RESOLVE } })).toBe(true)
  })
})

// ─── Slice 17: the server phrases every item (17-5) ──────────────────────────
describe('describeItem', () => {
  test('every catalog row is phrased on all three axes', () => {
    // The sweep is the point: a new item that reaches the store without
    // sentences would render as a blank card, and the store page is the only
    // place a player learns what they hold.
    for (const row of ITEM_CATALOG) {
      const { effect, where, binding } = describeItem(row)
      for (const line of [effect, where, binding]) {
        expect(typeof line).toBe('string')
        expect(line.length).toBeGreaterThan(0)
      }
    }
  })

  test('every ability a catalog row grants has a player-facing line', () => {
    // The escape hatch describeItem has (drop what it cannot phrase) is only
    // safe because this fails first. Without it a new ability would silently
    // vanish from the store and the item would read as doing nothing.
    //
    // Phrased PER TARGET (9a): the same ability reads differently on a standard
    // and on a horn, so a row must have the line for the thing IT is worn by.
    for (const row of ITEM_CATALOG) {
      const target = row.target === 'squad' ? 'squad' : 'character'
      for (const ability of [...(row.abilities ?? []), ...(row.denies ?? [])]) {
        expect(ITEM_ABILITY_TEXT[ability]?.[target]).toBeTruthy()
      }
    }
  })

  test('every stat a catalog row moves has a player-facing word', () => {
    // Same contract as the ability sweep, and the same reason: describeItem
    // drops what it cannot phrase, so without this a new stat would leave the
    // card silently understating what the item does.
    for (const row of ITEM_CATALOG) {
      for (const stat of Object.keys(row.mods ?? {})) {
        expect(ITEM_STAT_TEXT[stat]).toBeTruthy()
      }
    }
  })

  test('no row denies an ability that only arrives by implication (9-4)', () => {
    // The AUTHORING rule. Such a row is not dangerous — the engine subtracts
    // denials before running the implication closure, so it is merely inert —
    // but inert is not what an author meant, and this is how they find out.
    for (const row of ITEM_CATALOG) {
      expect(inertDenials(row)).toEqual([])
    }
  })

  test('every gear row names a slot, and every slotted row is gear', () => {
    // The slot is what the anatomy check matches on (5-6). A gear row without
    // one has nowhere to go and would be unequippable.
    for (const row of ITEM_CATALOG) {
      if (row.target === 'character') expect(typeof row.slot).toBe('string')
      if (row.slot) expect(row.target).toBe('character')
    }
  })

  test('every row declares uniqueness and lootability', () => {
    // Both are ROW flags rather than kind tests (9-6, 9-12), so the loot code
    // and the store both ask the item instead of inferring from what it is.
    for (const row of ITEM_CATALOG) {
      expect(typeof (row.unique ?? false)).toBe('boolean')
      expect(typeof (row.lootable ?? true)).toBe('boolean')
    }
  })

  test('banners are unique and never lootable, in both directions', () => {
    for (const row of ITEM_CATALOG.filter((r) => r.kind === 'banner')) {
      expect(row.unique).toBe(true)
      expect(row.lootable).toBe(false)
    }
  })

  test('never leaks an engine word to the client', () => {
    for (const row of ITEM_CATALOG) {
      for (const ability of row.abilities ?? []) {
        expect(describeItem(row).effect).not.toContain(ability)
      }
    }
  })

  test('names the rung a banner needs, from the same constant that gates it', () => {
    expect(describeItem(BANNER).where).toContain(SQUAD_BANNER_RANK)
  })

  // ── Gear (slice 9a) ──────────────────────────────────────────────────────
  test('a stat row states its numbers, signed', () => {
    const helm = findItem('gear_iron_helm')
    expect(describeItem(helm).effect).toContain('+1 defence')
  })

  test('a row with a cost states both halves', () => {
    // The hauberk pays for its armour in speed, and the card must say so —
    // otherwise the player finds out by losing a race.
    const { effect } = describeItem(findItem('gear_mail_hauberk'))
    expect(effect).toContain('+1 armour')
    expect(effect).toContain('\u22121 speed')
  })

  test('a row carrying BOTH stats and an ability says both (9-2)', () => {
    const { effect } = describeItem(findItem('relic_the_long_watch'))
    expect(effect).toContain('defence')
    expect(effect).toMatch(/does not break/)
  })

  test('the same ability reads differently on a banner and on a person', () => {
    // The reason ITEM_ABILITY_TEXT is keyed per target: "the squad does not
    // break" printed on a horn would be a lie the player cannot check.
    expect(describeItem(BANNER).effect).toMatch(/squad/i)
    expect(describeItem(findItem('relic_the_long_watch')).effect).toMatch(/bearer/i)
  })

  test('gear names the slot it needs', () => {
    expect(describeItem(findItem('gear_iron_helm')).where).toMatch(/head slot/)
    expect(describeItem(findItem('gear_mail_hauberk')).where).toMatch(/body slot/)
  })

  test('a stat the phrasing does not know is dropped, not printed raw', () => {
    const { effect } = describeItem({
      target: 'character', slot: 'misc', mods: { charisma: 3 },
    })
    expect(effect).not.toContain('charisma')
    expect(effect).toMatch(/no power of its own/)
  })

  test('a zero delta is not a sentence', () => {
    const { effect } = describeItem({ target: 'character', slot: 'misc', mods: { attack: 0 } })
    expect(effect).toMatch(/no power of its own/)
  })

  test('states permanence both ways', () => {
    expect(describeItem({ ...BANNER, permanent: true }).binding).toMatch(/cannot be taken back/i)
    expect(describeItem({ ...BANNER, permanent: false }).binding).toMatch(/taken back later/i)
  })

  test('an item with no abilities says so, rather than nothing', () => {
    expect(describeItem({ ...BANNER, abilities: [] }).effect).toMatch(/no power of its own/i)
  })

  test('an unphrased ability is dropped, not printed raw', () => {
    const effect = describeItem({ ...BANNER, abilities: ['tremendous_wibble'] }).effect
    expect(effect).not.toContain('tremendous_wibble')
    expect(effect).toMatch(/no power of its own/i)
  })
})
