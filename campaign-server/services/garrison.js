import {
  GARRISON_BANDS,
  GARRISON_RESOLVE_MIN,
  GARRISON_RESOLVE_MAX,
  GARRISON_RESOLVE_START,
  GARRISON_SURRENDER_FLOOR,
  GARRISON_WALL_SLOW_MAX,
  GARRISON_SALLY_THRESHOLD,
  GARRISON_SALLY_TROOPS,
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

// The sally threshold predicate — "is the garrison `determined` (resolve ≥
// threshold)?" Superseded as the battle trigger by the graduated
// garrisonSallyTroops below (S7 sends troops for `normal` too), but retained as
// a pure determined-level predicate.
export const garrisonSallies = (resolve = GARRISON_RESOLVE_START) =>
  clampResolve(resolve) >= GARRISON_SALLY_THRESHOLD

// The sally (payoff 2), GRADUATED by level (S7): how many troops the garrison
// commits to the decisive pitched battle — low none, normal some, determined
// more (GARRISON_SALLY_TROOPS). They enter the fight as allied reinforcements
// storming the enemy's rear (the S6 casterless spell), NOT by pre-thinning the
// enemy. The battle route reads this once, builds the BattleInput
// `reinforcements` spec from it, and narrates the sally when it is > 0.
export const garrisonSallyTroops = (resolve = GARRISON_RESOLVE_START) =>
  GARRISON_SALLY_TROOPS[garrisonLevel(resolve)] ?? 0
