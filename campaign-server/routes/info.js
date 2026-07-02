import { Router } from 'express'
import { getInfo } from '../services/engine.js'

const router = Router()

// Same contract as the C++ server's GET /api/info — keeps the existing
// frontend working unchanged while it talks to this server instead.
router.get('/', async (_req, res) => {
  res.json(await getInfo())
})

export default router
