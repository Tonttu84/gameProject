import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import bcrypt from 'bcryptjs'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { seedDevUser } from '../services/devSeed.js'
import User from '../models/user.js'
import config from '../utils/config.js'

beforeAll(startTestDb)
afterAll(stopTestDb)
beforeEach(clearDb)

describe('seedDevUser', () => {
  test('creates the dev user with a hash that matches DEV_PASSWORD', async () => {
    expect(await seedDevUser()).toBe(true)
    const user = await User.findOne({ username: config.DEV_USER })
    expect(user).not.toBeNull()
    expect(await bcrypt.compare(config.DEV_PASSWORD, user.passwordHash)).toBe(true)
  })

  test('is idempotent: a second boot neither duplicates nor overwrites', async () => {
    await seedDevUser()
    expect(await seedDevUser()).toBe(false)
    expect(await User.countDocuments({ username: config.DEV_USER })).toBe(1)
  })

  test('never seeds when MONGODB_URI points at a real database', async () => {
    const saved = config.MONGODB_URI
    config.MONGODB_URI = 'mongodb://some-real-host/gamedb'
    try {
      expect(await seedDevUser()).toBe(false)
      expect(await User.countDocuments()).toBe(0)
    } finally {
      config.MONGODB_URI = saved
    }
  })
})
