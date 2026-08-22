import {
  FOOD_KG_PER_SIZE_SQ_PER_DAY,
  DAYS_PER_TURN,
  RECON_LEVEL_THRESHOLDS,
  RAID_CAPACITY_SPEED_SCALE,
  BASELINE_ACCURACY,
  ACCURACY_PER_BALLISTIC,
  RAID_STRENGTH_BANDS,
  RAID_PRESTIGE_JOIN_PER_BAND,
  RAID_PRESTIGE_WIN_PER_BAND,
  SQUAD_RANKS,
} from './campaignConfig.js'

// Campaign-layer unit capabilities, DERIVED from the engine-exported combat
// stats (unittypes collection, i.e. `./game dump-units`). Nothing here is
// hand-maintained per unit type: a future Flyer or new skirmisher gets its
// scouting/foraging role purely from its stats, keeping the C++ constructors
// the single source of truth.
//
// Scales: speed is the engine's movement-points-per-tick stat (2026-07-14
// movement rework): 10 = foot, 18 = giant scorpion, 28 = horse/cavalry.
// ballisticSkill is on the melee-attack scale: 10 = trained archer,
// 1 = animal with no ranged sense. All multipliers are tuning knobs.

// The recon/forage/screen formulas below were tuned on the old 1–3
// hexes-per-tick speed scale, so they normalize engine speed through this
// ONE seam (10 points = 1.0 foot-speed) instead of each inventing its own
// conversion. Retuning them to exploit the finer granularity is deferred.
// raidCapacityCost is the exception: its 40-point scale was designed for
// raw movement points — see its comment.
const SPEED_POINTS_PER_FOOT = 10
const speedFactor = (stats) => stats.speed / SPEED_POINTS_PER_FOOT

// Field points a single unit contributes (Stage 4 Part 2.5, renamed + widened
// under the effort slider — docs/CAMPAIGN_PLAN.md "Effort slider" decision 1):
// accuracy × mobility, plus the signed reconTag, on a scale where a baseline
// human (accuracy 10, foot speed, reconTag 0) is worth 1.0. accuracy =
// ballisticSkill × ACCURACY_PER_BALLISTIC (the engine derives the same; the
// catalog exports ballisticSkill). An ABSOLUTE per-unit worth, summed raw into
// the turn's ONE points pool, which the effort slider then splits between
// foraging and scouting — nothing here decides which track a unit feeds.
export const fieldPointValue = (stats) =>
  ((stats.ballisticSkill * ACCURACY_PER_BALLISTIC) / BASELINE_ACCURACY) * speedFactor(stats) +
  stats.reconTag

// The army's per-turn field-points pool: Σ count·fieldPointValue — a RAW sum
// (a bigger or sharper-eyed force generates more), kept fractional (the pool
// never rounds). Snapshotted once at newDay (campaign.forage.pool) and split
// by the effort slider for the rest of the turn. Unknown types contribute
// nothing (safe-degrade guard: routes validate, this only degrades).
export const fieldPointsFor = (army, catalog) => {
  const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
  let points = 0
  for (const [type, count] of entries) {
    const unitType = catalog.get(type)
    if (unitType) points += count * fieldPointValue(unitType.stats)
  }
  return points
}

// Band order, weakest eyes first — reveal tiers (campaignView's enemy view)
// compare a band's rank against this ladder. Index === recon level.
export const SCOUTING_BANDS = ['Blind', 'Outmatched', 'Contested', 'Superior', 'Overwhelming']

// Recon rework (docs/CAMPAIGN_PLAN.md): the scouting level is driven by
// accumulated leftover scouting points (campaign.recon.points), NOT a passive
// troop-coverage ratio. `reconLevel` counts how many RECON_LEVEL_THRESHOLDS the
// points have crossed (0 = Blind, up to SCOUTING_BANDS.length − 1 = Overwhelming);
// `reconBand` maps that to the band label the reveal tiers, forage posture, and
// recon-sensitive event rungs all read. This band is the ONLY scouting fact
// allowed across the hidden-info boundary (a raw point count would leak nothing
// about the enemy, but the band is what the reveal tiers key off).
export const reconLevel = (points) => {
  let level = 0
  for (const threshold of RECON_LEVEL_THRESHOLDS) {
    if ((points ?? 0) >= threshold) level += 1
    else break
  }
  return Math.min(level, SCOUTING_BANDS.length - 1)
}

export const reconBand = (points) => SCOUTING_BANDS[reconLevel(points)]

// Raid party budget cost of ONE unit (Stage 4 Part 2): size × (40 − speed) /
// RAID_CAPACITY_SPEED_SCALE — the user's formula (2026-07-13), kept literally.
// Deliberately uses RAW movement points: the 40-point scale was designed for
// the movement-speed rework (2026-07-14, speeds 10–28), which is what makes
// the speed term meaningful — foot costs 3/4 of its size, a rider 3/10.
export const raidCapacityCost = (stats, size) =>
  Math.max(0, (size * (RAID_CAPACITY_SPEED_SCALE - stats.speed)) / RAID_CAPACITY_SPEED_SCALE)

// Screening (protecting foragers / countering enemy harassment): armoured,
// dangerous, and mobile enough to intercept — heavy cavalry's specialty.
// Armour weighs fully so heavy cavalry (armour 5) beats light (armour 2)
// while both ride the same horse.
export const screenValue = (stats) =>
  stats.armour + Math.floor(stats.attack / 6) + speedFactor(stats)

// Food need in kg per TURN (one turn = DAYS_PER_TURN days of campaigning):
// size² × FOOD_KG_PER_SIZE_SQ_PER_DAY × DAYS_PER_TURN. Size lives on the
// unit type root, not in stats, so this takes the size directly.
export const foodPerTurn = (size) =>
  size * size * FOOD_KG_PER_SIZE_SQ_PER_DAY * DAYS_PER_TURN

// Total kg/turn for an army ({type: count} object or Map), given a catalog
// Map of name → unit type doc. Unknown types eat as a size-10 human — the
// roster is validated at the mutating routes, so this is only a guard.
export const armyFoodPerTurn = (army, catalog) => {
  const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
  let total = 0
  for (const [type, count] of entries)
    total += count * foodPerTurn(catalog.get(type)?.size ?? 10)
  return Math.ceil(total)
}

// ── Squad prestige (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL") ────
// A squad's prestige is a PERMANENT rank that gates its upgrades and is never
// spent. These are the pure derivations; the award is applied in the raid
// route, and nothing reads the rank for gating yet (slice 1 earns and keeps it).

// How much a raid's strength band is worth, 1 (weakest) .. N (strongest).
// RAID_STRENGTH_BANDS is ordered STRONGEST FIRST, so the weight is the reverse
// index — derived rather than a second hardcoded table, so adding a band cannot
// silently leave its weight behind. An unknown label is worth 0 rather than
// throwing: a band that has left the table must not be able to 500 a raid that
// otherwise resolved fine.
export const raidBandWeight = (label) => {
  const i = RAID_STRENGTH_BANDS.findIndex((b) => b.label === label)
  return i < 0 ? 0 : RAID_STRENGTH_BANDS.length - i
}

// Prestige a squad earns for one raid. Winning REPLACES the participation
// award — it does not stack on top of it — so the win rate is the whole payout
// for a won raid.
export const raidPrestige = (strengthBand, won) =>
  raidBandWeight(strengthBand) *
  (won ? RAID_PRESTIGE_WIN_PER_BAND : RAID_PRESTIGE_JOIN_PER_BAND)

// The rank word for a cumulative prestige total. First match down a
// strongest-first ladder, so the top rank absorbs everything above its
// threshold (prestige is uncapped) and a missing/undefined value — a squad
// document written before the field existed — reads as the lowest rank rather
// than crashing the view.
export const squadRank = (prestige) => {
  const value = prestige ?? 0
  return (SQUAD_RANKS.find((r) => value >= r.min) ?? SQUAD_RANKS.at(-1)).label
}

// The next rung up and what it costs — {label, at} — or null for a squad
// already at the top of an uncapped ladder.
//
// Shipped rather than re-derived client-side (13-14) for the reason every other
// campaign number is: SQUAD_RANKS is the one place the thresholds live, and a
// client with its own copy would go stale the first time they are retuned. The
// screen states the rung and the number and promises NOTHING about what the
// rung grants — that is 13-14's other half, and it lives in the wording, not
// here.
export const nextRank = (prestige) => {
  const value = prestige ?? 0
  // Strongest-first, so the last rung the value has NOT reached is the next
  // one up; nothing above the top rung's threshold has a next.
  const rungs = [...SQUAD_RANKS].filter((r) => value < r.min)
  if (rungs.length === 0) return null
  const next = rungs.at(-1)
  return { label: next.label, at: next.min }
}
