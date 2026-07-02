import { Router } from 'express'
import UnitType from '../models/unitType.js'

const router = Router()

// Unit catalog as synced from the engine at boot (see services/catalogSync.js).
router.get('/', async (_req, res) => {
  const units = await UnitType.find({}).sort({ name: 1 })
  res.json(units)
})

export default router
