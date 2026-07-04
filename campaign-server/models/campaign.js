import mongoose from 'mongoose'

// One roguelite campaign run per document. HIDDEN INFORMATION lives here in
// plain fields — enemy.army, enemy.plannedPlacement, augury.trueEvent/
// decoyEvent/prediction internals, forage.enemyPlan — and must NEVER reach a
// client through Mongoose toJSON. Every response goes
// through services/campaignView.js, the single serializer that decides what
// the player may see. Do not add routes that res.json() a campaign document.

const auguryEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    severity: { type: Number, required: true }, // 1 mild … 3 catastrophe
    baseAccuracy: { type: Number, required: true }, // consult-roll bonus — HIDDEN
    effect: { type: mongoose.Schema.Types.Mixed, required: true },
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

// Bump this whenever the campaign document shape changes incompatibly (new
// required fields, changed semantics). There is NO backwards compatibility:
// a roguelite run is disposable, so any stored campaign whose version differs
// — including pre-versioning docs that lack the field — is deleted on the
// next listing instead of being served to campaignView, where missing fields
// render as nonsense (the "food stuck at 100 kg, Land 0%" playtest bug).
export const CAMPAIGN_SCHEMA_VERSION = 3 // v3: augury rework (events/auguryScore → augury subdoc)

const campaignSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  schemaVersion: { type: Number, default: CAMPAIGN_SCHEMA_VERSION },
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

  // The turn's prophecy. trueEvent applies at end-of-turn regardless of the
  // reading; the client sees only the predicted card + raw dice roll.
  augury: {
    trueEvent: { type: auguryEventSchema, required: true }, // HIDDEN
    decoyEvent: { type: auguryEventSchema, required: true }, // HIDDEN
    prediction: {
      // null until the augur is consulted this turn.
      type: new mongoose.Schema(
        {
          eventId: { type: String, required: true },
          roll: { type: Number, required: true }, // raw exploding dice — the visible flourish
          total: { type: Number, required: true }, // roll + hidden bonuses — HIDDEN
          threshold: { type: Number, required: true }, // HIDDEN
          accurate: { type: Boolean, required: true }, // HIDDEN
        },
        { _id: false },
      ),
      default: null,
    },
    consulted: { type: Boolean, default: false },
    rerollsRemaining: { type: Number, required: true },
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
