import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root: campaign-server/utils/ → two levels up.
const ROOT = path.resolve(__dirname, '..', '..')

// MONGODB_URI is the later escape hatch to a real/hosted MongoDB: when set,
// the embedded persistent mongod is skipped entirely and nothing else changes.
const config = {
  PORT: Number(process.env.PORT) || 3001,
  MONGODB_URI: process.env.MONGODB_URI || null,
  DB_NAME: process.env.DB_NAME || 'gamedb',
  // NOT inside the repo: on Windows the repo lives on /mnt/c (drvfs), where
  // mongod/WiredTiger cannot run — the data dir must be a real Linux
  // filesystem. Mirrored by the Makefile's db-clean rule; change both together.
  DB_PATH: process.env.DB_PATH || path.join(os.homedir(), '.gameproject', 'db'),
  // The engine binary and its working dir (it reads maps/ relative to cwd).
  ENGINE_BIN: process.env.ENGINE_BIN || path.join(ROOT, 'game'),
  GAME_DIR: process.env.GAME_DIR || ROOT,
  MAPS_DIR: process.env.MAPS_DIR || path.join(ROOT, 'maps'),
  // Battles render at ~200ms/tick in the SFML window, so allow long runs.
  BATTLE_TIMEOUT_MS: Number(process.env.BATTLE_TIMEOUT_MS) || 10 * 60 * 1000,
}

export default config
