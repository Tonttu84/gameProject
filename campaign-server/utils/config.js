import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root: campaign-server/utils/ → two levels up.
const ROOT = path.resolve(__dirname, '..', '..')

// Build tag resolution: explicit APP_VERSION env → the BUILD_VERSION file the
// Docker image stamps automatically at build time (fresh on every changed
// build) → the committed package version (plain dev). Bug reports pin it, and
// campaigns from any OTHER build are deleted at login — a stale save is never
// worth the risk while the game changes daily (user, 2026-07-05).
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const buildStampPath = path.join(ROOT, 'BUILD_VERSION')
const buildStamp = fs.existsSync(buildStampPath)
  ? fs.readFileSync(buildStampPath, 'utf8').trim()
  : null

// MONGODB_URI is the later escape hatch to a real/hosted MongoDB: when set,
// the embedded persistent mongod is skipped entirely and nothing else changes.
const config = {
  PORT: Number(process.env.PORT) || 3001,
  // Build tag stamped onto bug reports and campaign saves (see above).
  APP_VERSION: process.env.APP_VERSION || buildStamp || pkg.version,
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
  // When set (container/production), the campaign server also serves the
  // built frontend from this directory; in dev the Vite server does it.
  FRONTEND_DIST: process.env.FRONTEND_DIST || null,
  // Explicit opt-in to seed the dev user even against an external MongoDB
  // (used by docker-compose for local testing). Never set this anywhere public.
  DEV_SEED: process.env.DEV_SEED === '1',
  // Test-only: force the augur's fate draws so the e2e exercises a KNOWN reveal
  // deterministically instead of hoping the random draw lands a multi-choice
  // one. Comma-separated per-draw specs, each `trueId:falseId` (falseId
  // optional). Consumed in draw order across a turn's slots (and rerolls);
  // exhausted/empty → normal random draw. NEVER set in a real deployment.
  DEV_AUGURY: process.env.DEV_AUGURY
    ? process.env.DEV_AUGURY.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
  // Battles render at ~200ms/tick in the SFML window, so allow long runs.
  BATTLE_TIMEOUT_MS: Number(process.env.BATTLE_TIMEOUT_MS) || 10 * 60 * 1000,
  // JWT signing secret. The fallback is for local dev only — set SECRET in any
  // deployment that is reachable by anyone but you.
  SECRET: process.env.SECRET || 'dev-only-secret-change-me',
  // Seeded at boot by services/devSeed.js — embedded local DB only (skipped
  // whenever MONGODB_URI is set), so it survives make db-clean/rebuilds.
  DEV_USER: process.env.DEV_USER || 'testuser',
  DEV_PASSWORD: process.env.DEV_PASSWORD || 'test',
}

export default config
