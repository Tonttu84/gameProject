import {
  BOSS_FIGHT_METER_FLOOR,
  BOSS_FIGHT_METER_CEILING,
  BOSS_FIGHT_METER_THRESHOLD,
  METER_BANDS,
} from '../utils/campaignConfig.js'
import { rosterTotal } from './events.js'

// How much the boss-fight meter fills this end-of-day. S2 "effort slider"
// (docs/CAMPAIGN_PLAN.md, decision 11): foraging no longer pulls named units
// out of camp, so `inCamp` is read against the CURRENT forage.share instead
// of a per-unit assignment — sliding toward food reads as more of the army
// exposed, same as it used to when foragers were physically away. Raiders are
// still a hard subtraction (they really are elsewhere). CEILING when nobody
// is effectively in camp, FLOOR when the whole (non-raiding) roster is
// scouting-postured — raiding/foraging is faster meter growth traded for
// readiness on the day it lands.
export function meterFillAtShare(campaign, share) {
  const total = rosterTotal(campaign.roster)
  if (total <= 0) return BOSS_FIGHT_METER_FLOOR
  const raiders = rosterTotal(campaign.raid.assignment)
  const inCamp = (total - raiders) * (1 - share)
  const fill = BOSS_FIGHT_METER_CEILING - BOSS_FIGHT_METER_FLOOR * (inCamp / total)
  return Math.max(BOSS_FIGHT_METER_FLOOR, fill)
}

export function meterFillAmount(campaign) {
  return meterFillAtShare(campaign, campaign.forage.share ?? 0)
}

// Descending {min, label} table → the first phrase the value qualifies for
// (same convention as campaignView's bandLabel for the enemy bands).
export const meterBand = (value) => METER_BANDS.find(({ min }) => value >= min).label

// How much meter is LEFT before the walls fall, as the player is allowed to see
// it. The forage panel's turns-to-breach readout is `remaining / fill`, so it
// needs this gap — and the gap is the hidden counter subtracted from a FIXED
// threshold, so handing over the true remainder would undo the recon gate by
// arithmetic (subtract it from 1000 and you have meter.value exactly).
//
// Hence: derived from the DISPLAYED estimate bracket, never from meter.value.
// It is null exactly when the estimate is null (recon level 0, the Blind tier),
// and it inherits precisely the width recon has bought — narrowing on a
// level-up, collapsing to a point at the top level, with no separate gate of
// its own to keep in step. The bracket INVERTS on the way through: a higher
// meter value is less remaining, so estimate.high sets remaining.low. Floored
// at 0 because a wide bracket can run past the threshold.
export function remainingBracket(estimate) {
  if (!estimate) return null
  return {
    low: Math.max(0, BOSS_FIGHT_METER_THRESHOLD - estimate.high),
    high: Math.max(0, BOSS_FIGHT_METER_THRESHOLD - estimate.low),
  }
}
