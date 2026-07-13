import bcrypt from 'bcryptjs'
import User from '../models/user.js'
import config from '../utils/config.js'

// Dev convenience: guarantee a known login (testuser/test) exists so a
// `make db-clean` / rebuild doesn't force re-registering every time. Only
// runs against the embedded local mongod — when MONGODB_URI points at a
// real/hosted DB this is a no-op, so the account can never leak into a
// deployment. DEV_SEED=1 is the explicit opt-out of that guard, used by the
// docker-compose test stack (its Mongo is external but still local-only).
// True when the known dev login (DEV_USER/DEV_PASSWORD) is guaranteed to exist:
// the embedded local mongod, or the explicit DEV_SEED opt-in. The single source
// of truth for both seeding and printing the boot login hint — so a real
// deployment (external DB, no DEV_SEED) neither seeds nor advertises creds.
export function devLoginAvailable() {
  return !config.MONGODB_URI || config.DEV_SEED
}

// Returns true if the user was created this boot.
export async function seedDevUser() {
  if (!devLoginAvailable()) return false
  const existing = await User.findOne({ username: config.DEV_USER })
  if (existing) return false
  const passwordHash = await bcrypt.hash(config.DEV_PASSWORD, 10)
  await User.create({ username: config.DEV_USER, name: 'Dev Tester', passwordHash })
  return true
}
