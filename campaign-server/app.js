import express from 'express'
import unitsRouter from './routes/units.js'
import infoRouter from './routes/info.js'
import mapsRouter from './routes/maps.js'
import battlesRouter from './routes/battles.js'
import { errorHandler } from './middleware/errorHandler.js'

// The express app without DB/engine wiring, exported for supertest.
// Boot order (connect DB, sync catalog, listen) lives in index.js.
const app = express()

app.use(express.json({ limit: '2mb' }))

// Same permissive CORS as the C++ server — the Vite proxy makes this moot in
// dev, but direct calls keep working. Tighten when auth lands.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

app.use('/api/units', unitsRouter)
app.use('/api/info', infoRouter)
app.use('/api/map', mapsRouter)
app.use('/api/battles', battlesRouter)

app.use(errorHandler)

export default app
