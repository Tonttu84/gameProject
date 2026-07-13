import {
  FOOD_KG_PER_SIZE_SQ_PER_DAY,
  DAYS_PER_TURN,
  SCOUTING_BAND_THRESHOLDS,
} from './campaignConfig.js'

// Campaign-layer unit capabilities, DERIVED from the engine-exported combat
// stats (unittypes collection, i.e. `./game dump-units`). Nothing here is
// hand-maintained per unit type: a future Flyer or new skirmisher gets its
// scouting/foraging role purely from its stats, keeping the C++ constructors
// the single source of truth.
//
// Scales: speed 1 = foot, 2 = heavy cavalry, 3 = light cavalry.
// ballisticSkill is on the melee-attack scale: 10 = trained archer,
// 1 = animal with no ranged sense. All multipliers are tuning knobs.

// Scouting: super-linear in mobility (speed² — covering ground is most of the
// job, and a future flyer should dominate), plus ranged sense (observing and
// skirmishing at a distance), plus the engine's signed designer tag for units
// whose scouting worth diverges from what those two imply (LightCavalry +4,
// Warhorse −2). See docs/CAMPAIGN_PLAN.md Stage 4.
export const reconValue = (stats) =>
  stats.speed * stats.speed + Math.floor(stats.ballisticSkill / 2) + stats.reconTag

// Scouting coverage of one side: Σ(count·reconValue) / Σ(count·size) —
// "scouting per unit of army you must screen." The ÷size denominator is what
// keeps a big army from auto-winning scouting: a blob dilutes its own
// coverage (300 infantry DRAG DOWN 12 light cavalry, they don't out-sum it).
// Unknown types screen as size-10 dead weight with no recon (same guard
// convention as armyFoodPerTurn: routes validate, this only degrades safely).
export const scoutingCoverage = (army, catalog) => {
  const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
  let recon = 0
  let sizeSum = 0
  for (const [type, count] of entries) {
    const unitType = catalog.get(type)
    recon += count * (unitType ? reconValue(unitType.stats) : 0)
    sizeSum += count * (unitType?.size ?? 10)
  }
  return sizeSum > 0 ? recon / sizeSum : 0
}

// The player-vs-enemy coverage comparison, collapsed to the banded label that
// is the ONLY scouting fact allowed across the hidden-info boundary (the raw
// ratio would leak enemy composition). Degenerate cases: eyes against a blind
// enemy see everything; two blind armies contest by default.
export const scoutingBand = (playerCoverage, enemyCoverage) => {
  if (playerCoverage <= 0 && enemyCoverage <= 0) return 'Contested'
  const ratio = enemyCoverage <= 0 ? Infinity : playerCoverage / enemyCoverage
  const t = SCOUTING_BAND_THRESHOLDS
  if (ratio >= t.Overwhelming) return 'Overwhelming'
  if (ratio >= t.Superior) return 'Superior'
  if (ratio >= t.Contested) return 'Contested'
  if (ratio >= t.Outmatched) return 'Outmatched'
  return 'Blind'
}

// Foraging: covering ground is what matters — riders sweep a wide area dry
// long before infantry could.
export const forageValue = (stats) => Math.max(1, stats.speed * 2)

// Screening (protecting foragers / countering enemy harassment): armoured,
// dangerous, and mobile enough to intercept — heavy cavalry's specialty.
// Armour weighs fully so heavy cavalry (armour 5, speed 2) beats light
// (armour 2, speed 3).
export const screenValue = (stats) =>
  stats.armour + Math.floor(stats.attack / 6) + stats.speed

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
