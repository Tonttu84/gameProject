import {
  bandLabel,
  ENEMY_CONSUMPTION_KG_PER_TURN,
  ENEMY_SUPPLY_BANDS,
  ENEMY_REINFORCE_HEADCOUNT,
  ENEMY_DESERTION_HEADCOUNT,
  ENEMY_WITHDRAW_FRACTION,
} from '../utils/campaignConfig.js'

// The shadowing enemy host as a MODELLED PRESSURE, not an opponent.
//
// Renamed from `enemyAi.js` (2026-08-09) because that name was a standing
// invitation to build the one thing this game has decided not to have. The
// enemy is an abstract roguelite challenge: it makes no decisions, has no
// behaviour and does not react to the player. Everything here is arithmetic on
// state the player pushes against — it consumes a fixed amount, takes what the
// shared land still offers, and its numbers follow from that. `enemy.stance`
// was deleted outright in v19 for the same reason.
//
// So: nothing in this file should ever branch on "what would the enemy do".
// See docs/CAMPAIGN_PLAN.md (START HERE) and DESIGN.md for the principle.

export const armyTotal = (army) => [...army.values()].reduce((a, b) => a + b, 0)

// The shadowing enemy host's per-turn upkeep. Runs during day resolution
// (before newDay). Mutates campaign.enemy; returns log lines the player is
// allowed to see (their pickets can observe the enemy camp). The old stance
// machine is gone — the boss-fight meter (+ bossFightDue) is the single signal
// for what the enemy is doing, and the near-annihilation "withdraws → you win"
// case is a direct check in dayResolution's end conditions.
//
// S2 "effort slider" (docs/CAMPAIGN_PLAN.md, decision 4): the enemy no longer
// plans a forage detachment off its own army composition — campaign.forage.
// enemyDrainKg is now a flat abstract number applied in resolveForaging, not
// derived here.
// S4 "starve the enemy": this turn's verdict on whether the host fed itself —
// the ring-weighted kg it actually took (resolveForaging) against a FIXED
// consumption. A ratio, so the bands read the same whatever the constants are
// retuned to. Pure and exported for its own tests.
export const enemySupplyState = (incomeKg) =>
  bandLabel(
    Math.max(0, incomeKg) / Math.max(1, ENEMY_CONSUMPTION_KG_PER_TURN),
    ENEMY_SUPPLY_BANDS,
  )

// Apply a FIXED headcount change (signed) to the host, split across its unit
// types in proportion to the composition it already has, and return the net
// change actually applied.
//
// Not a percentage: see ENEMY_REINFORCE_HEADCOUNT. The whole point is that the
// swing per turn does not depend on how big the host currently is.
//
// Largest-remainder apportionment, so the fixed number lands EXACTLY rather
// than being eaten by per-type flooring — under the old multiplicative version
// a thin type simply never moved, which is fine for a rate but would silently
// lose men from a headcount that is supposed to be exact.
const adjustArmy = (army, delta) => {
  const total = armyTotal(army)
  if (total === 0 || delta === 0) return 0

  // A host cannot lose more men than it has.
  const want = delta < 0 ? -Math.min(-delta, total) : delta
  const sign = Math.sign(want)
  const magnitude = Math.abs(want)

  // Each type's exact share is magnitude × (n / total) ≤ n, so no type can be
  // apportioned more men than it has even before the clamp below.
  const parts = [...army].map(([type, n]) => {
    const exact = magnitude * (n / total)
    const whole = Math.floor(exact)
    return { type, n, whole, frac: exact - whole }
  })

  // Hand the rounding remainder to the largest fractions first.
  const remainder = magnitude - parts.reduce((a, p) => a + p.whole, 0)
  parts.sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < remainder; i++) parts[i].whole += 1

  let applied = 0
  for (const p of parts) {
    const next = Math.max(0, p.n + sign * p.whole)
    applied += next - p.n
    army.set(p.type, next)
  }
  return applied
}

// `enemyIncomeKg` is the host's ring-weighted take for the turn, from
// resolveForaging — which must therefore run BEFORE this (it does; foraging is
// step 1 of day resolution, enemyTurn is step 4).
export function enemyTurn(campaign, catalog, enemyIncomeKg = 0) {
  const log = []
  const enemy = campaign.enemy
  const size = armyTotal(enemy.army)
  if (size === 0) return log // checkEnd handles the win

  // No stockpile any more: the state is recomputed from scratch each turn, so
  // nothing accumulates and nothing has to be migrated between turns.
  const state = enemySupplyState(enemyIncomeKg)
  enemy.supplyState = state

  // The consequence, v1: a well-fed host grows, a starving one bleeds men, a
  // steady one holds. The log is player-visible, so these stay PHRASES — the
  // host's numbers are recon-gated intel and must not leak through the report.
  // A BROKEN host does not recruit, however well it is eating. Below the
  // withdraw threshold it is already melting away down the road it came by
  // (dayResolution's near-annihilation win), and letting food lift it back over
  // that line would steal a win the player had already earned — CI caught
  // exactly that. Fiction and mechanics agree here: fresh swords join a going
  // concern, not a rout. Starvation still applies below the line; only growth
  // is barred, so the collapse is one-way.
  const broken = size < enemy.initialStrength * ENEMY_WITHDRAW_FRACTION
  if (state === 'well-provisioned' && !broken) {
    if (adjustArmy(enemy.army, ENEMY_REINFORCE_HEADCOUNT) > 0)
      log.push('Their camp is well fed, and word of it draws fresh swords to their banner.')
  } else if (state === 'near starving') {
    if (adjustArmy(enemy.army, -ENEMY_DESERTION_HEADCOUNT) < 0)
      log.push('Hunger is telling in the enemy camp — men are slipping away from it in the night.')
  }

  return log
}
