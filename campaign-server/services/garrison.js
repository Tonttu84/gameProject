import { GARRISON_BANDS, GARRISON_RESOLVE_START } from '../utils/campaignConfig.js'

// Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison Resolve"): the standing
// between your relief army and Karrowgate's besieged garrison. Slice 1 is the
// track + its event gate + the coarse readout below; later slices hang the
// passive wall-slow and the boss-fight sally off the same number.

// The player-facing band word for a resolve value — own info kept a phrase to
// hold the fiction (never the raw number). Descending {min,label} table → the
// first phrase the value qualifies for (same convention as meterBand).
export const garrisonBand = (resolve = GARRISON_RESOLVE_START) =>
  GARRISON_BANDS.find(({ min }) => resolve >= min).label
