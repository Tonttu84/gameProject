// Central error mapping. Express 5 forwards rejected async handlers here
// automatically, including jwt.verify throws from middleware/auth.js.
export function errorHandler(err, _req, res, _next) {
  // Duplicate-key comes through as the raw driver error; only code 11000 is a
  // client error (unique index violation) — other MongoServerErrors fall
  // through to the default 500. The users collection's only unique index is
  // username, so the message can be specific.
  if (err.name === 'MongoServerError' && err.code === 11000)
    return res.status(400).json({ error: 'expected `username` to be unique' })

  switch (err.name) {
    case 'CastError':
      return res.status(400).json({ error: 'malformed id' })
    case 'ValidationError':
      return res.status(400).json({ error: err.message })
    case 'JsonWebTokenError':
      return res.status(401).json({ error: 'token invalid' })
    case 'TokenExpiredError':
      return res.status(401).json({ error: 'token expired' })
    case 'EngineProcessError':
      return res.status(502).json({ error: 'battle engine failed' })
    case 'EngineOutputError':
      return res.status(500).json({ error: 'battle engine returned invalid output' })
    default:
      console.error(err)
      return res.status(500).json({ error: 'internal server error' })
  }
}
