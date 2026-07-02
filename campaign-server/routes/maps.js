import fs from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import config from '../utils/config.js'

const router = Router()

// Stricter than the C++ isSafeMapName: allow only [A-Za-z0-9_-], which
// excludes '..', separators, and anything else path-like outright.
const SAFE_MAP_NAME = /^[A-Za-z0-9_-]+$/

// Same contract as the C++ server's GET /api/map?name=
router.get('/', async (req, res) => {
  const name = req.query.name ?? 'sample_battle'
  if (typeof name !== 'string' || !SAFE_MAP_NAME.test(name))
    return res.status(400).json({ error: 'invalid map name' })

  try {
    const body = await fs.readFile(path.join(config.MAPS_DIR, `${name}.json`), 'utf8')
    res.type('application/json').send(body)
  } catch {
    res.status(404).json({ error: 'map not found' })
  }
})

export default router
