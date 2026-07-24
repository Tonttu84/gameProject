import {
  GARRISON_BANDS,
  GARRISON_RESOLVE_MIN,
  GARRISON_RESOLVE_MAX,
  GARRISON_RESOLVE_START,
  GARRISON_SURRENDER_FLOOR,
  GARRISON_WALL_SLOW_MAX,
  GARRISON_SALLY_THRESHOLD,
} from '../utils/campaignConfig.js'

// Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison Resolve"): the standing
// between your relief army and Karrowgate's besieged garrison. Slice 1 is the
// track + its event gate + the coarse readout; slice 2 hangs the passive
// wall-slow (below) off the same number, plus a band-cross decay in day
// resolution. Later slices add the boss-fight sally.

// The player-facing LEVEL word for a resolve value — low / normal / determined
// (S5 redesign). Shown on the HUD gauge beside a proportional bar; the raw
// integer stays hidden. Descending {min,label} table → the first level the
// value qualifies for (same convention as meterBand).
export const garrisonLevel = (resolve = GARRISON_RESOLVE_START) =>
  GARRISON_BANDS.find(({ min }) => resolve >= min).label

// Clamp a resolve value to the track's bounds — the one place [MIN, MAX] lives.
export const clampResolve = (resolve) =>
  Math.max(GARRISON_RESOLVE_MIN, Math.min(GARRISON_RESOLVE_MAX, resolve))

// The surrender condition (S5): at/under the floor the garrison throws open
// Karrowgate's gates and the campaign is lost — a second failure clock running
// parallel to the walls meter. Read at end-of-day (dayResolution step 6), after
// the turn's resolve moves (event effects + band-cross decay) have settled.
export const garrisonSurrendered = (resolve = GARRISON_RESOLVE_START) =>
  clampResolve(resolve) <= GARRISON_SURRENDER_FLOOR

// The single writer for campaign.garrison.resolve: initialize the track from
// the starting value if the campaign predates the field, then move it by
// `delta`, clamped. Both the `garrison` event effect (events.js) and the
// passive band-cross decay (dayResolution.js) go through here so init/clamp
// live in exactly one place. Returns the new resolve.
export const adjustResolve = (campaign, delta) => {
  if (!campaign.garrison) campaign.garrison = { resolve: GARRISON_RESOLVE_START }
  campaign.garrison.resolve = clampResolve(
    (campaign.garrison.resolve ?? GARRISON_RESOLVE_START) + delta,
  )
  return campaign.garrison.resolve
}

// Slice 2 centerpiece — the passive wall-slow. Fraction in [0, MAX] that the
// day's boss-fight-meter fill is reduced by, LINEAR in resolve: a devoted
// garrison (100) slows the walls' fall by the full MAX, a broken one (0) not at
// all. Capped at GARRISON_WALL_SLOW_MAX (< 1) so the walls always give a little
// each turn — the garrison can slow the breach but never freeze it.
export const wallSlowFactor = (resolve = GARRISON_RESOLVE_START) =>
  (GARRISON_WALL_SLOW_MAX * clampResolve(resolve)) / GARRISON_RESOLVE_MAX

// The sally (payoff 2) — INTERIM until S7 swaps in graduated reinforcements.
// True when the garrison is `determined` (resolve ≥ threshold) enough to risk a
// sortie at the decisive pitched battle. The battle route (campaigns.js) reads
// this once and, if it fires, thins the hidden enemy army by GARRISON_SALLY_FACTOR
// before building the enemy's placement — the garrison joins the fight from the
// gates. (S7 will replace this with garrison allies entering the battle as
// reinforcements from the enemy rear, graduated by level.)
export const garrisonSallies = (resolve = GARRISON_RESOLVE_START) =>
  clampResolve(resolve) >= GARRISON_SALLY_THRESHOLD
