// The character layer (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS").
//
// Everything here is PURE: it takes a campaign (or a plain object shaped like
// one) and returns values. Nothing saves, and nothing reaches for the DB — the
// routes own persistence, exactly as services/squadUpgrades.js works.
//
// The rule to reach for when this file is silent: **a character is a special
// kind of troop, and follows every rule troops follow unless a decision
// explicitly changes it** (5-0). That is why `allBodies` exists at all — the
// troop-wide numbers should not have to learn what a character is.

import { CHARACTER_NAMES, CHARACTER_TYPES, MAX_CHARACTERS_PER_SQUAD } from '../utils/campaignConfig.js'
import { getRandom } from '../utils/dice.js'

// `campaign.characters` reaches here as a Mongoose DocumentArray on a live doc
// and a plain array in tests and at creation — both iterate, so read either.
const listOf = (campaign) => campaign?.characters ?? []

export const isCharacterType = (type) => CHARACTER_TYPES.includes(type)

// The living. Every reader that asks "who can do something" filters through
// here: a dead character is KEPT on the rolls (5-9), so forgetting the filter
// is how a fallen mage ends up reading omens.
export const livingCharacters = (campaign) => listOf(campaign).filter((c) => c.alive)

export const characterById = (campaign, id) =>
  listOf(campaign).find((c) => c.id === Number(id)) ?? null

// The living characters riding with one squad. A list rather than a lookup
// because MAX_CHARACTERS_PER_SQUAD is a prototyping placeholder (decision 9) —
// the day it rises above 1, the callers should already be plural.
export const charactersOfSquad = (campaign, squadId) =>
  livingCharacters(campaign).filter((c) => c.squadId === Number(squadId))

// The living, unattached ones — the pool the deploy screen offers as loose
// bodies of their type, and the pool an attach draws from.
export const looseCharacters = (campaign) =>
  livingCharacters(campaign).filter((c) => c.squadId == null)

// Living characters as a {type: count} Map — the same shape `roster` has, so a
// troop-wide computation can take them without knowing what a character is.
export const characterBodies = (campaign) => {
  const bodies = new Map()
  for (const c of livingCharacters(campaign))
    bodies.set(c.type, (bodies.get(c.type) ?? 0) + 1)
  return bodies
}

// Every body in camp: the roster plus the living characters (5-10). This is
// what food upkeep, the boss-fight meter, the field-points pool and the
// annihilation check read now that casters live outside the roster. If they
// read `roster` alone, migrating six casters out of it would silently refund
// their rations and shift the meter — three balance changes nobody chose.
export const allBodies = (campaign, roster = campaign?.roster) => {
  const bodies = new Map(roster instanceof Map ? roster : Object.entries(roster ?? {}))
  for (const [type, n] of characterBodies(campaign))
    bodies.set(type, (bodies.get(type) ?? 0) + n)
  return bodies
}

// ── The modifier layer (5-2/5-3) ────────────────────────────────────────────
//
// A character's base unit type is never modified. What items, experience and
// wounds will do instead is fold into a flat {stat: delta} bag — the same
// `squad_mods` transport the squad upgrades already ride (4b), so a character's
// modifiers reach the engine through a door that exists and is already bounded
// (AUnit::MAX_STAT_MOD).
//
// SOURCES are stored and the bag is DERIVED, so retuning a future item
// re-prices every existing character and no save can go stale.
//
// It returns {} today, and that is the whole point: the seam is here, its
// callers are wired, and the slices that fill it change this function only.
export const characterMods = (character) => {
  const mods = {}
  void character?.items
  void character?.experience
  void character?.wounds
  return mods
}

// ── Hanging back (5-8) ──────────────────────────────────────────────────────
//
// Every character carries the toggle whatever their type — the user's call, so
// that a battle-mage can be ordered to hold the line and a swordsman to stay
// out of it. Only the DEFAULT is type-derived: spellcasters and archers hang
// back, melee does not.
//
// `preferredRange > 0` picks out exactly Archer, Mage, Priest and Necromancer
// from the live catalog and nothing else, so the default needs no new data and
// cannot drift out of step with a retuned unit. An unknown type does not hang
// back: a body the catalog cannot describe is not one we should assume is
// fragile.
export const hangsBackByDefault = (type, catalog) =>
  (catalog?.get(type)?.stats?.preferredRange ?? 0) > 0

// ── Minting (5-12) ──────────────────────────────────────────────────────────

// Ids are allocated max+1 and NEVER reused. Dead characters stay on the rolls
// (5-9), so the maximum only ever climbs — which is what makes this safe, and
// what stops a later recovery spell from waking a name someone else now holds.
export const nextCharacterId = (campaign) =>
  listOf(campaign).reduce((max, c) => Math.max(max, c.id), 0) + 1

// A name nobody on the rolls holds — the DEAD included, because a campaign
// that recycles a fallen name reads as a bug rather than as flavour. Drawn
// through the shared dice queue so tests can pin exactly who walks in.
export const drawCharacterName = (campaign, names = CHARACTER_NAMES) => {
  const taken = new Set(listOf(campaign).map((c) => c.name))
  const free = names.filter((n) => !taken.has(n))
  // Running out of names must never block a hire the player has already paid
  // for, so an exhausted pool falls back to a numbered name rather than
  // refusing. It is deliberately ugly: it should read as a pool that wants
  // more entries, not as a feature.
  if (free.length === 0) return `Stranger ${nextCharacterId(campaign)}`
  return free[getRandom(0, free.length - 1)]
}

// Mint one character of `type`. Returns the plain object to push onto
// `campaign.characters` — the caller owns the document.
export const mintCharacter = (campaign, type, catalog, overrides = {}) => ({
  id: nextCharacterId(campaign),
  // Only DRAW when the caller has not supplied a name. The starting six are
  // named in order so a fresh campaign is reproducible (5-12), and drawing for
  // them would burn six rolls off the shared dice queue — the same queue the
  // day-1 augury draw is reading two lines later at creation. A name override
  // must therefore cost no roll at all, not merely be overwritten afterwards.
  name: overrides.name ?? drawCharacterName(campaign),
  type,
  squadId: null,
  hangBack: hangsBackByDefault(type, catalog),
  alive: true,
  diedDay: null,
  items: [],
  experience: 0,
  wounds: [],
  ...overrides,
})

// ── Attaching (5-7) ─────────────────────────────────────────────────────────
//
// Free and ungated: any phase, any number of times. The only rules are that
// the character is alive, the squad exists, and the squad is not already full.
// Returns {error} or {character} — never throws, and never mutates on the
// error path, so a route can validate and apply in the same call.
export const planAttach = (campaign, characterId, squadId) => {
  const character = characterById(campaign, characterId)
  if (!character) return { error: `no such character: ${characterId}` }
  if (!character.alive) return { error: `${character.name} is dead` }

  // Detach: a null/undefined squad sends them back to camp, which is always
  // legal — that is what makes riding along at full risk (5-8) a fair deal.
  if (squadId == null) return { character, squadId: null }

  const squad = campaign.squads?.find((s) => s.id === Number(squadId))
  if (!squad) return { error: `no such squad: ${squadId}` }

  const already = charactersOfSquad(campaign, squadId).filter((c) => c.id !== character.id)
  if (already.length >= MAX_CHARACTERS_PER_SQUAD)
    return {
      error: `${squad.name} already has ${already.length === 1 ? 'a character' : `${already.length} characters`}`,
    }

  return { character, squadId: Number(squadId) }
}

// ── Taking the field ────────────────────────────────────────────────────────
//
// One placement entry for one character, built entirely from the RECORD. Both
// battle paths (the pitched battle and a raid party) go through here, because a
// second copy would be a second chance to forget `avoids_melee` — and a
// character who silently stops hanging back is a bug the player pays for with a
// dead mage.
//
// Nothing here is ever taken from the request. The client says WHERE a loose
// character stands; it never says who they are, how they fight, or what
// modifiers they carry. That is the same rule squad_mods follows (4b).
// `abilities` is what the character's SQUAD grants them — a bound banner's gift
// (slice 6). It is passed in rather than looked up here because this module
// knows nothing about items, and the caller already has the squad in hand.
//
// An attached character IS covered by their squad's banner: 5-0's standing rule
// is that a character is a special kind of troop and follows every rule troops
// follow, and the banner's own rule is that it grants its ability to all units
// in the squad. Empty for a loose character, who is in no squad to be covered
// by — which is the same membership scoping the engine applies (6-6).
export const characterEntryFor = (character, { q, r }, abilities = []) => {
  const mods = characterMods(character)
  return {
    unit_type: character.type,
    q,
    r,
    character_id: character.id,
    // The engine's name for the toggle. Defaulted false rather than left
    // undefined so the entry always states the intent explicitly.
    avoids_melee: character.hangBack ?? false,
    ...(Object.keys(mods).length > 0 ? { squad_mods: mods } : {}),
    ...(abilities.length > 0 ? { squad_abilities: abilities } : {}),
  }
}

// ── Coming home (5-9) ───────────────────────────────────────────────────────
//
// Reconcile the characters a battle was SENT with the ids that walked off it.
// Asking who we sent is the load-bearing half: the engine reports survivors,
// so an id missing from `survivorIds` is dead — but only if it was on the
// field in the first place, and a character in camp must never be killed by a
// battle it never joined.
//
// Mutates in place (the caller is holding the document open) and returns the
// characters that died, so a route can log them by name.
export const reconcileCharacters = (campaign, sentIds, survivorIds, day) => {
  // A MISSING list is not an empty one. `[]` means the engine looked and found
  // no survivors — everyone sent died. `undefined` means it never reported,
  // which is a bug in the pipeline rather than a massacre, and killing the whole
  // company on a field that failed to arrive is the worse way to be wrong: a
  // death here is permanent and a campaign cannot be un-lost.
  if (survivorIds == null) return []
  const survived = new Set(survivorIds.map(Number))
  const fallen = []
  for (const id of sentIds ?? []) {
    if (survived.has(Number(id))) continue
    const character = characterById(campaign, id)
    if (!character || !character.alive) continue
    character.alive = false
    character.diedDay = day
    // Their squad loses them, but nothing else about the record is touched:
    // items, experience and wounds stay exactly as they were, because a later
    // recovery has to have something to recover.
    character.squadId = null
    fallen.push(character)
  }
  return fallen
}
