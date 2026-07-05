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
    // 1 minor … 3 major — the event's POOL. A slot's true/false pair shares
    // one pool, and the reading modifier comes from the pool
    // (events.js POOL_LEGIBILITY), so the shown odds can't out the truth.
    severity: { type: Number, required: true },
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
export const CAMPAIGN_SCHEMA_VERSION = 6 // v6: augury odds from the open-ended reading roll (rolled at consult)

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

  // The turn's fates: AUGURY_SLOTS independent true/false event pairs, each
  // with its own odds. Every slot's trueEvent applies at end-of-turn
  // regardless of the reading; the client sees the shown card + odds per
  // slot once consulted, never the pair or the outcome.
  augury: {
    slots: {
      type: [
        new mongoose.Schema(
          {
            trueEvent: { type: auguryEventSchema, required: true }, // HIDDEN
            falseEvent: { type: auguryEventSchema, required: true }, // HIDDEN
            // Chance the vision shows the truth: rolled at consult from the
            // open-ended reading (throwDice + base + mage/character +
            // trueEvent.baseAccuracy, × 5%, clamped). Null until consulted;
            // public from then on — exactly the number the vision was
            // rolled against.
            odds: { type: Number, default: null },
            // null until consulted; then whether the vision showed the truth — HIDDEN
            shownTrue: { type: Boolean, default: null },
          },
          { _id: false },
        ),
      ],
      required: true,
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
