import {
  GARRISON_BANDS,
  GARRISON_RESOLVE_MIN,
  GARRISON_RESOLVE_MAX,
  GARRISON_RESOLVE_START,
  GARRISON_WALL_SLOW_MAX,
} from '../utils/campaignConfig.js'

// Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison Resolve"): the standing
// between your relief army and Karrowgate's besieged garrison. Slice 1 is the
// track + its event gate + the coarse readout; slice 2 hangs the passive
// wall-slow (below) off the same number, plus a band-cross decay in day
// resolution. Later slices add the boss-fight sally.

// The player-facing band word for a resolve value — own info kept a phrase to
// hold the fiction (never the raw number). Descending {min,label} table → the
// first phrase the value qualifies for (same convention as meterBand).
export const garrisonBand = (resolve = GARRISON_RESOLVE_START) =>
  GARRISON_BANDS.find(({ min }) => resolve >= min).label

// Clamp a resolve value to the track's bounds — the one place [MIN, MAX] lives.
export const clampResolve = (resolve) =>
  Math.max(GARRISON_RESOLVE_MIN, Math.min(GARRISON_RESOLVE_MAX, resolve))

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
