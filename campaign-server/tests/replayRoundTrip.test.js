import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest'
import supertest from 'supertest'
import config from '../utils/config.js'
import { startTestDb, stopTestDb, clearDb } from './helpers/db.js'
import { createUserAndToken } from './helpers/auth.js'
import { runAndPersistBattle } from '../services/battleRunner.js'
import app from '../app.js'
import Battle from '../models/battle.js'

// The other half of the battle → replay → ReplayView round trip the 2026-07-07
// deferred item asked for. The frontend half
// (frontend/src/__tests__/replayRoundTrip.test.jsx) renders a recorded battle;
// this half proves the recording SURVIVES the trip: a real run of the real
// binary, persisted through the real battleRunner, read back through the real
// route the browser calls.
//
// What it is guarding against is silent loss, not a wrong number. Tick.units is
// a STRICT Mongoose schema: a field the engine emits and the schema does not
// declare is dropped on write, with no error anywhere — the browser simply
// stops drawing something. That has already happened once (ox/oy/sz carry a
// schema comment saying exactly this), and no test between the engine's stdout
// and the browser's props was in a position to catch it.
//
// Lives campaign-side because only this layer can see both the engine binary
// and the wire shape — the same reason the role↔config tests do
// (docs/CAMPAIGN_PLAN.md, standing principle 2).
const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(here, '../../frontend/src/__tests__/fixtures/recordedReplay.json')

const hasEngine = fs.existsSync(config.ENGINE_BIN)
if (!hasEngine)
  // Same discipline as engine.integration.test.js: a skipped suite is invisible
  // in a green run, so say out loud that the pipeline went unchecked.
  console.warn(
    `engine binary not built (${config.ENGINE_BIN}) — replay round-trip test SKIPPED; run \`make\` to enable it`,
  )

const api = supertest(app)

describe.skipIf(!hasEngine)('battle → recorded replay → the route the browser reads', () => {
  const fixture = hasEngine ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null

  let userId
  let engineReplay // what the binary emitted, before the DB saw it
  let served // what GET /:id/ticks gave back

  beforeAll(async () => {
    await startTestDb()
    await clearDb()
    ;({ userId } = await createUserAndToken(api))

    // The fixture's own input, so both halves of the round trip describe the
    // same battle, and its seed, so a CI failure here is reproducible rather
    // than a different fight every run. (Same seed reproduces only on the same
    // toolchain — see resolveSeed() in Utility.cpp — which is why what follows
    // asserts SHAPE and never a specific outcome.)
    process.env.GAME_RNG_SEED = String(fixture.seed)
    const { battle, result, error } = await runAndPersistBattle(fixture.input, userId)
    delete process.env.GAME_RNG_SEED
    expect(error).toBeUndefined()

    engineReplay = result.replay
    const res = await api.get(`/api/battles/${battle.id}/ticks`).expect(200)
    served = res.body
  }, 60_000)

  afterAll(stopTestDb)

  test('the battle really was fought — both armies deployed and the log ran', () => {
    expect(engineReplay.ticks.length).toBeGreaterThan(1)
    const teams = new Set(engineReplay.ticks[0].units.map((u) => u.team))
    expect(teams).toEqual(new Set(['red', 'blue']))
    expect(engineReplay.ticks.flatMap((t) => t.log).length).toBeGreaterThan(0)
  })

  test('every tick the engine recorded is served back, in order', async () => {
    expect(served).toHaveLength(engineReplay.ticks.length)
    expect(served.map((t) => t.index)).toEqual(engineReplay.ticks.map((t) => t.tick))

    // tickCount is what the frontend sizes its scrubber with; a mismatch shows
    // up as a slider that runs past the end of the replay.
    const [battle] = await Battle.find({ user: userId })
    expect(battle.tickCount).toBe(served.length)
  })

  test('not one unit field is dropped between the engine and the browser', () => {
    for (const [i, tick] of engineReplay.ticks.entries()) {
      const out = served[i]
      expect(out.units).toHaveLength(tick.units.length)
      for (const [j, emitted] of tick.units.entries()) {
        // Field-for-field, values included: the strict schema drops what it
        // does not declare, so "the keys are all here" is the assertion, and
        // the values catch a schema type that quietly coerces.
        expect(out.units[j]).toEqual(emitted)
      }
    }
  })

  test('every log line keeps its tier and its words', () => {
    for (const [i, tick] of engineReplay.ticks.entries()) {
      expect(served[i].log).toEqual(tick.log)
      for (const line of served[i].log) {
        expect(typeof line.text).toBe('string')
        // The client renders an unknown tier rather than dropping it, so this
        // is not a correctness gate — it is the tripwire that says the engine
        // grew a fourth tier and the browser's depth control needs a rung.
        expect(['basic', 'detail', 'trace']).toContain(line.tier)
      }
    }
  })

  test('the recorded fixture the browser test renders still matches this engine', () => {
    const keysIn = (ticks, pick) => new Set(ticks.flatMap(pick).flatMap((o) => Object.keys(o)))
    const fixtureUnitKeys = keysIn(fixture.ticks, (t) => t.units)
    const liveUnitKeys = keysIn(engineReplay.ticks, (t) => t.units)
    const unknown = [...liveUnitKeys].filter((k) => !fixtureUnitKeys.has(k))

    // One direction only. A field in the fixture that this run did not produce
    // is just a draw that went differently (nobody broke, nobody engaged) — but
    // a field the fixture has never seen is a recorder change the browser test
    // is rendering blind to, and the fixture needs regenerating.
    expect(
      unknown,
      `ReplayRecorder now emits ${unknown.join(', ')} — regenerate ${path.relative(process.cwd(), FIXTURE)} (see its _regenerate field) so the browser test renders what the engine actually records`,
    ).toEqual([])

    const liveTiers = new Set(engineReplay.ticks.flatMap((t) => t.log).map((l) => l.tier))
    const fixtureTiers = new Set(fixture.ticks.flatMap((t) => t.log).map((l) => l.tier))
    expect([...liveTiers].filter((t) => !fixtureTiers.has(t))).toEqual([])
  })
})
