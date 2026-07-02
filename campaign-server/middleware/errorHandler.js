// Central error mapping. Express 5 forwards rejected async handlers here
// automatically. When the auth module lands, its tokenExtractor/userExtractor
// middlewares slot in before the routes and their errors map here too.
export function errorHandler(err, _req, res, _next) {
  switch (err.name) {
    case 'CastError':
      return res.status(400).json({ error: 'malformed id' })
    case 'ValidationError':
      return res.status(400).json({ error: err.message })
    case 'EngineProcessError':
      return res.status(502).json({ error: 'battle engine failed' })
    case 'EngineOutputError':
      return res.status(500).json({ error: 'battle engine returned invalid output' })
    default:
      console.error(err)
      return res.status(500).json({ error: 'internal server error' })
  }
}
