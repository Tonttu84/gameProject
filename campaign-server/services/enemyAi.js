import {
  ENEMY_SHADOW_DAY,
  ENEMY_OFFER_EVERY,
  ENEMY_LOW_SUPPLIES,
  ENEMY_WITHDRAW_FRACTION,
  ENEMY_FORAGE_FRACTION,
} from '../utils/campaignConfig.js'
import { armyFoodPerTurn } from '../utils/capabilities.js'
import { forageCapacityKg } from './forage.js'

export const armyTotal = (army) => [...army.values()].reduce((a, b) => a + b, 0)

// Minimal v1 stance machine for the shadowing enemy host. Runs during day
// resolution (before newDay). Mutates campaign.enemy; returns log lines the
// player is allowed to see (their pickets can observe the enemy camp).
export function enemyTurn(campaign, catalog) {
  const log = []
  const enemy = campaign.enemy
  const size = armyTotal(enemy.army)
  if (size === 0) return log // checkEnd handles the win

  // The host eats from its train, same size²-per-turn model as the player.
  enemy.supplies = Math.max(0, enemy.supplies - armyFoodPerTurn(enemy.army, catalog))

  // Tomorrow's forage plan: a fixed fraction of the host sweeps the rings.
  campaign.forage.enemyPlan = enemyForagePlanKg(enemy.army, catalog)

  const prev = enemy.stance
  if (size < enemy.initialStrength * ENEMY_WITHDRAW_FRACTION) {
    enemy.stance = 'withdrawing'
  } else if (enemy.supplies < ENEMY_LOW_SUPPLIES || (campaign.day + 1) % ENEMY_OFFER_EVERY === 0) {
    // Hungry armies seek a decision; otherwise a periodic show of force.
    enemy.stance = 'offering_battle'
  } else if (campaign.day + 1 >= ENEMY_SHADOW_DAY) {
    enemy.stance = 'shadowing'
  } else {
    enemy.stance = 'camp'
  }

  if (enemy.stance !== prev) {
    const lines = {
      camp: 'The enemy sits behind its palisade.',
      shadowing: 'The enemy host has broken camp and shadows your line of march.',
      offering_battle: 'Enemy banners form up in the plain — they are offering battle.',
      withdrawing: 'The enemy host is melting away down the road it came by.',
    }
    log.push(lines[enemy.stance])
  }
  return log
}

// Kg of forage capacity the enemy commits: ENEMY_FORAGE_FRACTION of its
// whole host's capacity. Also used at campaign creation for the first turn.
export function enemyForagePlanKg(army, catalog) {
  return Math.floor(forageCapacityKg(army, catalog) * ENEMY_FORAGE_FRACTION)
}
