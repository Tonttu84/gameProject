import { eventValenceFor, eventEligible, GARRISON_SORTIE_EVENTS } from './events.js'
import { adjustResolve } from './garrison.js'
import {
  RAID_BASE_TARGETS,
  RAID_RANGE_JITTER,
  RAID_TARGET_FRACTION,
  RAID_CAPACITY_RATIO,
  RAID_LOOT_FOOD,
  RAID_LOOT_MATERIALS,
  RAID_GOLD_PER_UNIT,
  RAID_GOLD_VARIANCE,
  RAID_HORSES_PER_UNIT,
  RAID_HORSES_VARIANCE,
  RAID_RESCUE_UNIT,
  RAID_RESCUE_COUNT,
  RAID_STRENGTH_BANDS,
} from '../utils/campaignConfig.js'

// Raid opportunities (Stage 4 Part 2): each turn the scouts turn up a hand of
// capacity-limited targets — an isolated detachment, a supply train, a
// prisoner column, or (only when a bad fate is sealed in the augury) the camp
// a coming blow will spring from. Launching one fights a REAL short engine
// battle through the one battle pipeline; the replay is the reveal.
//
// Generation uses Math.random, not the dice queue — same rule as the augury's
// drawSlot: tests queue exact consult/clash rolls, and dealing a new day's
// opportunities must not eat their values.

const entriesOf = (army) =>
  army instanceof Map ? [...army.entries()] : Object.entries(army ?? {})

const randInt = ([lo, hi]) => lo + Math.floor(Math.random() * (hi - lo + 1))
const randFloat = ([lo, hi]) => lo + Math.random() * (hi - lo)

// Coin a won raid brings back: the target's headcount × its type's per-unit
// rate × a variance roll that is INDEPENDENT of the size jitter. Reward and
// guard strength therefore only loosely track each other — the fat target
// under a thin guard is a real find, which is the point of scouting a card's
// reward before committing to it. Types with no rate (rescue/counter/sortie)
// pay no gold. Rounded, minimum 1 so a tiny target still carries a coin.
const goldFor = (type, targetForce) => {
  const rate = RAID_GOLD_PER_UNIT[type]
  if (!rate) return 0
  const units = Object.values(targetForce).reduce((a, b) => a + b, 0)
  return Math.max(1, Math.round(units * rate * randFloat(RAID_GOLD_VARIANCE)))
}

// Remounts off a won horse drove — the same guards × rate × wide-variance
// shape as gold, for the same reason: the herd's worth and the strength of the
// men watching it track each other only loosely, so a scout's reveal is what
// separates a bargain from a poor ride. Only `seize_horses` has a rate.
const horsesFor = (type, targetForce) => {
  if (type !== 'seize_horses') return 0
  const units = Object.values(targetForce).reduce((a, b) => a + b, 0)
  return Math.max(1, Math.round(units * RAID_HORSES_PER_UNIT * randFloat(RAID_HORSES_VARIANCE)))
}

// Descending {min, label} table → the first phrase the value qualifies for.
const bandLabel = (value, bands) => bands.find(({ min }) => value >= min).label

// Player-facing card text per raid type. counter_event stays deliberately
// vague about WHICH fate it unmakes — naming it would out the true vision.
const FLAVOR = {
  destroy_detachment: {
    title: 'Isolated Detachment',
    description:
      'An enemy detachment is camped beyond supporting distance. Cut it down before it rejoins the host.',
  },
  loot_supplies: {
    title: 'Supply Train',
    description:
      'Laden wagons crawl toward the enemy camp under light guard. Take the stores for your own.',
  },
  rescue_troops: {
    title: 'Prisoner Column',
    description:
      'Captives are marched toward the enemy rear. Break the escort and the freed men will join your banner.',
  },
  counter_event: {
    title: 'Riders Massing',
    description:
      'The scouts have found where a coming blow is being readied. Strike the muster first and it never falls.',
  },
  seize_horses: {
    title: 'The Horse Drove',
    description:
      'A dealer\'s string of remounts moves under hired guard toward the enemy camp — sound animals, sold to whoever pays. Take them before they do.',
  },
}

// A jittered RAID_TARGET_FRACTION slice of the enemy host. NOT pre-subtracted
// from the army — the detachment becomes real only if the raid wins (a
// destroy reward) or dies with the raid's defeat (it never existed apart).
const sliceTargetForce = (enemyArmy) => {
  const force = {}
  for (const [type, count] of entriesOf(enemyArmy)) {
    if (count <= 0) continue
    const n = Math.round(count * RAID_TARGET_FRACTION * (0.6 + Math.random() * 0.8))
    if (n > 0) force[type] = Math.min(n, count)
  }
  if (Object.keys(force).length === 0) {
    // A tiny host still offers a target: one unit of its most numerous type.
    const biggest = entriesOf(enemyArmy)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])[0]
    if (biggest) force[biggest[0]] = 1
  }
  return force
}

// Party budget: the target's size-points × ratio, so the party the player can
// send is comparable to what it will meet.
const capacityOf = (targetForce, catalog) => {
  let sizePoints = 0
  for (const [type, n] of Object.entries(targetForce))
    sizePoints += n * (catalog.get(type)?.size ?? 10)
  return Math.ceil(sizePoints * RAID_CAPACITY_RATIO)
}

// A player-facing band bracketing a hidden value: value ± RAID_RANGE_JITTER,
// floored/ceiled, minimum width 1 (so a value of 1 still reads as a range, not
// a giveaway). Revealing a field pins the range to the exact value.
const rangeAround = (value, jitter = RAID_RANGE_JITTER) => {
  const lo = Math.max(0, Math.floor(value * (1 - jitter)))
  const hi = Math.ceil(value * (1 + jitter))
  return [lo, Math.max(hi, lo + 1)]
}

// Ranges over the hidden reward, by reward shape — only the numeric keys the
// reward actually has (loot pays food+materials+gold, destroy pays gold, the
// horse drove pays horses and nothing else, rescue pays roster). A
// counter_event reward is {slot}: no number to reveal,
// so rewardRange is null and only enemy intel is buyable on those cards.
const rewardRangeOf = (reward) => {
  if (!reward) return null
  const range = {}
  if (typeof reward.food === 'number') range.food = rangeAround(reward.food)
  if (typeof reward.materials === 'number') range.materials = rangeAround(reward.materials)
  if (typeof reward.gold === 'number') range.gold = rangeAround(reward.gold)
  if (typeof reward.horses === 'number') range.horses = rangeAround(reward.horses)
  if (reward.roster) {
    range.roster = {}
    for (const [type, n] of Object.entries(reward.roster)) range.roster[type] = rangeAround(n)
  }
  return Object.keys(range).length > 0 ? range : null
}

// Per-unit-type ranges over the hidden target force. Fantasy rosters read
// per type (3 Giants vs 20 spearmen is the decision, not "23 units"), so the
// enemy is never collapsed to one headcount here.
const enemyRangeOf = (targetForce) => {
  const range = {}
  for (const [type, n] of Object.entries(targetForce)) range[type] = rangeAround(n)
  return range
}

// Build ONE opportunity of the given type, or null if the host is exhausted.
// counterSlot (for counter_event) is the augury slot this counter unmakes.
// sortieEvent (for garrison_sortie) is the GARRISON_SORTIE_EVENTS entry whose
// gate is met: its flavour becomes the card, and its `sortie` block the reward
// (resolve — hidden — plus any loot) and the thins-enemy flag.
const buildOpportunity = (campaign, catalog, { type, seq, source, counterSlot, sortieEvent }) => {
  const targetForce = sliceTargetForce(campaign.enemy.army)
  if (Object.keys(targetForce).length === 0) return null // nothing left to raid
  // garrison_sortie carries its reward on the event; strip the control flag out
  // of what becomes the (hidden) reward object — reward holds resolve + any loot.
  const { thinsEnemy = false, ...sortieReward } = sortieEvent?.sortie ?? {}
  const reward =
    type === 'loot_supplies'
      ? {
          food: randInt(RAID_LOOT_FOOD),
          materials: randInt(RAID_LOOT_MATERIALS),
          gold: goldFor(type, targetForce),
        }
      : type === 'rescue_troops'
        ? { roster: { [RAID_RESCUE_UNIT]: randInt(RAID_RESCUE_COUNT) } }
        : type === 'counter_event'
          ? { slot: counterSlot }
          : type === 'garrison_sortie'
            ? sortieReward
            : type === 'seize_horses'
              ? // The drove pays remounts and nothing else — one clean identity,
                // so the reveal answers exactly one question.
                { horses: horsesFor(type, targetForce) }
              : // destroy_detachment: the destruction is still the point, but the
                // field is stripped afterwards — that coin is the caster lane's.
                { gold: goldFor(type, targetForce) }
  const flavor =
    type === 'garrison_sortie'
      ? { title: sortieEvent.title, description: sortieEvent.description }
      : FLAVOR[type]
  const totalUnits = Object.values(targetForce).reduce((a, b) => a + b, 0)
  return {
    id: `d${campaign.day}-${seq}`,
    type,
    ...flavor,
    targetForce, // HIDDEN ground truth
    strengthBand: bandLabel(totalUnits, RAID_STRENGTH_BANDS),
    capacity: capacityOf(targetForce, catalog),
    reward, // HIDDEN ground truth
    rewardRange: rewardRangeOf(reward),
    enemyRange: enemyRangeOf(targetForce),
    rewardReveal: 0,
    enemyReveal: 0,
    source,
    // A garrison sortie may inflict its real casualties on the host (like
    // destroy_detachment) or pay other loot instead — carried per-opportunity.
    thinsEnemy,
    resolved: false,
    outcome: null,
  }
}

// The pool of ordinary raid types a base/scouted target draws from. The horse
// drove is an ordinary member (uniform draw, ~1 in 4): cavalry is an OPTIONAL
// lane, so its supply is never guaranteed — no turn is promised a drove, and
// none is promised anything else either.
const RAID_POOL = ['destroy_detachment', 'loot_supplies', 'rescue_troops', 'seize_horses']
const randomRaidType = () => RAID_POOL[Math.floor(Math.random() * RAID_POOL.length)]

// Deal the turn's opening board: RAID_BASE_TARGETS base target(s) plus ONE
// counter_event per sealed bad fate (each names its own slot). Everything
// beyond this is bought during the turn with scouting points (addScoutedTarget).
// The scoutingPoints pool itself is set by the caller (both deal sites) as the
// (1 − forage.share) slice of the day's fieldPointsFor pool — this only
// produces the opportunity list.
export function generateRaidOpportunities(campaign, catalog) {
  // eventValenceFor (not eventValence): a choice-fate stores only the `choice`
  // sentinel effect, its declared valence lives in the pool — a declared-bad
  // choice event draws a counter_event like any bad fate.
  const badSlots = campaign.augury.slots
    .map((slot, i) => ({ i, event: slot.trueEvent }))
    .filter(({ event }) => eventValenceFor(event) === 'bad')

  const opportunities = []
  let seq = 0
  const push = (opp) => {
    if (opp) {
      opportunities.push(opp)
      seq += 1
    }
  }
  for (let b = 0; b < RAID_BASE_TARGETS; b++)
    push(buildOpportunity(campaign, catalog, { type: randomRaidType(), seq, source: 'base' }))
  // One counter per bad fate (was one total): a coming blow always grants its
  // own extra chance to unmake it rather than crowding out a plundering target.
  for (const bad of badSlots)
    push(
      buildOpportunity(campaign, catalog, {
        type: 'counter_event',
        seq,
        source: 'counter_event',
        counterSlot: bad.i,
      }),
    )
  // Garrison sortie (slice 4): one per sortie event whose resolve gate the
  // garrison currently clears — the standing opens these cooperation raids, so
  // they only appear once trust is earned (a wary garrison offers none). The
  // campaign doc is a valid `requires` context (day/roster/eventFlags/garrison),
  // exactly as the augury draw uses it.
  for (const event of GARRISON_SORTIE_EVENTS)
    if (eventEligible(event, campaign))
      push(
        buildOpportunity(campaign, catalog, {
          type: 'garrison_sortie',
          seq,
          source: 'garrison_sortie',
          sortieEvent: event,
        }),
      )
  return opportunities
}

// Spend-a-point outcomes (the route validates points/ownership; these mutate).
// Bump one field's reveal level; false if already at the max (range→exact = 1),
// leaving room for finer levels later without a schema change.
const MAX_REVEAL = 1
export function revealField(opportunity, field) {
  const key = field === 'reward' ? 'rewardReveal' : 'enemyReveal'
  if (opportunity[key] >= MAX_REVEAL) return false
  opportunity[key] += 1
  return true
}

// Scout a NEW ordinary target onto the board (source 'scouted'), or null if
// the host is exhausted. Its id continues the turn's sequence.
export function addScoutedTarget(campaign, catalog) {
  const opp = buildOpportunity(campaign, catalog, {
    type: randomRaidType(),
    seq: campaign.raid.opportunities.length,
    source: 'scouted',
  })
  if (!opp) return null
  campaign.raid.opportunities.push(opp)
  return opp
}

// Apply a WON raid's reward. Mutates the campaign in place; caller saves.
// Returns log lines — phrases only where the enemy is concerned (the log is
// player-visible, so enemy numbers never leak through it).
export function applyRaidReward(campaign, opportunity, redSurvivors = {}) {
  const entries = []
  if (opportunity.type === 'destroy_detachment') {
    // The caller already booked the real casualties (targetForce − red_survivors),
    // win or lose. A WIN pursues the routing remainder — the surviving slice —
    // so the whole detachment is gone. Subtracting only that remainder here
    // avoids double-counting the casualties already removed at the launch site.
    for (const [type, n] of entriesOf(redSurvivors))
      campaign.enemy.army.set(type, Math.max(0, (campaign.enemy.army.get(type) ?? 0) - n))
    entries.push('The detachment is wiped out — the enemy host is the thinner for it.')
    // Prestige stub (Stage E, docs/CAMPAIGN_PLAN.md): no mechanic yet.
    entries.push('A prestigious victory — word of it spreads (prestige not yet tracked).')
    const { gold = 0 } = opportunity.reward ?? {}
    if (gold) {
      campaign.resources.gold += gold
      entries.push(`The field is stripped afterwards: +${gold} gold.`)
    }
  } else if (opportunity.type === 'loot_supplies') {
    const { food = 0, materials = 0, gold = 0 } = opportunity.reward ?? {}
    campaign.resources.food += food
    campaign.resources.materials += materials
    campaign.resources.gold += gold
    entries.push(`Plunder taken: +${+(food / 1000).toFixed(1)} t of food, +${materials} materials.`)
    if (gold) entries.push(`A paychest rode with the wagons: +${gold} gold.`)
  } else if (opportunity.type === 'seize_horses') {
    // Loot-shaped: the guard is a narrative slice (hired swords watching a
    // dealer's herd, not the enemy's own riders), so nothing is subtracted
    // from the hidden host — winning takes the animals, not their strength.
    const { horses = 0 } = opportunity.reward ?? {}
    campaign.resources.horses += horses
    entries.push(`The drove is run off to your own lines: +${horses} horses.`)
  } else if (opportunity.type === 'rescue_troops') {
    for (const [type, n] of Object.entries(opportunity.reward?.roster ?? {})) {
      campaign.roster.set(type, (campaign.roster.get(type) ?? 0) + n)
      entries.push(`${n} freed prisoners rejoin your banner.`)
    }
  } else if (opportunity.type === 'garrison_sortie') {
    // Garrison sortie (slice 4): a won sally feeds the resolve track (hidden —
    // adjustResolve, never a number in the log) and lands whatever loot the
    // version carries. Its real casualties (thins-enemy versions) are booked at
    // the launch site win-or-lose, like destroy_detachment, not here.
    const { resolve = 0, food = 0, materials = 0, roster } = opportunity.reward ?? {}
    if (resolve) adjustResolve(campaign, resolve)
    if (food) campaign.resources.food += food
    if (materials) campaign.resources.materials += materials
    for (const [type, n] of Object.entries(roster ?? {})) {
      campaign.roster.set(type, (campaign.roster.get(type) ?? 0) + n)
      entries.push(`${n} of Karrowgate's own ride out to join your banner.`)
    }
    entries.push(
      'The sally strikes home — sally-port and siege-line, you fought as one; Karrowgate stands the taller for it.',
    )
    if (food || materials)
      entries.push(
        `Stores carried off from the siege park: +${+(food / 1000).toFixed(1)} t of food, +${materials} materials.`,
      )
  } else if (opportunity.type === 'counter_event') {
    const slot = campaign.augury.slots[opportunity.reward?.slot]
    if (slot) slot.countered = true
    entries.push('The muster is scattered — a blow that was coming will never fall.')
  }
  return entries
}
