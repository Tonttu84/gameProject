import { Router } from 'express'
import BugReport, { SCREENS, MAX_MESSAGE_LENGTH } from '../models/bugReport.js'
import Campaign, { CAMPAIGN_SCHEMA_VERSION } from '../models/campaign.js'
import { userExtractor } from '../middleware/auth.js'
import config from '../utils/config.js'

const router = Router()

// Every route here requires a login: a report is always owned by a user.
router.use(userExtractor)

// A demo guest could otherwise flood the collection; cap submissions per user
// over a rolling window. Small numbers by design — this is a report button,
// not a chat box.
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

// POST /api/bug-reports  { message, screen? }
// The body is UNTRUSTED: accept ONLY a string message and an enum screen,
// reject anything else, and stamp the reproduction context server-side from
// the caller's own state. Nothing here is echoed into a UI.
router.post('/', async (req, res) => {
  const body = req.body ?? {}

  // Reject unknown fields outright rather than silently dropping them — keeps
  // the contract tight and surfaces client mistakes instead of storing junk.
  const allowed = new Set(['message', 'screen'])
  const unknown = Object.keys(body).filter((k) => !allowed.has(k))
  if (unknown.length > 0)
    return res.status(400).json({ error: `unexpected field(s): ${unknown.join(', ')}` })

  const { message } = body
  if (typeof message !== 'string')
    return res.status(400).json({ error: 'message required' })
  const trimmed = message.trim()
  if (trimmed.length === 0)
    return res.status(400).json({ error: 'message required' })
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return res.status(400).json({ error: `message too long (max ${MAX_MESSAGE_LENGTH} characters)` })

  // A client-claimed screen is only trusted as far as the fixed enum; anything
  // else collapses to 'unknown' rather than being rejected — a mislabelled
  // report is still worth having.
  const screen = SCREENS.includes(body.screen) ? body.screen : 'unknown'

  const since = new Date(Date.now() - RATE_WINDOW_MS)
  const recent = await BugReport.countDocuments({
    user: req.user._id,
    createdAt: { $gte: since },
  })
  if (recent >= RATE_LIMIT)
    return res.status(429).json({ error: 'too many bug reports — please try again later' })

  // Trusted reproduction context: the caller's current active campaign (if
  // any) and the running build's schema version. Never client claims.
  const campaign = await Campaign.findOne({
    user: req.user._id,
    status: 'active',
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  }).sort({ _id: -1 })

  const report = await BugReport.create({
    user: req.user._id,
    message: trimmed,
    context: {
      screen,
      campaign: campaign?._id ?? null,
      day: campaign?.day ?? null,
      appVersion: config.APP_VERSION,
      schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    },
  })

  // Minimal ack: don't echo the stored text back out (no reason to, and it
  // keeps report content off the API surface).
  res.status(201).json({ id: report._id.toString(), createdAt: report.createdAt })
})

export default router
