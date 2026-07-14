import { eventValence } from './events.js'
import {
  RAID_OPPORTUNITIES_PER_DAY,
  RAID_TARGET_FRACTION,
  RAID_CAPACITY_RATIO,
  RAID_LOOT_FOOD,
  RAID_LOOT_MATERIALS,
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

// Deal the day's opportunities. Count follows the scouting band (better eyes
// find more openings — the deterministic Stage-4 payoffs live elsewhere, so
// raids keep their randomness); a counter_event is dealt exactly when some
// slot's sealed truth is a bad fate, its (hidden) reward naming that slot.
export function generateRaidOpportunities(campaign, catalog, band) {
  const count = RAID_OPPORTUNITIES_PER_DAY[band] ?? 1
  const badSlots = campaign.augury.slots
    .map((slot, i) => ({ i, effect: slot.trueEvent.effect }))
    .filter(({ effect }) => eventValence(effect) === 'bad')

  const types = []
  if (badSlots.length > 0) types.push('counter_event')
  const pool = ['destroy_detachment', 'loot_supplies', 'rescue_troops']
  while (types.length < count) types.push(pool[Math.floor(Math.random() * pool.length)])
  types.length = count

  const opportunities = []
  types.forEach((type, i) => {
    const targetForce = sliceTargetForce(campaign.enemy.army)
    if (Object.keys(targetForce).length === 0) return // nothing left to raid
    const reward =
      type === 'loot_supplies'
        ? { food: randInt(RAID_LOOT_FOOD), materials: randInt(RAID_LOOT_MATERIALS) }
        : type === 'rescue_troops'
          ? { roster: { [RAID_RESCUE_UNIT]: randInt(RAID_RESCUE_COUNT) } }
          : type === 'counter_event'
            ? { slot: badSlots[Math.floor(Math.random() * badSlots.length)].i }
            : null
    const totalUnits = Object.values(targetForce).reduce((a, b) => a + b, 0)
    opportunities.push({
      id: `d${campaign.day}-${i}`,
      type,
      ...FLAVOR[type],
      targetForce, // HIDDEN — campaignView strips it to strengthBand
      strengthBand: bandLabel(totalUnits, RAID_STRENGTH_BANDS),
      capacity: capacityOf(targetForce, catalog),
      reward, // HIDDEN
      resolved: false,
      outcome: null,
    })
  })
  return opportunities
}

// Apply a WON raid's reward. Mutates the campaign in place; caller saves.
// Returns log lines — phrases only where the enemy is concerned (the log is
// player-visible, so enemy numbers never leak through it).
export function applyRaidReward(campaign, opportunity) {
  const entries = []
  if (opportunity.type === 'destroy_detachment') {
    // The slice becomes real — and dead: subtract it from the hidden host.
    for (const [type, n] of entriesOf(opportunity.targetForce))
      campaign.enemy.army.set(type, Math.max(0, (campaign.enemy.army.get(type) ?? 0) - n))
    entries.push('The detachment is wiped out — the enemy host is the thinner for it.')
  } else if (opportunity.type === 'loot_supplies') {
    const { food = 0, materials = 0 } = opportunity.reward ?? {}
    campaign.resources.food += food
    campaign.resources.materials += materials
    entries.push(`Plunder taken: +${+(food / 1000).toFixed(1)} t of food, +${materials} materials.`)
  } else if (opportunity.type === 'rescue_troops') {
    for (const [type, n] of Object.entries(opportunity.reward?.roster ?? {})) {
      campaign.roster.set(type, (campaign.roster.get(type) ?? 0) + n)
      entries.push(`${n} freed prisoners rejoin your banner.`)
    }
  } else if (opportunity.type === 'counter_event') {
    const slot = campaign.augury.slots[opportunity.reward?.slot]
    if (slot) slot.countered = true
    entries.push('The muster is scattered — a blow that was coming will never fall.')
  }
  return entries
}
