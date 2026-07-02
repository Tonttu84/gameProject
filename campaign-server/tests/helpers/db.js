import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'

// Ephemeral in-memory mongod for tests — unrelated to the persistent dev DB
// in utils/db.js (no dbPath: data vanishes with the process).
let memServer = null

export async function startTestDb() {
  memServer = await MongoMemoryServer.create()
  await mongoose.connect(memServer.getUri(), { dbName: 'gamedb-test' })
}

export async function stopTestDb() {
  await mongoose.disconnect()
  if (memServer) await memServer.stop()
  memServer = null
}

export async function clearDb() {
  const collections = Object.values(mongoose.connection.collections)
  await Promise.all(collections.map((c) => c.deleteMany({})))
}
