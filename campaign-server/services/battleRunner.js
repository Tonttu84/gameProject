import Battle from '../models/battle.js'
import Tick from '../models/tick.js'
import { runBattle } from './engine.js'

// Run one battle through the engine and persist it: one Battle doc plus one
// Tick doc per turn (separate collection so long battles never approach the
// 16MB document limit). Extracted from routes/battles.js so campaign battles
// (and later forager skirmishes) reuse the exact same run-and-persist path.
//
// Returns { error } for engine-level rejections (bad map name, empty input …
// — client error, nothing stored), otherwise { battle, result, summary }
// where summary is the client-facing shape the /api/battles route returns.
export async function runAndPersistBattle(input, userId) {
  const result = await runBattle(input)
  if (result.error) return { error: result.error }

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
      tickCount: replay.ticks.length,
    },
  }
}
