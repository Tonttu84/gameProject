import { Router } from 'express'
import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { runBattle } from '../services/engine.js'

const router = Router()

// Run one battle through the engine and persist it: one Battle doc plus one
// Tick doc per turn (separate collection so long battles never approach the
// 16MB document limit). The response is the summary only — the replay is
// fetched tick-range by tick-range for scrubbing.
router.post('/', async (req, res) => {
  const input = req.body ?? {}
  const result = await runBattle(input)

  // Engine-level rejections (bad map name, empty input …) come back as
  // {"error": ...} on stdout with exit 0 — client error, nothing to store.
  if (result.error) return res.status(400).json({ error: result.error })

  const replay = result.replay ?? { map: input.map ?? 'unknown', cols: 0, rows: 0, ticks: [] }

  const battle = await Battle.create({
    map: replay.map,
    input,
    winner: result.winner,
    blueSurvivors: result.blue_survivors ?? {},
    redSurvivors: result.red_survivors ?? {},
    tickCount: replay.ticks.length,
    cols: replay.cols,
    rows: replay.rows,
  })

  if (replay.ticks.length > 0)
    await Tick.insertMany(
      replay.ticks.map((t) => ({
        battle: battle._id,
        index: t.tick,
        units: t.units,
        log: t.log ?? [],
      })),
    )

  // One line per battle so battle lengths are easy to eyeball in the server
  // console; the same number is stored as tickCount for querying.
  console.log(`battle ${battle.id}: ${replay.ticks.length} ticks, winner ${result.winner}`)

  res.status(201).json({
    id: battle.id,
    winner: result.winner,
    blue_survivors: result.blue_survivors ?? {},
    red_survivors: result.red_survivors ?? {},
    tickCount: replay.ticks.length,
  })
})

router.get('/:id', async (req, res) => {
  const battle = await Battle.findById(req.params.id)
  if (!battle) return res.status(404).json({ error: 'battle not found' })
  res.json(battle)
})

// Tick range for the replay scrubber. Defaults to the whole replay; the
// frontend fetches in chunks (?from=&to=) as the user scrubs.
router.get('/:id/ticks', async (req, res) => {
  const from = Math.max(0, Number(req.query.from) || 0)
  const toRaw = Number(req.query.to)
  const to = Number.isFinite(toRaw) ? toRaw : Number.MAX_SAFE_INTEGER

  const ticks = await Tick.find({
    battle: req.params.id,
    index: { $gte: from, $lte: to },
  }).sort({ index: 1 })

  res.json(ticks)
})

export default router
