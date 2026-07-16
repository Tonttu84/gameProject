import { DESERTION_FRACTION } from '../utils/campaignConfig.js'
import { getCatalog } from '../utils/catalog.js'
import { armyFoodPerTurn, scoutingCoverage, scoutingBand } from '../utils/capabilities.js'
import { applyEffect, firedRung, rosterTotal } from './events.js'
import { drawAugury, auguryReveal } from './augury.js'
import { enemyTurn, armyTotal } from './enemyAi.js'
import { buildEnemyPlacement } from './enemyPlacement.js'
import { generateRaidOpportunities } from './raid.js'
import { resolveForaging } from './forage.js'

// End-of-turn pipeline (one turn = two weeks). Order is load-bearing and
// later stages splice into it:
//   0.5 scouting band    (read once, against the hosts as they stand at dawn —
//                         the same band campaignView showed when the player
//                         committed orders; sets the forage POSTURE in 1–2 and
//                         picks each recon-sensitive fate's RUNG in 3)
//   1. forage            (both hosts strip the rings; player yield × posture)
//   2. forager clashes   (inside the forage step — contested rings, clash
//                         odds × posture damper)
//   3. apply true event  (regardless of what the augur foretold — the reveal;
//                         the band decides WHICH RUNG of the fate fires)
//   4. enemy turn        (upkeep, stance, tomorrow's offer + forage plan)
//   5. player upkeep     (food, desertion at zero)
//   6. check end         (annihilation / enemy withdrawal)
//   7. new turn          (draw events, clear forage assignment, regenerate
//                         the enemy's planned placement)
//
// Annihilation ends the campaign the moment it happens — after a battle as
// well as at end-of-turn. A wiped player roster loses even when the enemy
// died too: with no army left there is nothing to claim the country with.
export function checkAnnihilation(campaign) {
  const entries = []
  if (rosterTotal(campaign.roster) === 0) {
    campaign.status = 'lost'
    entries.push('Your army is no more.')
  } else if (armyTotal(campaign.enemy.army) === 0) {
    campaign.status = 'won'
    entries.push('The enemy host is destroyed. The country is yours.')
  }
  return entries
}

// Mutates and saves the campaign; returns the day report shown to the player.
export async function endDay(campaign) {
  const catalog = await getCatalog()
  const entries = []
  const report = { day: campaign.day }

  // 0.5. Scouting: the fortnight's recon contest, read once against the hosts
  // as they stand at dawn — the same derivation (and so the same band)
  // campaignView showed while the player was committing orders. It sets the
  // forage posture in steps 1–2 and picks each recon-sensitive fate's rung
  // in step 3.
  const band = scoutingBand(
    scoutingCoverage(campaign.roster, catalog),
    scoutingCoverage(campaign.enemy.army, catalog),
  )

  // 1–2. Foraging and forager clashes, at the band's posture
  const foraging = resolveForaging(campaign, catalog, band)
  entries.push(...foraging.entries)
  report.forage = foraging.forage

  // 3. Every slot's true event comes to pass — foretold or not — but the
  // scouting band picks the RUNG that fires (Stage 4 1c): Blind → the full
  // event, Warned → a lesser blow, Anticipated → neutral or reversed. The
  // report carries the reveal (per slot: predicted vs actual, plus the fired
  // rung so a mitigated threat reads as the same event downgraded); the log
  // records what actually happened.
  report.augury = auguryReveal(campaign)
  campaign.augury.slots.forEach((slot, i) => {
    // A countered fate (a won counter_event raid, Stage 4 Part 2) never
    // fires at any rung: the raid unmade it before the fortnight ended.
    // auguryReveal already carries the flag to the report.
    if (slot.countered) {
      entries.push(`Averted: ${slot.trueEvent.title} — your raiders unmade it.`)
      return
    }
    const fired = firedRung(slot.trueEvent, band)
    if (fired.reconSensitive) {
      report.augury[i].fired = {
        title: fired.title,
        description: fired.description,
        rung: fired.rung,
      }
      report.augury[i].scoutsIntervened = fired.intervened
    }
    entries.push(`Came to pass: ${fired.title}.`)
    if (fired.intervened) entries.push('Your scouts saw it coming.')
    entries.push(...applyEffect(campaign, fired.effect))
  })

  // 4. Enemy turn
  entries.push(...enemyTurn(campaign, catalog))

  // 5. Player upkeep — size² × kg/day × days-per-turn, from live catalog sizes.
  const units = rosterTotal(campaign.roster)
  const foodNeed = armyFoodPerTurn(campaign.roster, catalog)
  const foodConsumed = Math.min(campaign.resources.food, foodNeed)
  campaign.resources.food = Math.max(0, campaign.resources.food - foodNeed)
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
  entries.push(...checkAnnihilation(campaign))
  if (campaign.status === 'active' && campaign.enemy.stance === 'withdrawing') {
    campaign.status = 'won'
    entries.push('The enemy has abandoned the campaign. The country is yours.')
  }

  // 7. New turn
  if (campaign.status === 'active') {
    campaign.day += 1
    campaign.battleFoughtToday = false
    campaign.militiaBoughtToday = 0
    campaign.forage.assignment = new Map()
    campaign.raid.assignment = new Map()
    campaign.augury = drawAugury()
    campaign.enemy.plannedPlacement = await buildEnemyPlacement(campaign.enemy.army)
    // Tomorrow's raids are cut from tomorrow's contest: the band is
    // recomputed against the hosts as the day's attrition left them (the
    // same derivation the next campaignView shows), and counter_event keys
    // off the FRESH augury drawn just above.
    campaign.raid.opportunities = generateRaidOpportunities(
      campaign,
      catalog,
      scoutingBand(
        scoutingCoverage(campaign.roster, catalog),
        scoutingCoverage(campaign.enemy.army, catalog),
      ),
    )
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
