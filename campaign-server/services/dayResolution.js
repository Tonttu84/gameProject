import { UPKEEP_DIVISOR, DESERTION_FRACTION } from '../utils/campaignConfig.js'
import { drawEvents, rosterTotal } from './events.js'
import { enemyTurn, armyTotal } from './enemyAi.js'
import { buildEnemyPlacement } from './enemyPlacement.js'

// End-of-day pipeline. Order is load-bearing and later stages splice into it:
//   1. forage            (foraging stage)
//   2. forager clashes   (foraging stage)
//   2.5 scouting accrual (scouting stage)
//   3. apply true event  (augury rework; v1 applies the picked card at pick time)
//   4. enemy turn        (upkeep, stance, tomorrow's offer)
//   5. player upkeep     (food, desertion at zero)
//   6. check end         (annihilation / enemy withdrawal)
//   7. new day           (draw events, regenerate the enemy's planned placement)
//
// Mutates and saves the campaign; returns the day report shown to the player.
export async function endDay(campaign) {
  const entries = []
  const report = { day: campaign.day }

  // 4. Enemy turn
  entries.push(...enemyTurn(campaign))

  // 5. Player upkeep
  const units = rosterTotal(campaign.roster)
  const foodConsumed = Math.min(campaign.resources.food, Math.ceil(units / UPKEEP_DIVISOR))
  campaign.resources.food = Math.max(0, campaign.resources.food - Math.ceil(units / UPKEEP_DIVISOR))
  let deserters = 0
  if (campaign.resources.food <= 0 && units > 0) {
    // Empty stores: a tenth of every line slips away in the dark.
    for (const [type, n] of campaign.roster) {
      const gone = Math.floor(n * DESERTION_FRACTION)
      if (gone > 0) {
        campaign.roster.set(type, n - gone)
        deserters += gone
      }
    }
    if (deserters > 0) entries.push(`${deserters} soldiers deserted — the stores are empty.`)
  }
  report.upkeep = { foodConsumed, deserters }

  // 6. End conditions
  if (rosterTotal(campaign.roster) === 0) {
    campaign.status = 'lost'
    entries.push('Your army is no more.')
  } else if (armyTotal(campaign.enemy.army) === 0) {
    campaign.status = 'won'
    entries.push('The enemy host is destroyed. The country is yours.')
  } else if (campaign.enemy.stance === 'withdrawing') {
    campaign.status = 'won'
    entries.push('The enemy has abandoned the campaign. The country is yours.')
  }

  // 7. New day
  if (campaign.status === 'active') {
    campaign.day += 1
    campaign.battleFoughtToday = false
    campaign.events = { drawn: drawEvents(campaign.auguryScore), picked: false }
    campaign.enemy.plannedPlacement = await buildEnemyPlacement(campaign.enemy.army)
  }

  campaign.log.push({ day: report.day, entries })
  await campaign.save()

  report.entries = entries
  report.status = campaign.status
  report.enemy = {
    stance: campaign.enemy.stance,
    battleOffer: campaign.enemy.stance === 'offering_battle',
  }
  report.newDay = campaign.day
  return report
}
