import mongoose from 'mongoose'

// One roguelite campaign run per document. HIDDEN INFORMATION lives here in
// plain fields — enemy.army, enemy.plannedPlacement, events[].isReal,
// forage.enemyPlan — and must NEVER reach a client through Mongoose toJSON. Every response goes
// through services/campaignView.js, the single serializer that decides what
// the player may see. Do not add routes that res.json() a campaign document.

const eventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    effect: { type: mongoose.Schema.Types.Mixed, required: true },
    probability: { type: Number, default: 0 }, // display-only
    isReal: { type: Boolean, required: true }, // HIDDEN
  },
  { _id: false },
)

// Forage rings around the shared camp area: near/mid/far, near depletes
// first, no regrowth — the emptying land is the campaign clock.
const ringSchema = new mongoose.Schema(
  {
    ring: { type: Number, required: true }, // 0 near, 1 mid, 2 far
    richness: { type: Number, required: true },
    initialRichness: { type: Number, required: true },
  },
  { _id: false },
)

const campaignSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['active', 'won', 'lost'], default: 'active' },
  // One `day` = one campaign turn = two weeks of campaigning (DAYS_PER_TURN).
  day: { type: Number, default: 1 },
  battleFoughtToday: { type: Boolean, default: false },

  resources: {
    food: { type: Number, required: true },
    materials: { type: Number, required: true },
  },
  // Unit-type name -> count. Names validated against the unittypes collection
  // at the routes that mutate it.
  roster: { type: Map, of: Number, required: true },

  // Legacy 0-100 augury bias (v1 pick-a-card port); replaced by the
  // true-event/decoy prediction rework in a later stage.
  auguryScore: { type: Number, default: 50 },
  events: {
    drawn: { type: [eventSchema], default: [] },
    picked: { type: Boolean, default: false },
  },

  forage: {
    rings: { type: [ringSchema], required: true },
    // This turn's player forager assignment, unit-type → count. Assigned
    // units are unavailable for the turn's battle; cleared at newDay.
    assignment: { type: Map, of: Number, default: {} },
    // Forage capacity (in kg) the enemy commits this turn — HIDDEN (knowing
    // the enemy's forage effort is scouting intel, not free information).
    enemyPlan: { type: Number, default: 0 },
  },

  enemy: {
    army: { type: Map, of: Number, required: true }, // HIDDEN
    initialStrength: { type: Number, required: true },
    supplies: { type: Number, required: true },
    stance: {
      type: String,
      enum: ['camp', 'shadowing', 'offering_battle', 'withdrawing'],
      default: 'camp',
    },
    // Exact placement the engine will receive today — HIDDEN until a
    // scouting reveal is purchased (later stage).
    plannedPlacement: { type: [mongoose.Schema.Types.Mixed], default: null },
  },

  // Placeholder for the character system: augury reads
  // character?.auguryBonus ?? 0. TODO flesh out when characters land.
  character: { type: mongoose.Schema.Types.Mixed, default: null },

  battles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Battle' }],
  log: {
    type: [
      new mongoose.Schema(
        { day: Number, entries: [String] },
        { _id: false },
      ),
    ],
    default: [],
  },
})

export default mongoose.model('Campaign', campaignSchema)
