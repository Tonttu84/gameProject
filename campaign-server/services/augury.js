import { chanceRoll } from '../utils/dice.js'
import {
  AUGURY_SLOTS,
  AUGURY_BASE_ODDS,
  AUGURY_ODDS_PER_POINT,
  AUGURY_MAX_ODDS,
  AUGURY_REROLLS_PER_DAY,
  AUGURY_MAGE_BONUS_CAP,
} from '../utils/campaignConfig.js'
import { EVENT_POOL } from './events.js'

// The augur's visions. Each turn holds AUGURY_SLOTS independent fates; a slot
// is a hidden {trueEvent, falseEvent} pair. Every slot's TRUE event applies
// at end-of-turn no matter what was shown. Consulting resolves each slot:
// random < that slot's odds → the vision shows the truth, otherwise the false
// event. Rerolling a slot REPLACES that fate only: a fresh pair is drawn and
// read, the other slots keep their sealed fates.
//
// campaign.augury.slots[i].{trueEvent,falseEvent,shownTrue} are HIDDEN —
// campaignView serves only the shown cards (and with a distinct false event
// per pair, a shown card alone never tells whether it is the truth).

export const mageBonus = (roster) =>
  Math.min(AUGURY_MAGE_BONUS_CAP, Math.floor(Math.sqrt(roster.get('Mage') ?? 0)))

// Chance this slot's vision shows its true event: legible mild omens read
// well, catastrophes stay murky; mages and character skill help.
export const auguryOdds = (campaign, trueEvent) =>
  Math.min(
    AUGURY_MAX_ODDS,
    AUGURY_BASE_ODDS +
      AUGURY_ODDS_PER_POINT *
        (trueEvent.baseAccuracy +
          mageBonus(campaign.roster) +
          (campaign.character?.auguryBonus ?? 0)),
  )

// Event draws use Math.random, not the dice queue: tests queue exact consult
// rolls, and a newDay redraw must not eat their values.
const drawSlot = () => {
  const trueIdx = Math.floor(Math.random() * EVENT_POOL.length)
  let falseIdx = Math.floor(Math.random() * (EVENT_POOL.length - 1))
  if (falseIdx >= trueIdx) falseIdx += 1
  return {
    trueEvent: { ...EVENT_POOL[trueIdx] },
    falseEvent: { ...EVENT_POOL[falseIdx] },
    shownTrue: null, // unresolved until the augur is consulted
  }
}

export function drawAugury() {
  return {
    slots: Array.from({ length: AUGURY_SLOTS }, drawSlot),
    consulted: false,
    rerollsRemaining: AUGURY_REROLLS_PER_DAY,
  }
}

export const shownEvent = (slot) => (slot.shownTrue ? slot.trueEvent : slot.falseEvent)

// Resolve every slot's vision. Queue-deterministic: one chanceRoll (a single
// d1000 draw) per slot, in slot order. Returns the shown events.
export function consultAugury(campaign) {
  for (const slot of campaign.augury.slots)
    slot.shownTrue = chanceRoll(auguryOdds(campaign, slot.trueEvent))
  campaign.augury.consulted = true
  return campaign.augury.slots.map(shownEvent)
}

// Replace ONE fate: the slot gets a fresh pair and a fresh reading (one
// chanceRoll), one reroll is spent. Returns the slot's newly shown event.
export function rerollAugurySlot(campaign, index) {
  const slot = drawSlot()
  slot.shownTrue = chanceRoll(auguryOdds(campaign, slot.trueEvent))
  campaign.augury.slots.splice(index, 1, slot) // splice keeps Mongoose array change tracking
  campaign.augury.rerollsRemaining -= 1
  return shownEvent(slot)
}

// The end-of-turn reveal for the day report, one entry per slot: what was
// foretold vs what came to pass. `wasAccurate` is whether the shown card was
// the truth, null if the augur was never consulted.
export function auguryReveal(campaign) {
  const card = ({ id, title, description, severity }) => ({ id, title, description, severity })
  const { consulted, slots } = campaign.augury
  return slots.map((slot) => ({
    predicted: consulted ? card(shownEvent(slot)) : null,
    actual: card(slot.trueEvent),
    wasAccurate: consulted ? slot.shownTrue === true : null,
  }))
}
