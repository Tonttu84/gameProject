import { Router } from 'express'
import { runAndPersistSample } from '../services/battleRunner.js'

const router = Router()

// Unauthenticated: the login screen's "Watch a battle" button launches the
// hardcoded sample scenario so a visitor sees the engine before signing up.
// It rides the SAME pipeline as a campaign battle — engine → Battle + Tick docs
// — and returns the summary; the client then plays it via the public
// GET /api/battles/:id/ticks route, so ReplayView renders it straight from the
// DB (the only renderer since SFML retired). The battle is ownerless
// (user: null). Engine failures surface as 502/500 through the shared error
// handler (Express 5 forwards the async rejection).
router.post('/', async (_req, res) => {
  const { error, summary } = await runAndPersistSample()
  if (error) return res.status(400).json({ error })
  res.status(201).json(summary)
})

export default router
