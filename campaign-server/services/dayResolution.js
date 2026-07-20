import { DESERTION_FRACTION } from '../utils/campaignConfig.js'
import { getCatalog } from '../utils/catalog.js'
import {
  armyFoodPerTurn,
  scoutingCoverage,
  scoutingBand,
  scoutingPointsFor,
} from '../utils/capabilities.js'
import { applyEffect, firedRung, rungOf, rosterTotal } from './events.js'
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

// Attach a recon-sensitive fate's fired-rung outcome to its reveal card: the
// rung that actually fired and whether the scouts turned it. A plain fate
// leaves the card untouched (its `actual` already carries the truth).
const attachFired = (revealSlot, fired) => {
  if (!fired.reconSensitive) return
  revealSlot.fired = { title: fired.title, description: fired.description, rung: fired.rung }
  revealSlot.scoutsIntervened = fired.intervened
}

// Push the option CARDS (never the effects) onto a reveal slot and record the
// owed decision — shared by acceptance and the end-day fallback.
const pendChoice = (campaign, revealSlot, i, slotDoc, fired, day, deferred) => {
  campaign.pendingChoices.push({
    slot: i,
    eventId: slotDoc.trueEvent.id,
    rung: fired.rung,
    day,
    deferred,
  })
  revealSlot.pendingChoice = {
    options: fired.choices.map(({ id, label, description }) => ({ id, label, description })),
  }
}

// Fates come to pass at the tent (2026-07-18): once the player accepts the
// reading (rerolled or not), every slot's true event is revealed and — by
// default — APPLIED on the spot. The one reason to wait: a still-unresolved
// counter_event raid targets the slot, so the fate stays counterable — its
// rung is recorded (`firedRungName`) and lands at end-day unless the raid
// unmakes it first. Choice-fates pend their decision either way; a deferred
// pick is recorded (`chosenChoice`) instead of applied.
// Mutates and saves the campaign; returns the fates report for the reveal.
export async function acceptFates(campaign) {
  const catalog = await getCatalog()
  const entries = []
  const report = { day: campaign.day }
  const band = scoutingBand(
    scoutingCoverage(campaign.roster, catalog),
    scoutingCoverage(campaign.enemy.army, catalog),
  )
  const counterTargets = new Set(
    campaign.raid.opportunities
      .filter((o) => o.type === 'counter_event' && !o.resolved)
      .map((o) => o.reward?.slot),
  )

  report.augury = auguryReveal(campaign)
  campaign.augury.slots.forEach((slot, i) => {
    if (slot.countered) {
      entries.push(`Averted: ${slot.trueEvent.title} — your raiders unmade it.`)
      return
    }
    const fired = firedRung(slot.trueEvent, band)
    if (counterTargets.has(i)) {
      // Deferred: the blow has not fallen. At the tent show only the pending
      // THREAT — strip the verdict the uniform reveal put on the card (what
      // came to pass, the augur's judgment, whether scouts turned it) and hold
      // it for end-day, after the raid that may unmake it (2026-07-18 fix). The
      // rung is recorded so exactly what was foreseen is what lands.
      slot.firedRungName = fired.rung
      report.augury[i] = {
        predicted: report.augury[i].predicted,
        odds: report.augury[i].odds,
        deferred: true,
      }
      entries.push('A coming blow has been foreseen — your raiders may yet unmake it before it falls.')
      if (fired.choices?.length) pendChoice(campaign, report.augury[i], i, slot, fired, report.day, true)
      return
    }
    attachFired(report.augury[i], fired)
    if (fired.choices?.length) {
      pendChoice(campaign, report.augury[i], i, slot, fired, report.day, false)
      entries.push(`Came to pass: ${fired.title} — a decision awaits you.`)
      if (fired.intervened) entries.push('Your scouts saw it coming.')
      return
    }
    entries.push(`Came to pass: ${fired.title}.`)
    if (fired.intervened) entries.push('Your scouts saw it coming.')
    entries.push(...applyEffect(campaign, fired.effect))
  })

  campaign.augury.accepted = true
  entries.push(...checkAnnihilation(campaign))
  if (campaign.status !== 'active') campaign.pendingChoices = []
  campaign.log.push({ day: report.day, entries })
  await campaign.save()
  report.entries = entries
  return report
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

  // 3. The fates. Two timelines:
  //  - ACCEPTED at the tent (the normal play flow since 2026-07-18): the
  //    reveal already happened and plain effects already applied there — only
  //    DEFERRED slots (a counter-raid target, marked by firedRungName) still
  //    owe anything. Their RECORDED rung applies, not the band's current pick,
  //    so what was revealed is exactly what lands. No report.augury section —
  //    the tent played that beat.
  //  - never accepted (skipped the tent / API user): the original end-of-turn
  //    resolution, verbatim — full reveal in the report, band-picked rungs,
  //    choices pending (immediately-applying, v11 behaviour).
  if (campaign.augury.accepted) {
    // Only DEFERRED slots owe anything (the tent applied the rest). Each now
    // RESOLVES and REVEALS — the verdict the tent withheld plays here, after
    // the raid phase: `fate` carries the slot index so the reveal card lands
    // under the right fate name. The reveal is full (predicted/actual/verdict)
    // but confined to the deferred slots.
    const reveal = auguryReveal(campaign)
    const revealed = []
    campaign.augury.slots.forEach((slot, i) => {
      if (!slot.firedRungName) return
      const card = { ...reveal[i], fate: i }
      if (slot.countered) {
        entries.push(`Averted: ${slot.trueEvent.title} — your raiders unmade it.`)
        revealed.push(card)
        return
      }
      const fired = rungOf(slot.trueEvent, slot.firedRungName)
      attachFired(card, fired)
      if (fired.choices?.length) {
        // The 409 gate forced the pick before this end-day could run; a
        // missing option (mid-campaign pool edit) degrades to nothing.
        const option = fired.choices.find((c) => c.id === slot.chosenChoice)
        if (option) {
          entries.push(`${fired.title}: your decision comes to pass — ${option.label}.`)
          entries.push(...applyEffect(campaign, option.effect))
        }
        revealed.push(card)
        return
      }
      entries.push(`Came to pass: ${fired.title}.`)
      entries.push(...applyEffect(campaign, fired.effect))
      revealed.push(card)
    })
    if (revealed.length) report.augury = revealed
  } else {
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
      attachFired(report.augury[i], fired)
      // A choice-fate (resolve-then-choose): nothing applies now — the
      // decision is recorded and the player picks a branch after the reveal;
      // every other mutating route is gated until then. The report slot
      // carries the option CARDS only (effects stay server-side, looked up
      // again at choose time).
      if (fired.choices?.length) {
        pendChoice(campaign, report.augury[i], i, slot, fired, report.day, false)
        entries.push(`Came to pass: ${fired.title} — a decision awaits you.`)
        if (fired.intervened) entries.push('Your scouts saw it coming.')
        return
      }
      entries.push(`Came to pass: ${fired.title}.`)
      if (fired.intervened) entries.push('Your scouts saw it coming.')
      entries.push(...applyEffect(campaign, fired.effect))
    })
  }

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
  // Game over outranks an owed decision: without this, the choose route's
  // active-guard would strand the pending entries (and the client's gate)
  // on a finished campaign.
  if (campaign.status !== 'active') campaign.pendingChoices = []

  // 7. New turn
  if (campaign.status === 'active') {
    campaign.day += 1
    campaign.battleFoughtToday = false
    campaign.militiaBoughtToday = 0
    campaign.forage.assignment = new Map()
    campaign.raid.assignment = new Map()
    campaign.augury = drawAugury()
    campaign.enemy.plannedPlacement = await buildEnemyPlacement(campaign.enemy.army)
    // Tomorrow's board: one base target (+ a counter per FRESH bad fate drawn
    // above), and the scouting-points pool refilled from the roster as the
    // day's attrition left it — unused points from today expire here.
    campaign.raid.opportunities = generateRaidOpportunities(campaign, catalog)
    campaign.raid.scoutingPoints = scoutingPointsFor(campaign.roster, catalog)
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
