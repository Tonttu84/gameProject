import { throwDice, chanceRoll } from '../utils/dice.js'
import {
  AUGURY_SLOTS,
  AUGURY_BASE_POINTS,
  AUGURY_ODDS_PER_POINT,
  AUGURY_ODDS_MIN,
  AUGURY_ODDS_MAX,
  AUGURY_REROLLS_PER_DAY,
  AUGURY_MAGE_BONUS_CAP,
} from '../utils/campaignConfig.js'
import { EVENT_POOL } from './events.js'

// The augur's visions. Each turn holds AUGURY_SLOTS independent fates; a slot
// is a hidden {trueEvent, falseEvent} pair. Every slot's TRUE event applies
// at end-of-turn no matter what was shown. Consulting reads each slot:
//
//   points = throwDice() + base + mageBonus + characterBonus
//          + trueEvent.baseAccuracy (the event's legibility modifier)
//   odds   = clamp(points × per-point, min, max)   ← SHOWN on the card
//   vision = chanceRoll(odds) ? trueEvent : falseEvent
//
// The displayed odds are exactly the number the vision was rolled against —
// the minigame is judging a dire omen at 30% (probably noise) against one at
// 90% (all but certain), then spending the turn's reroll on ONE slot, which
// REPLACES that fate: fresh pair, fresh reading; the others stay sealed.
//
// slots[i].{trueEvent,falseEvent,shownTrue} stay HIDDEN; slots[i].odds is
// public once consulted (null before). The odds carry a whiff of the hidden
// truth (an illegible severe event drags them down) — that is flavor, not a
// leak the player can invert: the exploding roll dominates the variance.

export const mageBonus = (roster) =>
  Math.min(AUGURY_MAGE_BONUS_CAP, Math.floor(Math.sqrt(roster.get('Mage') ?? 0)))

// One open-ended reading: exploding d6 + flat base + reading skill + the
// event's legibility, mapped to a clamped probability. Consumes dice-queue
// draws (the throwDice chain), so tests pin it exactly.
export const rollAuguryOdds = (campaign, trueEvent) => {
  const points =
    throwDice() +
    AUGURY_BASE_POINTS +
    mageBonus(campaign.roster) +
    (campaign.character?.auguryBonus ?? 0) +
    trueEvent.baseAccuracy
  // Rounded to whole percent: the number IS the display, and chanceRoll's
  // d1000 threshold must match it exactly.
  const odds = Math.min(AUGURY_ODDS_MAX, Math.max(AUGURY_ODDS_MIN, points * AUGURY_ODDS_PER_POINT))
  return Math.round(odds * 100) / 100
}

// Event draws use Math.random, not the dice queue: tests queue exact consult
// rolls, and a newDay redraw must not eat their values.
const drawSlot = () => {
  const trueIdx = Math.floor(Math.random() * EVENT_POOL.length)
  let falseIdx = Math.floor(Math.random() * (EVENT_POOL.length - 1))
  if (falseIdx >= trueIdx) falseIdx += 1
  return {
    trueEvent: { ...EVENT_POOL[trueIdx] },
    falseEvent: { ...EVENT_POOL[falseIdx] },
    odds: null, // rolled at consult, public from then on
    shownTrue: null, // unresolved until the augur is consulted — HIDDEN
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

// Read one slot. Queue order per slot: the throwDice chain (value die,
// explosion die, recursing on explosion), then one d1000 chanceRoll.
const readSlot = (campaign, slot) => {
  slot.odds = rollAuguryOdds(campaign, slot.trueEvent)
  slot.shownTrue = chanceRoll(slot.odds)
}

// Resolve every slot's vision, in slot order. Returns the shown events.
export function consultAugury(campaign) {
  for (const slot of campaign.augury.slots) readSlot(campaign, slot)
  campaign.augury.consulted = true
  return campaign.augury.slots.map(shownEvent)
}

// Replace ONE fate: the slot gets a fresh pair and a fresh reading (new
// roll, new odds); one reroll is spent. Returns the slot's newly shown event.
export function rerollAugurySlot(campaign, index) {
  const slot = drawSlot()
  readSlot(campaign, slot)
  campaign.augury.slots.splice(index, 1, slot) // splice keeps Mongoose array change tracking
  campaign.augury.rerollsRemaining -= 1
  return shownEvent(slot)
}

// The end-of-turn reveal for the day report, one entry per slot: what was
// foretold at which odds vs what came to pass. `wasAccurate` is whether the
// shown card was the truth, null if the augur was never consulted.
export function auguryReveal(campaign) {
  const card = ({ id, title, description, severity }) => ({ id, title, description, severity })
  const { consulted, slots } = campaign.augury
  return slots.map((slot) => ({
    predicted: consulted ? card(shownEvent(slot)) : null,
    odds: consulted ? slot.odds : null,
    actual: card(slot.trueEvent),
    wasAccurate: consulted ? slot.shownTrue === true : null,
  }))
}
