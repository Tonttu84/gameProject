import { screenValue } from '../utils/capabilities.js'
import { throwDice, getRandom } from '../utils/dice.js'
import {
  CLASH_LOSER_CASUALTY_PCT,
  CLASH_WINNER_CASUALTY_PCT,
} from '../utils/campaignConfig.js'

// Abstract forager-clash resolution: cheap and swingy on purpose (a whole
// exploding die per side against strengths in the tens). The interface —
// parties in, losses + forfeit flag out — is fixed so engine-backed skirmish
// battles can swap in behind it later without touching forage.js.
//
// A party is { type: count } (plain object); catalog maps name → unit type
// doc (for stats). Returns per-side losses as { type: count }.

const partyStrength = (party, catalog) => {
  let s = 0
  for (const [type, count] of Object.entries(party)) {
    const stats = catalog.get(type)?.stats
    if (!stats) continue
    s += count * (stats.attack / 4 + screenValue(stats))
  }
  return s + throwDice()
}

const partyTotal = (party) => Object.values(party).reduce((a, b) => a + b, 0)

// Casualties fall on the low-screen stragglers first: high screenValue units
// (heavy cavalry) are the ones covering the retreat and die last.
const takeCasualties = (party, catalog, pct) => {
  let toLose = Math.ceil(partyTotal(party) * (pct / 100))
  const losses = {}
  const byScreen = Object.keys(party).sort(
    (a, b) =>
      (screenValue(catalog.get(a)?.stats ?? { armour: 0, attack: 0, speed: 0 }) -
        screenValue(catalog.get(b)?.stats ?? { armour: 0, attack: 0, speed: 0 })),
  )
  for (const type of byScreen) {
    if (toLose <= 0) break
    const dead = Math.min(party[type], toLose)
    if (dead > 0) {
      losses[type] = dead
      toLose -= dead
    }
  }
  return losses
}

// → { winner: 'player'|'enemy'|'draw', playerLosses, enemyLosses, log }
// A draw is a brush that breaks off: light casualties both sides, no forfeit.
export function resolveClash(playerParty, enemyParty, ring, catalog) {
  const ringName = ['near', 'middle', 'far'][ring] ?? `ring ${ring}`
  const playerStrength = partyStrength(playerParty, catalog)
  const enemyStrength = partyStrength(enemyParty, catalog)

  if (playerStrength === enemyStrength) {
    const pct = getRandom(CLASH_WINNER_CASUALTY_PCT[0], CLASH_WINNER_CASUALTY_PCT[1])
    return {
      winner: 'draw',
      playerLosses: takeCasualties(playerParty, catalog, pct),
      enemyLosses: takeCasualties(enemyParty, catalog, pct),
      log: [`Foragers traded blows in the ${ringName} ring — both sides broke off.`],
    }
  }

  const playerWon = playerStrength > enemyStrength
  const loserPct = getRandom(CLASH_LOSER_CASUALTY_PCT[0], CLASH_LOSER_CASUALTY_PCT[1])
  const winnerPct = getRandom(CLASH_WINNER_CASUALTY_PCT[0], CLASH_WINNER_CASUALTY_PCT[1])

  return {
    winner: playerWon ? 'player' : 'enemy',
    playerLosses: takeCasualties(playerParty, catalog, playerWon ? winnerPct : loserPct),
    enemyLosses: takeCasualties(enemyParty, catalog, playerWon ? loserPct : winnerPct),
    log: [
      playerWon
        ? `Your foragers drove off an enemy party in the ${ringName} ring.`
        : `Enemy horsemen routed your foragers in the ${ringName} ring.`,
    ],
  }
}
