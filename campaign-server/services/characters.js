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
import { findItem, ITEM_STAT_TEXT, SLOT_TEXT } from './items.js'
import { enginePaths, isCasterType, rollPaths } from './magic.js'
import { onMission } from './missions.js'

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

// ── The modifier layer (5-2/5-3), filled at last by slice 9a ────────────────
//
// A character's base unit type is never modified. What items, experience and
// wounds do instead folds into a flat {stat: delta} bag — the same `squad_mods`
// transport the squad upgrades already ride (4b), so a character's modifiers
// reach the engine through a door that exists and is already bounded
// (AUnit::MAX_STAT_MOD).
//
// SOURCES are stored and the bag is DERIVED, so retuning an item re-prices
// every existing character and no save can go stale. That promise is what this
// function is for; storing the bag would have broken it the first time a number
// moved.

// The gear a character actually wears, as {slot, index, row} with the catalog
// row resolved. Sparse (5-5): only what is worn is stored.
//
// Two filters, both deliberate:
//   • an id whose row has LEFT the catalog degrades to nothing rather than
//     throwing — the archetypeOf convention, so a campaign in flight still
//     loads after a catalog edit;
//   • an entry in a slot the creature no longer HAS is dropped at derivation
//     time (5-5's promise). A creature that loses a limb changes its LAYOUT
//     only; the save is never surgically rewritten, so a stranded item is a
//     read-time filter and comes back if the limb does. Pass `anatomy` to apply
//     it — without one, nothing is stranded and everything worn counts.
export const wornItems = (character, anatomy = null) =>
  [...(character?.items ?? [])]
    .map((worn) => ({ slot: worn?.slot, index: worn?.index, row: findItem(worn?.itemId) }))
    .filter(({ row }) => row)
    .filter(({ slot, index }) => !anatomy || (index ?? 0) < (anatomy[slot] ?? 0))

// Every stat delta a character's gear adds up to. Deltas ADD: two items each
// giving +1 attack give +2, by the only arithmetic either row means.
//
// Experience and wounds still contribute nothing — they are later slices, and
// the void keeps them visible as sources this function is expected to grow.
export const characterMods = (character, anatomy = null) => {
  const mods = {}
  for (const { row } of wornItems(character, anatomy))
    for (const [stat, delta] of Object.entries(row.mods ?? {}))
      mods[stat] = (mods[stat] ?? 0) + delta
  void character?.experience
  void character?.wounds
  return mods
}

// ── The character sheet (9-16) ──────────────────────────────────────────────
//
// The sheet is the SERVER's arithmetic, like every other number the campaign
// screens render: base plus the derived bag, resolved here so the client folds
// nothing and holds no copy of the unit catalog.
//
// The VOCABULARY is 9-5's and it is exactly ITEM_STAT_TEXT's — the stats a
// character sheet shows as numbers, phrased in the player's words. Reusing that
// map rather than writing a second list is what stops a helm reading "+1
// defence" beside a row that calls the same number something else, and it means
// a stat that gains a sheet line gains an item line with it.
//
// `reconTag` is therefore absent, as 9-5 requires: it is a signed fudge term in
// a campaign formula, not a number on a sheet.
//
// A row is shown when the TYPE has the stat or when something MOVED it. That
// second clause is what keeps a mod to a stat the catalog does not carry (the
// engine exports formationFighter; the campaign's UnitType does not store it)
// visible rather than silently dropped — a modifier the player cannot see is
// worse than a base of zero they can.
export const characterSheet = (baseStats, mods = {}) => {
  // No catalog row means we know nothing about this creature's numbers. Null,
  // not an empty list: "nothing is known" and "everything is zero" are
  // different sentences and the screen says the first one.
  if (!baseStats) return null
  const stats = typeof baseStats.toObject === 'function' ? baseStats.toObject() : baseStats
  return Object.entries(ITEM_STAT_TEXT)
    .filter(([stat]) => stats[stat] !== undefined || (mods[stat] ?? 0) !== 0)
    .map(([stat, label]) => {
      const base = stats[stat] ?? 0
      const delta = mods[stat] ?? 0
      return { stat, label, base, delta, value: base + delta }
    })
}

// The body plan as the sheet DRAWS it (5-6): one entry per slot kind, in a
// fixed order, phrased. The counts are wearing positions, not limbs — a horse
// has four legs and one `legs` slot, because barding is worn as a set.
//
// Sent instead of the raw anatomy map, because the client would otherwise have
// to name the slots itself and would meet the engine's vocabulary doing it
// (17-5). A slot the creature does not have is dropped rather than sent as a
// zero: an empty row a player can never fill reads as a bug.
export const characterSlots = (anatomy) => {
  if (!anatomy) return null
  return Object.entries(SLOT_TEXT)
    .filter(([slot]) => (anatomy[slot] ?? 0) > 0)
    .map(([slot, label]) => ({ slot, label, count: anatomy[slot] }))
}

// What a character's gear GRANTS and what it DENIES, as engine ability words
// (9-3). Two lists rather than one signed structure, because they travel to the
// engine as two separate placement fields and are applied in a fixed order
// there: the denial is subtracted first and the implication closure runs after
// it (9-4), so a row denying an implied ability is inert rather than dangerous.
//
// Nothing here checks whether a denial is eligible, and that is the point. The
// authoring rule ("deny only non-implied abilities") is enforced by a catalog
// sweep in items.test.js, which tells an author their row does nothing; the
// ORDER in the engine is what makes it SAFE. Duplicates are collapsed — two
// items granting the same word grant it once.
export const characterAbilities = (character, anatomy = null) => {
  const granted = new Set()
  const denied = new Set()
  for (const { row } of wornItems(character, anatomy)) {
    for (const name of row.abilities ?? []) granted.add(name)
    for (const name of row.denies ?? []) denied.add(name)
  }
  return { granted: [...granted], denied: [...denied] }
}

// ── Availability (9-8 / 9-9) ────────────────────────────────────────────────
//
// A character whose squad is out today cannot be re-kitted, attached or
// detached: they are not here. It reads the two notions of busy 12-3 stores
// rather than inventing a third — a raid is spent-today and lives on the
// campaign, a mission spans turns and lives on the charter.
//
// A LOOSE character is never away: they are standing in camp, and nothing they
// are not part of can take them anywhere.
export const characterIsAway = (campaign, character) => {
  if (character?.squadId == null) return false
  const squad = [...(campaign?.squads ?? [])].find((s) => s.id === character.squadId)
  if (!squad) return false
  if (onMission(squad)) return true
  return [...(campaign?.raid?.squadAssignment ?? [])].map(Number).includes(squad.id)
}

// Why a character cannot be acted on, in the player's vocabulary — or null.
// One phrase per state, and only states that exist.
export const awayBlocker = (campaign, character) => {
  if (character?.squadId == null) return null
  const squad = [...(campaign?.squads ?? [])].find((s) => s.id === character.squadId)
  if (!squad) return null
  if (onMission(squad)) return `${character.name} is away on a mission with ${squad.name}`
  if ([...(campaign?.raid?.squadAssignment ?? [])].map(Number).includes(squad.id))
    return `${character.name} is out raiding with ${squad.name}`
  return null
}

// ── Equipping (9-8) ─────────────────────────────────────────────────────────
//
// Free: no phase gate, no per-turn limit, no cost. 5-7's rule, and for 5-7's
// reason — the restriction that DOES exist is availability, not economy.
//
// Validates and returns a plan; never mutates, so a route can check and apply
// in one call and an error path leaves the document untouched. `anatomy` is the
// creature's body plan out of the engine catalog (5-6) — passed in rather than
// looked up here, because this module knows nothing about the DB.
export const planEquip = (campaign, characterId, { slot, index, itemId }, anatomy) => {
  const character = characterById(campaign, characterId)
  if (!character) return { error: `no such character: ${characterId}` }
  if (!character.alive) return { error: `${character.name} is dead` }
  const away = awayBlocker(campaign, character)
  if (away) return { error: away }

  const row = findItem(itemId)
  if (!row) return { error: 'no such item' }
  if (row.target !== 'character') return { error: 'that item does not go to a character' }
  if (!row.slot) return { error: 'that item has nowhere to go on a character' }

  // An undeclared anatomy is an ERROR, never a humanoid by omission (5-6). The
  // engine makes that a compile error for a unit type; here it can only be a
  // drifted sync, and answering "no slots" is the safe direction.
  if (!anatomy) return { error: `nothing is known about where a ${character.type} can wear things` }

  const at = Number(index ?? 0)
  if (!Number.isInteger(at) || at < 0) return { error: 'that is not a slot' }
  const have = anatomy[slot] ?? 0
  if (slot !== row.slot) return { error: `${row.name} is worn in a ${row.slot} slot` }
  if (at >= have) {
    return {
      error: have === 0
        ? `a ${character.type} has no ${slot} slot`
        : `a ${character.type} has only ${have} ${slot} slot${have === 1 ? '' : 's'}`,
    }
  }

  // The store is the only source. "In the store" means "on nothing" (slice 6),
  // so an item already worn — by this character or another — is not available,
  // and neither is one that was never won.
  if (![...(campaign?.items ?? [])].includes(itemId))
    return { error: 'that item is not in the store' }

  const occupant = [...(character.items ?? [])].find(
    (worn) => worn?.slot === slot && Number(worn?.index ?? 0) === at,
  )
  if (occupant) return { error: `that slot is already filled` }

  return { character, worn: { slot, index: at, itemId }, item: row }
}

// Take a piece off and put it back in the store. Refused while the bearer is
// away for the same reason equipping is.
export const planUnequip = (campaign, characterId, { slot, index }) => {
  const character = characterById(campaign, characterId)
  if (!character) return { error: `no such character: ${characterId}` }
  if (!character.alive) return { error: `${character.name} is dead` }
  const away = awayBlocker(campaign, character)
  if (away) return { error: away }

  const at = Number(index ?? 0)
  const worn = [...(character.items ?? [])].find(
    (w) => w?.slot === slot && Number(w?.index ?? 0) === at,
  )
  if (!worn) return { error: 'nothing is worn there' }
  const row = findItem(worn.itemId)
  if (row?.permanent) return { error: `${row.name} cannot be taken back` }

  return { character, worn, item: row }
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
  // The hire roll (docs/CAMPAIGN_PLAN.md "▶ SLICE 2", S2-3/S2-4/S2-14), made
  // HERE because this is where characters are already minted and because
  // hiding the roll until hire is the point (S2-5): the recruit card offers "a
  // Mage", and the log names what actually took service. Sealing a rolled
  // caster onto the day's offer instead — the machinery raid bearers use —
  // would turn hiring into shopping, and M-5 asks for a real gamble on a named
  // individual.
  //
  // Unlike the name above, this DOES draw from the shared dice queue for the
  // starting six: their paths are the campaign's opening hand and rolling them
  // is the whole point, where their names are fixed so a fresh campaign is
  // reproducible.
  paths: rollPaths(type),
  ...overrides,
})

// ── Attaching (5-7, amended by 9-9) ─────────────────────────────────────────
//
// Free and ungated: any phase, any number of times. The rules are that the
// character is alive, that they are HERE (9-9 — a squad out raiding or away on
// a mission takes its character with it), the squad exists, and the squad is
// not already full.
// Returns {error} or {character} — never throws, and never mutates on the
// error path, so a route can validate and apply in the same call.
export const planAttach = (campaign, characterId, squadId) => {
  const character = characterById(campaign, characterId)
  if (!character) return { error: `no such character: ${characterId}` }
  if (!character.alive) return { error: `${character.name} is dead` }

  // ── 9-9 AMENDS 5-7: an away character is untouchable ─────────────────────
  //
  // Attach and detach stay free in any phase, at no cost, any number of times.
  // "Away" is simply not a state you can act on — and this check has to be
  // HERE rather than only on the equip route, because otherwise 9-8 is
  // advisory: detach, re-kit, re-attach is three clicks.
  //
  // It gates the DETACH below too, which is why it sits above it.
  const away = awayBlocker(campaign, character)
  if (away) return { error: away }

  // Detach: a null/undefined squad sends them back to camp, which is legal
  // whenever they are actually here — that is what makes riding along at full
  // risk (5-8) a fair deal.
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
//
// `squadMods` is the same story for the squad's UPGRADES (13-17): membership
// means membership, so the drill and the equipment a charter has earned reach
// its posted character too. Until 13-17 they did not, and posting a character
// to your best-drilled cohort was quietly worth less than it looked — the gap
// slice 6 flagged and left rather than fixed silently.
//
// The two bags ADD rather than override. Both are {stat: delta} deltas headed
// for the same bounded engine door, and a squad's +1 on top of a character's
// own +1 is +2 by the only arithmetic either side means. `characterMods` is
// still {} today, so nothing observes the sum yet — which is exactly when to
// get it right.
// `anatomy` is the creature's body plan (5-6), used to drop gear worn in a slot
// the type does not have. Optional: without it nothing is stranded, which is the
// right answer for a caller that has no catalog in hand.
export const characterEntryFor = (
  character, { q, r }, abilities = [], squadMods = {}, anatomy = null,
) => {
  const mods = { ...squadMods }
  for (const [stat, delta] of Object.entries(characterMods(character, anatomy)))
    mods[stat] = (mods[stat] ?? 0) + delta

  // The squad's abilities and the bearer's own gear travel on SEPARATE wire
  // fields, because the engine scopes them differently: `squad_abilities` holds
  // only while the unit is in a squad (6-6), `carried_abilities` is worn on the
  // body and goes wherever the body goes.
  //
  // They used to be merged onto the one field, and that was the bug 9a recorded
  // here and 9b left standing: a LOOSE character is in no squad, so their gear's
  // gift arrived and was dropped in silence. The fix is the engine's scoping,
  // which is where it went — this side just stopped conflating the two.
  //
  // 6-7 is untouched: the engine still learns the word `fearless` and never the
  // words `banner` or `helm`. What the field name tells it is the SCOPE.
  const gear = characterAbilities(character, anatomy)
  const granted = [...new Set(abilities)]

  return {
    unit_type: character.type,
    q,
    r,
    character_id: character.id,
    // The paths they command (S2-3), from the RECORD like everything else here.
    //
    // The FULL map, zeros included (services/magic.js enginePaths), and only
    // for a caster. AUnit::setPathLevel writes what it is handed and nothing
    // else, and the engine's Mage() seeds Fire 1 of its own — so a hire who
    // rolled Air must arrive carrying fire: 0, or he quietly commands Fire
    // anyway and the roll that is the whole of the Mage lane's gamble means
    // less than it says.
    ...(isCasterType(character.type) ? { paths: enginePaths(character.paths) } : {}),
    // The engine's name for the toggle. Defaulted false rather than left
    // undefined so the entry always states the intent explicitly.
    avoids_melee: character.hangBack ?? false,
    ...(Object.keys(mods).length > 0 ? { squad_mods: mods } : {}),
    ...(granted.length > 0 ? { squad_abilities: granted } : {}),
    // What the gear gives (9-3), unscoped — see above.
    ...(gear.granted.length > 0 ? { carried_abilities: gear.granted } : {}),
    // What the gear takes away (9-4). A separate field because the engine
    // applies it in a fixed order — subtracted BEFORE the implication closure
    // runs — which is what makes a general item system safe.
    ...(gear.denied.length > 0 ? { denied_abilities: gear.denied } : {}),
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
