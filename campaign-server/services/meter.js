import {
  BOSS_FIGHT_METER_FLOOR,
  BOSS_FIGHT_METER_CEILING,
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
