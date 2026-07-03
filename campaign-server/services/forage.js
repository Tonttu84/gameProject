import { forageValue } from '../utils/capabilities.js'
import { chanceRoll } from '../utils/dice.js'
import { resolveClash } from './skirmish.js'
import {
  FORAGE_KG_PER_POINT,
  FORAGE_FOOD_SHARE,
  FORAGE_MATERIALS_SHARE,
  CLASH_BASE,
  CLASH_CONTEST_FACTOR,
  CLASH_CAP,
  CLASH_LOSER_YIELD_FORFEIT,
  ENEMY_FORAGE_FRACTION,
} from '../utils/campaignConfig.js'

// Foraging step of day resolution. Both hosts strip the same three rings of
// countryside; near depletes first, nothing grows back, and meeting the
// enemy's parties out there is how forager clashes happen.

const entriesOf = (army) =>
  army instanceof Map ? [...army.entries()] : Object.entries(army ?? {})

// Assignment → kg the party can gather this turn (capability-driven: a future
// Flyer forages purely off its exported stats).
export const forageCapacityKg = (assignment, catalog) => {
  let points = 0
  for (const [type, count] of entriesOf(assignment)) {
    const stats = catalog.get(type)?.stats
    if (!stats) continue
    points += count * forageValue(stats)
  }
  return points * FORAGE_KG_PER_POINT
}

// Fill rings nearest-first, spilling leftover capacity outward. Returns the
// kg wanted from each ring (before contention with the other side).
export const allocateNearFirst = (capacityKg, richnessByRing) => {
  const want = richnessByRing.map(() => 0)
  let left = capacityKg
  for (let i = 0; i < richnessByRing.length && left > 0; i++) {
    want[i] = Math.min(left, richnessByRing[i])
    left -= want[i]
  }
  return want
}

// The enemy's foraging detachment: a pro-rata slice of its whole host. Its
// composition is what its foragers' escorts look like in a clash.
export const enemyForageParty = (army) => {
  const party = {}
  for (const [type, count] of entriesOf(army)) {
    const n = Math.floor(count * ENEMY_FORAGE_FRACTION)
    if (n > 0) party[type] = n
  }
  return party
}

const applyLosses = (armyMap, losses) => {
  for (const [type, dead] of Object.entries(losses))
    armyMap.set(type, Math.max(0, (armyMap.get(type) ?? 0) - dead))
}

const total = (obj) => Object.values(obj).reduce((a, b) => a + b, 0)

// Mutates the campaign (rings, resources, roster, enemy army/supplies) and
// returns { forage: <report block>, entries: [log lines] }.
export function resolveForaging(campaign, catalog) {
  const rings = campaign.forage.rings
  const richness = rings.map((r) => r.richness)

  const playerCapacity = forageCapacityKg(campaign.forage.assignment, catalog)
  const enemyCapacity = campaign.forage.enemyPlan

  const wantP = allocateNearFirst(playerCapacity, richness)
  const wantE = allocateNearFirst(enemyCapacity, richness)

  // Both sides gather against start-of-turn richness simultaneously; a ring
  // that can't feed both scales each side down pro-rata.
  const harvestP = []
  const harvestE = []
  for (let i = 0; i < rings.length; i++) {
    const want = wantP[i] + wantE[i]
    const scale = want > richness[i] ? richness[i] / want : 1
    harvestP.push(Math.floor(wantP[i] * scale))
    harvestE.push(Math.floor(wantE[i] * scale))
  }

  // What a routed side abandons is scattered and spoiled, not returned to the
  // land: the ring is depleted by everything gathered, credited or not.
  const creditP = [...harvestP]
  const creditE = [...harvestE]
  const clashes = []
  const entries = []

  for (let i = 0; i < rings.length; i++) {
    rings[i].richness -= harvestP[i] + harvestE[i]

    if (harvestP[i] <= 0 || harvestE[i] <= 0) continue
    const pressure =
      (CLASH_CONTEST_FACTOR * Math.min(harvestP[i], harvestE[i])) /
      (harvestP[i] + harvestE[i])
    const p = Math.min(CLASH_CAP, CLASH_BASE[i] + pressure)
    if (!chanceRoll(p)) continue

    const playerParty = Object.fromEntries(campaign.forage.assignment)
    const enemyParty = enemyForageParty(campaign.enemy.army)
    const clash = resolveClash(playerParty, enemyParty, i, catalog)

    applyLosses(campaign.roster, clash.playerLosses)
    applyLosses(campaign.enemy.army, clash.enemyLosses)
    if (clash.winner === 'enemy')
      creditP[i] = Math.floor(creditP[i] * (1 - CLASH_LOSER_YIELD_FORFEIT))
    if (clash.winner === 'player')
      creditE[i] = Math.floor(creditE[i] * (1 - CLASH_LOSER_YIELD_FORFEIT))

    entries.push(...clash.log)
    clashes.push({
      ring: i,
      winner: clash.winner,
      playerLosses: clash.playerLosses,
      enemyLosses: clash.enemyLosses,
    })
  }

  const gatheredP = creditP.reduce((a, b) => a + b, 0)
  const gatheredE = creditE.reduce((a, b) => a + b, 0)
  const food = Math.floor(gatheredP * FORAGE_FOOD_SHARE)
  const materials = Math.floor(gatheredP * FORAGE_MATERIALS_SHARE)
  campaign.resources.food += food
  campaign.resources.materials += materials
  // The enemy's forage feeds its supply train (its materials are its problem).
  campaign.enemy.supplies += Math.floor(gatheredE * FORAGE_FOOD_SHARE)

  if (total(Object.fromEntries(campaign.forage.assignment)) > 0)
    entries.push(`Foragers brought in ${food} kg of food and ${materials} of materials.`)

  return {
    forage: {
      capacity: playerCapacity,
      harvested: { food, materials },
      rings: rings.map((r) => ({ ring: r.ring, richness: r.richness, initialRichness: r.initialRichness })),
      clashes,
    },
    entries,
  }
}
