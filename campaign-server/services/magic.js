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
  CASTER_CHARACTER_TYPES,
  DECLARED_CASTER_PATH,
  DECLARED_CASTERS_ROLL_SECOND,
  ENEMY_CHANNELS,
  ENEMY_SCHOOLS,
  ENEMY_SCRIPT_STORE,
  HIRE_PATH_POOL,
  HIRE_PRIMARY_LEVEL,
  HIRE_SECOND_PATH_PERCENT,
  MAX_CHOSEN_SPELLS,
  MAX_SHORTLIST_SPELLS,
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
  // A type that is no caster rolls NOTHING — and consumes nothing: a Golem
  // minted at the foundry (C-4) must not eat draws off the shared dice queue
  // a test or a same-day augury is counting on.
  if (!isCasterType(type)) return {}

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
//
// CASTER_CHARACTER_TYPES, not CHARACTER_TYPES: character-hood stopped implying
// casterhood the day the Golem became a character (C-4) — it is minded by
// nothing and commands nothing, and the wire must not offer it paths.
export const isCasterType = (type) =>
  CASTER_CHARACTER_TYPES.includes(type) || Boolean(DECLARED_CASTER_PATH[type])

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

// ── The enemy's scripts (E-7 / E-8) ─────────────────────────────────────────
//
// The host's half of slice 4's chosen spells, and the twin of withCasterPaths
// above: run over a placement that already carries `paths`, it stamps `script`
// onto the casters who qualify for an authored row. The engine receives it in
// exactly the field a player character's list arrives in — there is ONE magic
// system (M-17) and the wire never learns whose list it is holding.
//
// DERIVED, NEVER SEALED (E-8). withCasterPaths sealed because it ROLLS and a
// reload must not reroll; this walk draws nothing — ENEMY_SCRIPT_STORE is
// ordered and the first qualifying row wins — so the same inputs give the same
// scripts every time it runs, and there is nothing to protect from a reload.
// Sealing it would be a schema field carrying a value the code can recompute,
// which is the trade walledSides already settled the other way.

// Whether ANY id on a row names a battlefield form. Caster-independent on
// purpose: it is a property of the ROW (what the once-per-composition rule
// below counts), not of who happens to qualify for it.
const carriesBattlefield = (row, spells) =>
  row.spells.some((id) => spells.some((form) => form.spell === id && form.battlefield))

// Can this enemy caster cast this SPELL — at least one of its forms, under the
// encounter's sealed numbers? The fold castableSpellsFor does for the player,
// asked as a yes/no: forms are per-form rows and a spell is reachable when any
// one of them is.
//
// THE POOL IS THE LOCK (E-8). A battlefield form the sealed `channels` cannot
// cover is not a form this encounter has, so it is skipped here rather than
// checked after the fact — which is the same gate the engine applies at cast
// (it qualifies on the pool in full), read one layer earlier so a script that
// could only ever fizzle is never handed out.
const enemyCanCast = (held, spellId, spells, schoolLevelOf, channels) =>
  spells.some((form) => form.spell === spellId
    && !(form.battlefield && (form.poolCost ?? 0) > channels)
    && formQualifies(held, form, schoolLevelOf))

// `magic` is the enemy block enemyMagic() builds — {schools, channels} — and is
// the ONLY source of school levels here: the enemy's research is the encounter
// (E-7), so a caster's row is judged against what the host was sealed with and
// never against the player's study. `store` is injectable for the same reason
// `rand` is elsewhere: a test pins the rows it is talking about.
export const withEnemyScripts = (placement, magic, spells = [], store = ENEMY_SCRIPT_STORE) => {
  const levels = levelBag(magic?.schools)
  const schoolLevelOf = (school) => levels.get(school) ?? 0
  const channels = Number(magic?.channels) || 0
  const battlefieldRow = new Map(store.map((row) => [row.id, carriesBattlefield(row, spells)]))

  // ONE GLOBAL PER SIDE PER PASS (E-8, the user's "only 1 mage should have it
  // scripted"): a second caster carrying the same enchantment is a wasted line
  // (E-4 — the second completion fizzles unpaid), so the walk simply refuses to
  // hand a battlefield row out twice and the runner-up drops to the next row he
  // qualifies for. Ordinary rows repeat freely; nothing is lost by two casters
  // both raising skeletons. This is the campaign layer applying to its own
  // authoring the warning alsoScriptedBy only PHRASES for the player.
  let battlefieldTaken = false

  return placement.map((entry) => {
    if (!isCasterType(entry.unit_type)) return entry
    const held = levelBag(entry.paths)
    for (const row of store) {
      const isBattlefield = battlefieldRow.get(row.id)
      if (isBattlefield && battlefieldTaken) continue
      // EVERY spell on the row, or the row is not his: a partial match would
      // field a caster reaching for something he cannot cast, and the walk has
      // a next row for him.
      if (row.spells.length === 0) continue
      if (!row.spells.every((id) => enemyCanCast(held, id, spells, schoolLevelOf, channels))) continue
      if (isBattlefield) battlefieldTaken = true
      // The row's SHORTLIST (A-7), held to the same test its script is: an id
      // this caster cannot cast under the encounter's sealed numbers is not a
      // line he could ever draw, so it is dropped here rather than handed over
      // to be skipped later. Unlike the script, a partial match is fine — a
      // shortlist is a fence and a narrower one is still a fence, where a
      // script is an order that must be castable in full.
      //
      // Filtered to nothing means the field is OMITTED, not sent empty: absence
      // is the signal on both lists, and for the shortlist absence means the
      // whole castable roster rather than silence (A-7).
      const shortlist = (row.shortlist ?? []).filter(
        (id) => enemyCanCast(held, id, spells, schoolLevelOf, channels),
      )
      return {
        ...entry,
        script: [...row.spells],
        ...(shortlist.length > 0 ? { shortlist } : {}),
      }
    }
    // ABSENCE IS THE SIGNAL, the chosenSpells convention: a caster who matches
    // nothing is sent no `script` key at all, which the engine reads as the
    // default walk — not an empty list that would have to mean the same thing.
    return entry
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
//
// The ONE exception, and it is a spend rather than a location (Construction
// slice C1, C-6): a mage who FORGED this fortnight is excluded, so his
// RESEARCH_POINTS_PER_MAGE simply never arrive that day. That is the research
// half of forging's price — the bank is never debited, and no second thing
// about WHERE he is enters the rate (C-1 keeps forging location-blind too).
export const researchingMages = (campaign) =>
  livingCharacters(campaign).filter(
    // A stamp only counts when it is a REAL day matching this one — `!=` on
    // null covers undefined too, so a skeleton campaign with no `day` at all
    // (the structural tests') keeps every mage studying.
    (c) => c.type === 'Mage' && !(c.forgedDay != null && c.forgedDay === campaign?.day),
  ).length

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

// ── The battlefield enchantments (slice A, E-2/E-3) ─────────────────────────

// A battlefield form is single-form, costs its `poolCost` IN FULL out of the
// army-wide banner channel pool (E-2 — the pool is the only cost, and there is
// no new resource behind it), takes hold once per side per battle (E-4), and
// never enters the default walk: only a chosen-spells line fires one (E-3).
//
// Four facts, one sentence, written HERE because the server phrases every row
// and the client composes nothing (17-5). Built off the row's own poolCost, so
// a retuned price moves the sentence with it.
const poolLineFor = (row) =>
  row?.battlefield === true
    ? `Draws ${row.poolCost ?? 0} from the army's pool — once per battle, and only when scripted.`
    : null

// The two new fields as a row wears them across the wire. `battlefield` is
// normalised to a real boolean and `poolCost` to a real number so a catalog
// that predates the fields reads as "an ordinary spell" rather than as
// undefined, and the client never has to test for absence.
const poolFieldsOf = (row) => {
  const poolLine = poolLineFor(row)
  return {
    battlefield: row?.battlefield === true,
    poolCost: row?.poolCost ?? 0,
    // Absent on an ordinary spell rather than null: there is no sentence to
    // print, and a row with no pool involvement should carry no pool line.
    ...(poolLine ? { poolLine } : {}),
  }
}

// ── What the player is shown (slice 3, S3-1/S3-2/S3-6) ──────────────────────

// The roster grouped under the four schools, each row carrying its gates.
//
// THE GRANTED PATHS ARE FILTERED OUT HERE (S3-2). A pure-Holy or pure-Unholy
// form exports `school: null` from the engine — the whole roster crosses the
// wire and deciding who shows what is the reader's business — and The Study is
// about research, which those two are not part of (M-14). They wait for slice
// 4's scripting, where a Priest's repertoire is the point.
//
// UNLOCKED IS THE SCHOOL GATE ALONE (S3-6). M-6 splits the two gates: the ARMY
// researches the school, the individual caster meets the path level. So a row
// says what it requires and stops there — it does not go looking through the
// roster for somebody who could cast it. The player reads their casters' paths
// on the character sheet, which is the screen that owns people.
//
// Rows keep the engine's order, which is the roster's own: minor before major
// within a spell (weakest first, the order chooseSpellToCast walks), so a school
// reads as a ladder rather than an alphabetised list.
export const spellsForSchool = (spells, school, level) =>
  spells
    .filter((row) => row.school === school)
    .map((row) => ({
      spell: row.spell,
      form: row.form,
      label: row.label,
      // Revealed when the player expands the row (S3-4); the menu shows the
      // label alone. Authored engine-side beside the constants it quotes, and
      // passed through untouched — this layer phrases what it owns, not this.
      description: row.description,
      // ORDERED, primary first (M-20), and PHRASED like pathEntries above: the
      // client joins {label, level} atoms and holds no vocabulary of its own.
      requires: (row.paths ?? []).map(({ path, level: needed }) => ({
        path,
        label: SPELL_PATH_TEXT[path] ?? path,
        level: needed,
      })),
      schoolLevel: row.schoolLevel,
      unlocked: level >= row.schoolLevel,
      fatigue: row.fatigue,
      castingTime: row.castingTime,
      // A battlefield row's price is not its fatigue (E-2), so the Study says
      // so on the row itself — phrased here, printed verbatim there.
      ...poolFieldsOf(row),
    }))

// The whole research block campaignView ships, schools and spells together.
//
// All four schools always appear, Construction included — it holds no spells
// yet (M-9 shipped it hollow for crafting, which has its own interview pending)
// and it is shown and focusable exactly like the other three (S3-5). An empty
// school is the honest shape of the system, not a special case to hide.
export const researchView = (campaign, spells = []) => ({
  focus: campaign?.research?.focus ?? null,
  allies: campaign?.research?.allies ?? 0,
  // What this turn's study will add (S2-6) — mages plus lent allies, the same
  // number accrueResearch banks at end of turn, so the screen cannot disagree
  // with what actually lands.
  rate: researchRate(campaign),
  schools: Object.fromEntries(
    SPELL_SCHOOLS.map((school) => {
      const { level, points } = schoolOf(campaign, school)
      return [school, {
        label: SPELL_SCHOOL_TEXT[school],
        level,
        points,
        // What the NEXT level costs, off the one place that arithmetic lives.
        // At the ceiling there is nothing left to buy and the bank is held at
        // 0 by grantResearchPoints, so this is null rather than a price for a
        // level that cannot be bought.
        nextCost: level >= RESEARCH_MAX_LEVEL ? null : nextLevelCost(level),
        spells: spellsForSchool(spells, school, level),
      }]
    }),
  ),
})

// ── Chosen spells (slice 4) ─────────────────────────────────────────────────

// Can THIS caster cast THIS form today? Both gates a spell passes (M-9), read
// campaign-side: every path requirement against his own rolled levels, and the
// school requirement against the army's research.
//
// A school-less form (Holy/Unholy, M-14) passes the second gate outright, which
// is what puts `bless` on a Priest's sheet from day one — the first screen in
// the project to name a granted path's spell at all (S3-2 kept them off The
// Study deliberately, because they are had rather than earned).
//
// SPLIT IN TWO for E-7, and the split IS M-19: the gates are identical for both
// sides and only the SOURCE of the school number differs. `formQualifies` is
// that one predicate — a caster's held paths, a catalog form, and a function
// saying what level the side has in a school — and the enemy's script matching
// passes it the encounter's sealed numbers where this passes it the player's
// research. Copying the loop instead would be two readings of one rule, which is
// exactly what M-19 exists to forbid. Both live HERE, beside the gate they were
// cut out of, and withEnemyScripts reaches back up the file for them.

// Named for what it holds rather than for paths alone: a {key: level} bag,
// numeric and defaulted. Both gates read one — a caster's paths here, and a
// side's four schools where withEnemyScripts above reads the sealed block.
const levelBag = (bag) =>
  new Map(bagEntries(bag).map(([k, lvl]) => [k, Number(lvl) || 0]))

const formQualifies = (held, row, schoolLevelOf) => {
  for (const { path, level } of row.paths ?? [])
    if ((held.get(path) ?? 0) < level) return false
  if (row.school == null) return true
  return schoolLevelOf(row.school) >= (row.schoolLevel ?? 0)
}

// The spells this caster can cast RIGHT NOW, one row per SPELL (S4-2/S4-3).
//
// The catalog is one row per FORM, so the fold is the work: a spell is offered
// when he qualifies for at least one of its forms, and the row wears the label
// and description of the STRONGEST one he qualifies for — which is exactly what
// the engine would cast for him (M-13). So a Fire 1 mage is offered "Ember" and
// the same row becomes "Fireball" when he reaches Fire 3, without the choice he
// made ever needing to be re-made: the ID under it never changed.
//
// Forms arrive weakest-first (the roster's own order, which chooseSpellToCast
// relies on), so the last qualifying one wins.
//
// TAKEN IN LEVELS, NOT IN CAMPAIGN STATE (S2 of the battle lab). The fold needs
// exactly two bags — what the caster holds and what his SIDE has open — and a
// campaign is only ever one way of producing the second. The battle lab has no
// campaign at all (SB-1) and still has to answer "what can this man cast", so
// the rule lives here in the form that has no campaign in it and
// castableSpellsFor below is the campaign's way of asking. One rules site, two
// callers — the same shape M-19 forced on formQualifies one layer down.
export const castableSpellsForLevels = (paths, schoolLevels, spells = []) => {
  const held = levelBag(paths)
  const levels = levelBag(schoolLevels)
  const schoolLevelOf = (school) => levels.get(school) ?? 0

  const rows = new Map()
  for (const row of spells) {
    if (!formQualifies(held, row, schoolLevelOf)) continue
    rows.set(row.spell, {
      spell: row.spell,
      label: row.label,
      description: row.description,
      // Off the WINNING form, like the label and the description above: a
      // battlefield spell is single-form today (E-3), but the fields are read
      // here rather than off the spell so the strongest-form rule keeps
      // owning them the day a battlefield spell grows a second form.
      ...poolFieldsOf(row),
    })
  }
  return [...rows.values()]
}

// The campaign's way of asking the above: his paths against the four schools
// his army's research has opened. `schoolLevels` is the same projection the
// engine's `magic.blue.schools` is built from, so what The Study offers and
// what the engine will actually let him cast are read off one number.
export const castableSpellsFor = (character, campaign, spells = []) =>
  castableSpellsForLevels(character?.paths, schoolLevels(campaign), spells)

// Who ELSE is carrying this battlefield spell in his own script (E-4/E-5).
//
// Once per side per BATTLE means a second completion fizzles unpaid, so two
// casters scripted with the same enchantment is a wasted line rather than a
// double effect. That is worth SAYING and not worth refusing (E-2/E-3: the
// engine's once-per-side rule is the backstop, and a script is a preference
// that a caster may never reach anyway) — so this returns a sentence, and
// planChosenSpells goes on accepting the list.
//
// The dead are skipped through livingCharacters, the one place "who can still
// do something" is decided (5-9 keeps a fallen caster on the rolls), and so is
// anyone who is no caster at all — a script left on a body that cannot cast is
// not a clash with anybody.
const alsoScriptedBy = (character, campaign, spellId) => {
  const others = livingCharacters(campaign).filter(
    (c) => c.id !== character?.id
      && isCasterType(c.type)
      && (c.script ?? []).includes(spellId),
  )
  if (others.length === 0) return null

  // Named, because the player's next move is to go and change one of the two
  // scripts and he needs to know whose. Past the first the names stop earning
  // their length, so the rest are counted.
  const [first, ...rest] = others
  const who = rest.length === 0
    ? `${first.name} has`
    : `${first.name} and ${rest.length} other${rest.length === 1 ? '' : 's'} have`
  return `${who} this scripted too — it can only take hold once per battle.`
}

// What the character sheet renders for "Chosen spells" (S4-7, S4-9).
//
// The server phrases every row and the client composes no sentence (17-5), so
// the slots arrive already resolved: a chosen id the caster can no longer be
// offered would appear as a label-less row, and cannot — paths are fixed at
// hire and school levels only rise, so a saved choice stays castable for good.
export const chosenSpellsView = (character, campaign, spells = []) => {
  const castable = castableSpellsFor(character, campaign, spells)
  const byId = new Map(castable.map((row) => [row.spell, row]))
  // A clash is only possible where the effect is army-wide and once-per-side
  // (E-4), so an ordinary spell two casters both scripted is not remarked on:
  // both of them casting it is the point.
  const withWarning = (row) => {
    if (!row.battlefield) return row
    const warning = alsoScriptedBy(character, campaign, row.spell)
    return warning ? { ...row, warning } : row
  }
  return {
    max: MAX_CHOSEN_SPELLS,
    // Compacted, never sparse: position IS priority (S4-1), so an id that
    // somehow resolves to nothing is dropped rather than left as a hole.
    chosen: (character?.script ?? []).map((id) => byId.get(id)).filter(Boolean).map(withWarning),
    // Everything he could reach for, chosen or not — the picker shows the whole
    // list and marks what is already taken, rather than shrinking as slots fill.
    options: castable.map(withWarning),
  }
}

// Validate a proposed list against the caster and the day (S4-3).
//
// Returns `{ error }` for a refusal or `{ script }` for the list to store,
// following the plan/apply shape every other mutation in this layer uses. The
// list REPLACES what was there; there is no per-slot route, so a set is
// idempotent and a clear is just a shorter list.
export const planChosenSpells = (character, campaign, spells, ids) => {
  if (!Array.isArray(ids)) return { error: 'script must be an array of spell ids' }
  if (ids.length > MAX_CHOSEN_SPELLS)
    return { error: `a caster may choose at most ${MAX_CHOSEN_SPELLS} spells` }
  if (new Set(ids).size !== ids.length)
    return { error: 'the same spell cannot be chosen twice' }

  const castable = new Set(castableSpellsFor(character, campaign, spells).map((r) => r.spell))
  for (const id of ids)
    if (!castable.has(id)) return { error: `${character.name} cannot cast ${id}` }

  return { script: [...ids] }
}

// ── The shortlist (the casting AI, A-7) ─────────────────────────────────────
//
// The script's sibling: what the caster improvises from once his opening
// sequence is walked. Everything below MIRRORS the two functions above, because
// it is the same subject read a second way — one castable list, one cap, one
// plan/apply shape — and the two differences are the whole of what a shortlist
// IS:
//
//   • it is UNORDERED. Position is priority in a script (S4-1/A-6); here the
//     engine draws by weighted lottery over the scorer's own numbers (A-2), so
//     there is nothing for an order to mean.
//   • it OFFERS NO BATTLEFIELD SPELL. A global is script-only (E-3) — it takes
//     hold once per side and is cast because it was ordered, never because a
//     lottery happened to name it — so the fence must not be able to contain
//     one. Filtered out of the OPTIONS as well as refused by the plan, because
//     a picker that offers a click the server refuses is a worse bug than the
//     refusal it hides.
//
// The absence rule is the third thing they share and the one A-7 turns on: an
// empty shortlist is not a mute caster but the whole castable roster.

// What the lottery may legally be fenced to: everything he can cast that is not
// a script-only global. One function because the view and the plan must not be
// able to disagree about it — that disagreement is exactly the bug above.
const shortlistableFor = (character, campaign, spells) =>
  castableSpellsFor(character, campaign, spells).filter((row) => !row.battlefield)

// What the character sheet renders for "Shortlist", beside the three slots.
//
// The same row shape chosenSpellsView ships, so the sheet renders one kind of
// spell row and holds no second vocabulary — minus the clash warning, which
// belongs to battlefield spells and there are none here by construction.
//
// `line` is the server's sentence and the client composes nothing (17-5). It
// says what an EMPTY list does, because that is the one thing about this
// control a player cannot guess from looking at it.
export const shortlistView = (character, campaign, spells = []) => {
  const options = shortlistableFor(character, campaign, spells)
  const byId = new Map(options.map((row) => [row.spell, row]))
  return {
    max: MAX_SHORTLIST_SPELLS,
    // Resolved through the same map the options come from, so an id that can no
    // longer be offered is dropped rather than drawn as a label-less row — the
    // chosen-spells convention, and it cannot happen for the same reason.
    chosen: (character?.shortlist ?? []).map((id) => byId.get(id)).filter(Boolean),
    options,
    line: `Left empty, ${character?.name ?? 'he'} may reach for anything he can cast.`,
  }
}

// Validate a proposed shortlist. `{ error }` or `{ shortlist }`, the plan/apply
// shape every mutation in this layer uses, and the list REPLACES what was there.
export const planShortlist = (character, campaign, spells, ids) => {
  if (!Array.isArray(ids)) return { error: 'shortlist must be an array of spell ids' }
  if (ids.length > MAX_SHORTLIST_SPELLS)
    return { error: `a caster may be shortlisted at most ${MAX_SHORTLIST_SPELLS} spells` }
  if (new Set(ids).size !== ids.length)
    return { error: 'the same spell cannot be shortlisted twice' }

  const allowed = new Set(shortlistableFor(character, campaign, spells).map((r) => r.spell))
  for (const id of ids) {
    if (allowed.has(id)) continue
    // Two refusals, one phrase each, because they are different mistakes: a
    // spell he cannot cast at all, and one he can cast but only on your order.
    const castable = castableSpellsFor(character, campaign, spells).some((r) => r.spell === id)
    return castable
      ? { error: `${id} is cast only when it is scripted` }
      : { error: `${character.name} cannot cast ${id}` }
  }

  return { shortlist: [...ids] }
}

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
