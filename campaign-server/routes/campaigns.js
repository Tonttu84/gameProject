import { Router } from 'express'
import Campaign, { CAMPAIGN_SCHEMA_VERSION, TURN_PHASES } from '../models/campaign.js'
import UnitType from '../models/unitType.js'
import { userExtractor } from '../middleware/auth.js'
import { campaignView } from '../services/campaignView.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import { endDay, acceptFates, checkAnnihilation } from '../services/dayResolution.js'
import { applyEffect, choiceRung, SIEGE_SPINE } from '../services/events.js'
import { drawAugury, consultAugury, rerollAugurySlot } from '../services/augury.js'
import {
  canAfford,
  applyHire,
  drawRecruitOffer,
  recruitCtx,
  findRecruitEntry,
  resolveHire,
} from '../services/recruit.js'
import { buildEnemyPlacement, spreadPlacement, makeZonePlacer } from '../services/enemyPlacement.js'
import { generateRaidOpportunities, applyRaidReward, revealField, addScoutedTarget } from '../services/raid.js'
import { fortifiedSidesFor, fortifyCost, fortifyWorkerCost, atFortCap } from '../services/fortification.js'
import { findOverstackedHex } from '../services/placementCapacity.js'
import { getInfo } from '../services/engine.js'
import { getCatalog } from '../utils/catalog.js'
import { raidCapacityCost, fieldPointsFor } from '../utils/capabilities.js'
import config from '../utils/config.js'
import {
  MAP_NAME,
  RAID_MAX_TURNS,
  STARTING_ROSTER,
  STARTING_SQUADS,
  STARTING_FOOD,
  STARTING_MATERIALS,
  STARTING_WORKERS,
  STARTING_GOLD,
  STARTING_HORSES,
  RECRUITING_FERVOR_START,
  ENEMY_ARMY,
  ENEMY_SUPPLIES,
  FORAGE_RINGS,
  ENEMY_DRAIN_KG_PER_TURN,
  DEFAULT_FORAGE_SHARE,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
  GARRISON_RESOLVE_START,
  GARRISON_SALLY_TICK,
  GARRISON_SALLY_UNIT,
  GARRISON_SALLY_TEAM,
  GARRISON_SALLY_BATTLE_MESSAGE,
} from '../utils/campaignConfig.js'
import { garrisonSallyTroops } from '../services/garrison.js'

const router = Router()

// Every campaign route requires a login and only ever sees the caller's own
// campaigns; a foreign or unknown id is a plain 404 (no existence oracle).
router.use(userExtractor)

// Responses ALWAYS go through campaignView() — hidden info (enemy army,
// planned placement, event truth flags) never leaves this file as JSON.

// Version checks filter the QUERY, not the loaded document: Mongoose fills
// schema defaults on hydration, so a pre-versioning doc would look current
// once loaded. Legacy docs 404 here and are deleted by the listing route.
// buildVersion works the same way: a save from any other build is invisible.
const findOwn = async (req) =>
  Campaign.findOne({
    _id: req.params.id,
    user: req.user._id,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    buildVersion: config.APP_VERSION,
  })

// A fired choice-fate awaiting the player's decision (events with choices,
// resolve-then-choose) blocks every other mutating action — the fortnight
// isn't resolved until the choice is made. Reads stay open; the choices
// route below is the only way forward. Returns true when it wrote the 409.
const rejectIfChoicePending = (campaign, res) => {
  if ((campaign.pendingChoices?.length ?? 0) > 0) {
    res.status(409).json({ error: 'a decision is pending — resolve it first' })
    return true
  }
  return false
}

// The turn is a one-way march (docs/CAMPAIGN_PLAN.md "Effort slider",
// decision 12): a phase's decisions FREEZE the moment the turn moves past it.
// This guard is what makes that true server-side — it generalises the old
// recruit lock (`rejectIfRecruiting`), which enforced exactly this rule for
// exactly one door.
//
// It rejects only when the campaign is PAST the route's phase, never when it
// is before. Acting early is left alone deliberately: the client marches the
// screens in order so it cannot happen there, and nothing later has happened
// yet, so an early write can't be informed by information the player wasn't
// meant to have. The abuse this exists to stop is the opposite one — going
// BACK to re-decide once the fates are read, the raids are resolved or the
// offer is drawn. `phase` is the last phase for routes that close the turn
// (battles, end-day), so those are never refused on these grounds.
// Same returns-true-when-it-wrote-the-409 shape as the guard above.
const PHASE_INDEX = Object.fromEntries(TURN_PHASES.map((p, i) => [p, i]))
const rejectIfPhasePassed = (campaign, res, phase) => {
  if (PHASE_INDEX[campaign.phase ?? 'prepare'] > PHASE_INDEX[phase]) {
    res.status(409).json({
      error: `the ${phase} phase is behind you — that decision is made for this turn`,
    })
    return true
  }
  return false
}

// The mirror image, and the ONE place the turn refuses to run AHEAD of itself:
// the fortnight can't end before its decisions have been made. Every other
// mutating route already refuses a second resolution by its own state
// (augury.consulted/accepted, recruit.hiredToday, battleFoughtToday, the
// pendingChoices lookup) — end-day had no such flag, so a double submit
// resolved two fortnights. Since end-day resets the phase to 'prepare', this
// makes the second one a 409 (user, 2026-08-08: the backend, not the client,
// is what must make double-resolution impossible).
const rejectIfPhaseBefore = (campaign, res, phase) => {
  if (PHASE_INDEX[campaign.phase ?? 'prepare'] < PHASE_INDEX[phase]) {
    res.status(409).json({
      error: `the turn is still in ${campaign.phase} — see it through before the fortnight ends`,
    })
    return true
  }
  return false
}

// The boss fight is mandatory once the meter marks it due: the fortnight can't
// end until it's actually been fought. Fighting it wins or loses the campaign
// (see the battle route below), so `status !== 'active'` then blocks end-day
// via its own guard — this only ever fires on the due-but-not-yet-fought day.
// Same shape as rejectIfChoicePending. Returns true when it wrote the 400.
const rejectIfBossFightUnfought = (campaign, res) => {
  if (campaign.bossFightDue && !campaign.battleFoughtToday) {
    res.status(400).json({ error: 'the enemy offers battle — you must take the field before the day can end' })
    return true
  }
  return false
}

router.post('/', async (req, res) => {
  const catalog = await getCatalog()
  // Day-1 draw, before the doc exists: hand drawAugury the starting context so
  // prerequisite-gated fates (events.js `requires`) are judged against the
  // opening army. No eventFlags yet — the first turn can't be a chain payoff.
  const augury = drawAugury({ day: 1, roster: STARTING_ROSTER })
  // Effort slider (S2): one field-points pool, split by DEFAULT_FORAGE_SHARE
  // (the schema default for forage.share) between the forage kg it seeds and
  // the raid board's day-1 scouting-points pool.
  const pool = fieldPointsFor(STARTING_ROSTER, catalog)
  const campaign = await Campaign.create({
    user: req.user._id,
    resources: { food: STARTING_FOOD, materials: STARTING_MATERIALS, gold: STARTING_GOLD, horses: STARTING_HORSES },
    workers: { total: STARTING_WORKERS, used: 0 },
    roster: STARTING_ROSTER,
    // No day-1 offer is drawn here, unlike the augury above: the Recruit phase
    // draws its own lazily when the player opens it, so the pool is judged
    // against the stores as they stand at that moment rather than before the
    // turn has been played. `drawnDay` defaults to 0, which never equals a
    // live day, so day 1 draws on first open like every other day.
    recruit: { fervor: RECRUITING_FERVOR_START },
    squads: STARTING_SQUADS,
    forage: {
      rings: FORAGE_RINGS.map((richness, ring) => ({ ring, richness, initialRichness: richness })),
      pool,
      enemyDrainKg: ENEMY_DRAIN_KG_PER_TURN,
    },
    augury,
    // The scripted siege spine (S8): three GUARANTEED beats forced into their
    // day's augury by drawAugury's schedule drain (turns 2/5/8). Seeded here so
    // they ride the same `chained`/scheduledEvents machinery as an event chain,
    // but guaranteed from the campaign's first turn rather than a player choice.
    scheduledEvents: SIEGE_SPINE.map((s) => ({ ...s })),
    // Day-1 raid board: one base target (+ any counters), plus the scouting
    // slice of the day-1 pool. end-day redeals both each new turn.
    raid: {
      opportunities: generateRaidOpportunities(
        { day: 1, augury, enemy: { army: ENEMY_ARMY } },
        catalog,
      ),
      scoutingPoints: pool * (1 - DEFAULT_FORAGE_SHARE),
    },
    enemy: {
      army: ENEMY_ARMY,
      initialStrength: Object.values(ENEMY_ARMY).reduce((a, b) => a + b, 0),
      supplies: ENEMY_SUPPLIES,
      plannedPlacement: await buildEnemyPlacement(ENEMY_ARMY),
    },
  })
  res.status(201).json(await campaignView(campaign))
})

router.get('/', async (req, res) => {
  // Campaigns from an incompatible schema version OR another build are
  // deleted, not migrated (no backwards compatibility — the client then
  // offers a fresh campaign). Every Docker build stamps a fresh version, so
  // redeploying wipes old saves without anyone remembering to bump anything.
  await Campaign.deleteMany({
    user: req.user._id,
    $or: [
      { schemaVersion: { $ne: CAMPAIGN_SCHEMA_VERSION } },
      { buildVersion: { $ne: config.APP_VERSION } },
    ],
  })
  const campaigns = await Campaign.find({ user: req.user._id }).sort({ _id: -1 })
  res.json(await Promise.all(campaigns.map((c) => campaignView(c))))
})

router.get('/:id', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  res.json(await campaignView(campaign))
})

// Advance the turn to the next phase ({phase}). The march is one-way and one
// step at a time: the target must be exactly the phase after the current one,
// so there is no going back and no skipping past a screen that owes a
// decision. Everything the player committed in the phase they are leaving is
// frozen from here on (rejectIfPhasePassed above).
//
// Two steps are NOT taken here:
//  - 'recruit' is entered through POST /:id/recruit/open, because entering it
//    DRAWS the day's offer — a phase change with a side effect, kept in the one
//    place that owns it rather than duplicated here.
//  - 'deploy' is reachable only on the pitched-battle day: since 2026-08-08 a
//    quiet turn has no deployment at all and ends from Recruiting, so offering
//    the step would put the player on an empty grid that reads as an offer of
//    battle.
router.post('/:id/phase', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return

  const target = req.body?.phase
  if (!TURN_PHASES.includes(target))
    return res.status(400).json({ error: 'unknown phase' })
  if (target === 'recruit')
    return res.status(400).json({ error: 'open the recruit phase to draw the day’s offer' })
  if (PHASE_INDEX[target] !== PHASE_INDEX[campaign.phase] + 1)
    return res.status(409).json({ error: `the turn is in ${campaign.phase} — it moves one phase forward at a time` })
  if (target === 'deploy' && !campaign.bossFightDue)
    return res.status(400).json({ error: 'there is no battle to deploy for today' })

  campaign.phase = target
  await campaign.save()
  res.json(await campaignView(campaign))
})

// Set today's effort split between foraging and scouting: {share: 0..1}.
// Sticky across turns (the schema never resets it at newDay) — re-issue any
// time before leaving Prepare (rejectIfPhasePassed); the split then seals for
// the rest of the turn (docs/CAMPAIGN_PLAN.md "Effort slider" decision 12).
// Recomputes raid.scoutingPoints from the SAME pool snapshot forage reads, so
// there is nothing separate to track — the client never spends against the
// pool while still in Prepare (its raids screen only opens in the 'raids'
// phase), so this is safe to recompute on every change.
router.post('/:id/effort', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfPhasePassed(campaign, res, 'prepare')) return

  const share = req.body?.share
  if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1)
    return res.status(400).json({ error: 'share must be a number between 0 and 1' })

  campaign.forage.share = share
  campaign.raid.scoutingPoints = campaign.forage.pool * (1 - share)
  await campaign.save()
  res.json(await campaignView(campaign))
})

// Consult the augur: one reading per turn resolves every slot's vision. The
// response's campaign view carries the shown cards; which are TRUE stays
// hidden until end-of-turn.
router.post('/:id/augury/consult', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'omens')) return
  if (campaign.augury.consulted)
    return res.status(400).json({ error: 'the augur has already spoken today' })

  const shown = consultAugury(campaign)
  campaign.log.push({
    day: campaign.day,
    entries: [`The augur speaks: ${shown.map((e) => e.title).join(', ')}.`],
  })
  await campaign.save()
  res.json(await campaignView(campaign))
})

// Reroll ONE slot ({slot: 0-based index}): REPLACES that fate — a fresh pair
// is drawn (the old truth will never fire) and read fresh; the other slots
// keep their sealed fates. Requires a prior consult and a remaining reroll.
router.post('/:id/augury/reroll', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'omens')) return
  if (!campaign.augury.consulted)
    return res.status(400).json({ error: 'consult the augur before rerolling' })
  if (campaign.augury.accepted)
    return res.status(400).json({ error: 'the fates are sealed — nothing left to reroll' })
  if (campaign.augury.rerollsRemaining <= 0)
    return res.status(400).json({ error: 'no rerolls remaining' })

  const slot = req.body?.slot
  if (!Number.isInteger(slot) || slot < 0 || slot >= campaign.augury.slots.length)
    return res.status(400).json({ error: 'slot index required' })

  const shown = rerollAugurySlot(campaign, slot)
  campaign.log.push({
    day: campaign.day,
    entries: [`The bones are cast anew: ${shown.title}.`],
  })
  await campaign.save()
  res.json(await campaignView(campaign))
})

// Accept the fates: seal the reading (rerolled or not) and let the fortnight's
// events come to pass right here at the tent — the reveal beat plays mid-turn,
// while the player still remembers why they rerolled. Plain effects apply
// immediately; a fate a live counter_event raid targets is deferred (see
// acceptFates). Returns the same {report, campaign} envelope end-day uses.
router.post('/:id/augury/accept', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfPhasePassed(campaign, res, 'omens')) return
  if (!campaign.augury.consulted)
    return res.status(400).json({ error: 'consult the augur before accepting the fates' })
  if (campaign.augury.accepted)
    return res.status(400).json({ error: 'the fates have already come to pass' })

  const report = await acceptFates(campaign)
  res.json({ report, campaign: await campaignView(campaign) })
})

// Fight today's battle. The server owns the map and the enemy: the client
// sends only its own placement; enemy_placement is the campaign's hidden
// plannedPlacement, so the battle matches whatever scouting revealed.
router.post('/:id/battles', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (campaign.battleFoughtToday) return res.status(400).json({ error: 'battle already fought today' })
  // Stage B: the ONLY battle is the decisive boss fight, unlocked when the
  // meter fills (campaign.bossFightDue). There is no voluntary full-army
  // battle before then — raids and forage clashes are the only ways to fight.
  if (!campaign.bossFightDue)
    return res.status(400).json({ error: 'no battle is offered — the enemy is not yet ready to fight' })

  const placement = req.body?.player_placement
  if (!Array.isArray(placement) || placement.length === 0)
    return res.status(400).json({ error: 'player_placement required' })

  // The roster is the budget: you can only field units you own. Placement
  // entries for a squad carry squad_id (see Stage A) — validated against the
  // campaign's own squads so a client can't invent an id or borrow one that
  // isn't theirs. Whole-army/roster budget checks below don't need to treat
  // squad-tagged entries any differently: they're already flattened into
  // this same per-unit array by the client, one entry per unit.
  const ownSquadIds = new Set(campaign.squads.map((s) => s.id))
  const fieldedSquadIds = new Set()
  const placed = new Map()
  for (const entry of placement) {
    if (!entry || typeof entry.unit_type !== 'string')
      return res.status(400).json({ error: 'malformed placement entry' })
    if (entry.squad_id != null) {
      if (!ownSquadIds.has(entry.squad_id))
        return res.status(400).json({ error: `not one of your squads: squad_id ${entry.squad_id}` })
      fieldedSquadIds.add(entry.squad_id)
    }
    placed.set(entry.unit_type, (placed.get(entry.unit_type) ?? 0) + 1)
  }
  const placeableTypes = new Set(
    (await UnitType.find({ placeable: true })).map((t) => t.name),
  )
  for (const [type, count] of placed) {
    if (!placeableTypes.has(type))
      return res.status(400).json({ error: `not a placeable unit type: ${type}` })
    // Only units committed to a raid this turn are unavailable for the
    // battle — foraging is passive since S2 and no longer removes named
    // units from camp (docs/CAMPAIGN_PLAN.md "Effort slider" decision 2).
    const raiding = campaign.raid.assignment.get(type) ?? 0
    if (count > (campaign.roster.get(type) ?? 0) - raiding) {
      return res.status(400).json({
        error: raiding > 0
          ? `not enough ${type} in camp (${raiding} out raiding)`
          : `not enough ${type} in the roster`,
      })
    }
  }

  // A hex can only hold so much (Hex::CAPACITY). The engine silently DROPS
  // overflow units per hex rather than rejecting the battle — but the roster
  // reconciliation below debits what was SENT, not what the engine actually
  // placed, so an overstacked hex would quietly cost the player units with
  // no combat fought for them. Reject it up front instead.
  const catalog = await getCatalog()
  const info = await getInfo()
  const overstacked = findOverstackedHex(placement, catalog, info.grid.hexCapacity)
  if (overstacked)
    return res.status(400).json({
      error: `hex (${overstacked.q},${overstacked.r}) is overstacked: `
        + `${overstacked.used}/${overstacked.hexCapacity}`,
    })

  // Battle commits the WHOLE army (user, 2026-07-05): every unit not out
  // raiding must take the field — no reserves skulking in camp. Foraging is
  // passive since S2 and no longer holds anyone back (decision 2).
  let inCamp = 0
  for (const [type, n] of campaign.roster)
    inCamp += n
      - (campaign.raid.assignment.get(type) ?? 0)
      - (placed.get(type) ?? 0)
  if (inCamp > 0)
    return res.status(400).json({
      error: `the whole army must take the field — ${inCamp} units still in camp`,
    })

  // Garrison Resolve payoff 2 — the sally (S7), GRADUATED by garrison level.
  // A garrison that trusts you commits men to the decisive battle: they enter
  // as allied reinforcements storming the enemy's rear at GARRISON_SALLY_TICK
  // (the S6 casterless auto-cast spell), fed via the BattleInput `reinforcements`
  // spec — low sends no one, normal some, determined more. This REPLACES the
  // interim slice-3 enemy-thinning (the enemy host is no longer pre-scaled; the
  // reinforcements do their damage in the fight itself). Read once, here, on the
  // decisive battle only.
  const sallyTroops = garrisonSallyTroops(campaign.garrison?.resolve ?? GARRISON_RESOLVE_START)
  const sallied = sallyTroops > 0
  const reinforcements = sallied
    ? [{
        tick: GARRISON_SALLY_TICK,
        team: GARRISON_SALLY_TEAM,
        count: sallyTroops,
        unit_type: GARRISON_SALLY_UNIT,
        message: GARRISON_SALLY_BATTLE_MESSAGE,
      }]
    : []

  const input = {
    map: MAP_NAME,
    player_placement: placement,
    enemy_placement: campaign.enemy.plannedPlacement ?? [],
    // The player's paid-for fortifications for this battle: the map file is
    // static, the level is dynamic, so the walled sides are injected here.
    fortified_sides: fortifiedSidesFor(MAP_NAME, campaign.fortificationLevel),
    // The garrison's sally, if any: allied reinforcements at the enemy rear.
    reinforcements,
  }
  const { error, battle, summary } = await runAndPersistBattle(input, req.user._id)
  if (error) return res.status(400).json({ error })

  // Units left in camp are unaffected; fielded units are replaced by their
  // survivors. The enemy fields its whole host, so its army IS the survivors.
  for (const [type, count] of placed) {
    const inCamp = (campaign.roster.get(type) ?? 0) - count
    campaign.roster.set(type, inCamp + (summary.blue_survivors[type] ?? 0))
  }
  campaign.enemy.army = summary.red_survivors

  // Reconcile fielded squads: a squad regroups with its battle survivors
  // (including any stragglers who broke but lived — Stage A's persistent
  // squadId tag survives a rout) unless the engine reports the formation
  // wiped, in which case it's disbanded — its survivors, if any, are already
  // folded into the flat roster reconciliation above as loose troops.
  // Squads left in camp (not in fieldedSquadIds) are untouched.
  const squadSurvivors = summary.blue_squads ?? {}
  campaign.squads = campaign.squads
    .filter((squad) => {
      if (!fieldedSquadIds.has(squad.id)) return true
      const result = squadSurvivors[String(squad.id)]
      return Boolean(result) && !result.wiped
    })
    .map((squad) => {
      if (fieldedSquadIds.has(squad.id))
        squad.composition = squadSurvivors[String(squad.id)].survivors
      return squad
    })
  campaign.battleFoughtToday = true
  campaign.battles.push(battle._id)

  // This is the boss fight — the gate above means there is no other kind of
  // battle. It is decisive both ways regardless of survivor counts
  // (docs/CAMPAIGN_PLAN.md): a 'blue' win takes the country, red/stalemate
  // loses the campaign. This REPLACES the old checkAnnihilation call here;
  // annihilation still runs on the ambient paths (forage clashes, raid
  // launches, augury accept), just not on the decisive battle itself.
  campaign.bossFightDue = false
  const won = summary.winner === 'blue'
  campaign.status = won ? 'won' : 'lost'
  campaign.log.push({
    day: campaign.day,
    entries: [
      ...(sallied
        ? ['Karrowgate\'s garrison sallies from the gates as the lines close — its men storm the enemy\'s rear to fight at your side.']
        : []),
      `Battle joined — ${summary.winner === 'blue' ? 'victory' : summary.winner === 'red' ? 'defeat' : 'stalemate'} after ${summary.tickCount} turns.`,
      won
        ? 'The enemy host is broken. The country is yours.'
        : 'The line is shattered — the campaign is lost.',
    ],
  })
  await campaign.save()

  res.status(201).json({ ...summary, campaign: await campaignView(campaign) })
})

// Launch a batch of raids on scouted opportunities (Stage 4 Part 2): each
// capacity-limited party fights a REAL short engine battle against its
// opportunity's hidden target force, both sides auto-placed (no raid
// placement UI in v1). Raiding is INDEPENDENT of the day's main battle for
// now — no battleFoughtToday gate; explicitly a provisional call, see
// docs/CAMPAIGN_PLAN.md Stage 4 open decisions.
//
// SQUAD-ONLY RAIDING (2026-07-21): a party is a set of SQUAD ids
// (`parties[raidId] = [squadId, …]`), not loose troop counts. A squad goes
// whole (its full composition); several squads may stack onto one opportunity.
// The capacity cap still bites — the party's cost is Σ raidCapacityCost over
// every troop in the sent squads.
//
// The whole batch is ONE request (not one call per opportunity) so overlap
// between raids launched together is caught in one place: a squad can't be
// double-booked across two opportunities in the same click. `raid.squadAssignment`
// extends that guarantee across SEPARATE requests within the same day — a squad
// already sent on an earlier raid this turn is unavailable to a later batch too.
// Validation runs to completion BEFORE any battle is spawned: battles are
// external subprocesses that can't be rolled back, so a bad request must be
// rejected wholesale, never partially applied.
router.post('/:id/raids/launch', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'raids')) return

  const parties = req.body?.parties
  if (parties === null || typeof parties !== 'object' || Array.isArray(parties))
    return res.status(400).json({ error: 'parties required' })
  const raidIds = Object.keys(parties)
  if (raidIds.length === 0) return res.status(400).json({ error: 'parties required' })

  const catalog = await getCatalog()
  const ownSquads = new Map(campaign.squads.map((s) => [s.id, s]))
  // Squads already committed to a raid earlier today, plus the ones this batch
  // draws on — a squad can raid only once per turn, and only once per batch.
  const committedSquads = new Set(campaign.raid.squadAssignment)
  const batchSquads = new Set()
  const cleanedByRaid = {} // raidId -> {type: count} flattened from its squads
  const squadsByRaid = {} // raidId -> [squad, …]
  for (const raidId of raidIds) {
    const opportunity = campaign.raid.opportunities.find((o) => o.id === raidId)
    if (!opportunity) return res.status(404).json({ error: `raid opportunity not found: ${raidId}` })
    if (opportunity.resolved)
      return res.status(400).json({ error: `this opportunity is already resolved: ${raidId}` })

    const squadIds = parties[raidId]
    if (!Array.isArray(squadIds) || squadIds.length === 0)
      return res.status(400).json({ error: `squad ids required for ${raidId}` })

    const squads = []
    const cleaned = {}
    let cost = 0
    for (const sid of squadIds) {
      if (!Number.isInteger(sid))
        return res.status(400).json({ error: `bad squad id for ${raidId}` })
      const squad = ownSquads.get(sid)
      if (!squad) return res.status(400).json({ error: `not one of your squads: squad_id ${sid}` })
      if (committedSquads.has(sid))
        return res.status(400).json({ error: `squad ${sid} is already committed to a raid today` })
      if (batchSquads.has(sid))
        return res.status(400).json({ error: `squad ${sid} is assigned to two raids at once` })
      batchSquads.add(sid)
      squads.push(squad)
      for (const [type, n] of squad.composition) {
        if (n <= 0) continue
        const unitType = catalog.get(type)
        if (!unitType?.placeable)
          return res.status(400).json({ error: `not a placeable unit type: ${type}` })
        cleaned[type] = (cleaned[type] ?? 0) + n
        cost += n * raidCapacityCost(unitType.stats, unitType.size)
      }
    }
    if (Object.keys(cleaned).length === 0)
      return res.status(400).json({ error: `squad ids required for ${raidId}` })
    if (cost > opportunity.capacity)
      return res.status(400).json({
        error: `party for ${raidId} exceeds the raid's capacity: ${Math.ceil(cost)}/${opportunity.capacity}`,
      })
    cleanedByRaid[raidId] = cleaned
    squadsByRaid[raidId] = squads
  }

  // Everything validated — now the irreversible part. Both sides of each
  // raid ride the shared zone spread (the same core the enemy's daily plan
  // uses); a raid is a short battle with no fortifications. The player side is
  // built per squad with a squad_id tag so the engine returns a per-squad
  // survivor breakdown (blue_squads), the same as the main battle route.
  const info = await getInfo()
  const sizeOf = new Map([...catalog.values()].map((t) => [t.name, t.size]))
  const zoneOf = (zone) => ({
    ...zone,
    width: info.grid.width,
    hexCapacity: info.grid.hexCapacity,
  })

  const results = []
  for (const raidId of raidIds) {
    const opportunity = campaign.raid.opportunities.find((o) => o.id === raidId)
    const cleaned = cleanedByRaid[raidId]
    const squads = squadsByRaid[raidId]
    const placer = makeZonePlacer(zoneOf(info.playerZone), sizeOf)
    // addBlock, not add: each squad lands on ONE hex so the engine builds it as
    // a single formation (it groups by hex + squad_id). Scattering a squad's
    // members over the zone would field N one-member squads instead — the raid
    // party would fight as loners. squad_name matches the main battle route so
    // the replay names the formation.
    for (const squad of squads)
      placer.addBlock(squad.composition, { squad_id: squad.id, squad_name: squad.name })
    const input = {
      map: MAP_NAME,
      player_placement: placer.result(),
      enemy_placement: spreadPlacement(
        Object.fromEntries(opportunity.targetForce),
        zoneOf(info.enemyZone),
        sizeOf,
      ),
      max_turns: RAID_MAX_TURNS,
    }
    const { error, battle, summary } = await runAndPersistBattle(input, req.user._id)
    if (error) return res.status(400).json({ error })

    // The party is replaced by its survivors (same reconciliation as the main
    // battle route). The committed troops stay in raid.assignment for the rest
    // of the day regardless of survivors — they already spent today's raid on
    // this opportunity — and the squads themselves in raid.squadAssignment.
    for (const [type, count] of Object.entries(cleaned)) {
      campaign.roster.set(type, (campaign.roster.get(type) ?? 0) - count + (summary.blue_survivors[type] ?? 0))
      campaign.raid.assignment.set(type, (campaign.raid.assignment.get(type) ?? 0) + count)
    }
    // Reconcile each raided squad with its own battle survivors, exactly like
    // the main battle route: composition = the squad's survivors, or the squad
    // is disbanded if the engine reports the formation wiped. This keeps the
    // invariant loose = roster − Σ squads.composition − forage intact.
    const squadSurvivors = summary.blue_squads ?? {}
    const raidedIds = new Set(squads.map((s) => s.id))
    campaign.squads = campaign.squads
      .filter((squad) => {
        if (!raidedIds.has(squad.id)) return true
        const result = squadSurvivors[String(squad.id)]
        return Boolean(result) && !result.wiped
      })
      .map((squad) => {
        if (raidedIds.has(squad.id)) squad.composition = squadSurvivors[String(squad.id)].survivors
        return squad
      })
    campaign.raid.squadAssignment.push(...raidedIds)

    // destroy_detachment (and a thins-enemy garrison_sortie, slice 4) inflict
    // their REAL battle casualties on the hidden enemy host, win OR lose
    // (docs/CAMPAIGN_PLAN.md Stage D): the slice that actually died is
    // targetForce − red_survivors. For destroy_detachment a WIN additionally
    // pursues the routing remainder (that second subtraction lives in
    // applyRaidReward), so a win removes the whole slice and a loss removes only
    // the real dead; a garrison_sortie is a spoiling attack — no pursuit, only
    // the real casualties. Loot/rescue/counter raids never pre-subtract their
    // (narrative) target force, so a lost one still leaves the host untouched.
    if (opportunity.type === 'destroy_detachment' || opportunity.thinsEnemy)
      for (const [type, n] of opportunity.targetForce) {
        const casualties = Math.max(0, n - (summary.red_survivors[type] ?? 0))
        campaign.enemy.army.set(type, Math.max(0, (campaign.enemy.army.get(type) ?? 0) - casualties))
      }

    const won = summary.winner === 'blue'
    const entries = [
      won
        ? `Raid on ${opportunity.title}: victory after ${summary.tickCount} turns.`
        : `Raid on ${opportunity.title}: the party is ${
            summary.winner === 'red' ? 'beaten back' : 'fought to a standstill'
          } after ${summary.tickCount} turns.`,
    ]
    if (won) entries.push(...applyRaidReward(campaign, opportunity, summary.red_survivors))
    opportunity.resolved = true
    opportunity.outcome = { winner: summary.winner, battleId: battle.id }
    campaign.battles.push(battle._id)
    entries.push(...checkAnnihilation(campaign))
    campaign.log.push({ day: campaign.day, entries })
    results.push({ raidId, ...summary })
  }

  await campaign.save()
  res.status(201).json({ results, campaign: await campaignView(campaign) })
})

// The raid scouting mini-game (Stage 4 Part 2.5): spend the per-turn
// scouting-points pool to shape the board. {action:'add_target'} scouts one new
// ordinary target; {action:'reveal', raidId, field:'reward'|'enemy'} pins that
// field of an existing target from a range to its exact value. Ownership /
// active / pending-choice guards mirror /raids/launch. Points-only spend — no
// battle runs here, and launching a partly-revealed target stays allowed (the
// fight always uses the hidden targetForce regardless of what's been bought).
router.post('/:id/raids/scout', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'raids')) return

  const action = req.body?.action

  if (action === 'add_target') {
    if (campaign.raid.scoutingPoints < RAID_SCOUT_COST_ADD)
      return res.status(400).json({ error: 'not enough scouting points' })
    const catalog = await getCatalog()
    const opportunity = addScoutedTarget(campaign, catalog)
    if (!opportunity)
      return res.status(400).json({ error: 'no more targets to scout — the enemy host is exhausted' })
    campaign.raid.scoutingPoints -= RAID_SCOUT_COST_ADD
    await campaign.save()
    return res.status(201).json({ campaign: await campaignView(campaign) })
  }

  if (action === 'reveal') {
    const { raidId, field } = req.body ?? {}
    if (field !== 'reward' && field !== 'enemy')
      return res.status(400).json({ error: "field must be 'reward' or 'enemy'" })
    const opportunity = campaign.raid.opportunities.find((o) => o.id === raidId)
    if (!opportunity) return res.status(404).json({ error: `raid opportunity not found: ${raidId}` })
    if (opportunity.resolved)
      return res.status(400).json({ error: `this opportunity is already resolved: ${raidId}` })
    // A slot-only reward (counter_event) has no numeric range to pin — nothing
    // to buy, so reject rather than silently burn points to no visible effect.
    if (field === 'reward' && !opportunity.rewardRange)
      return res.status(400).json({ error: 'this target has no reward intel to reveal' })
    if (campaign.raid.scoutingPoints < RAID_SCOUT_COST_REVEAL)
      return res.status(400).json({ error: 'not enough scouting points' })
    if (!revealField(opportunity, field))
      return res.status(400).json({ error: `${field} intel is already fully revealed` })
    campaign.raid.scoutingPoints -= RAID_SCOUT_COST_REVEAL
    await campaign.save()
    return res.status(201).json({ campaign: await campaignView(campaign) })
  }

  return res.status(400).json({ error: "action must be 'add_target' or 'reveal'" })
})

// Spend stores at the camp. {action:'fortify'} raises the fortification level
// (materials + labour) — the only spend action left: buying bodies moved to the
// Recruit phase (POST /:id/recruit/hire), where Militia is just the base tier of
// RECRUIT_POOL. Own-resource spend — no hidden info touched.
router.post('/:id/spend', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'prepare')) return

  const action = req.body?.action

  if (action === 'fortify') {
    if (atFortCap(campaign.fortificationLevel))
      return res.status(400).json({ error: 'fortifications already at maximum' })
    const cost = fortifyCost(campaign.fortificationLevel)
    if (campaign.resources.materials < cost)
      return res.status(400).json({ error: 'not enough materials' })
    const workerCost = fortifyWorkerCost(campaign.fortificationLevel)
    const workersAvailable = campaign.workers.total - campaign.workers.used
    if (workersAvailable < workerCost)
      return res.status(400).json({ error: 'not enough workers to raise the works' })
    campaign.resources.materials -= cost
    campaign.workers.used += workerCost
    campaign.fortificationLevel += 1
    campaign.log.push({
      day: campaign.day,
      entries: [`The works are raised to level ${campaign.fortificationLevel} (−${cost} materials, −${workerCost} workers).`],
    })
    await campaign.save()
    return res.json(await campaignView(campaign))
  }

  return res.status(400).json({ error: 'unknown spend action' })
})

// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"): open
// the phase and get the day's offer. The draw happens HERE, lazily, rather
// than at creation/end-day — the affordable pool is computed from the stores
// as they stand right now, so gold won from this turn's raids can put a caster
// on the board this turn (Raids precedes Recruit in the turn order precisely
// for that payoff). Idempotent: `drawnDay` seals the offer for the day, so
// re-entering the phase returns what was already drawn instead of rerolling
// it (and with it the day's ONE Fervor roll).
//
// This is also the DOOR into the recruit phase — the one phase step that isn't
// a pure state change, which is why POST /:id/phase refuses to make it. Both
// happen together: the offer is drawn and the turn moves on, closing forage,
// omens and raids behind it (rejectIfPhasePassed).
router.post('/:id/recruit/open', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhasePassed(campaign, res, 'recruit')) return

  // Saved unconditionally, unlike the draw: re-opening an already-drawn phase
  // is idempotent for the OFFER but must still stamp the phase (a reload that
  // lands here mid-turn is exactly how the client re-syncs).
  campaign.phase = 'recruit'
  if (campaign.recruit.drawnDay !== campaign.day) {
    const offer = drawRecruitOffer(recruitCtx(campaign))
    campaign.recruit.dailyOptions = offer.dailyOptions
    campaign.recruit.boosted = offer.boosted
    campaign.recruit.hiredToday = offer.hiredToday
    campaign.recruit.drawnDay = campaign.day
  }
  await campaign.save()
  res.json(await campaignView(campaign))
})

// The day's one hire, from today's sealed dailyOptions. {entryId} hires that
// option (boosted per today's ONE roll). There is no skip and no "nothing
// affordable" path: the Travellers card pads every offer, so a hire is always
// possible — and it is the ONLY way out of the phase, which is why the lock
// above can safely refuse everything else. This is also the only way to buy
// troops at all (the old POST /:id/spend {action:'militia'} was folded in as
// this pool's base tier in S4).
router.post('/:id/recruit/hire', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (campaign.recruit.drawnDay !== campaign.day)
    return res.status(400).json({ error: 'recruiting has not been opened today' })
  if (campaign.recruit.hiredToday)
    return res.status(400).json({ error: "today's recruiting is already resolved" })

  const entryId = req.body?.entryId
  if (!campaign.recruit.dailyOptions.includes(entryId))
    return res.status(400).json({ error: "not one of today's recruit options" })

  // Guarded lookup, like pendingChoices': an id whose entry has left the pool
  // mid-campaign degrades to a 400 instead of throwing on `.cost`.
  const entry = findRecruitEntry(entryId)
  if (!entry) return res.status(400).json({ error: 'that hire is no longer on offer' })

  const workersFree = campaign.workers.total - campaign.workers.used
  // Checked against the BOOST-RESOLVED cost — the same number campaignView
  // showed and applyHire is about to charge. Checking the raw entry.cost here
  // would reject a boosted-but-discounted hire the UI had legitimately
  // enabled. The phase lock means resources can't actually move between draw
  // and hire, so this is defence in depth: it is what makes "no hiring on
  // credit" true regardless of how the offer got there.
  const { cost } = resolveHire(entry, campaign.recruit.boosted, { resources: campaign.resources, workersFree })
  if (!canAfford(cost, campaign.resources, workersFree))
    return res.status(400).json({ error: 'not enough stores to hire that' })

  const entries = applyHire(campaign, entryId, campaign.recruit.boosted)
  campaign.recruit.hiredToday = true
  // Cleared, not left stale: hiredToday alone would still leave a resolveHire
  // preview computed against POST-hire resources in the view below — clearing
  // makes "nothing left to pick today" unambiguous.
  campaign.recruit.dailyOptions = []
  campaign.log.push({ day: campaign.day, entries })
  await campaign.save()
  res.json(await campaignView(campaign))
})

router.post('/:id/end-day', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
  if (rejectIfPhaseBefore(campaign, res, 'recruit')) return
  if (rejectIfBossFightUnfought(campaign, res)) return

  const report = await endDay(campaign)
  res.json({ report, campaign: await campaignView(campaign) })
})

// Resolve a pending choice-fate (events with choices): apply the picked
// branch, log it, clear the entry, and re-check annihilation — a branch can
// end the campaign (march a one-man army into the fever). `:slot` is the
// report/pending slot index; the option set comes from EVENT_POOL via the
// recorded eventId+rung, never from anything the client sent.
router.post('/:id/choices/:slot', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  const slot = Number(req.params.slot)
  const idx = campaign.pendingChoices.findIndex((p) => p.slot === slot)
  if (idx === -1) return res.status(404).json({ error: 'no decision pending for that fate' })

  const pending = campaign.pendingChoices[idx]
  const def = choiceRung(pending.eventId, pending.rung)
  if (!def) {
    // The pool moved out from under a sealed decision (mid-campaign edit):
    // drop the orphan rather than strand the campaign behind the gate.
    campaign.pendingChoices.splice(idx, 1)
    await campaign.save()
    return res.status(404).json({ error: 'that decision no longer exists' })
  }

  const option = def.choices.find((c) => c.id === req.body?.choice)
  if (!option) return res.status(400).json({ error: 'choice required' })

  // A deferred pending (its slot is counter-raid-targeted): record the pick
  // on the slot — it comes to pass at end-day unless the raid unmakes it.
  if (pending.deferred) {
    const slotDoc = campaign.augury.slots[slot]
    if (slotDoc) slotDoc.chosenChoice = option.id
    campaign.pendingChoices.splice(idx, 1)
    campaign.log.push({
      day: campaign.day,
      entries: [`${def.title}: you chose ${option.label} — it comes to pass at nightfall, unless your raiders strike first.`],
    })
    await campaign.save()
    return res.json({
      campaign: await campaignView(campaign),
      resolved: { slot, choice: option.id, label: option.label },
    })
  }

  const entries = [`${def.title}: you chose "${option.label}".`]
  entries.push(...applyEffect(campaign, option.effect))
  campaign.pendingChoices.splice(idx, 1)
  entries.push(...checkAnnihilation(campaign))
  // A campaign ended by the branch takes its remaining decisions with it
  // (same rule as end-day step 6): nothing may strand behind the gate.
  if (campaign.status !== 'active') campaign.pendingChoices = []
  campaign.log.push({ day: campaign.day, entries })
  await campaign.save()

  res.json({
    campaign: await campaignView(campaign),
    resolved: { slot, choice: option.id, label: option.label },
  })
})

export default router
