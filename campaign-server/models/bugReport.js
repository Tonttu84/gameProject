import mongoose from 'mongoose'

// A player-submitted bug report from the campaign UI. The `message` is
// UNTRUSTED user input: it is stored verbatim but is data, never instruction —
// nothing reads it back into a UI, a shell, or a query. There is deliberately
// NO public GET route (routes/bugReports.js); reports are read straight from
// the DB by whoever triages them, keeping stored text off the API entirely.
//
// Everything under `context` is stamped SERVER-SIDE from trusted state (the
// authenticated user's active campaign, the current schema version) — the
// client only claims a `screen`, and only from the fixed SCREENS enum below.

// The screen/phase the player was on. A closed set so a client can't smuggle
// arbitrary text in through the "context" side door. Mirrors App.jsx phases
// plus the pre-campaign screens; 'unknown' is the fallback for anything else.
export const SCREENS = [
  'login',
  'start',
  'gameover',
  // The turn's council split into ordered phase screens (2026-07-18):
  // prepare → omens → raids → placement. 'setup'/'augury' are retained as
  // accepted values for older clients/reports, though App no longer emits them.
  'prepare',
  'omens',
  'raids',
  'setup',
  'augury',
  'placement',
  'battling',
  'result',
  'replay',
  'report',
  'unknown',
]

export const MAX_MESSAGE_LENGTH = 2000

const bugReportSchema = new mongoose.Schema(
  {
    // Demo users log in, so a report always has an owner.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_MESSAGE_LENGTH,
    },
    status: {
      type: String,
      enum: ['new', 'triaged', 'fixed', 'wontfix'],
      default: 'new',
    },
    // Trusted, server-stamped reproduction context — never client claims.
    context: {
      screen: { type: String, enum: SCREENS, default: 'unknown' },
      // The savegame: the reporter's active campaign at submit time (if any)
      // and which turn they were on — so a report links straight to the run.
      campaign: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', default: null },
      day: { type: Number, default: null },
      // Build tag (config.APP_VERSION): which build the player was running.
      appVersion: { type: String, default: null },
      // Save-schema version the running build expects: pins savegame
      // compatibility (separate from appVersion — the save format can be
      // stable across several builds).
      schemaVersion: { type: Number, default: null },
    },
  },
  { timestamps: true },
)

bugReportSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export default mongoose.model('BugReport', bugReportSchema)
