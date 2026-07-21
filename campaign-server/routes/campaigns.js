import { Router } from 'express'
import Campaign, { CAMPAIGN_SCHEMA_VERSION } from '../models/campaign.js'
import UnitType from '../models/unitType.js'
import { userExtractor } from '../middleware/auth.js'
import { campaignView } from '../services/campaignView.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import { endDay, acceptFates, checkAnnihilation } from '../services/dayResolution.js'
import { applyEffect, choiceRung } from '../services/events.js'
import { drawAugury, consultAugury, rerollAugurySlot } from '../services/augury.js'
import { buildEnemyPlacement, spreadPlacement } from '../services/enemyPlacement.js'
import { enemyForagePlanKg } from '../services/enemyAi.js'
import { generateRaidOpportunities, applyRaidReward, revealField, addScoutedTarget } from '../services/raid.js'
import { fortifiedSidesFor, fortifyCost, fortifyWorkerCost, atFortCap } from '../services/fortification.js'
import { findOverstackedHex } from '../services/placementCapacity.js'
import { getInfo } from '../services/engine.js'
import { getCatalog } from '../utils/catalog.js'
import { raidCapacityCost, scoutingPointsFor } from '../utils/capabilities.js'
import config from '../utils/config.js'
import {
  MAP_NAME,
  RAID_MAX_TURNS,
  STARTING_ROSTER,
  STARTING_SQUADS,
  STARTING_FOOD,
  STARTING_MATERIALS,
  STARTING_WORKERS,
  ENEMY_ARMY,
  ENEMY_SUPPLIES,
  FORAGE_RINGS,
  MILITIA_FOOD_COST,
  MILITIA_MATERIAL_COST,
  MILITIA_WORKER_COST,
  MILITIA_DAILY_CAP,
  MILITIA_UNIT,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
} from '../utils/campaignConfig.js'

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
  const campaign = await Campaign.create({
    user: req.user._id,
    resources: { food: STARTING_FOOD, materials: STARTING_MATERIALS },
    workers: { total: STARTING_WORKERS, used: 0 },
    roster: STARTING_ROSTER,
    squads: STARTING_SQUADS,
    forage: {
      rings: FORAGE_RINGS.map((richness, ring) => ({ ring, richness, initialRichness: richness })),
      assignment: {},
      enemyPlan: enemyForagePlanKg(ENEMY_ARMY, catalog),
    },
    augury,
    // Day-1 raid board: one base target (+ any counters), plus the turn's
    // scouting-points pool derived from the starting roster's recon capability.
    // end-day redeals both each new turn.
    raid: {
      opportunities: generateRaidOpportunities(
        { day: 1, augury, enemy: { army: ENEMY_ARMY } },
        catalog,
      ),
      scoutingPoints: scoutingPointsFor(STARTING_ROSTER, catalog),
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

// Set (replace) today's forager assignment: {assignment: {type: count}}.
// Assigned units sweep the rings at end-of-turn and are unavailable for the
// turn's battle. Can be re-issued any time before end-day.
router.post('/:id/forage', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  const assignment = req.body?.assignment
  if (assignment === null || typeof assignment !== 'object' || Array.isArray(assignment))
    return res.status(400).json({ error: 'assignment required' })

  const cleaned = {}
  for (const [type, count] of Object.entries(assignment)) {
    if (!Number.isInteger(count) || count < 0)
      return res.status(400).json({ error: `bad count for ${type}` })
    if (count > (campaign.roster.get(type) ?? 0))
      return res.status(400).json({ error: `not enough ${type} in the roster` })
    if (count > 0) cleaned[type] = count
  }

  campaign.forage.assignment = cleaned
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
    // Units out foraging OR committed to a raid this turn are unavailable for
    // the battle (raid.assignment mirrors forage.assignment — a raided unit
    // must not be double-counted onto the battle line as well).
    const foraging = campaign.forage.assignment.get(type) ?? 0
    const raiding = campaign.raid.assignment.get(type) ?? 0
    if (count > (campaign.roster.get(type) ?? 0) - foraging - raiding) {
      const away = [
        foraging > 0 && `${foraging} out foraging`,
        raiding > 0 && `${raiding} out raiding`,
      ].filter(Boolean).join(', ')
      return res.status(400).json({
        error: away
          ? `not enough ${type} in camp (${away})`
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
  // foraging must take the field — no reserves skulking in camp.
  let inCamp = 0
  for (const [type, n] of campaign.roster)
    inCamp += n
      - (campaign.forage.assignment.get(type) ?? 0)
      - (campaign.raid.assignment.get(type) ?? 0)
      - (placed.get(type) ?? 0)
  if (inCamp > 0)
    return res.status(400).json({
      error: `the whole army must take the field — ${inCamp} units still in camp`,
    })

  const input = {
    map: MAP_NAME,
    player_placement: placement,
    enemy_placement: campaign.enemy.plannedPlacement ?? [],
    // The player's paid-for fortifications for this battle: the map file is
    // static, the level is dynamic, so the walled sides are injected here.
    fortified_sides: fortifiedSidesFor(MAP_NAME, campaign.fortificationLevel),
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
// The whole batch is ONE request (not one call per opportunity) so overlap
// between raids launched together is caught in one place: a unit type can't
// be double-booked across two opportunities in the same click just because
// each was validated in isolation. `campaign.raid.assignment` extends that
// guarantee across SEPARATE requests within the same day (see the schema
// comment) — a unit already sent on an earlier raid this turn is unavailable
// to a later batch too, even if the roster count alone would look sufficient.
// Validation runs to completion BEFORE any battle is spawned: battles are
// external subprocesses that can't be rolled back, so a bad request must be
// rejected wholesale, never partially applied.
router.post('/:id/raids/launch', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  if (rejectIfChoicePending(campaign, res)) return

  const parties = req.body?.parties
  if (parties === null || typeof parties !== 'object' || Array.isArray(parties))
    return res.status(400).json({ error: 'parties required' })
  const raidIds = Object.keys(parties)
  if (raidIds.length === 0) return res.status(400).json({ error: 'parties required' })

  const catalog = await getCatalog()
  const cleanedByRaid = {}
  const requested = {} // Σ count per unit type, across every raid in this batch
  for (const raidId of raidIds) {
    const opportunity = campaign.raid.opportunities.find((o) => o.id === raidId)
    if (!opportunity) return res.status(404).json({ error: `raid opportunity not found: ${raidId}` })
    if (opportunity.resolved)
      return res.status(400).json({ error: `this opportunity is already resolved: ${raidId}` })

    const party = parties[raidId]
    if (party === null || typeof party !== 'object' || Array.isArray(party))
      return res.status(400).json({ error: `party required for ${raidId}` })

    const cleaned = {}
    let cost = 0
    for (const [type, count] of Object.entries(party)) {
      if (!Number.isInteger(count) || count < 0)
        return res.status(400).json({ error: `bad count for ${type}` })
      if (count === 0) continue
      const unitType = catalog.get(type)
      if (!unitType?.placeable)
        return res.status(400).json({ error: `not a placeable unit type: ${type}` })
      cleaned[type] = count
      requested[type] = (requested[type] ?? 0) + count
      cost += count * raidCapacityCost(unitType.stats, unitType.size)
    }
    if (Object.keys(cleaned).length === 0)
      return res.status(400).json({ error: `party required for ${raidId}` })
    if (cost > opportunity.capacity)
      return res.status(400).json({
        error: `party for ${raidId} exceeds the raid's capacity: ${Math.ceil(cost)}/${opportunity.capacity}`,
      })
    cleanedByRaid[raidId] = cleaned
  }

  // Availability: roster minus today's foragers minus troops already
  // committed to a raid this turn — checked against the BATCH TOTAL per type,
  // so two raids in the same request can't each claim the same soldiers.
  for (const [type, count] of Object.entries(requested)) {
    const foraging = campaign.forage.assignment.get(type) ?? 0
    const raiding = campaign.raid.assignment.get(type) ?? 0
    if (count > (campaign.roster.get(type) ?? 0) - foraging - raiding)
      return res.status(400).json({
        error: foraging > 0
          ? `not enough ${type} in camp (${foraging} out foraging)`
          : raiding > 0
            ? `not enough ${type} in camp (${raiding} already committed to a raid today)`
            : `not enough ${type} in the roster`,
      })
  }

  // Everything validated — now the irreversible part. Both sides of each
  // raid ride the shared zone spread (the same core the enemy's daily plan
  // uses); a raid is a short battle with no fortifications.
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
    const input = {
      map: MAP_NAME,
      player_placement: spreadPlacement(cleaned, zoneOf(info.playerZone), sizeOf),
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
    // this opportunity.
    for (const [type, count] of Object.entries(cleaned)) {
      campaign.roster.set(type, (campaign.roster.get(type) ?? 0) - count + (summary.blue_survivors[type] ?? 0))
      campaign.raid.assignment.set(type, (campaign.raid.assignment.get(type) ?? 0) + count)
    }

    // destroy_detachment inflicts its REAL battle casualties on the hidden
    // enemy host, win OR lose (docs/CAMPAIGN_PLAN.md Stage D): the slice that
    // actually died is targetForce − red_survivors. A WIN additionally pursues
    // the routing remainder — that second subtraction lives in applyRaidReward
    // below, so a win removes the whole slice and a loss removes only the real
    // dead. The other raid types never pre-subtract their (narrative) target
    // force, so a lost loot/rescue/counter raid still leaves the host untouched.
    if (opportunity.type === 'destroy_detachment')
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
// (materials); {action:'militia', count} buys bodies (food + materials, per-turn
// capped). Own-resource spend — no hidden info touched.
router.post('/:id/spend', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  if (rejectIfChoicePending(campaign, res)) return

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

  if (action === 'militia') {
    const count = req.body?.count
    if (!Number.isInteger(count) || count <= 0)
      return res.status(400).json({ error: 'count required' })
    if (campaign.militiaBoughtToday + count > MILITIA_DAILY_CAP)
      return res.status(400).json({
        error: `militia limited to ${MILITIA_DAILY_CAP} per turn (${campaign.militiaBoughtToday} already raised)`,
      })
    const foodCost = count * MILITIA_FOOD_COST
    const materialCost = count * MILITIA_MATERIAL_COST
    if (campaign.resources.food < foodCost || campaign.resources.materials < materialCost)
      return res.status(400).json({ error: 'not enough stores' })
    const workerCost = count * MILITIA_WORKER_COST
    const workersAvailable = campaign.workers.total - campaign.workers.used
    if (workersAvailable < workerCost)
      return res.status(400).json({ error: 'not enough workers to muster militia' })
    campaign.resources.food -= foodCost
    campaign.resources.materials -= materialCost
    // Unlike fort labour, these workers don't stay in the workforce busy —
    // they leave it entirely to become roster soldiers, so they come off
    // `total`, not `used` (see the campaignConfig.js STARTING_WORKERS comment).
    campaign.workers.total -= workerCost
    campaign.roster.set(MILITIA_UNIT, (campaign.roster.get(MILITIA_UNIT) ?? 0) + count)
    campaign.militiaBoughtToday += count
    campaign.log.push({
      day: campaign.day,
      entries: [`${count} militia join the ranks (−${foodCost} food, −${materialCost} materials, −${workerCost} workers).`],
    })
    await campaign.save()
    return res.json(await campaignView(campaign))
  }

  return res.status(400).json({ error: 'unknown spend action' })
})

router.post('/:id/end-day', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (rejectIfChoicePending(campaign, res)) return
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
