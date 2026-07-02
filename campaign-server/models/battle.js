import mongoose from 'mongoose'

// One battle run through the engine. Per-tick replay data lives in the Tick
// collection (one doc per tick, keyed by battle id) so long battles never
// push this document toward Mongo's 16MB limit.
const battleSchema = new mongoose.Schema(
  {
    map: { type: String, required: true },
    // The raw BattleInput that was piped to the engine (placements etc.).
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    winner: { type: String, required: true, enum: ['red', 'blue', 'draw'] },
    blueSurvivors: { type: Map, of: Number, default: {} },
    redSurvivors: { type: Map, of: Number, default: {} },
    tickCount: { type: Number, required: true, min: 0 },
    cols: { type: Number, default: 0 },
    rows: { type: Number, default: 0 },
    // Owner, once the auth module lands (same DB, users collection).
    // Nullable from day one so multi-user attaches without a migration.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

battleSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  },
})

export default mongoose.model('Battle', battleSchema)
