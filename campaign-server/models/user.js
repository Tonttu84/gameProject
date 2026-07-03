import mongoose from 'mongoose'

// One account. Battles reference this via Battle.user (ref: 'User'), which has
// been nullable since before auth existed, so no migration is needed.
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, minlength: 3 },
    name: { type: String },
    // Only the bcrypt hash is ever stored; the plaintext password rule
    // (min length) is enforced in routes/users.js where the plaintext exists.
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
)

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    delete ret.passwordHash
    return ret
  },
})

export default mongoose.model('User', userSchema)
