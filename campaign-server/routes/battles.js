import { Router } from 'express'
import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import { userExtractor } from '../middleware/auth.js'

const router = Router()

// Sandbox battle: runs the request body through the engine as-is (no campaign
// state involved). The run-and-persist logic lives in services/battleRunner.js
// and is shared with campaign battles. The response is the summary only — the
// replay is fetched tick-range by tick-range for scrubbing.
// Requires a login (userExtractor); replays and catalog reads stay public.
router.post('/', userExtractor, async (req, res) => {
  const input = req.body ?? {}
  const { error, summary } = await runAndPersistBattle(input, req.user._id)

  // Engine-level rejections (bad map name, empty input …) come back as
  // {"error": ...} on stdout with exit 0 — client error, nothing stored.
  if (error) return res.status(400).json({ error })

  res.status(201).json(summary)
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
