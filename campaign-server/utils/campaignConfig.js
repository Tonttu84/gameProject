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
// Playtest aid: seed enough to build the full fort progression from turn 1
// (L0→1 = 50, L1→2 = 100 = 150 to max) plus a little for militia, so forts are
// visible/testable on the campaign map without a debug grant. See docs/CAMPAIGN_PLAN.md.
export const STARTING_MATERIALS = 200

// ── Augury ──────────────────────────────────────────────────────────────────
// Each turn holds AUGURY_SLOTS independent fates, each a hidden true/false
// event pair. Consulting a slot computes its odds of showing the truth from
// an open-ended reading roll (user formula, 2026-07-05):
//
//   points = throwDice()            exploding d6, avg 4.2, unbounded upside
//          + AUGURY_BASE_POINTS     flat base
//          + mageBonus              min(3, floor(sqrt(mages)))
//          + character?.auguryBonus placeholder, 0 today
//          + trueEvent.baseAccuracy the event's legibility modifier (0–3)
//   odds   = clamp(points × AUGURY_ODDS_PER_POINT, MIN, MAX)
//
// The odds are SHOWN on the vision card — the minigame is judging a dire
// omen at 30% (probably noise) against one at 90% (all but certain) — and
// the vision itself is one chanceRoll against exactly that number.
export const AUGURY_SLOTS = 3
export const AUGURY_BASE_POINTS = 2
export const AUGURY_ODDS_PER_POINT = 0.05 // 5% per point
// Floor per the user (2026-07-05): even a bungled reading keeps a little
// value. (With base 2 the formula bottoms out at 15%; the floor is the
// guarantee that survives future maluses.)
export const AUGURY_ODDS_MIN = 0.05
export const AUGURY_ODDS_MAX = 0.9
export const AUGURY_REROLLS_PER_DAY = 1 // rerolling a slot REPLACES that fate: new pair, new roll, new odds
// The tent reveals each slot's TRUE card once the turn's reroll is spent
// (user: "I need to see the true cards when the reroll has been resolved").
// TEMP DEBUG: true = reveal immediately on consult while the augury is
// playtested; flip to false for the reroll-gated final behavior.
export const AUGURY_DEBUG_SHOW_TRUTH = true
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

// ── Fortifications & militia (materials sink, Stage 3) ───────────────────────
// Fortifications are ABSTRACT LEVELS that wall the battle map at preset
// locations. Spending materials raises fortificationLevel; each level activates
// every preset side with tier ≤ level, walling a wider (and sturdier) span of
// the player's front deployment edge. The engine already applies the combat
// penalty for an attacker crossing a fortified side — the campaign only decides
// WHICH sides are fortified this battle (services/fortification.js).
export const FORTIFY_COST_BASE = 50 // cost to reach level N+1 = FORTIFY_COST_BASE × (N+1)
// Fortifications also cost labour: raising to level N+1 needs
// FORTIFY_WORKER_COST_BASE × (N+1) workers (L0→1 = 500, L1→2 = 1000). Workers
// are the off-map civilian pool (see STARTING_WORKERS); a raised level keeps
// them permanently (the works stand). Distinct from the materials cost — a
// fort needs both the stores and the hands.
export const FORTIFY_WORKER_COST_BASE = 500
export const FORTIFICATION_MAX_LEVEL = 2 // cap (levels 1–2 for now; strength scaling later)

// Ordered, tier-gated player-front hexsides per map. fortificationLevel = N
// activates every entry with tier ≤ N. Authored along the enemy-facing (south,
// higher-r) edge of the player deployment zone: on sample_battle the player
// zone is rows 0–7 and the enemy is at rows 22–29, so the front is row 7 and
// the two southern sides (SE/SW) of each front hex are the wall. The defended
// hex is the row-7 (player-side) hex. `durability` is inert for now (placeholder
// consumed by the later combat-score erosion step) — level 2 sides are sturdier,
// the "mostly coverage, a bit of strength" steer. Axial q at r=7 is visual
// col − 3, so q 4–5 is the center (cols 7–8); tier 2 widens to cols 5–10.
export const FORTIFICATION_PRESETS = {
  sample_battle: [
    // tier 1 — short center span
    { q: 4, r: 7, dir: 'SE', tier: 1, durability: 100 },
    { q: 4, r: 7, dir: 'SW', tier: 1, durability: 100 },
    { q: 5, r: 7, dir: 'SE', tier: 1, durability: 100 },
    { q: 5, r: 7, dir: 'SW', tier: 1, durability: 100 },
    // tier 2 — widens the span, sturdier works
    { q: 2, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 2, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 3, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 3, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 6, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 6, r: 7, dir: 'SW', tier: 2, durability: 160 },
    { q: 7, r: 7, dir: 'SE', tier: 2, durability: 160 },
    { q: 7, r: 7, dir: 'SW', tier: 2, durability: 160 },
  ],
}

// Militia purchase: raw bodies bought with stores. Cost per head + a per-turn
// cap so it's a steady trickle, not an instant army. (Added to Soldier for now;
// a distinct Militia unit type is a later SSOT run.)
export const MILITIA_FOOD_COST = 2
export const MILITIA_MATERIAL_COST = 1
export const MILITIA_WORKER_COST = 1 // each militiaman IS a worker taken off the civilian pool
export const MILITIA_DAILY_CAP = 50
export const MILITIA_UNIT = 'Soldier'

// ── Workers (civilian labour pool, off the campaign map) ─────────────────────
// A finite workforce that fortifications and militia both draw on. Tracked as
// total + used; available = total − used. Spending (forts, militia) raises
// `used` permanently — no replenishment yet (events / growth is a later SSOT
// run; see docs/CAMPAIGN_PLAN.md item 5). Deliberately large relative to the
// fighting roster. NOTE: the planned "workers eat food at 1/3 upkeep" step is
// intentionally NOT wired yet — at this pool size it would dwarf army upkeep;
// it waits on the replenishment design.
export const STARTING_WORKERS = 2000

// Enemy AI stance machine (services/enemyAi.js). Thresholds are turns.
export const ENEMY_SHADOW_DAY = 3 // leaves camp and starts shadowing from this turn
export const ENEMY_OFFER_EVERY = 5 // offers battle every Nth turn regardless
export const ENEMY_LOW_SUPPLIES = 25000 // offers battle below this (~1 turn of food)
export const ENEMY_WITHDRAW_FRACTION = 0.2 // withdraws (you win) below this strength
