// Recon R2 — graduated numeric estimates (docs/CAMPAIGN_PLAN.md "Recon rework").
//
// The player's scouting LEVEL (recon.points → reconLevel, utils/capabilities.js)
// buys a numeric [low, high] estimate around a hidden true value — the enemy's
// total count and the boss-fight meter value. The estimate is stored as an
// ABSOLUTE offset pair set at the moment of a level-up and displayed against the
// LIVE truth, which gives two properties the design needs:
//   • casualties to the true value slide floor + ceiling + truth down together by
//     exactly the loss (same width, nothing leaked across turns);
//   • the bracket only narrows on a level-up — it is never re-rolled per turn, so
//     a player can't harvest the highest floor / lowest ceiling over many turns
//     to triangulate the truth.
import {
  RECON_BRACKET_MULTIPLIERS,
  RECON_BRACKET_JITTER,
} from '../utils/campaignConfig.js'
import { SCOUTING_BANDS } from '../utils/capabilities.js'

// The top recon level (Overwhelming) reveals the exact value — zero offsets.
export const TOP_RECON_LEVEL = SCOUTING_BANDS.length - 1

// Set a fresh bracket for `truth` at recon `level` (1..TOP). Below the top the
// offsets are `truth × (mult − 1)` widened by a directional jitter (floor pushed
// DOWN, ceiling UP — never inverting the sign, so the bracket always straddles
// the truth). At the top level the offsets are exactly 0 (exact reveal). `rand`
// is injectable for deterministic tests; production passes Math.random.
export function computeBracket(truth, level, rand = Math.random) {
  if (level >= TOP_RECON_LEVEL) return { atLevel: level, floorOffset: 0, ceilOffset: 0 }
  const [floorMult, ceilMult] = RECON_BRACKET_MULTIPLIERS[level]
  const floorOffset = Math.round(truth * (floorMult - 1) - rand() * RECON_BRACKET_JITTER.floor * truth)
  const ceilOffset = Math.round(truth * (ceilMult - 1) + rand() * RECON_BRACKET_JITTER.ceil * truth)
  return { atLevel: level, floorOffset, ceilOffset }
}

// The [low, high] estimate to show this turn: the stored offsets against the
// current true value, floor clamped ≥ 0. `null` at recon level 0 (no estimate is
// shown at all — the Blind tier). At the top level the offsets are 0, so this
// collapses to the exact value.
export function displayBracket(stored, liveTruth, level) {
  if (level <= 0) return null
  const low = Math.max(0, Math.round(liveTruth + (stored?.floorOffset ?? 0)))
  const high = Math.round(liveTruth + (stored?.ceilOffset ?? 0))
  return { low, high: Math.max(low, high) }
}

// Re-set the bracket for a subject IFF the recon level has climbed since it was
// last set (newLevel > stored.atLevel). Returns the possibly-updated stored
// bracket; callers persist it. No-op (same object) when the level is unchanged —
// that's what keeps the estimate stable across turns within a level.
export function bracketOnLevelUp(stored, truth, newLevel, rand = Math.random) {
  if (newLevel > (stored?.atLevel ?? 0)) return computeBracket(truth, newLevel, rand)
  return stored
}
