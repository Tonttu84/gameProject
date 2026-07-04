import { Router } from 'express'
import Campaign, { CAMPAIGN_SCHEMA_VERSION } from '../models/campaign.js'
import UnitType from '../models/unitType.js'
import { userExtractor } from '../middleware/auth.js'
import { campaignView } from '../services/campaignView.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import { endDay } from '../services/dayResolution.js'
import { drawAugury, consultAugury, rerollAugury } from '../services/augury.js'
import { buildEnemyPlacement } from '../services/enemyPlacement.js'
import { enemyForagePlanKg } from '../services/enemyAi.js'
import { getCatalog } from '../utils/catalog.js'
import {
  MAP_NAME,
  STARTING_ROSTER,
  STARTING_FOOD,
  STARTING_MATERIALS,
  ENEMY_ARMY,
  ENEMY_SUPPLIES,
  FORAGE_RINGS,
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
const findOwn = async (req) =>
  Campaign.findOne({
    _id: req.params.id,
    user: req.user._id,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  })

router.post('/', async (req, res) => {
  const campaign = await Campaign.create({
    user: req.user._id,
    resources: { food: STARTING_FOOD, materials: STARTING_MATERIALS },
    roster: STARTING_ROSTER,
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
  // Campaigns from an incompatible schema version are deleted, not migrated
  // (no backwards compatibility — the client then offers a fresh campaign).
  await Campaign.deleteMany({
    user: req.user._id,
    schemaVersion: { $ne: CAMPAIGN_SCHEMA_VERSION },
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

// Consult the augur: one reading per turn. The response's campaign view
// carries the prophecy card + raw roll; whether it was TRUE stays hidden
// until end-of-turn.
router.post('/:id/augury/consult', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (campaign.augury.consulted)
    return res.status(400).json({ error: 'the augur has already spoken today' })

  const shown = consultAugury(campaign)
  campaign.log.push({
    day: campaign.day,
    entries: [`The augur speaks: ${shown.title}.`],
  })
  await campaign.save()
  res.json(await campaignView(campaign))
})

// Reroll the bones: REPLACES fate — both events are redrawn (the old true
// event will never fire) and read fresh. Requires a prior consult and a
// remaining reroll.
router.post('/:id/augury/reroll', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })
  if (!campaign.augury.consulted)
    return res.status(400).json({ error: 'consult the augur before rerolling' })
  if (campaign.augury.rerollsRemaining <= 0)
    return res.status(400).json({ error: 'no rerolls remaining' })

  const shown = rerollAugury(campaign)
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

  // The roster is the budget: you can only field units you own.
  const placed = new Map()
  for (const entry of placement) {
    if (!entry || typeof entry.unit_type !== 'string')
      return res.status(400).json({ error: 'malformed placement entry' })
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

  const input = {
    map: MAP_NAME,
    player_placement: placement,
    enemy_placement: campaign.enemy.plannedPlacement ?? [],
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
  campaign.battleFoughtToday = true
  campaign.battles.push(battle._id)
  campaign.log.push({
    day: campaign.day,
    entries: [`Battle joined — ${summary.winner === 'blue' ? 'victory' : summary.winner === 'red' ? 'defeat' : 'stalemate'} after ${summary.tickCount} turns.`],
  })
  await campaign.save()

  res.status(201).json({ ...summary, campaign: await campaignView(campaign) })
})

router.post('/:id/end-day', async (req, res) => {
  const campaign = await findOwn(req)
  if (!campaign) return res.status(404).json({ error: 'campaign not found' })
  if (campaign.status !== 'active') return res.status(400).json({ error: 'campaign is over' })

  const report = await endDay(campaign)
  res.json({ report, campaign: await campaignView(campaign) })
})

export default router
