import fs from 'node:fs/promises'
import mongoose from 'mongoose'
import config from './config.js'

let memServer = null

// Without MONGODB_URI, runs an embedded mongod (mongodb-memory-server) in
// PERSISTENT mode: dbPath survives restarts, so campaigns/replays are durable
// local data, not test throwaway. With MONGODB_URI set, connects there instead.
export async function connectDb() {
  let uri = config.MONGODB_URI
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    await fs.mkdir(config.DB_PATH, { recursive: true })
    memServer = await MongoMemoryServer.create({
      instance: { dbPath: config.DB_PATH, storageEngine: 'wiredTiger', launchTimeout: 30000 },
    })
    uri = memServer.getUri()
  }
  await mongoose.connect(uri, { dbName: config.DB_NAME })
}

export async function disconnectDb() {
  await mongoose.disconnect()
  if (memServer) {
    await memServer.stop()
    memServer = null
  }
}
