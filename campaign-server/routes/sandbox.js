import { Router } from 'express'
import UnitType from '../models/unitType.js'
import { getInfo } from '../services/engine.js'
import { spreadPlacement } from '../services/enemyPlacement.js'
import { runAndPersistSandboxBattle } from '../services/battleRunner.js'
import { userExtractor } from '../middleware/auth.js'
import { castableSpellsForLevels, isCasterType } from '../services/magic.js'
import { getSpellCatalog } from '../utils/spellCatalog.js'
import {
  CASTER_CHARACTER_TYPES,
  DECLARED_CASTER_PATH,
  ENEMY_CHANNELS,
  ENEMY_SCHOOLS,
  MAP_NAME,
  SANDBOX_MAX_CHANNELS,
  SANDBOX_MAX_PATH_LEVEL,
  SANDBOX_MAX_RUNS,
  SANDBOX_MAX_SCHOOL_LEVEL,
  SANDBOX_MAX_UNITS_PER_SIDE,
  SPELL_PATHS,
  SPELL_PATH_TEXT,
  SPELL_SCHOOLS,
  SPELL_SCHOOL_TEXT,
} from '../utils/campaignConfig.js'

// THE BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE", slice S1).
//
// A free-standing battle composed entirely by hand: both armies, both sides of
// the field, no campaign involved (SB-1). That is what makes it able to reach
// the fights the campaign cannot hand you — a battlefield enchantment needs
// Enchantment 2 while the host is sealed at 1, so no encounter can currently
// field one at all — and it is why this router touches no campaign document.
//
// It also means the lab CANNOT leak campaign state or undermine recon: the
// player composes the hypothetical enemy himself, so what he sees here is his
// own hypothesis, never the real host's numbers.
//
// Every route needs a login (SB-2): a launch spawns an engine subprocess, and
// this is the one route where the caller names how much work that subprocess
// does. The size cap is the other half of that guard.
const router = Router()

// The lab's zones, straight from the engine's own `info` — the same two the
// campaign deploys into. `blue` is the player's near edge, `red` the far one.
const zoneFor = (info, side) => (side === 'red' ? info.enemyZone : info.playerZone)

// Name → hex-packing size for EVERY type, not just the placeable ones: the lab
// composes from the full catalog (SB-1), so it must be able to weigh a
// Necromancer or a Scorpion, which `info.units` does not list.
const sizeCatalog = async () => {
  const types = await UnitType.find({}).select('name size')
  return new Map(types.map((t) => [t.name, t.size]))
}

// A {key: level} bag rebuilt KEY BY KEY from a fixed vocabulary — the same
// by-construction discipline the placement whitelist below follows, applied to
// the two bags S2 lets the client name (a caster's paths, a side's schools).
//
// The walk is over the VOCABULARY, never over the client's own keys: an unknown
// key is not "rejected" so much as never looked at, which is the version of the
// guard that cannot be forgotten when the engine grows an eleventh path. Values
// are truncated, clamped into the engine's own 0..9 range, and dropped outright
// when they are not finite — `Number('lots')` is NaN, and NaN on the wire is
// `null` in JSON, which the engine would read as a level it never checks.
const levelBagFrom = (bag, vocabulary, max) => {
  const source = bag && typeof bag === 'object' && !Array.isArray(bag) ? bag : {}
  const out = {}
  for (const key of vocabulary) {
    if (source[key] === undefined || source[key] === null) continue
    const level = Math.trunc(Number(source[key]))
    if (!Number.isFinite(level)) continue
    out[key] = Math.min(max, Math.max(0, level))
  }
  return out
}

// A caster's script: ordered spell ids, and POSITION IS PRIORITY (S4-1), so the
// order the client sent is the one thing here that must survive untouched.
//
// Every id is checked against the engine's own roster rather than against a
// list kept here — the catalog is what the engine will actually be asked to
// cast, and an id it does not know is a line the caster could only ever skip.
// Duplicates are dropped rather than refused, exactly as planChosenSpells'
// campaign-side twin treats them as a mistake with an obvious repair.
const sanitizeScript = (script) => {
  if (!Array.isArray(script)) return []
  const known = new Set(getSpellCatalog().map((row) => row.spell))
  const out = []
  for (const id of script) {
    if (typeof id !== 'string' || !known.has(id) || out.includes(id)) continue
    out.push(id)
  }
  return out
}

// One placement entry, rebuilt from scratch rather than passed through. The
// body is untrusted (SECURITY_NOTES.md), and the engine reads fields — squad
// ids, character ids, caster paths — that mean things in the campaign layer
// that they must not be allowed to mean here. Whitelisting by CONSTRUCTION is
// the version of that guard which cannot be forgotten when a field is added.
//
// S2 adds the caster fields (paths and scripts) to this whitelist deliberately,
// one at a time, which is exactly the review this shape is meant to force. Two
// rules govern the pair, and both are about what ABSENCE means:
//
//   • only a CASTER carries them. `paths` and `script` mean nothing to the
//     engine on a Soldier, and a bag of zeros on a body that can cast nothing
//     is a field claiming a decision nobody made.
//   • an EMPTY field is omitted, never sent as `{}` or `[]`. Absence is the
//     engine's own default (SB-7): no `script` is the default walk (E-3), and
//     no `paths` leaves the engine's constructor seeding alone — a Mage keeps
//     his Fire 1. An empty bag would OVERWRITE that seed with nothing and hand
//     back a mute mage, so "I did not configure this one" has to travel as
//     silence for the lab's default to be the game's own choice.
const sanitizeEntry = (entry) => {
  const unitType = String(entry?.unit_type ?? '')
  const base = {
    unit_type: unitType,
    q: Math.trunc(Number(entry?.q)),
    r: Math.trunc(Number(entry?.r)),
  }
  if (!isCasterType(unitType)) return base

  const paths = levelBagFrom(entry?.paths, SPELL_PATHS, SANDBOX_MAX_PATH_LEVEL)
  const script = sanitizeScript(entry?.script)
  return {
    ...base,
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
    ...(script.length > 0 ? { script } : {}),
  }
}

// The top-level `magic` block, one side at a time (D1: the lab holds one per
// SIDE, not just for the enemy — SB-8 named the enemy because that was the ask,
// but the lab composes both armies and SB-5's "anything goes" is per side).
//
// Same absence rule as the entry above, one layer up: a side the client did not
// send is omitted, and an omitted side leaves the ENGINE'S defaults standing —
// every school at SPELL_SCHOOL_OPEN_DEFAULT and no pool. That is what makes the
// lab's own default ("all nine, zero channels") reproduce today's behaviour
// exactly rather than quietly closing a door the moment the block appears.
const sanitizeSideMagic = (block) => {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null
  const out = {}
  const schools = levelBagFrom(block.schools, SPELL_SCHOOLS, SANDBOX_MAX_SCHOOL_LEVEL)
  if (Object.keys(schools).length > 0) out.schools = schools
  const channels = Math.trunc(Number(block.channels))
  if (Number.isFinite(channels))
    out.channels = Math.min(SANDBOX_MAX_CHANNELS, Math.max(0, channels))
  return Object.keys(out).length > 0 ? out : null
}

const sanitizeMagic = (magic) => {
  const out = {}
  for (const side of ['blue', 'red']) {
    const block = sanitizeSideMagic(magic?.[side])
    if (block) out[side] = block
  }
  return Object.keys(out).length > 0 ? out : null
}

// Every type isCasterType() accepts, DERIVED rather than listed a second time.
// The two config keys are the whole universe it can say yes to, and running the
// union back through the predicate is what keeps this honest the day a third
// source of casterhood appears: the list cannot drift from the rule, because
// the rule is what filters it.
const CASTER_TYPES = [
  ...new Set([...CASTER_CHARACTER_TYPES, ...Object.keys(DECLARED_CASTER_PATH)]),
].filter(isCasterType)

// Validate one side's placement: an array, within the cap, every type known to
// the catalog and every coordinate a real number. Returns an error STRING (the
// shape the routes turn into a 400) or null.
const placementError = (entries, side, sizes) => {
  if (!Array.isArray(entries)) return `${side}_placement must be an array`
  if (entries.length > SANDBOX_MAX_UNITS_PER_SIDE)
    return `too many units on the ${side} side (${entries.length}; the lab allows ${SANDBOX_MAX_UNITS_PER_SIDE})`
  for (const e of entries) {
    if (!sizes.has(e.unit_type)) return `unknown unit type "${e.unit_type}"`
    if (!Number.isFinite(e.q) || !Number.isFinite(e.r)) return 'placement coordinates must be numbers'
  }
  return null
}

// SB-10's two launch numbers, rebuilt from the body by construction like
// everything else here — they are the one pair a client names that decides how
// much WORK the server does, so neither is ever passed through.
//
// `runs`: truncated and clamped into 1..SANDBOX_MAX_RUNS, with junk falling
// back to a single battle rather than a refusal. Asking for "lots" is a broken
// client, not an attack, and one run is what every launch before S3 meant.
const runCountFrom = (value) => {
  const runs = Math.trunc(Number(value))
  if (!Number.isFinite(runs)) return 1
  return Math.min(SANDBOX_MAX_RUNS, Math.max(1, runs))
}

// `seed`: an integer or nothing at all. Absent, blank and unreadable all mean
// "draw fresh" — the engine's own default — and only a number or the string a
// text field produces is even looked at, since `Number([])` is 0 and an empty
// array is nobody asking for seed zero. A string is TRIMMED first for the same
// reason: `Number(' ')` is 0, and a field holding a space would otherwise seed
// the batch to a single run nobody asked to collapse.
const seedFrom = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const named = typeof value === 'string' ? value.trim() : value
  if (named === '') return null
  const seed = Math.trunc(Number(named))
  return Number.isFinite(seed) ? seed : null
}

// Launch one lab battle. Body is {player_placement, enemy_placement, magic}:
// axial entries, one per BODY, exactly as the campaign's battle route builds
// them, plus S2's per-side school levels and channel pool.
//
// The map is stamped here rather than taken from the body — only
// maps/sample_battle.json exists, so there is nothing to pick between, and a
// map name from the client is a filesystem argument the engine would read.
router.post('/battles', userExtractor, async (req, res) => {
  const sizes = await sizeCatalog()
  const playerPlacement = (Array.isArray(req.body?.player_placement) ? req.body.player_placement : [])
    .map(sanitizeEntry)
  const enemyPlacement = (Array.isArray(req.body?.enemy_placement) ? req.body.enemy_placement : [])
    .map(sanitizeEntry)

  const error =
    placementError(playerPlacement, 'player', sizes) ?? placementError(enemyPlacement, 'enemy', sizes)
  if (error) return res.status(400).json({ error })

  // Both sides empty is a battle with nothing in it; ONE side empty is a
  // legitimate thing to test (does a lone host walk the field? does a garrison
  // survive alone?), so only the pair is refused.
  if (playerPlacement.length === 0 && enemyPlacement.length === 0)
    return res.status(400).json({ error: 'place at least one unit before launching' })

  // Omitted entirely when the client sent nothing usable, rather than sent as
  // an empty object: the engine's defaults are the lab's defaults (SB-7), and
  // the only way to say "leave them alone" on this wire is to say nothing.
  const magic = sanitizeMagic(req.body?.magic)

  // E2, DECIDED HERE rather than in the browser: a seed makes the engine repeat
  // its entire draw sequence, so N seeded runs are N copies of ONE battle — a
  // batch that would report "100% win rate" off a single sample dressed as ten.
  // The seed and the batch answer different questions (SB-10 says so outright),
  // so naming a seed collapses the batch to the one run it can actually
  // produce. The client greying the spinner out is a courtesy; this is the
  // contract.
  const seed = seedFrom(req.body?.seed)
  const runs = seed === null ? runCountFrom(req.body?.runs) : 1

  const { error: engineError, summary, batch } = await runAndPersistSandboxBattle(
    {
      map: MAP_NAME,
      player_placement: playerPlacement,
      enemy_placement: enemyPlacement,
      ...(magic ? { magic } : {}),
    },
    req.user._id,
    { runs, seed },
  )
  if (engineError) return res.status(400).json({ error: engineError })

  // ADDITIVE: the summary is byte-for-byte the one S1 returned — the replay the
  // client already watches is the batch's FIRST run (E1) — and `batch` rides
  // alongside it. A launch of one is a batch of one, so the block is always
  // there and the readout needs no special case for the common launch.
  res.status(201).json({ ...summary, batch })
})

// Auto-place one side's army over its deployment zone (SB-3's per-side button).
// Body is {side: 'blue'|'red', army: {type: count}}; the response is the axial
// placement the client then draws and may edit by hand.
//
// This runs SERVER-side on purpose, through `spreadPlacement` — the very
// function the enemy's daily plan and both sides of a raid already use. Auto
// placement is therefore not new work and, more to the point, cannot drift from
// production: the lab packs hexes to the same capacity rule the real game does,
// so a formation that fits here fits there.
router.post('/auto-place', userExtractor, async (req, res) => {
  const side = req.body?.side === 'red' ? 'red' : 'blue'
  const army = req.body?.army
  if (!army || typeof army !== 'object' || Array.isArray(army))
    return res.status(400).json({ error: 'army must be an object of {unitType: count}' })

  const sizes = await sizeCatalog()
  let total = 0
  for (const [type, count] of Object.entries(army)) {
    if (!sizes.has(type)) return res.status(400).json({ error: `unknown unit type "${type}"` })
    const n = Number(count)
    if (!Number.isInteger(n) || n < 0) return res.status(400).json({ error: `bad count for "${type}"` })
    total += n
  }
  if (total > SANDBOX_MAX_UNITS_PER_SIDE)
    return res.status(400).json({
      error: `too many units on the ${side} side (${total}; the lab allows ${SANDBOX_MAX_UNITS_PER_SIDE})`,
    })

  const info = await getInfo()
  const placement = spreadPlacement(
    army,
    { ...zoneFor(info, side), width: info.grid.width, hexCapacity: info.grid.hexCapacity },
    sizes,
  )

  res.json({ placement })
})

// The lab's STATIC VOCABULARY, in one call (S2). Everything the caster panels
// need to render themselves and nothing that changes between two of them: the
// ten paths and four schools with their player-facing words, the caster types,
// SB-8's preset, and the bounds the spinners clamp to.
//
// PHRASED SERVER-SIDE, like everything else the client renders (17-5) — the lab
// never holds its own copy of "Fire" or "Evocation", so a renamed path is one
// edit in campaignConfig.js and not two.
//
// SB-8'S PRESET READS THE LIVE CONSTANTS. `ENEMY_SCHOOLS`/`ENEMY_CHANNELS` are
// balance-deferred and the balance pass will move them; served from here, the
// button loads whatever the campaign's host is actually sealed with today,
// which is the whole reason the preset was chosen over an authored tier table.
// It reveals nothing about a particular campaign either — these are the
// authored constants every campaign starts from, not one encounter's card.
router.get('/reference', userExtractor, (req, res) => {
  res.json({
    paths: SPELL_PATHS.map((key) => ({ key, label: SPELL_PATH_TEXT[key] })),
    schools: SPELL_SCHOOLS.map((key) => ({ key, label: SPELL_SCHOOL_TEXT[key] })),
    casterTypes: CASTER_TYPES,
    enemyPreset: { schools: { ...ENEMY_SCHOOLS }, channels: ENEMY_CHANNELS },
    limits: {
      maxPathLevel: SANDBOX_MAX_PATH_LEVEL,
      maxSchoolLevel: SANDBOX_MAX_SCHOOL_LEVEL,
      maxChannels: SANDBOX_MAX_CHANNELS,
      // SB-10's batch ceiling, so the runs spinner reads its own bound off the
      // server exactly as every other spinner in the lab does.
      maxRuns: SANDBOX_MAX_RUNS,
      // The same number as maxSchoolLevel, and the same CONSTANT: it is the
      // engine's SPELL_SCHOOL_OPEN_DEFAULT, which is both the top of the scale
      // and the level a side sits at when no magic block is sent. The lab
      // initialises its schools to it so that touching nothing changes nothing.
      openSchoolLevel: SANDBOX_MAX_SCHOOL_LEVEL,
    },
  })
})

// What ONE caster could cast, under his own paths and his side's school levels
// (D3). The picker asks; it does not work it out.
//
// This is the lab's single rules site, and it is the campaign's: the fold is
// `castableSpellsForLevels`, the level-driven half of the very function The
// Study's own picker is built on. A client-side copy would be a second reading
// of M-6's gate, and the two would drift the first time a form grows a
// requirement — which is the mistake M-19 exists to forbid one layer down.
//
// Both bags go through the launch route's own sanitizers, so what the picker is
// answered about is exactly what a launch would send: raise a path here and the
// list grows by the same rule the engine will apply at cast.
//
// No cap and no refusal — SB-5's "anything goes" means a level 9 in a path the
// campaign could never grant is a legitimate question to ask, and the honest
// answer is the longer list.
router.post('/castable', userExtractor, (req, res) => {
  const paths = levelBagFrom(req.body?.paths, SPELL_PATHS, SANDBOX_MAX_PATH_LEVEL)
  const schools = levelBagFrom(req.body?.schools, SPELL_SCHOOLS, SANDBOX_MAX_SCHOOL_LEVEL)
  res.json({ options: castableSpellsForLevels(paths, schools, getSpellCatalog()) })
})

export default router
