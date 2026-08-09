import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { clearCatalogCache } from '../../utils/catalog.js'

// Ephemeral in-memory mongod for tests — unrelated to the persistent dev DB
// in utils/db.js (no dbPath: data vanishes with the process).
let memServer = null

export async function startTestDb() {
  // Escape hatch to a REAL mongod (CI's mongo:7 service container). Default
  // stays mongodb-memory-server so a plain `npm test` needs no setup — but
  // that package DOWNLOADS a binary from fastdl.mongodb.org, which is blocked
  // outright on some networks (every DB-backed suite then simply cannot run).
  // Deliberately NOT the app's own MONGODB_URI: that one switches the *server*
  // to a persistent DB, which is a different decision from where tests store
  // throwaway state.
  const externalUri = process.env.MONGODB_TEST_URI
  if (externalUri) {
    await mongoose.connect(externalUri, { dbName: 'gamedb-test' })
    // A fresh in-memory mongod starts empty; a shared external one carries
    // whatever the previous test FILE left behind (each file clears only
    // between its own tests). Clear on entry so both paths start identical —
    // vitest.config.js keeps files serial, so this can't race another file.
    await clearDb()
    return
  }
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
  // Each test re-seeds unittypes; the campaign layer's module-level catalog
  // cache must not leak the previous test's rows.
  clearCatalogCache()
}
