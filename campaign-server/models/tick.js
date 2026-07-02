import mongoose from 'mongoose'

const unitStateSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true },
    type: { type: String, required: true },
    team: { type: String, required: true, enum: ['red', 'blue'] },
    q: { type: Number, required: true },
    r: { type: Number, required: true },
    hp: { type: Number, required: true },
  },
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
  log: { type: [String], default: [] },
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
