import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { runBattle, runSample } from './engine.js'

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
async function persistBattleResult(result, { input, userId }) {
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
  })

  if (replay.ticks.length > 0)
    await Tick.insertMany(
      replay.ticks.map((t) => ({
        battle: battle._id,
        index: t.tick,
        units: t.units,
        log: t.log ?? [],
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
      // and a character's death is permanent. red_characters stays unsurfaced,
      // like red_squads: the enemy has no characters in this design.
      blue_characters: result.blue_characters,
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
export async function runAndPersistBattle(input, userId) {
  const result = await runBattle(input)
  if (result.error) return { error: result.error }
  return persistBattleResult(result, { input, userId })
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
