import config from '../utils/config.js'
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
import { EVENT_POOL, POOL_LEGIBILITY, eligiblePool } from './events.js'

// The augur's visions. Each turn holds AUGURY_SLOTS independent fates; a slot
// is a hidden {trueEvent, falseEvent} pair drawn from ONE pool (severity
// tier). Every slot's TRUE event applies at end-of-turn no matter what was
// shown. Consulting reads each slot:
//
//   points = throwDice() + base + mageBonus + characterBonus
//          + POOL_LEGIBILITY[pool]   (the pool's modifier, never the event's)
//   odds   = clamp(points × per-point, min, max)   ← SHOWN on the card
//   vision = chanceRoll(odds) ? trueEvent : falseEvent
//
// The displayed odds are exactly the number the vision was rolled against —
// the minigame is judging a dire omen at 30% (probably noise) against one at
// 90% (all but certain), then spending the turn's reroll on ONE slot, which
// REPLACES that fate: fresh pair, fresh reading; the others stay sealed.
//
// slots[i].{trueEvent,falseEvent,shownTrue} stay HIDDEN; slots[i].odds is
// public once consulted (null before). Because the pair shares a pool and
// the modifier belongs to the pool, the odds reveal the reading's murkiness
// and nothing about which card is true; pools mix good and bad events, so
// even the (visible) pool leaks magnitude, never direction.

export const mageBonus = (roster) =>
  Math.min(AUGURY_MAGE_BONUS_CAP, Math.floor(Math.sqrt(roster.get('Mage') ?? 0)))

// One open-ended reading: exploding d6 + flat base + reading skill + the
// POOL's legibility (identical for both pair members — the odds can never
// out the truth), mapped to a clamped probability. Consumes dice-queue
// draws (the throwDice chain), so tests pin it exactly.
export const rollAuguryOdds = (campaign, trueEvent) => {
  const points =
    throwDice() +
    AUGURY_BASE_POINTS +
    mageBonus(campaign.roster) +
    (campaign.character?.auguryBonus ?? 0) +
    (POOL_LEGIBILITY[trueEvent.severity] ?? 0)
  // Rounded to whole percent: the number IS the display, and chanceRoll's
  // d1000 threshold must match it exactly.
  const odds = Math.min(AUGURY_ODDS_MAX, Math.max(AUGURY_ODDS_MIN, points * AUGURY_ODDS_PER_POINT))
  return Math.round(odds * 100) / 100
}

// Event draws use Math.random, not the dice queue: tests queue exact consult
// rolls, and a newDay redraw must not eat their values.
//
// The false event comes from the SAME severity tier as the truth (user,
// 2026-07-05): tier members share a legibility modifier, so the displayed
// odds are identical whichever of the pair is true — the odds tell the
// player how murky the reading was, never which card to believe.
const eventById = new Map(EVENT_POOL.map((e) => [e.id, e]))

const slotFrom = (trueEvent, falseEvent) => ({
  trueEvent: { ...trueEvent },
  falseEvent: { ...falseEvent },
  odds: null, // rolled at consult, public from then on
  shownTrue: null, // unresolved until the augur is consulted — HIDDEN
})

// Both the truth and the decoy come from the pool the campaign state currently
// allows (eligiblePool) — a prerequisite-gated fate (events.js `requires`)
// enters neither role until its trigger is met. `ctx` is {day, roster,
// eventFlags}; an empty ctx (no gating context) admits only the ungated
// events, which the tripwire guarantees keep every tier legible.
// Prefer an event no other slot in this reading has already taken (user,
// 2026-08-10: "a bit boring to have multiple same events"). Applies to the
// decoy as well as the truth — a false card repeating another slot's fate reads
// just as flat, and worse, invites the player to think the repetition means
// something.
//
// Falls back to the whole candidate list rather than failing. With three slots,
// a prerequisite-gated pool and a severity-matched decoy, the unused set can
// legitimately run dry; a repeated reading is a small disappointment, a missing
// one is a broken turn. Preference, not a guarantee.
const pickUnused = (candidates, used) => {
  const fresh = candidates.filter((e) => !used.has(e.id))
  const from = fresh.length > 0 ? fresh : candidates
  return from[Math.floor(Math.random() * from.length)]
}

const randomSlot = (ctx = {}, used = new Set()) => {
  const pool = eligiblePool(ctx)
  const trueEvent = pickUnused(pool, used)
  const peers = pool.filter(
    (e) => e.severity === trueEvent.severity && e.id !== trueEvent.id,
  )
  const falseEvent = pickUnused(peers, used)
  return slotFrom(trueEvent, falseEvent)
}

// Test-only (config.DEV_AUGURY, off in production): a FIFO of `trueId:falseId`
// specs, re-seeded each drawAugury() and consumed by every draw/reroll in
// order. It deliberately does NOT touch the dice queue (see the note above),
// so queued consult rolls are untouched. Returns null — random fallback — when
// the list is empty or a truth id is unknown.
let forcedDraws = []
const forcedSlot = () => {
  const spec = forcedDraws.shift()
  if (!spec) return null
  const [trueId, falseId] = spec.split(':')
  const trueEvent = eventById.get(trueId)
  if (!trueEvent) return null
  const peers = EVENT_POOL.filter(
    (e) => e.severity === trueEvent.severity && e.id !== trueEvent.id,
  )
  const falseEvent = (falseId && eventById.get(falseId)) || peers[0]
  return slotFrom(trueEvent, falseEvent)
}

const drawSlot = (ctx, used) => forcedSlot() ?? randomSlot(ctx, used)

// Every event id a slot has spoken for, truth and decoy alike. Forced and
// scheduled slots count too: they are guaranteed beats and are never displaced,
// but the random draws around them should still steer clear of repeating them.
const claimedBy = (slots) => {
  const used = new Set()
  for (const slot of slots) {
    if (slot?.trueEvent?.id) used.add(slot.trueEvent.id)
    if (slot?.falseEvent?.id) used.add(slot.falseEvent.id)
  }
  return used
}

// Event chains (part 2): drain the campaign's schedule queue into FORCED slots.
// Every entry whose day has arrived (`day <= ctx.day`) becomes a slot with the
// scheduled event as its truth and a same-tier eligible decoy — a guaranteed
// beat. Drained entries are removed from ctx.scheduledEvents (reassigned so a
// Mongoose DocumentArray records the change; a plain ctx is fine too); entries
// not yet due, or beyond this turn's slot capacity, stay for a later draw. An
// id no longer in the pool is dropped (the sealed-fate rule). This MUTATES ctx
// — the single intended side effect, called only from drawAugury; dayResolution
// saves the campaign after. An empty/absent queue is a no-op (creation ctx).
const drainScheduled = (ctx) => {
  const queue = ctx?.scheduledEvents
  if (!queue || queue.length === 0) return []
  const day = ctx.day ?? 1
  const pool = eligiblePool(ctx)
  const forced = []
  const remaining = []
  for (const entry of queue) {
    const trueEvent = eventById.get(entry.eventId)
    if (!trueEvent) continue // id gone from the pool: drop it, don't strand it
    const peers = pool.filter(
      (e) => e.severity === trueEvent.severity && e.id !== trueEvent.id,
    )
    if (entry.day <= day && forced.length < AUGURY_SLOTS && peers.length > 0) {
      const falseEvent = peers[Math.floor(Math.random() * peers.length)]
      forced.push(slotFrom(trueEvent, falseEvent))
    } else {
      remaining.push({ eventId: entry.eventId, day: entry.day })
    }
  }
  ctx.scheduledEvents = remaining
  return forced
}

// ctx is the campaign context the eligibility filter reads: {day, roster,
// eventFlags} — plus scheduledEvents, which this DRAINS (see drainScheduled).
// The live doc IS a valid ctx (dayResolution passes `campaign`); the creation
// route passes a plain {day, roster} before the doc exists. An omitted ctx
// admits only ungated events and has no queue to drain.
export function drawAugury(ctx = {}) {
  forcedDraws = [...config.DEV_AUGURY]
  const scheduled = drainScheduled(ctx)
  // Built one at a time, threading what has been claimed so far — Array.from's
  // generator runs in index order, so slot 2 already knows what 0 and 1 took.
  const used = new Set()
  const claim = (slot) => {
    if (slot?.trueEvent?.id) used.add(slot.trueEvent.id)
    if (slot?.falseEvent?.id) used.add(slot.falseEvent.id)
    return slot
  }
  return {
    slots: Array.from(
      { length: AUGURY_SLOTS },
      (_, i) => claim(scheduled[i] ?? drawSlot(ctx, used)),
    ),
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
  // Steer the redraw away from what the OTHER slots already hold — troubling
  // the Vael for a thread and getting back one you are already reading is the
  // most annoying way to spend the turn's only reroll.
  const others = campaign.augury.slots.filter((_, i) => i !== index)
  const slot = drawSlot(campaign, claimedBy(others))
  readSlot(campaign, slot)
  campaign.augury.slots.splice(index, 1, slot) // splice keeps Mongoose array change tracking
  campaign.augury.rerollsRemaining -= 1
  return shownEvent(slot)
}

// The end-of-turn reveal for the day report, one entry per slot: what was
// foretold at which odds vs what came to pass. `wasAccurate` is whether the
// shown card was the truth, null if the augur was never consulted.
// `countered` marks a fate a won counter_event raid unmade (Stage 4 Part 2) —
// its effect never fired.
export function auguryReveal(campaign) {
  const card = ({ id, title, description, severity }) => ({ id, title, description, severity })
  const { consulted, slots } = campaign.augury
  return slots.map((slot) => ({
    predicted: consulted ? card(shownEvent(slot)) : null,
    odds: consulted ? slot.odds : null,
    actual: card(slot.trueEvent),
    wasAccurate: consulted ? slot.shownTrue === true : null,
    countered: slot.countered === true,
  }))
}
