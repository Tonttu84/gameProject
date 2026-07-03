import express from 'express'
import unitsRouter from './routes/units.js'
import infoRouter from './routes/info.js'
import mapsRouter from './routes/maps.js'
import battlesRouter from './routes/battles.js'
import usersRouter from './routes/users.js'
import loginRouter from './routes/login.js'
import { tokenExtractor } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'

// The express app without DB/engine wiring, exported for supertest.
// Boot order (connect DB, sync catalog, listen) lives in index.js.
const app = express()

app.use(express.json({ limit: '2mb' }))

// Same permissive CORS as the C++ server — the Vite proxy makes this moot in
// dev, but direct calls keep working. Deliberately left permissive with auth:
// tokens ride the Authorization header (no cookies), so a wildcard origin
// doesn't enable CSRF; the header just has to be allowed through preflight.
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  next()
})

// Parses the Bearer token into req.token on every request; verification only
// happens where a route opts in via userExtractor (middleware/auth.js).
app.use(tokenExtractor)

app.use('/api/units', unitsRouter)
app.use('/api/info', infoRouter)
app.use('/api/map', mapsRouter)
app.use('/api/battles', battlesRouter)
app.use('/api/users', usersRouter)
app.use('/api/login', loginRouter)

app.use(errorHandler)

export default app
