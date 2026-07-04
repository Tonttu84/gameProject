import { throwDice, getRandom } from '../utils/dice.js'
import {
  AUGURY_THRESHOLD,
  AUGURY_REROLLS_PER_DAY,
  AUGURY_MAGE_BONUS_CAP,
} from '../utils/campaignConfig.js'
import { EVENT_POOL } from './events.js'

// The augur's prophecy. Each turn TWO distinct events are drawn: the TRUE
// event (applies at end-of-turn no matter what) and a DECOY. Consulting rolls
// exploding dice; on a good roll the vision shows the truth, on a bad one it
// shows either event at even odds — so even a failed reading can happen to be
// right, and the player can never tell which from the outside. A reroll does
// not re-read the same fate, it REPLACES it: both events are redrawn (the old
// truth will never fire) and the new pair is read fresh.
//
// campaign.augury.trueEvent / decoyEvent / prediction.{total,threshold,accurate}
// are HIDDEN — campaignView serves only the predicted card and the raw dice
// roll (exploding rolls are fun to show, and without the hidden bonuses the
// total can't be reconstructed from it).

// Event draws use Math.random, not the dice queue: tests queue exact consult
// rolls, and a newDay redraw must not eat their values.
export function drawAugury() {
  const trueIdx = Math.floor(Math.random() * EVENT_POOL.length)
  let decoyIdx = Math.floor(Math.random() * (EVENT_POOL.length - 1))
  if (decoyIdx >= trueIdx) decoyIdx += 1
  return {
    trueEvent: { ...EVENT_POOL[trueIdx] },
    decoyEvent: { ...EVENT_POOL[decoyIdx] },
    prediction: null,
    consulted: false,
    rerollsRemaining: AUGURY_REROLLS_PER_DAY,
  }
}

export const mageBonus = (roster) =>
  Math.min(AUGURY_MAGE_BONUS_CAP, Math.floor(Math.sqrt(roster.get('Mage') ?? 0)))

// Roll the reading and record the prediction; returns the SHOWN event.
// Queue-deterministic: one throwDice() chain, then — only when the reading
// fails — one getRandom(1,2) draw picking which event the false vision shows
// (1 = true, 2 = decoy).
export function consultAugury(campaign) {
  const augury = campaign.augury
  const roll = throwDice()
  const total =
    roll +
    augury.trueEvent.baseAccuracy +
    mageBonus(campaign.roster) +
    (campaign.character?.auguryBonus ?? 0)
  const accurate = total >= AUGURY_THRESHOLD
  const shown = accurate
    ? augury.trueEvent
    : getRandom(1, 2) === 1
      ? augury.trueEvent
      : augury.decoyEvent
  augury.prediction = {
    eventId: shown.id,
    roll,
    total,
    threshold: AUGURY_THRESHOLD,
    accurate,
  }
  augury.consulted = true
  return shown
}

// Replace fate: fresh pair of events, fresh reading, one reroll spent.
// Returns the newly shown event.
export function rerollAugury(campaign) {
  const rerollsRemaining = campaign.augury.rerollsRemaining - 1
  campaign.augury = { ...drawAugury(), rerollsRemaining }
  return consultAugury(campaign)
}

// The end-of-turn reveal for the day report: what was foretold vs what came.
// `wasAccurate` compares the SHOWN card to the truth (a lucky wrong reading
// that happened to show the true event counts as true), null if never read.
export function auguryReveal(campaign) {
  const { trueEvent, decoyEvent, prediction } = campaign.augury
  const card = ({ id, title, description, severity }) => ({ id, title, description, severity })
  const predicted = prediction
    ? card(prediction.eventId === trueEvent.id ? trueEvent : decoyEvent)
    : null
  return {
    predicted,
    actual: card(trueEvent),
    wasAccurate: prediction ? prediction.eventId === trueEvent.id : null,
  }
}
