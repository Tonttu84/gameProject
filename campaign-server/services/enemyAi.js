import { ENEMY_FORAGE_FRACTION } from '../utils/campaignConfig.js'
import { armyFoodPerTurn } from '../utils/capabilities.js'
import { forageCapacityKg } from './forage.js'

export const armyTotal = (army) => [...army.values()].reduce((a, b) => a + b, 0)

// The shadowing enemy host's per-turn upkeep. Runs during day resolution
// (before newDay). Mutates campaign.enemy; returns log lines the player is
// allowed to see (their pickets can observe the enemy camp). The old stance
// machine is gone — the boss-fight meter (+ bossFightDue) is the single signal
// for what the enemy is doing, and the near-annihilation "withdraws → you win"
// case is a direct check in dayResolution's end conditions.
export function enemyTurn(campaign, catalog) {
  const log = []
  const enemy = campaign.enemy
  const size = armyTotal(enemy.army)
  if (size === 0) return log // checkEnd handles the win

  // The host eats from its train, same size²-per-turn model as the player.
  enemy.supplies = Math.max(0, enemy.supplies - armyFoodPerTurn(enemy.army, catalog))

  // Tomorrow's forage plan: a fixed fraction of the host sweeps the rings.
  campaign.forage.enemyPlan = enemyForagePlanKg(enemy.army, catalog)

  return log
}

// Kg of forage capacity the enemy commits: ENEMY_FORAGE_FRACTION of its
// whole host's capacity. Also used at campaign creation for the first turn.
export function enemyForagePlanKg(army, catalog) {
  return Math.floor(forageCapacityKg(army, catalog) * ENEMY_FORAGE_FRACTION)
}
