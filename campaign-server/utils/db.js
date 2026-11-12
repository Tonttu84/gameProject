import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import mongoose from 'mongoose'
import config from './config.js'

let memServer = null

// The embedded mongod's server version, pinned rather than left to
// mongodb-memory-server's default: v11 moved that default from 7.0 to 8.2, and
// mongod 8.2 refuses a data dir written by 7.0 (exit code 62), which would
// lock every existing ~/.gameproject/db out. 7.0 is also the server that
// docker-compose and CI run (mongo:7). Moving it is a deliberate data-dir
// upgrade (7.0 → 8.0 → setFeatureCompatibilityVersion → 8.2), not a bump
// (D13). tests/helpers/db.js uses it too, so local tests run the server CI runs.
//
// It lives in package.json's config.mongodbMemoryServer.version because the
// package's postinstall download reads it there; mongodb-memory-server only
// finds that file from the current directory, so the code passes it
// explicitly as well, and a server started from the repo root gets it too.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const EMBEDDED_MONGOD_VERSION = pkg.config.mongodbMemoryServer.version

// The MongoMemoryServer options for the embedded persistent mongod.
export function embeddedServerOptions(dbPath) {
  return {
    binary: { version: EMBEDDED_MONGOD_VERSION },
    instance: { dbPath, storageEngine: 'wiredTiger', launchTimeout: 30000 },
  }
}

// Without MONGODB_URI, runs an embedded mongod (mongodb-memory-server) in
// PERSISTENT mode: dbPath survives restarts, so campaigns/replays are durable
// local data, not test throwaway. With MONGODB_URI set, connects there instead.
export async function connectDb() {
  let uri = config.MONGODB_URI
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server')
    await fs.mkdir(config.DB_PATH, { recursive: true })
    memServer = await MongoMemoryServer.create(embeddedServerOptions(config.DB_PATH))
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
