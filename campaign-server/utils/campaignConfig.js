// Campaign tuning knobs and starting state — the one place campaign numbers
// live. Unit STATS stay in the C++ constructors (SSOT); these are the
// campaign-layer rules built on top of them.

export const MAP_NAME = 'sample_battle'

// Retires the frontend STARTING_ROSTER hardcode (docs/ADDING_UNITS.md §6).
export const STARTING_ROSTER = {
  Soldier: 300,
  Archer: 50,
  Mage: 3,
  Priest: 3,
  Cavalry: 10,
  LightCavalry: 12,
}
export const STARTING_FOOD = 100
export const STARTING_MATERIALS = 0
export const STARTING_AUGURY = 50

// The shadowing enemy host (hidden from the player; scouting reveals it).
export const ENEMY_ARMY = {
  Soldier: 540,
  Archer: 150,
  Necromancer: 11,
  LightCavalry: 20,
}
export const ENEMY_SUPPLIES = 400

// Upkeep: food consumed per day = ceil(totalUnits / UPKEEP_DIVISOR).
export const UPKEEP_DIVISOR = 10
// When food is exhausted, this fraction of every roster line deserts overnight.
export const DESERTION_FRACTION = 0.1

// Enemy AI stance machine (services/enemyAi.js).
export const ENEMY_SHADOW_DAY = 3 // leaves camp and starts shadowing from this day
export const ENEMY_OFFER_EVERY = 5 // offers battle every Nth day regardless
export const ENEMY_LOW_SUPPLIES = 100 // offers battle when supplies drop below this
export const ENEMY_WITHDRAW_FRACTION = 0.2 // withdraws (you win) below this strength
