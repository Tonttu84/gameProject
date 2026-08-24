import { ITEM_CATALOG, SQUAD_RANKS, SQUAD_BANNER_RANK } from '../utils/campaignConfig.js'

// Magic items and the banner tier — docs/CAMPAIGN_PLAN.md, SLICE 6.
//
// The shape the interview settled, because a later reader will otherwise
// "simplify" it back:
//   - The STORE (campaign.items) holds every item NOT currently held; a bound
//     item lives on its holder (squads[].banner), the same convention 5a used
//     for characters[].items. So "in the store" means exactly "on nothing".
//   - Acquisition is CHANNEL-AGNOSTIC (6-13). grantItem is the one chokepoint;
//     a raid reward and an event effect both come through it, and neither knows
//     anything the other doesn't.
//   - Uniqueness is a property of the ITEM, never of the channel that offers
//     it. holdsItem() is what a draw filters on, and grantItem refuses a
//     duplicate defensively so a scheduled event cannot sneak one through.
//   - The banner TIER is derived, never stored (6-8): retune the rank ladder
//     and every squad's tier follows, because nothing froze it at the moment of
//     crossing.

export const findItem = (id) => ITEM_CATALOG.find((row) => row.id === id) ?? null

// Mongoose arrays are array-likes and plain tests pass arrays; one reader
// covers both, and a campaign written before the field existed reads as empty.
const storeIds = (campaign) => [...(campaign?.items ?? [])]

// Remove ONE copy of an id from a list, leaving any others. Ordinary kit stacks
// (9-6), so the store may legitimately hold three Iron Helms — a filter that
// drops every match would destroy two of them on the first equip. This existed
// as a filter while banners were the only item and every item was unique; that
// it was correct then is exactly why it had to be found and changed now.
const withoutOne = (ids, itemId) => {
  const at = ids.indexOf(itemId)
  return at < 0 ? ids : [...ids.slice(0, at), ...ids.slice(at + 1)]
}

// Every item the campaign holds ANYWHERE — in the store, bound to a squad, or
// worn by a character. The uniqueness check has to see all three, or a banner
// already flying over a squad could be won a second time, and a relic already
// on a champion could be won again while he wears it.
//
// DEAD characters count. Their gear is preserved on the record (5-9) so a later
// recovery has something to find, which means it is still held — a relic on a
// body in a ditch must not also drop from the next enemy captain.
export const heldItemIds = (campaign) => [
  ...storeIds(campaign),
  ...[...(campaign?.squads ?? [])].map((squad) => squad?.banner).filter(Boolean),
  ...[...(campaign?.characters ?? [])].flatMap((c) =>
    [...(c?.items ?? [])].map((worn) => worn?.itemId).filter(Boolean),
  ),
]

export const holdsItem = (campaign, itemId) => heldItemIds(campaign).includes(itemId)

// The store, resolved for display. An id whose row has left the catalog
// degrades to nothing rather than throwing — the archetypeOf convention, so a
// campaign in flight still loads after a catalog edit.
export const storedItems = (campaign) => storeIds(campaign).map(findItem).filter(Boolean)

// ─── Phrasing (17-5) ────────────────────────────────────────────────────────
// The SERVER phrases every item, and the client renders sentences it never
// composes. Same contract as describeEffect: the client holds no copy of
// ITEM_CATALOG and has no business turning the enum word `fearless` into
// English. One function, so the store's two modes (17-4) cannot drift apart in
// wording, and a future holder's page gets the same sentences for free.

// What each ability WORD means, in the player's language. This map is the whole
// reason the raw `abilities` array never crosses to the client. A new ability
// that lands in ITEM_CATALOG without a line here fails items.test.js's sweep on
// purpose — the alternative is an item whose power is a debug word.
// Keyed by ability, then by what the item is worn BY — the same ability reads
// differently on a standard and on a horn. Adding the second target is what a
// character-carried `fearless` forced: the banner sentence talks about a squad,
// and printing it on a helm would be a lie the player has no way to check.
export const ITEM_ABILITY_TEXT = {
  fearless: {
    squad: 'The squad does not break: it holds where another would rout, whatever the odds.',
    character: 'The bearer does not break: they hold where another would run, whatever the odds.',
  },
}

// The character-sheet stat names, in the player's language (9-5). A stat with
// no line here is DROPPED from the sentence rather than printed raw, and
// items.test.js sweeps the catalog so an author finds out at CI time instead of
// shipping a card that says `ballisticSkill`.
export const ITEM_STAT_TEXT = {
  maxHP: 'stamina',
  attack: 'attack',
  defence: 'defence',
  armour: 'armour',
  speed: 'speed',
  ballisticSkill: 'marksmanship',
  preferredRange: 'preferred distance',
  formationFighter: 'how tightly they pack into a line',
}

// "+1 attack and −1 speed" — signed, in words, in a stable order so two items
// with the same bag read identically. Minus sign, not a hyphen: this is a
// number a player reads, not a flag.
const modText = (mods = {}) => {
  const parts = Object.entries(mods)
    .filter(([stat, delta]) => ITEM_STAT_TEXT[stat] && delta)
    .map(([stat, delta]) => `${delta > 0 ? '+' : '\u2212'}${Math.abs(delta)} ${ITEM_STAT_TEXT[stat]}`)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Where the thing can go. Derived from target+kind rather than authored per
// row, so the sentence stays true when the slot rules move — the Seasoned rung
// is named from the same constant hasBanner() gates on.
const whereText = (row) => {
  if (row.target === 'squad' && row.kind === 'banner') {
    return `Flown by a squad, in its banner slot — a charter must be ${SQUAD_BANNER_RANK} before the slot opens.`
  }
  if (row.target === 'squad') return 'Given to a squad.'
  if (row.target === 'character' && row.slot) {
    // The slot NAMES itself; how many of them a body has is a fact about the
    // creature and lives in the engine catalog (5-6), so the sentence stays
    // true for a hydra without knowing what a hydra is.
    return `Worn by a character, in a ${SLOT_TEXT[row.slot] ?? row.slot} slot.`
  }
  if (row.target === 'character') return 'Carried by a character.'
  return 'It has nowhere to go yet.'
}

// The anatomy slots, in the player's language. The engine's vocabulary
// (Anatomy.hpp) is already plain English, but routing it through a map keeps
// the rule that the client never meets an engine word by accident.
export const SLOT_TEXT = {
  head: 'head',
  torso: 'body',
  legs: 'legs',
  hand: 'hand',
  misc: 'kit',
}

// The three lines the store renders for an item, in both modes. An ability with
// no phrasing is DROPPED rather than printed raw — a reader must never meet the
// engine's vocabulary — and an item left with nothing to say says that plainly.
export const describeItem = (row) => {
  const target = row.target === 'squad' ? 'squad' : 'character'
  const sentences = []

  // Numbers first: a player checking whether to swap two helms wants the deltas
  // before the prose. A row may carry stats, abilities or both (9-2).
  const stats = modText(row.mods)
  if (stats) sentences.push(`It gives its bearer ${stats}.`)

  for (const name of row.abilities ?? []) {
    const line = ITEM_ABILITY_TEXT[name]?.[target]
    if (line) sentences.push(line)
  }

  // What it TAKES AWAY (9-3). Phrased from the same map, so a denial and a
  // grant of one ability can never describe it in two different vocabularies.
  const denied = (row.denies ?? [])
    .filter((name) => ITEM_ABILITY_TEXT[name]?.[target])
    .map((name) => name)
  if (denied.length > 0)
    sentences.push(`While it is worn, this is lost: ${
      denied.map((name) => ITEM_ABILITY_TEXT[name][target]).join(' ')
    }`)

  return {
    effect: sentences.join(' ') || 'It carries no power of its own — not yet.',
    where: whereText(row),
    binding: row.permanent
      ? 'Once it is given, it stays: it cannot be taken back, and nothing else will ever carry it.'
      : 'It can be taken back later and given to something else.',
  }
}

// ─── The authoring rule for denials (9-4) ───────────────────────────────────
//
// An ability that arrives BY IMPLICATION cannot be taken away: the engine
// subtracts denials first and runs abilityClosure() after, so a row denying one
// is inert. That order is the SAFETY (an undead that leaves a corpse stays
// unwritable); this list is only the COURTESY — it lets a catalog sweep tell an
// author their row does nothing, instead of leaving them to wonder.
//
// A MIRROR of the implication table in backend/engine/src/Abilities.cpp, which
// is the source of truth. Deliberately a mirror rather than a sync: the engine
// must not learn what an item is, and a campaign-side list that drifts costs a
// warning, never a bug — the engine's order is what actually holds.
//
// Today: Mindless => Fearless, Undead => NoCorpse. So `fearless` and `nocorpse`
// are both reachable by implication and both undeniable in practice.
export const IMPLIED_ABILITIES = ['fearless', 'nocorpse']

// The denials on this row that will do nothing. Empty for a well-authored row.
export const inertDenials = (row) =>
  (row?.denies ?? []).filter((name) => IMPLIED_ABILITIES.includes(name))

// What a slot of this kind can be filled from right now. The SLOT declares what
// it accepts and the store filters to that (6-14) — storage itself stays
// ignorant of what kinds exist, which is what lets a character's head slot use
// this same function later.
export const storedItemsOfKind = (campaign, kind) =>
  storedItems(campaign).filter((row) => row.kind === kind)

// Put a won item in the store. Returns true if it landed, false if the row is
// unique and the campaign already holds one — the defensive half of uniqueness
// (the draw-time filter is the other half, and is what stops the offer
// appearing at all).
//
// Uniqueness is a property of the ROW, never of the channel that offers it
// (9-6). Ordinary kit STACKS: `campaign.items` is a [String] that may simply
// repeat, and two copies of one row are identical, so nothing needs telling
// them apart. A per-instance uid arrives only if items ever gain per-instance
// state, and for that reason rather than this one.
export const grantItem = (campaign, itemId) => {
  const row = findItem(itemId)
  if (!row) return false
  if (row.unique && holdsItem(campaign, itemId)) return false
  // Degrade safely on a campaign with no store at all — the same convention
  // applyEffect's `flag` and `forage_modifier` branches use, and it matters for
  // the same reason: the structural tests sweep every authored fate through
  // applyEffect against skeleton campaigns.
  if (!campaign.items) campaign.items = []
  campaign.items.push(itemId)
  return true
}

// ─── The banner tier ────────────────────────────────────────────────────────
// Three rungs (decision 10): every squad carries a PLAIN banner, which does
// nothing and ships inert because spell cost does not exist yet; the Seasoned
// rung grants a BASIC one, whose only job today is opening the item slot (its
// bonus is deferred ON PURPOSE by decision 16 — do not invent one); a bound
// relic is the ITEM tier, and REPLACES the basic banner rather than stacking.
const BANNER_MIN = SQUAD_RANKS.find((r) => r.label === SQUAD_BANNER_RANK)?.min ?? Infinity

// True at or above the banner rung. Compared on PRESTIGE against the rung's
// threshold rather than on the rank word, so it stays true for every rank above
// it too. This is what OPENS the item slot.
export const hasBanner = (squad) => (squad?.prestige ?? 0) >= BANNER_MIN

export const bannerTier = (squad) => {
  if (squad?.banner) return 'item'
  return hasBanner(squad) ? 'basic' : 'plain'
}

// The item bound to this charter, resolved, or null.
export const squadBanner = (squad) => (squad?.banner ? findItem(squad.banner) : null)

// The ability names a squad's banner grants every body in it. Empty for the
// plain and basic tiers — the basic banner's benefit is deferred, not missing.
// This is the ONLY place the campaign layer turns a banner into engine words;
// the engine never learns what a banner is (6-7).
export const squadAbilities = (squad) => [...(squadBanner(squad)?.abilities ?? [])]

// Bind an item to a squad. Refuses everything the UI also greys out, because
// the server is the trust boundary and the UI is a courtesy:
//   - an item that is not in the store (already bound, or never won)
//   - an item that does not target a squad
//   - a squad below the banner rung — the basic banner is what opens the slot
//   - a squad that already carries a bound banner: bound is bound (decision
//     10), and a bound banner never comes back to the store
// Returns the resolved row on success, or an {error} the route turns into a 400.
export const bindItemToSquad = (campaign, squad, itemId) => {
  const row = findItem(itemId)
  if (!row) return { error: 'no such item' }
  if (row.target !== 'squad') return { error: 'that item does not go to a squad' }
  if (!storeIds(campaign).includes(itemId)) return { error: 'that item is not in the store' }
  if (!squad) return { error: 'no such squad' }
  if (row.kind === 'banner') {
    if (!hasBanner(squad)) return { error: `a squad must be ${SQUAD_BANNER_RANK} to carry a banner` }
    if (squad.banner) return { error: 'that squad already carries a banner' }
    squad.banner = itemId
  } else {
    return { error: 'that item has nowhere to go on a squad' }
  }
  // Out of the store for good: a permanent item leaves and never returns.
  campaign.items = withoutOne(storeIds(campaign), itemId)
  return { item: row }
}
