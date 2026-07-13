import { Router } from 'express'
import Campaign, { CAMPAIGN_SCHEMA_VERSION } from '../models/campaign.js'
import UnitType from '../models/unitType.js'
import { userExtractor } from '../middleware/auth.js'
import { campaignView } from '../services/campaignView.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import { endDay, checkAnnihilation } from '../services/dayResolution.js'
import { drawAugury, consultAugury, rerollAugurySlot } from '../services/augury.js'
import { buildEnemyPlacement } from '../services/enemyPlacement.js'
import { enemyForagePlanKg } from '../services/enemyAi.js'
import { fortifiedSidesFor, fortifyCost, fortifyWorkerCost, atFortCap } from '../services/fortification.js'
import { findOverstackedHex } from '../services/placementCapacity.js'
import { getInfo } from '../services/engine.js'
import { getCatalog } from '../utils/catalog.js'
import config from '../utils/config.js'
import {
  MAP_NAME,
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

router.post('/', async (req, res) => {
  const campaign = await Campaign.create({
    user: req.user._id,
    resources: { food: STARTING_FOOD, materials: STARTING_MATERIALS },
    workers: { total: STARTING_WORKERS, used: 0 },
    roster: STARTING_ROSTER,
    squads: STARTING_SQUADS,
    forage: {
      rings: FORAGE_RINGS.map((richness, ring) => ({ ring, richness, initialRichness: richness })),
      assignment: {},
      enemyPlan: enemyForagePlanKg(ENEMY_ARMY, await getCatalog()),
    },
    augury: drawAugury(),
    enemy: {
      army: ENEMY_ARMY,
      initialStrength: Object.values(ENEMY_ARMY).reduce((a, b) => a + b, 0),
      supplies: ENEMY_SUPPLIES,
      stance: 'camp',
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
  if (!campaign.augury.consulted)
    return res.status(400).json({ error: 'consult the augur before rerolling' })
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

// Fight today's battle. The server owns the map and the enemy: the client
// sends only its own placement; enemy_placement is the campaign's hidden
// plannedPlacement, so the battle matches whatever scouting revealed.
router.post('/:id/battles', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (campaign.battleFoughtToday) return res.status(400).json({ error: 'battle already fought today' })

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
    // Units out foraging are unavailable for today's battle.
    const foraging = campaign.forage.assignment.get(type) ?? 0
    if (count > (campaign.roster.get(type) ?? 0) - foraging)
      return res.status(400).json({
        error: foraging > 0
          ? `not enough ${type} in camp (${foraging} out foraging)`
          : `not enough ${type} in the roster`,
      })
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
    inCamp += n - (campaign.forage.assignment.get(type) ?? 0) - (placed.get(type) ?? 0)
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
  campaign.log.push({
    day: campaign.day,
    entries: [
      `Battle joined — ${summary.winner === 'blue' ? 'victory' : summary.winner === 'red' ? 'defeat' : 'stalemate'} after ${summary.tickCount} turns.`,
      ...checkAnnihilation(campaign),
    ],
  })
  await campaign.save()

  res.status(201).json({ ...summary, campaign: await campaignView(campaign) })
})

// Spend stores at the camp. {action:'fortify'} raises the fortification level
// (materials); {action:'militia', count} buys bodies (food + materials, per-turn
// capped). Own-resource spend — no hidden info touched.
router.post('/:id/spend', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

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
    campaign.workers.used += workerCost
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

  const report = await endDay(campaign)
  res.json({ report, campaign: await campaignView(campaign) })
})

export default router
