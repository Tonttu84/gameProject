// The magic campaign layer (docs/CAMPAIGN_PLAN.md "▶ SLICE 2 — THE CAMPAIGN
// LAYER"). Slice 1 built the engine half; this is the half that decides what
// the engine is TOLD.
//
// Everything here is PURE in the same sense services/characters.js is: it takes
// a campaign (or a plain object shaped like one) and returns values, or mutates
// a document the caller is already holding open. Nothing saves and nothing
// reaches for the DB.
//
// The rule to reach for when this file is silent is M-19: **both sides pass the
// identical gates, and only the SOURCE of each number differs.** The player's
// school level is campaign state grown by research; the enemy's is written on
// the encounter. The engine cannot tell them apart and never learns the word
// "research" — which is why this module has an `enemyMagic` beside its
// `playerMagic` rather than a flag threaded through one.

import {
  CHANNELS_BY_BANNER_TIER,
  CHARACTER_TYPES,
  DECLARED_CASTER_PATH,
  DECLARED_CASTERS_ROLL_SECOND,
  ENEMY_CHANNELS,
  ENEMY_SCHOOLS,
  HIRE_PATH_POOL,
  HIRE_PRIMARY_LEVEL,
  HIRE_SECOND_PATH_PERCENT,
  RESEARCH_DEFAULT_FOCUS,
  RESEARCH_LEVEL_COST,
  RESEARCH_MAX_LEVEL,
  RESEARCH_POINTS_PER_MAGE,
  RESEARCH_START_LEVEL,
  SPELL_PATHS,
  SPELL_PATH_TEXT,
  SPELL_SCHOOLS,
  SPELL_SCHOOL_TEXT,
} from '../utils/campaignConfig.js'
import { getRandom } from '../utils/dice.js'
import { bannerTier } from './items.js'
import { livingCharacters } from './characters.js'

// A {key: number} bag reaches here as a Mongoose Map on a live document and a
// plain object at creation and in tests. Both are read through here, the same
// convention services/characters.js `listOf` uses for its DocumentArray.
const bagEntries = (bag) =>
  bag instanceof Map ? [...bag.entries()] : Object.entries(bag ?? {})

// ── The hire roll (S2-3 / S2-4 / S2-14) ─────────────────────────────────────
//
// PATHS ARE HIDDEN UNTIL HIRE (S2-5): this runs inside mintCharacter, so the
// recruit card offers "a Mage" and the log names what actually took service.
// That is M-5's "a real gamble on a named individual" — sealing a rolled caster
// onto the day's offer would turn hiring into shopping.
//
// Three shapes, and the difference between them IS the design:
//   • a DECLARED path that does not roll on (a Priest) is flat Holy 2 — the
//     certainty the Priest lane sells, because priesthood is formal and not
//     skill (S2-4);
//   • a DECLARED path that does (a Necromancer) takes Death 2 and then the same
//     single check everyone else takes (S2-14) — necromancy is a craft, and this
//     is what lets the occasional enemy raiser reach the major form;
//   • everything else — the Mage lane — draws its primary from the eight
//     non-Holy paths, which is the gamble.
//
// `rand` is injectable so tests can pin exactly who walks in, and it is drawn
// through the shared dice queue like every other campaign roll.
export function rollPaths(type, rand = getRandom) {
  const declared = DECLARED_CASTER_PATH[type] ?? null
  const paths = {}

  if (declared) {
    paths[declared] = HIRE_PRIMARY_LEVEL
    if (!DECLARED_CASTERS_ROLL_SECOND.includes(type)) return paths
  } else {
    paths[HIRE_PATH_POOL[rand(0, HIRE_PATH_POOL.length - 1)]] = HIRE_PRIMARY_LEVEL
  }

  // ONE check, never a loop (the user's call): no lottery tail, and a
  // distribution with two shapes rather than an open-ended one. A draw that
  // lands on a path already held is +1 rather than a second entry — Fire 2
  // becomes Fire 3 — which is the only way a fresh hire clears a level-3 gate.
  if (rand(1, 100) <= HIRE_SECOND_PATH_PERCENT) {
    const second = HIRE_PATH_POOL[rand(0, HIRE_PATH_POOL.length - 1)]
    paths[second] = (paths[second] ?? 0) + 1
  }
  return paths
}

// Whether a unit type is a CASTER at all — that is, whether a `paths` object on
// its placement entry means anything to the engine.
//
// The player's two hire lanes plus every type whose path its craft declares, so
// the enemy's Necromancers are covered without the enemy side needing a list of
// its own (M-17: there is ONE magic system, and the engine cannot tell whose
// caster it is holding). A type that is neither is left alone rather than sent
// a bag of zeros — the wire says what the engine must not assume about a
// CASTER, and a soldier was never going to be assumed anything.
export const isCasterType = (type) =>
  CHARACTER_TYPES.includes(type) || Boolean(DECLARED_CASTER_PATH[type])

// The rolls for every caster body in a force, in the order spreadPlacement will
// lay them out (both walk `Object.entries` of the same {type: count} bag). One
// bag per BODY, because eleven Necromancers are eleven individuals.
//
// This is the SEALING half of S2-10: a raid target's casters are rolled when
// the board is drawn and stored on the card, so the launch that happens later
// fields exactly the enemy the card advertised. Rolling at launch would let a
// reload reroll them, which is the bug the v40 bearer sealing exists to prevent.
export const rollCasterPathsFor = (force, rand = getRandom) => {
  const entries = force instanceof Map ? [...force.entries()] : Object.entries(force ?? {})
  const rolls = []
  for (const [type, count] of entries) {
    if (!isCasterType(type)) continue
    for (let i = 0; i < count; i++) rolls.push(rollPaths(type, rand))
  }
  return rolls
}

// Stamp `paths` onto every caster entry of a placement, in the wire form.
//
// `sealed` is the list rollCasterPathsFor produced when the encounter was
// dealt; passing none rolls fresh, which is what the host's own placement does
// (it is rebuilt and re-sealed on the server each turn, so there is nothing for
// a reload to reroll). A sealed list that has run short falls back to a fresh
// roll rather than dropping the caster's paths — a card whose force was edited
// mid-campaign should field a caster who can do something, not a mute one.
export const withCasterPaths = (placement, sealed = null) => {
  let next = 0
  return placement.map((entry) => {
    if (!isCasterType(entry.unit_type)) return entry
    const rolled = sealed?.[next++] ?? rollPaths(entry.unit_type)
    return { ...entry, paths: enginePaths(rolled) }
  })
}

// A character's paths as the sheet DRAWS them (S2-13): one entry per path they
// actually have, in the engine's canonical order, PHRASED. The same shape and
// the same reasoning as characters.js `characterSlots` — the client renders
// "Fire 2 · Water 1" by joining these, and never holds a copy of the vocabulary
// to name a path itself (17-5).
//
// A path at 0 is dropped rather than sent: a row the player can never use reads
// as a bug, exactly as an empty slot the creature does not have would.
export const pathEntries = (paths) => {
  const held = new Map(bagEntries(paths).map(([p, lvl]) => [p, Number(lvl) || 0]))
  return SPELL_PATHS.filter((p) => (held.get(p) ?? 0) > 0).map((path) => ({
    path,
    label: SPELL_PATH_TEXT[path],
    level: held.get(path),
  }))
}

// What a caster's paths look like ON THE WIRE: every path the engine knows,
// zeros included.
//
// The zeros are load-bearing and not padding. `AUnit::setPathLevel` only writes
// the paths it is handed, and all three engine caster constructors seed one of
// their own (Mage → Fire 1, Priest → Holy 1, Necromancer → Death 1). Sending
// only what the hire rolled would leave that constructor seed standing beside
// it, so every Mage in the campaign would quietly carry Fire whatever S2-3's
// roll actually said — and the roll is the whole of what the Mage lane sells.
// Sending the full map makes the RECORD the whole truth about a caster, which
// is the same rule characterEntryFor already follows for everything else.
export const enginePaths = (paths) => {
  const held = new Map(bagEntries(paths).map(([p, lvl]) => [p, Number(lvl) || 0]))
  return Object.fromEntries(SPELL_PATHS.map((p) => [p, held.get(p) ?? 0]))
}

// ── Research (S2-2 / S2-6 / S2-7) ───────────────────────────────────────────

// A fresh campaign's four schools, all at 0 (S2-2). Built rather than written
// out so SPELL_SCHOOLS stays the single source of which four there are.
export const emptySchools = () =>
  Object.fromEntries(
    SPELL_SCHOOLS.map((s) => [s, { level: RESEARCH_START_LEVEL, points: 0 }]),
  )

export const freshResearch = () => ({
  focus: RESEARCH_DEFAULT_FOCUS,
  allies: 0,
  schools: emptySchools(),
})

// One school's state off a campaign, whatever shape it is stored in. Degrades
// to a zeroed school rather than throwing, the same convention the `flag` and
// `forage_modifier` effects use for a campaign missing their block — the
// structural tests sweep skeleton campaigns through this module.
export const schoolOf = (campaign, school) => {
  const schools = campaign?.research?.schools
  const row = schools instanceof Map ? schools.get(school) : schools?.[school]
  return { level: row?.level ?? RESEARCH_START_LEVEL, points: row?.points ?? 0 }
}

// What the campaign studies per turn (S2-6): MAGES ALONE, plus any lent ally.
//
// Priests are deliberately absent. Holy needs no research and priesthood is
// formal (S2-4), so the two hires trade against each other — Priests give you
// day-1 castings, Mages give you the future.
//
// And a Mage AWAY ON A MISSION still studies: any living Mage counts wherever
// they are. A second thing that changes the rate would re-open exactly what M-7
// closed when it made every mage contribute equally, posted or not.
export const researchingMages = (campaign) =>
  livingCharacters(campaign).filter((c) => c.type === 'Mage').length

export const researchRate = (campaign) =>
  (researchingMages(campaign) + (campaign?.research?.allies ?? 0)) * RESEARCH_POINTS_PER_MAGE

// What the NEXT level of a school costs: 30 × n (bd). Cumulative by
// construction — each level is bought in turn out of the same bank — which is
// what puts level 3 around turn 6 for three Mages rather than turn 3.
export const nextLevelCost = (level) => RESEARCH_LEVEL_COST * (level + 1)

// The turn's study, landing in the FOCUSED SCHOOL ONLY (S2-7).
//
// Points bank PER SCHOOL, so switching focus parks progress where it was earned
// and picks it up untouched later — the focus is a plan rather than a
// commitment you get punished for revising. Nothing decays and nothing is
// forfeited on a switch; that was rejected as a punishment attached to a choice
// that is supposed to be about direction.
//
// Mutates the document the caller is holding open and returns log entries, the
// same contract applyEffect has.
export function accrueResearch(campaign) {
  return grantResearchPoints(campaign, researchRate(campaign))
}

// Bank `points` into the focused school and buy whatever levels they reach.
//
// The single writer, shared by the turn's own study above and by the `research`
// effect (S2-11), because a gift of study and a fortnight of it are the same
// thing arriving from two places — and the level-up sentence the player reads
// should be written once, not twice with a chance of drifting.
export function grantResearchPoints(campaign, gained) {
  if (!(gained > 0)) return []
  const focus = campaign?.research?.focus ?? RESEARCH_DEFAULT_FOCUS
  if (!SPELL_SCHOOLS.includes(focus)) return []

  // Degrade safely on a campaign with no research block at all, rather than
  // throwing: the structural tests sweep skeleton campaigns through end-day and
  // through applyEffect, and a turn that cannot bank its study should pass
  // quietly, not crash.
  const row = campaign.research?.schools?.[focus]
  if (!row) return []
  row.points += gained

  // A turn's study may carry a school more than one rung when the bank is fat
  // enough — the loop is what makes a school reopened after a long detour catch
  // up in one turn rather than one level a turn for three turns.
  const entries = []
  while (row.level < RESEARCH_MAX_LEVEL && row.points >= nextLevelCost(row.level)) {
    row.points -= nextLevelCost(row.level)
    row.level += 1
    entries.push(
      `Your mages master ${SPELL_SCHOOL_TEXT[focus]} to the ${ordinal(row.level)} degree.`,
    )
  }
  // At the ceiling there is nothing left to buy, so the bank stops growing
  // rather than accumulating points no level will ever spend.
  if (row.level >= RESEARCH_MAX_LEVEL) row.points = 0
  return entries
}

const ORDINALS = [
  'first', 'second', 'third', 'fourth', 'fifth',
  'sixth', 'seventh', 'eighth', 'ninth',
]
const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`

// ── What the engine is told ─────────────────────────────────────────────────

// The player's school levels as the engine's `magic.<side>.schools` object.
export const schoolLevels = (campaign) =>
  Object.fromEntries(SPELL_SCHOOLS.map((s) => [s, schoolOf(campaign, s).level]))

// S2-8: the army-wide channel pool, counting ONLY THE SQUADS ON THE FIELD.
//
// This is decision 16's long-deferred answer made concrete — THE BASIC BANNER'S
// BENEFIT IS ITS CHANNEL. A banner sitting in camp channels nothing, so a
// two-squad raid draws on less than the whole army: "army-wide" (M-11) means
// not per-squad, never regardless of presence, and carrying your bannered
// charters becomes a real decision.
//
// The tier comes off services/items.js bannerTier(), so a retuned rank ladder
// moves the pool with it and no second mechanism has to be kept in step. The
// pool is set at battle start, drained by the engine and never persisted, which
// is why none of this needs a schema field.
export const channelsForSquads = (squads = []) =>
  [...squads].reduce((sum, squad) => sum + (CHANNELS_BY_BANNER_TIER[bannerTier(squad)] ?? 0), 0)

// The player's half of the engine's top-level `magic` block. `squads` is the
// charters actually TAKING THE FIELD — the caller has them in hand either way,
// and passing them in is what keeps "only the fielded squads count" true for a
// raid party as well as for the pitched battle.
export const playerMagic = (campaign, squads = []) => ({
  schools: schoolLevels(campaign),
  channels: channelsForSquads(squads),
})

// The host's half (S2-9): one sealed number per encounter, read off the
// document where it was written at creation. Falls back to the authored
// constants for a campaign that predates the field — the same degrade-safely
// convention the rest of this module uses.
export const enemyMagic = (campaign) => ({
  schools: { ...ENEMY_SCHOOLS, ...(bagToObject(campaign?.enemy?.magic?.schools) ?? {}) },
  channels: campaign?.enemy?.magic?.channels ?? ENEMY_CHANNELS,
})

const bagToObject = (bag) => {
  const entries = bagEntries(bag)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

// The whole block, both sides. The player is BLUE and the host is RED
// (backend/server/src/BattleServer.cpp) — the one place that mapping is written
// campaign-side, so neither battle route has to remember it.
export const magicBlock = (campaign, fieldedSquads = []) => ({
  blue: playerMagic(campaign, fieldedSquads),
  red: enemyMagic(campaign),
})

// ── The focus (S2-12) ───────────────────────────────────────────────────────
//
// Validates and returns a plan; never mutates, so a route can check and apply
// in one call and an error path leaves the document untouched — the same
// contract planEquip and planAttach have.
export const planResearchFocus = (school) => {
  if (typeof school !== 'string' || !SPELL_SCHOOLS.includes(school))
    return { error: 'no such school of magic' }
  return { school }
}
