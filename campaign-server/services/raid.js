import { eventValenceFor, eventEligible, GARRISON_SORTIE_EVENTS } from './events.js'
import { adjustResolve } from './garrison.js'
import { findItem, grantItem } from './items.js'
import { rollBearer } from './enemyBearers.js'
import { rollCasterPathsFor } from './magic.js'
import {
  RAID_BASE_TARGETS,
  RAID_RANGE_JITTER,
  RAID_TARGET_FRACTION,
  RAID_CAPACITY_RATIO,
  RAID_LOOT_FOOD,
  RAID_LOOT_MATERIALS,
  RAID_LOOT_MITHRIL,
  RAID_LOOT_MITHRIL_PCT,
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

// Flavour for the persistent card that lifts a forage modifier (S3), keyed by
// the modifier's id. A modifier whose id isn't listed still gets a card — the
// fallback keeps the system open, so a new `forage_modifier` fate works the day
// it's written and only needs an entry here to read better.
const FORAGE_MODIFIER_FLAVOR = {
  foraging_riders: {
    title: 'The Riders\' Camp',
    description:
      'Your scouts have followed the horse harrying your foragers back to the hollow they shelter in. Ride them down there and the foraging grounds are yours again.',
  },
  enemy_supply_depot: {
    title: 'The Enemy Depot',
    description:
      'The fortified depot behind the enemy lines is the reason they strip the country on a schedule. Burn it and they go back to scavenging like anyone else.',
  },
}
const forageModifierFlavor = (modifier) =>
  FORAGE_MODIFIER_FLAVOR[modifier.id] ?? {
    title: 'A Standing Problem',
    description: `The source of it has been found at last: ${modifier.label}. Put a party into it and be rid of the thing.`,
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
  if (typeof reward.mithril === 'number') range.mithril = rangeAround(reward.mithril)
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
// modifier (for the forage_modifier source) is the raidable forage.modifiers
// entry this card exists to undo — it supplies the flavour and the modifierId
// that applyRaidReward lifts on a win.
const buildOpportunity = (
  campaign, catalog, { type, seq, source, counterSlot, sortieEvent, modifier },
) => {
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
          // A strongbox of the forge's metal rides with SOME trains
          // (Construction slice C1, C-7) — a chance, not a promise, sealed
          // here with the rest of the reward so a reload cannot reroll it.
          ...(Math.random() * 100 < RAID_LOOT_MITHRIL_PCT
            ? { mithril: randInt(RAID_LOOT_MITHRIL) }
            : {}),
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
      : modifier
        ? forageModifierFlavor(modifier)
        : FLAVOR[type]
  const totalUnits = Object.values(targetForce).reduce((a, b) => a + b, 0)
  const strengthBand = bandLabel(totalUnits, RAID_STRENGTH_BANDS)
  return {
    id: `d${campaign.day}-${seq}`,
    type,
    ...flavor,
    targetForce, // HIDDEN ground truth
    strengthBand,
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
    // Persistent raids (S3): a modifier card survives the newDay redeal with
    // this force and reward intact, and stays until it's actually resolved.
    persistent: Boolean(modifier),
    modifierId: modifier?.id ?? null,
    // The champion riding with this target (9-12), SEALED here at the moment the
    // card is dealt rather than rolled at launch — a card advertises what it
    // carries (9-14), and rolling later would let a reload reroll the reward the
    // player picked the raid FOR. Scaled by `strengthBand`, the same field
    // prestige scales on, so a harder card is where the better relic is.
    bearer: rollBearer(campaign, strengthBand),
    // The target's casters, rolled the same way the player's hires are and
    // SEALED HERE for the same reason the bearer beside them is (S2-10): a card
    // advertises what it carries, and rolling at launch would let a reload
    // reroll the enemy the raid was chosen against. One bag per caster BODY, in
    // the order the launch-time spread will lay them out.
    casterPaths: rollCasterPathsFor(targetForce),
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

  // Persistent cards (S3) survive the redeal: an ordinary unresolved card is
  // dropped here, but a persistent one is carried over EXACTLY as it stands —
  // same targetForce, reward and bought reveal levels — so scouting spent on it
  // isn't wasted and the problem doesn't reshuffle away. Resolving it is the
  // only thing that takes it off the board. A card whose modifier is already
  // gone (lifted, or timed out) is dropped with the ordinary ones.
  const liveModifierIds = new Set((campaign.forage?.modifiers ?? []).map((m) => m.id))
  const carried = (campaign.raid?.opportunities ?? []).filter(
    (o) => o.persistent && !o.resolved && (!o.modifierId || liveModifierIds.has(o.modifierId)),
  )

  const opportunities = [...carried]
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
  // Standing forage pressures (S3): one persistent card per RAIDABLE modifier
  // that doesn't already have one on the board — the carry above means this
  // spawns the card once and then never again while it stands. Typed
  // destroy_detachment because that is what it is (ride the riders down, burn
  // the depot); the lift rides on modifierId, not on the type.
  const carriedModifierIds = new Set(carried.map((o) => o.modifierId).filter(Boolean))
  for (const modifier of campaign.forage?.modifiers ?? [])
    if (modifier.raidable && !carriedModifierIds.has(modifier.id))
      push(
        buildOpportunity(campaign, catalog, {
          type: 'destroy_detachment',
          seq,
          source: 'forage_modifier',
          modifier,
        }),
      )
  return opportunities
}

// Does beating this card cost the enemy host real strength? A
// destroy_detachment always does (that IS the card), and a garrison_sortie does
// when its version carries `thinsEnemy`. ONE predicate because two places ask:
// the launch site, which books the casualties, and the card view, which
// promises them. They must never disagree about what a card is worth.
export const thinsEnemyHost = (opportunity) =>
  opportunity.type === 'destroy_detachment' || Boolean(opportunity.thinsEnemy)

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
    // The prestige STUB that used to sit here is gone (slice 1): prestige is
    // real now and is awarded to the squads that went, by the raid route, for
    // every raid rather than only this card. This line stays as flavour only —
    // it must not read as if it were the award, or the player will look for a
    // number that lands somewhere else.
    entries.push('A prestigious victory — word of it spreads.')
    const { gold = 0 } = opportunity.reward ?? {}
    if (gold) {
      campaign.resources.gold += gold
      entries.push(`The field is stripped afterwards: +${gold} gold.`)
    }
  } else if (opportunity.type === 'loot_supplies') {
    const { food = 0, materials = 0, gold = 0, mithril = 0 } = opportunity.reward ?? {}
    campaign.resources.food += food
    campaign.resources.materials += materials
    campaign.resources.gold += gold
    campaign.resources.mithril = (campaign.resources.mithril ?? 0) + mithril
    entries.push(`Plunder taken: +${+(food / 1000).toFixed(1)} t of food, +${materials} materials.`)
    if (gold) entries.push(`A paychest rode with the wagons: +${gold} gold.`)
    if (mithril) entries.push(`Among the crates, a strongbox of pale metal: +${mithril} mithril.`)
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
  // A magic item on the card (slice 6, 6-13) — generic, outside the type
  // switch, the same shape as the modifierId lift below: ANY card carrying
  // `reward.item` grants it, whatever it is typed as. Banners are not a KIND
  // of raid; they are a kind of LOOT, and the second item kind must not need
  // its own raid type either.
  //
  // No card in RAID_TYPES carries one today — the first banner comes down the
  // event channel (the garrison's standard). This path exists because the
  // acquisition rule is channel-agnostic: an item can arrive like any other
  // magic item, and a card that wants to offer one is a row of config, not a
  // code change.
  if (opportunity.reward?.item) {
    const row = findItem(opportunity.reward.item)
    if (row && grantItem(campaign, opportunity.reward.item))
      entries.push(`${row.name} is carried back with the plunder.`)
  }

  // Standing forage pressure lifted (S3) — generic, outside the type switch:
  // ANY card carrying a modifierId removes that modifier by being won, whatever
  // it's typed as. The card itself is taken off the board by being resolved
  // (the carry filter in generateRaidOpportunities drops resolved ones).
  if (opportunity.modifierId) {
    const mods = campaign.forage?.modifiers
    const i = (mods ?? []).findIndex((m) => m.id === opportunity.modifierId)
    if (i >= 0) {
      const [lifted] = mods.splice(i, 1)
      entries.push(`${lifted.label} — that is the end of it. Your foraging is free of it from now on.`)
    }
  }
  return entries
}
