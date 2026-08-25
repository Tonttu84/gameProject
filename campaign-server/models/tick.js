import mongoose from 'mongoose'

const unitStateSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    type: { type: String, required: true },
    team: { type: String, required: true, enum: ['red', 'blue'] },
    q: { type: Number, required: true },
    r: { type: Number, required: true },
    hp: { type: Number, required: true },
    // In-hex layout from the engine's FormationLayout (hex-radius units):
    // offset from the hex centre + glyph size. ReplayView draws exclusively
    // from these — the DB is the render interface, no geometry client-side.
    ox: { type: Number, default: undefined },
    oy: { type: Number, default: undefined },
    sz: { type: Number, default: undefined },
    // Formation FACTS (absent when not applicable): squad name for squad
    // coloring; engaged hex side 0-5 (engine HexDirection: NE E SE SW W NW)
    // + rank within that engagement. Queryable state — not used for layout.
    squad: { type: String, default: undefined },
    side: { type: Number, min: 0, max: 5, default: undefined },
    rank: { type: Number, min: 0, default: undefined },
    // Visual-state cues ReplayView colors by (absent at their defaults): a
    // broken unit routs (orange), a casting unit is mid-spell (yellow). Like
    // ox/oy/sz these MUST be in the schema or the strict schema drops them.
    broken: { type: Boolean, default: undefined },
    cast: { type: Number, default: undefined },
  },
  { _id: false },
)

// One line of the battle log, and the DEPTH at which it should appear
// (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE LOGGING"). The engine records every
// tier and the browser filters (L-1), so the tag has to be stored, not derived.
//
// `tier` is deliberately NOT an enum: the client already renders an unrecognised
// tier rather than dropping it, on the grounds that a replay from a newer engine
// should read as slightly noisy instead of silently missing the line that
// explains the battle. A validator here would turn that into a write failure and
// lose the tick outright, which is the worse end of the same trade.
const logLineSchema = new mongoose.Schema(
  { tier: { type: String, required: true }, text: { type: String, required: true } },
  { _id: false },
)

// One engine tick of one battle: every alive unit's position/hp plus the
// narrative log lines for that tick. index 0 is the deployment snapshot.
const tickSchema = new mongoose.Schema({
  battle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Battle',
    required: true,
    index: true,
  },
  index: { type: Number, required: true, min: 0 },
  units: { type: [unitStateSchema], required: true },
  log: { type: [logLineSchema], default: [] },
})

tickSchema.index({ battle: 1, index: 1 }, { unique: true })

tickSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret._id
    delete ret.__v
    delete ret.battle
    return ret
  },
})

export default mongoose.model('Tick', tickSchema)
