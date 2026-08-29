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
//
// `extraEnv` is merged over the fixed environment below, and is how a caller
// asks the BINARY for something the JSON contract has no field for — today
// only GAME_RNG_SEED (SB-10's fixed seed). Merged last on purpose: the seed a
// caller names beats whatever the server process happens to have inherited.
function runEngine(mode, stdinText, extraEnv = {}) {
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
        env: { ...process.env, ASAN_OPTIONS: 'detect_leaks=0', ...extraEnv },
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
//
// `seed` (SB-10) sets GAME_RNG_SEED, which makes the engine repeat its ENTIRE
// draw sequence — the same battle, blow for blow, which is what answers "why
// did THAT happen". It is set only for a real integer and ABSENT otherwise:
// the variable existing at all is what the engine checks, and an empty string
// would be a seed it warns about on stderr and then ignores.
export function runBattle(input, { seed = null } = {}) {
  return runEngine(
    'battle',
    JSON.stringify(input),
    Number.isInteger(seed) ? { GAME_RNG_SEED: String(seed) } : {},
  )
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
