import {
  DESERTION_FRACTION,
  BOSS_FIGHT_METER_THRESHOLD,
  ENEMY_WITHDRAW_FRACTION,
  GARRISON_BAND_CROSS_DECAY,
  GARRISON_RESOLVE_START,
} from '../utils/campaignConfig.js'
import { getCatalog } from '../utils/catalog.js'
import {
  armyFoodPerTurn,
  reconBand,
  reconLevel,
  fieldPointsFor,
} from '../utils/capabilities.js'
import { bracketOnLevelUp } from './recon.js'
import { drawUpgradeOffer } from './squadUpgrades.js'
import { refillSquads } from './squadReinforce.js'
import { sweepOldBattles } from './battleRetention.js'
import {
  applyEffect,
  firedRung,
  rungOf,
  rosterTotal,
  optionCard,
  describeEffect,
  missionEffectFor,
} from './events.js'
import { drawMissionOffer, onMission, returnMissions } from './missions.js'
import { drawCharterOffer } from './charters.js'
import { charterOfferView, missionOfferView } from './campaignView.js'
import { drawAugury, auguryReveal } from './augury.js'
import { enemyTurn, armyTotal } from './enemyHost.js'
import { meterFillAmount, meterBand } from './meter.js'
import { wallSlowFactor, adjustResolve, garrisonSurrendered } from './garrison.js'
import { accrueResearch, enemyMagic } from './magic.js'
import { buildEnemyPlacement } from './enemyPlacement.js'
import { generateRaidOpportunities } from './raid.js'
import { resolveForaging, ageForageModifiers } from './forage.js'
import { allBodies, eatingBodies } from './characters.js'

// End-of-turn pipeline (one turn = two weeks). Order is load-bearing and
// later stages splice into it:
//   0.5 scouting band    (read once, against the hosts as they stand at dawn —
//                         the same band campaignView showed when the player
//                         committed orders; sets the forage POSTURE in 1 and
//                         picks each recon-sensitive fate's RUNG in 3)
//   1. forage            (passive since S2 — no assignment, no clashes: the
//                         player's slider share of the pool converts to kg,
//                         the enemy drains the same rings by a flat amount)
//   3. apply true event  (regardless of what the augur foretold — the reveal;
//                         the band decides WHICH RUNG of the fate fires)
//   4. meter + enemy turn (boss-fight meter fill/threshold read against the
//                         day's pre-reset forage share/raid assignment, THEN
//                         enemy upkeep — see services/meter.js)
//   5. player upkeep     (food, desertion at zero)
//   6. check end         (annihilation / enemy near-annihilation withdrawal)
//   7. new turn          (draw events, clear raid assignment, resnapshot the
//                         forage pool + scouting-points split, regenerate the
//                         enemy's planned placement)
//
// Annihilation ends the campaign the moment it happens — after a battle as
// well as at end-of-turn. A wiped player roster loses even when the enemy
// died too: with no army left there is nothing to claim the country with.
export function checkAnnihilation(campaign) {
  const entries = []
  // Characters count here too: an army of two surviving mages is still an
  // army, and losing the campaign because the last body with a name is not a
  // roster count would be the troop rule (5-0) failing at its loudest.
  if (rosterTotal(allBodies(campaign)) === 0) {
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
  // The rung card is what the beat actually RENDERS for a recon-sensitive fate
  // (`came = fired ?? actual`), so it needs the same mechanical line the plain
  // card gained — otherwise "Raiders Intercepted — a few sacks lost, nothing
  // more" is the whole of what the player is told, and the sacks are 1 t. The
  // rung's title, prose and the scouts' intervention are all on the card
  // already; the figure adds no disclosure the card wasn't making.
  revealSlot.fired = {
    title: fired.title,
    description: fired.description,
    rung: fired.rung,
    effect: describeEffect(fired.effect),
  }
  revealSlot.scoutsIntervened = fired.intervened
}

// Push the option CARDS (never the raw effects — optionCard renders each
// branch's cost through the one formatter instead) onto a reveal slot and
// record the owed decision — shared by acceptance and the end-day fallback.
const pendChoice = (campaign, revealSlot, i, slotDoc, fired, day, deferred) => {
  // A mission fate offers CHARTERS as well as branches (12-1), and the pair is
  // drawn ONCE, here, then sealed on the decision. Drawing it at view time
  // instead would let a reload reshuffle which two were offered until the
  // player liked them — the same reason the upgrade draft is sealed at newDay.
  const offersMission = fired.choices.some((c) => c.effect?.type === 'mission')
  const missionOffer = offersMission ? drawMissionOffer(campaign) : undefined
  // A charter fate offers COMPANIES the same way and is sealed the same way
  // (R1, R-6): the drawn ids ride on the decision, and the answer route
  // accepts only one of them. Same one draw, same one moment — a second draw
  // anywhere is a reroll the player did not earn.
  const offersCharter = fired.choices.some((c) => c.effect?.type === 'squad')
  const charterOffer = offersCharter ? drawCharterOffer(campaign) : undefined
  campaign.pendingChoices.push({
    slot: i,
    eventId: slotDoc.trueEvent.id,
    rung: fired.rung,
    day,
    deferred,
    missionOffer,
    charterOffer,
  })
  // The reveal card needs the offer as much as the choices-only overlay does —
  // the tent is where most players will meet this fate. Resolved through the
  // same one function the view uses, so the two cards cannot disagree.
  revealSlot.pendingChoice = {
    options: fired.choices.map(optionCard),
    missionOffer: missionOfferView(campaign, missionOffer),
    charterOffer: charterOfferView(charterOffer),
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
  const band = reconBand(campaign.recon?.points ?? 0)
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
        odds: report.augury[i].odds,
        deferred: true,
        // The TRUE fate, named, with what it will cost — NOT the shown vision.
        // By the time this card renders the truth is already public
        // (auguryTruthRevealed goes on at accept), so showing the prediction
        // here left the tent displaying a card the raid board simultaneously
        // contradicted: the counter card's `threat` has always read trueEvent.
        // Once the truth is out the bluff is no longer information, so it goes.
        //
        // This is the identity of the threat, never its VERDICT. Whether the
        // blow lands, whether the scouts turn it, and the effect itself still
        // wait for end-day — that is the 2026-07-18 deferral, and it is what
        // lets a raid still unmake this. Naming a threat is not calling its
        // outcome.
        threat: {
          title: fired.title,
          description: fired.description,
          effect: describeEffect(fired.effect),
        },
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

  // 0.5. Scouting level, from recon points accumulated up to this turn's start
  // (this turn's leftover accrues in step 7 below, for NEXT turn) — the SAME
  // band campaignView showed while the player was committing orders. It sets
  // the forage posture in step 1 and picks each recon-sensitive fate's rung
  // in step 3.
  const band = reconBand(campaign.recon?.points ?? 0)

  // 1. Foraging, at the band's posture — passive since S2, no clashes.
  const foraging = resolveForaging(campaign, band)
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
          // The charter picked when this deferred decision was made (decision
          // 12). It survived on the slot precisely so the mission has a target
          // now, a turn after the player chose it; a charter that has since gone
          // elsewhere sends nobody rather than being double-booked.
          const squad = slot.chosenSquadId != null
            ? campaign.squads.find((sq) => sq.id === slot.chosenSquadId && !onMission(sq))
            : null
          // The company picked when a deferred CHARTER decision was made (R1).
          // Same reason as the charter above: the pick was made a turn before
          // this fate comes to pass, and without it the fate would enrol
          // nobody. applyEffect re-checks eligibility, so a row taken in the
          // meantime is inert rather than a duplicate.
          entries.push(...applyEffect(campaign, option.effect, {
            squad,
            charterId: slot.chosenCharterId ?? undefined,
            eventId: slot.trueEvent?.id,
          }))
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

  // 4. Boss-fight meter, THEN the enemy turn (enemy upkeep). Read against the
  // day's pre-reset forage share/raid assignment — step 7 below resnapshots/
  // clears them for the new turn. Garrison Resolve slice 2: the day's fill is
  // slowed by wallSlowFactor(resolve) — a heartened garrison holds the walls
  // (the player's one lever to push the breach back), rounded to keep the
  // meter integer. Read resolve BEFORE the decay below so this turn's slow
  // reflects the garrison as it stood.
  const resolve = campaign.garrison?.resolve ?? GARRISON_RESOLVE_START
  const bandBefore = meterBand(campaign.meter.value)
  campaign.meter.value += Math.round(meterFillAmount(campaign) * (1 - wallSlowFactor(resolve)))
  if (campaign.meter.value >= BOSS_FIGHT_METER_THRESHOLD) campaign.bossFightDue = true
  // Band-cross decay: the meter only ever rises, so a changed band means the
  // walls were battered into a WORSE one — the garrison feels abandoned and
  // their resolve slips a step (hidden state, like the `garrison` effect; the
  // player sees only the band word drop).
  if (meterBand(campaign.meter.value) !== bandBefore) {
    adjustResolve(campaign, -GARRISON_BAND_CROSS_DECAY)
  }
  // S4 "starve the enemy": the host's supply state for the turn is decided by
  // what it managed to take from the rings back in step 1 — so the player
  // stripping the near ring first is what pushes it outward into thin ground.
  entries.push(...enemyTurn(campaign, catalog, foraging.forage.enemyIncomeKg))

  // 5. Player upkeep — size² × kg/day × days-per-turn, from live catalog sizes.
  // Characters eat like anyone else (docs/CAMPAIGN_PLAN.md 5-0/5-10): they
  // left the roster in slice 5, and if upkeep followed them out, migrating six
  // casters into characters would silently refund their rations. The ONE
  // carve-out is eatingBodies' (C-4): a golem is animated stone and draws no
  // rations — but it still counts as a body everywhere else in camp.
  const bodies = allBodies(campaign)
  const units = rosterTotal(bodies)
  const foodNeed = armyFoodPerTurn(eatingBodies(campaign), catalog)
  const foodConsumed = Math.min(campaign.resources.food, foodNeed)
  campaign.resources.food = Math.max(0, campaign.resources.food - foodNeed)
  let deserters = 0
  if (campaign.resources.food <= 0 && units > 0) {
    // Empty stores: a tenth of every line slips away in the dark. Characters
    // are deliberately NOT in this loop even though they ate above: desertion
    // takes a FRACTION of a line, which is meaningless for an individual, and
    // "your named mage walks out in the night" is a mechanic nobody has
    // designed. The troop rule (5-0) says characters follow troop rules unless
    // a decision changes it — this is the change, and it is written down here
    // rather than left as an oversight for a later reader to "fix".
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

  // 5.5. Replacements (13-2): every charter under its caps draws from the loose
  // pool up to its archetype's intake and pays for them out of the treasury,
  // with no player action anywhere. This is decision 14's "it refills through
  // the ordinary per-turn intake" finally made real.
  //
  // AFTER upkeep and desertion, deliberately. A body that joins tonight did not
  // eat this fortnight's rations, and it must not slip away in a desertion that
  // happened before it arrived — running this earlier would charge the player
  // for replacements and then desert a tenth of them the same night.
  //
  // BEFORE the end conditions below, so the report line lands in the turn that
  // paid for it. The refill moves bodies from loose to charter rather than
  // creating them, so it cannot rescue an army from annihilation.
  entries.push(...refillSquads(campaign, new Map([...catalog].map(([name, type]) => [name, type.size]))))

  // 5.7. The fortnight's study (docs/CAMPAIGN_PLAN.md "▶ SLICE 2", S2-6/S2-7):
  // every living Mage, plus any lent ally, banks RESEARCH_POINTS_PER_MAGE into
  // the FOCUSED school. Priests study nothing — Holy needs no research and
  // priesthood is formal (S2-4) — which is the whole trade between the two hire
  // lanes: Priests give you day-1 castings, Mages give you the future.
  //
  // AFTER the fates and the battle's reckoning have marked the dead, so a mage
  // who fell this fortnight does not study it; and after replacements, which
  // move bodies rather than create casters and so cannot change this. BEFORE
  // the end conditions, so a school opened tonight is reported in the turn that
  // paid for it — the first unlock is meant to be an event the player feels.
  //
  // A mage away on a MISSION still studies: any living Mage counts wherever
  // they are (S2-6), because a second thing that changes the rate would reopen
  // exactly what M-7 closed when it made every mage contribute equally.
  entries.push(...accrueResearch(campaign))

  // 6. End conditions
  entries.push(...checkAnnihilation(campaign))
  // Near-annihilation win: the enemy melts away once its host drops below a
  // fraction of its starting strength. Independent of the boss-fight meter
  // (this is the ambient path — the enemy raided/foraged down to a husk before
  // the decisive fight ever came due). `size === 0` is already the annihilation
  // win above, so this only fires for a nonzero-but-broken host.
  const enemySize = armyTotal(campaign.enemy.army)
  if (
    campaign.status === 'active' &&
    enemySize > 0 &&
    enemySize < campaign.enemy.initialStrength * ENEMY_WITHDRAW_FRACTION
  ) {
    campaign.status = 'won'
    entries.push('The enemy host is melting away down the road it came by. The country is yours.')
  }
  // Garrison surrender (S5): a second, parallel loss clock. Once this turn's
  // resolve moves (event effects + the band-cross decay above) have settled, a
  // garrison at/under the surrender floor gives up and opens Karrowgate's gates —
  // the bridge is lost, regardless of the walls meter. Read AFTER the decay so a
  // wall band-cross that pushes resolve to 0 loses the campaign the same turn.
  if (campaign.status === 'active' && garrisonSurrendered(campaign.garrison?.resolve ?? GARRISON_RESOLVE_START)) {
    campaign.status = 'lost'
    entries.push('Karrowgate throws open its gates — the garrison, abandoned once too often, has made its own peace. The bridge, and the campaign, is lost.')
  }
  // Game over outranks an owed decision: without this, the choose route's
  // active-guard would strand the pending entries (and the client's gate)
  // on a finished campaign.
  if (campaign.status !== 'active') campaign.pendingChoices = []

  // 6.9 Reclaim the storage of battles nobody can watch any more (L-6).
  //
  // BEFORE the day increments, so "older than the current turn" still means
  // "older than the turn just fought" and today's battle — the one the player
  // may be about to open from the report — survives.
  //
  // Deliberately outside the `status === 'active'` gate below: a campaign that
  // just ended is exactly the one whose replays nobody will open again.
  const swept = await sweepOldBattles(campaign)
  if (swept.deleted > 0)
    console.log(`campaign ${campaign.id}: swept ${swept.deleted} unwatchable battle(s)`)

  // 7. New turn
  if (campaign.status === 'active') {
    campaign.day += 1
    campaign.battleFoughtToday = false
    // Back to the top of the one-way march (routes' rejectIfPhasePassed): the
    // new turn re-opens every phase that this one closed.
    campaign.phase = 'prepare'
    campaign.raid.assignment = new Map()
    campaign.raid.squadAssignment = []
    // Homecomings (decision 12), BEFORE anything below reads availability: a
    // charter whose mission ends today is free for this turn's raids and this
    // turn's battle, not the next one. The prestige it earned lands here too,
    // which is why this sits above the upgrade draw — a charter that ranks up
    // by coming home finds its draft waiting on the same turn, exactly as one
    // that ranked up by raiding does.
    entries.push(...returnMissions(campaign, missionEffectFor))
    // Slice 4a: a charter that ranked up on this turn's raids finds its draft
    // waiting at the top of the next one. Drawn HERE, after the prestige those
    // raids paid has already landed, rather than lazily when the panel is
    // read — the draw is random, so it must happen exactly once and be sealed
    // on the document, or a reload would reshuffle the offer until the player
    // liked it. An UNSPENT offer is left alone: it is a decision still owed,
    // not stale state. A squad with two slots free therefore fills them one
    // turn at a time, which is the intended cadence.
    for (const squad of campaign.squads ?? []) {
      if (squad.upgradeOffer) continue
      const offer = drawUpgradeOffer(squad)
      if (offer) squad.upgradeOffer = offer
    }
    // Standing forage pressures age out here (S3) — AFTER the day they were in
    // force has resolved. Runs BEFORE the raid redeal below, so an expired
    // modifier's persistent card is dropped with it rather than carried for a
    // pressure that's already over.
    if (campaign.forage.modifiers?.length)
      campaign.forage.modifiers = ageForageModifiers(campaign.forage.modifiers)
    // The live doc IS the eligibility context (day already incremented above,
    // roster + eventFlags as this turn's fates left them), so a prerequisite
    // reads against next turn's state.
    campaign.augury = drawAugury(campaign)
    // Rebuilt against the encounter's OWN sealed magic (E-7) — read off the
    // document rather than the authored constants, so a campaign whose host was
    // written with different numbers scripts to those numbers.
    campaign.enemy.plannedPlacement = await buildEnemyPlacement(
      campaign.enemy.army,
      enemyMagic(campaign),
    )
    // Tomorrow's board: one base target (+ a counter per FRESH bad fate drawn
    // above); the field-points pool below is what backs its scouting-points
    // share.
    campaign.raid.opportunities = generateRaidOpportunities(campaign, catalog)
    // Recon: whatever scouting points went UNSPENT on the raid board this turn
    // pour into the accumulating recon pool (no decay) — this is what raises the
    // scouting level over the campaign (docs/CAMPAIGN_PLAN.md "Recon rework").
    // Done BEFORE the pool resnapshots below, so only the genuine leftover
    // accrues.
    campaign.recon.points = (campaign.recon.points ?? 0) + Math.max(0, campaign.raid.scoutingPoints ?? 0)
    // Effort slider S2: resnapshot tomorrow's pool from the roster as the
    // day's attrition left it, then split it by the STICKY forage.share the
    // player already has set (newDay never touches forage.share itself).
    campaign.forage.pool = fieldPointsFor(allBodies(campaign), catalog)
    campaign.raid.scoutingPoints = campaign.forage.pool * (1 - (campaign.forage.share ?? 0))
    // Recon R2: a level-up (re)sets the numeric estimate brackets ONCE, from the
    // truth as it now stands (enemy count = live host size AFTER this turn's
    // casualties; meter = the value just filled). Within a level they hold — only
    // a climb narrows them (services/recon.js), so cross-turn triangulation leaks
    // nothing (docs/CAMPAIGN_PLAN.md "Recon rework").
    const newLevel = reconLevel(campaign.recon.points)
    const setBracket = (target, truth) => {
      const next = bracketOnLevelUp(target, truth, newLevel)
      // Write leaf fields (not the object) so mongoose tracks the nested change.
      target.atLevel = next.atLevel
      target.floorOffset = next.floorOffset
      target.ceilOffset = next.ceilOffset
    }
    setBracket(campaign.recon.brackets.enemyCount, armyTotal(campaign.enemy.army))
    setBracket(campaign.recon.brackets.meter, campaign.meter.value)

    // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
    // tomorrow's offer is deliberately NOT drawn here. Drawing it now would
    // judge affordability against tonight's stores, so gold won by tomorrow's
    // raids could never reach tomorrow's pool — the whole reason the draw
    // moved into POST /:id/recruit/open. Just clear the day-state; `drawnDay`
    // self-resets as the day increments, so the next open draws afresh.
    campaign.recruit.dailyOptions = []
    campaign.recruit.boosted = false
    campaign.recruit.hiredToday = false
  }

  campaign.log.push({ day: report.day, entries })
  await campaign.save()

  report.entries = entries
  report.status = campaign.status
  // The day-report enemy summary carries the flavor inputs the reveal screen
  // narrates from: the boss-fight meter's band and whether the decisive fight
  // is now due (replaces the retired stance/battleOffer pair).
  report.enemy = {
    band: meterBand(campaign.meter.value),
    bossFightDue: campaign.bossFightDue,
  }
  report.newDay = campaign.day
  return report
}
