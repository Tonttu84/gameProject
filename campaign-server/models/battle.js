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
    // WHICH TURN this was fought on (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE
    // LOGGING", L-6). The retention sweep keeps the current turn's battles and
    // deletes everything older, and this is what it sorts on.
    //
    // Deliberately a field on BATTLE rather than on the campaign: the campaign
    // schema is version-gated and a save from another version is DELETED on
    // listing, so putting it there would cost the player their in-flight
    // campaign to gain a number the battle already knows about itself.
    //
    // Null for battles that belong to no turn — the ownerless sample battle
    // behind the login-screen demo, which no sweep must ever touch. A battle
    // stored before this field existed is likewise null, and reads as old,
    // which is the right answer: it cannot be watched either.
    day: { type: Number, default: null },
    // Fought in the battle lab rather than in a campaign (docs/CAMPAIGN_PLAN.md,
    // "TEST / SANDBOX MODE", SB-12). A sandbox battle belongs to NO campaign, so
    // it appears in no `campaign.battles` list — and sweepOldBattles only ever
    // deletes ids from such a list, which would make these battles unreachable
    // by the sweep forever, at roughly 21 MB of tick documents apiece. This flag
    // is what sweepSandboxBattles finds them by: one lab battle is kept per
    // user, and each launch deletes the one before it.
    //
    // A field rather than a marker inside `input`, because `input` is Mixed and
    // therefore unindexable and un-queryable in any way worth relying on: the
    // sweep must be able to ask "which of this user's battles are lab battles"
    // and get an exact answer.
    sandbox: { type: Boolean, default: false },
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
