import { execFile } from 'node:child_process'
import config from '../utils/config.js'

// The C++ engine failed to run (spawn error, non-zero exit, timeout).
export class EngineProcessError extends Error {
  name = 'EngineProcessError'
}

// The engine ran but its stdout wasn't the JSON contract we expect.
export class EngineOutputError extends Error {
  name = 'EngineOutputError'
}

// Run `./game <mode>` with optional stdin, parse stdout as JSON.
// cwd is the repo root — the engine resolves maps/ relative to it.
function runEngine(mode, stdinText) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      config.ENGINE_BIN,
      [mode],
      {
        cwd: config.GAME_DIR,
        timeout: config.BATTLE_TIMEOUT_MS,
        maxBuffer: 512 * 1024 * 1024,
        // The dev binary links ASan/LSan; known third-party leaks
        // (SFML/freetype glyph cache) would otherwise fail every battle run.
        // Engine leak checking still happens in `make test-serial`.
        env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0' },
      },
      (err, stdout) => {
        if (err) return reject(new EngineProcessError(`game ${mode}: ${err.message}`))
        try {
          resolve(JSON.parse(stdout))
        } catch {
          reject(new EngineOutputError(`game ${mode}: stdout was not valid JSON`))
        }
      },
    )
    if (stdinText !== undefined) child.stdin.write(stdinText)
    child.stdin.end()
  })
}

// One battle: BattleInput in, { winner, *_survivors, replay } out.
export function runBattle(input) {
  return runEngine('battle', JSON.stringify(input))
}

// The hardcoded sample scenario, run headless. Same { winner, *_survivors,
// replay } contract as runBattle — the field SOURCE is the C++ scenario instead
// of stdin JSON, but the output rides the identical persist/render pipeline
// (see services/battleRunner.js). No stdin. Powers the login-screen demo battle.
export function runSample() {
  return runEngine('sample')
}

// Full unit catalog (single source of truth) — synced into the DB at boot.
export function dumpUnits() {
  return runEngine('dump-units')
}

// The full spell roster, one row per FORM (slice 3, S3-1). Read at boot into
// utils/spellCatalog.js the way dumpUnits() is read into the DB, so the C++
// table stays the single source of truth for what a spell requires and costs.
//
// Unlike the unit catalog this needs no collection: nothing queries a spell, the
// campaign stores no reference to one, and the whole roster is small enough to
// hold in memory. A schema for it would be a second place to keep in step.
export function dumpSpells() {
  return runEngine('dump-spells')
}

// Grid/zone/placeable-unit info; static per binary, so cached after first call.
let cachedInfo = null
export async function getInfo() {
  if (!cachedInfo) cachedInfo = await runEngine('info')
  return cachedInfo
}
