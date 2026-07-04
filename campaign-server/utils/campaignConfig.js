// Campaign tuning knobs and starting state — the one place campaign numbers
// live. Unit STATS stay in the C++ constructors (SSOT); these are the
// campaign-layer rules built on top of them.
//
// TIME SCALE: one campaign turn (the model's `day` counter, one end-day
// resolution) represents TWO WEEKS of campaigning. Food is in kilograms and
// everything below is per-turn: a unit eats size² × FOOD_KG_PER_SIZE_SQ_PER_DAY
// × DAYS_PER_TURN each turn (size-10 foot soldier → 28 kg, size-20
// horse-and-rider → 112 kg), so stores and forage richness sit on the
// tens-of-thousands scale — an army of hundreds really does eat tonnes.

export const DAYS_PER_TURN = 14
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
// ~4 turns for the starting army (which needs 12,432 kg per turn).
export const STARTING_FOOD = 50000
export const STARTING_MATERIALS = 0

// ── Augury ──────────────────────────────────────────────────────────────────
// Consulting the augur rolls exploding dice + the true event's baseAccuracy
// bonus + a mage bonus + a character bonus; at or above the threshold the
// prophecy shows the true event, below it it may show the decoy. These
// numbers are server-side only — the UI never states odds.
export const AUGURY_THRESHOLD = 7
export const AUGURY_REROLLS_PER_DAY = 1 // a reroll REPLACES fate: both events redrawn
export const AUGURY_MAGE_BONUS_CAP = 3 // mageBonus = min(cap, floor(sqrt(mages)))

// The shadowing enemy host (hidden from the player; scouting reveals it).
export const ENEMY_ARMY = {
  Soldier: 540,
  Archer: 150,
  Necromancer: 11,
  LightCavalry: 20,
}
// ~4 turns for the enemy host (21,868 kg per turn); its forage deficit walks
// it down to ENEMY_LOW_SUPPLIES around turn 5 — hunger forces a battle.
export const ENEMY_SUPPLIES = 90000

// Daily food need per unit = size² × this (kg); a turn consumes 14 days of it.
// The square makes big mounts expensive: cavalry is a supply decision.
export const FOOD_KG_PER_SIZE_SQ_PER_DAY = 0.02

// When food is exhausted, this fraction of every roster line deserts per turn.
export const DESERTION_FRACTION = 0.1

// ── Foraging ────────────────────────────────────────────────────────────────
// Distance rings around the shared camp area, in kg of gatherable food. No
// regrowth: ring depletion is the campaign clock — when the land is picked
// clean, somebody has to fight.
export const FORAGE_RINGS = [20000, 35000, 55000] // near / mid / far
// One forageValue point gathers this many kg per turn. Calibrated so the
// whole starting army foraging at once roughly breaks even against its own
// consumption — and you can never afford to send everyone.
export const FORAGE_KG_PER_POINT = 15
// Harvest splits into rations and useful salvage (timber, iron, cordage).
export const FORAGE_FOOD_SHARE = 0.8
export const FORAGE_MATERIALS_SHARE = 0.2
// Base chance of a forager clash per contested ring, by distance — foraging
// far from camp is where the war of outposts happens.
export const CLASH_BASE = [0.05, 0.12, 0.25]
// Contested pressure: + factor × min(P,E)/(P+E), capped.
export const CLASH_CONTEST_FACTOR = 0.3
export const CLASH_CAP = 0.6
// The routed side abandons this share of what it gathered in the ring.
export const CLASH_LOSER_YIELD_FORFEIT = 0.5
// Detachment casualty ranges (percent of the foraging party), rolled per clash.
export const CLASH_LOSER_CASUALTY_PCT = [2, 6]
export const CLASH_WINNER_CASUALTY_PCT = [1, 2]
// The enemy AI sends this fraction of its host's forage capacity out each turn.
export const ENEMY_FORAGE_FRACTION = 0.4

// Enemy AI stance machine (services/enemyAi.js). Thresholds are turns.
export const ENEMY_SHADOW_DAY = 3 // leaves camp and starts shadowing from this turn
export const ENEMY_OFFER_EVERY = 5 // offers battle every Nth turn regardless
export const ENEMY_LOW_SUPPLIES = 25000 // offers battle below this (~1 turn of food)
export const ENEMY_WITHDRAW_FRACTION = 0.2 // withdraws (you win) below this strength
