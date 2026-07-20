import {
  BOSS_FIGHT_METER_FLOOR,
  BOSS_FIGHT_METER_CEILING,
  METER_BANDS,
} from '../utils/campaignConfig.js'
import { rosterTotal } from './events.js'

// How much the boss-fight meter fills this end-of-day, read against the
// day's pre-reset forage/raid assignments (called before step 7 clears them).
// CEILING when every non-forage/non-raid troop was out earning its keep,
// FLOOR when the whole roster sat idle in camp — raiding/foraging is faster
// meter growth (closer to the boss fight) traded for readiness on the day it
// lands (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop").
export function meterFillAmount(campaign) {
  const total = rosterTotal(campaign.roster)
  if (total <= 0) return BOSS_FIGHT_METER_FLOOR
  const inCamp = total - rosterTotal(campaign.forage.assignment) - rosterTotal(campaign.raid.assignment)
  const fill = BOSS_FIGHT_METER_CEILING - BOSS_FIGHT_METER_FLOOR * (inCamp / total)
  return Math.max(BOSS_FIGHT_METER_FLOOR, fill)
}

// Descending {min, label} table → the first phrase the value qualifies for
// (same convention as campaignView's bandLabel for the enemy bands).
export const meterBand = (value) => METER_BANDS.find(({ min }) => value >= min).label
