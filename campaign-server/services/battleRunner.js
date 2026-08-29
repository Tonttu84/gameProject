import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { runBattle, runSample } from './engine.js'
import { sweepSandboxBattles } from './battleRetention.js'

// Persist a battle the engine already produced: one Battle doc plus one Tick doc
// per turn (separate collection so long battles never approach the 16MB document
// limit). Shared tail for every battle SOURCE — stdin-JSON battles, the sample
// scenario, later forager skirmishes — so they all land in the DB the browser
// ReplayView renders from, identically.
//
// `result` is the engine's { winner, *_survivors, replay } envelope; `input` is
// the BattleInput (or a marker like { sample: true }) stored for the record;
// `userId` is the owner (null for ownerless demo battles). Returns
// { battle, result, summary } where summary is the client-facing shape.
// A log line as the Tick schema stores it (docs/CAMPAIGN_PLAN.md, "TIERED
// BATTLE LOGGING"). The engine emits {tier, text}; a bare string is what an
// OLDER binary emits, and it reads as Basic — the tier that cannot be filtered
// away, so nothing goes missing.
//
// Normalising HERE rather than fixing the fixtures is deliberate: the campaign
// server and the engine binary are deployed together but not built together, and
// a server meeting a binary from before the ladder should store its battles
// rather than reject every one of them with a validation error.
const logLine = (line) =>
  typeof line === 'string' ? { tier: 'basic', text: line } : line

async function persistBattleResult(result, { input, userId, day = null, sandbox = false }) {
  const replay = result.replay ?? { map: input.map ?? 'unknown', cols: 0, rows: 0, ticks: [] }

  const battle = await Battle.create({
    user: userId,
    map: replay.map,
    input,
    winner: result.winner,
    blueSurvivors: result.blue_survivors ?? {},
    redSurvivors: result.red_survivors ?? {},
    tickCount: replay.ticks.length,
    cols: replay.cols,
    rows: replay.rows,
    day,
    sandbox,
  })

  if (replay.ticks.length > 0)
    await Tick.insertMany(
      replay.ticks.map((t) => ({
        battle: battle._id,
        index: t.tick,
        units: t.units,
        log: (t.log ?? []).map(logLine),
      })),
    )

  // One line per battle so battle lengths are easy to eyeball in the server
  // console; the same number is stored as tickCount for querying.
  console.log(`battle ${battle.id}: ${replay.ticks.length} ticks, winner ${result.winner}`)

  return {
    battle,
    result,
    summary: {
      id: battle.id,
      winner: result.winner,
      blue_survivors: result.blue_survivors ?? {},
      red_survivors: result.red_survivors ?? {},
      // Per-campaign-squad survivor breakdown for the player's OWN army —
      // {"<squadId>": {survivors: {type: count}, wiped: bool}} — so the
      // battle route can regroup/disband persistent squads. red_squads is
      // deliberately never surfaced here: the enemy has no persistent
      // squad concept in this campaign design, and exposing it would be a
      // hidden-info leak surface for no current use.
      blue_squads: result.blue_squads ?? {},
      // The ids of the player's CHARACTERS who walked off the field (5-9).
      // Passed through UNDEFINED-PRESERVING on purpose: `[]` means the engine
      // looked and nobody survived, while a missing field means it never
      // reported, and the reconciliation must be able to tell those apart —
      // defaulting to `[]` here would turn a broken pipeline into a massacre,
      // and a character's death is permanent.
      blue_characters: result.blue_characters,
      // The enemy's, since slice 9a: the host fields BEARERS now — champions
      // carrying real gear (9-12) — and looting one turns on whether he
      // actually fell, which is a question only this list can answer.
      //
      // It is NOT a hidden-info leak the way red_squads would be: a bearer is
      // tagged with a fixed id the campaign layer chose itself, and what comes
      // back is whether that one body walked away. The enemy still has no
      // persistent characters (9-13) — nothing here survives the encounter.
      //
      // Undefined-preserving for the same reason blue_characters is: `[]` means
      // the engine looked and nobody survived, a missing field means it never
      // reported, and handing out a relic on a pipeline failure is the wrong
      // way to be wrong.
      red_characters: result.red_characters,
      tickCount: replay.ticks.length,
    },
  }
}

// Run one battle through the engine and persist it. Extracted from
// routes/battles.js so campaign battles (and later forager skirmishes) reuse the
// exact same run-and-persist path.
//
// Returns { error } for engine-level rejections (bad map name, empty input …
// — client error, nothing stored), otherwise { battle, result, summary }.
export async function runAndPersistBattle(input, userId, day = null) {
  const result = await runBattle(input)
  if (result.error) return { error: result.error }
  return persistBattleResult(result, { input, userId, day })
}

// Run one battle for the BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX
// MODE") and persist it. The same pipeline as every other battle — SB-1's whole
// point is that the lab needs no campaign document, so the only differences are
// the `sandbox` mark and the per-launch retention it enables (SB-12).
//
// The sweep runs AFTER the new battle lands and keeps it by id, so a run that
// fails leaves the previous replay watchable rather than deleting it for
// nothing. A sweep failure is not allowed to fail the launch: the player has a
// battle to watch either way, and the worst case of a missed sweep is one
// extra replay that the next launch will collect.
export async function runAndPersistSandboxBattle(input, userId) {
  const result = await runBattle(input)
  if (result.error) return { error: result.error }
  const persisted = await persistBattleResult(result, { input, userId, sandbox: true })
  await sweepSandboxBattles(userId, persisted.battle._id).catch((e) =>
    console.error('sandbox battle sweep failed:', e.message),
  )
  return persisted
}

// Run the hardcoded sample scenario and persist it as an ownerless battle. Same
// pipeline as a real battle — only the SOURCE differs (the C++ scenario, not
// stdin JSON) — so the login-screen demo plays through the one DB-backed
// ReplayView. Returns { battle, result, summary }.
export async function runAndPersistSample() {
  const result = await runSample()
  if (result.error) return { error: result.error }
  return persistBattleResult(result, { input: { sample: true }, userId: null })
}
