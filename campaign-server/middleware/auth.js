import jwt from 'jsonwebtoken'
import User from '../models/user.js'
import config from '../utils/config.js'

// tokenExtractor runs globally (app.js): it only parses the Authorization
// header into req.token, costing nothing on public routes. userExtractor is
// added per protected route and does the actual verification + DB lookup.

export const tokenExtractor = (req, _res, next) => {
  const auth = req.get('authorization')
  req.token = auth && auth.toLowerCase().startsWith('bearer ')
    ? auth.substring(7)
    : null
  next()
}

export const userExtractor = async (req, res, next) => {
  if (!req.token) return res.status(401).json({ error: 'token missing' })
  // jwt.verify throws JsonWebTokenError/TokenExpiredError on bad/stale tokens;
  // Express 5 forwards those to errorHandler, which maps them to 401.
  const decoded = jwt.verify(req.token, config.SECRET)
  if (!decoded.id) return res.status(401).json({ error: 'token invalid' })
  const user = await User.findById(decoded.id)
  if (!user) return res.status(401).json({ error: 'user not found' })
  req.user = user
  next()
}
