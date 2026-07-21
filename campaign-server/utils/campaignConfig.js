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
// Persistent starting squads (playtest item 1): a subset of STARTING_ROSTER
// organized into named, deployable formations so squads are testable from
// turn 1. Sized to fit one hex (Hex::CAPACITY = 640 size-points; Soldier/
// Archer are 10, Cavalry/LightCavalry are 20 — see `./game info`). At least
// one is mixed-type (Vanguard Riders) to exercise that path. `id` is a small
// int, not an ObjectId — it flows straight into the engine's placement JSON
// as squad_id. The remainder of STARTING_ROSTER stays loose (unassigned).
export const STARTING_SQUADS = [
  { id: 1, name: '1st Cohort',      composition: { Soldier: 40 } },
  { id: 2, name: 'Skirmishers',     composition: { Archer: 30 } },
  { id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 } },
]
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

// ── Scouting (Stage 4 → Recon rework) ────────────────────────────────────────
// The scouting level collapses to one of five bands — Blind / Outmatched /
// Contested / Superior / Overwhelming — and ONLY that label ever reaches the
// client (a raw point count would leak nothing about the enemy anyway).
// Recon rework (docs/CAMPAIGN_PLAN.md): the scouting LEVEL is no longer a
// passive troop-coverage ratio — it comes from `campaign.recon.points`, the
// leftover scouting points accumulated over the campaign (reconLevel/reconBand
// in utils/capabilities.js). Cumulative point thresholds to REACH each band
// above Blind, indexed to SCOUTING_BANDS[1..4]. A fresh campaign (0 points)
// starts Blind and climbs as unspent points accrue. ROUGH/TUNABLE — the real
// per-turn scouting pool is large relative to raid-board costs, so these want
// calibration in playtest (balance stays rough until the loop is complete).
// Cumulative leftover-point thresholds to REACH each band above Blind. Raised
// for recon R2 (2026-07-21): with a per-turn pool ~600 and a ~10-turn campaign,
// the old [100,300,700,1400] made the TOP tier (exact intel) trivially reached
// by mid-game. These make it a real hoard — top level costs most of a campaign's
// unspent points, so a player who ALSO spends on the raid board can't reach it.
export const RECON_LEVEL_THRESHOLDS = [200, 700, 2000, 4500] // Outmatched, Contested, Superior, Overwhelming

// Recon R2 — graduated numeric brackets (enemy total count + boss-fight meter
// value). At each recon LEVEL, the [low, high] estimate around the true value
// is `truth × [floorMult, ceilMult]`, asymmetric (skewed to OVER-estimate the
// enemy — floorMult < 1 < ceilMult). Level 0 (Blind) shows no number at all;
// the top level (Overwhelming) is exact (×[1,1]). Indexed by recon level 0..4.
// The offsets are stored ABSOLUTE and displayed against live truth, so
// casualties slide the whole bracket down without leaking width, and the bracket
// is re-set (narrower) only on a level-up — never re-rolled per turn. ROUGH/
// TUNABLE (docs/CAMPAIGN_PLAN.md "Recon rework").
export const RECON_BRACKET_MULTIPLIERS = [
  [1.0, 1.0], // 0 Blind — no bracket shown (gated out before this is read)
  [0.6, 1.7], // 1 Outmatched
  [0.78, 1.4], // 2 Contested
  [0.9, 1.18], // 3 Superior
  [1.0, 1.0], // 4 Overwhelming — exact
]
// Widening jitter added on top of the multiplier bracket when it's set, so the
// midpoint isn't the truth and the known multipliers can't be inverted to solve
// it. Directional (always widens, never inverts): the floor is pushed DOWN by up
// to `floor` × truth, the ceiling UP by up to `ceil` × truth. Skipped at the top
// level so "exact" stays exact.
export const RECON_BRACKET_JITTER = { floor: 0.25, ceil: 0.5 }

// Which rung of a recon-sensitive event actually fires at each scouting band
// (Stage 4 1c). 'blind' is the event itself (the full blow, and always what
// the augur foretells); 'warned' and 'anticipated' live on the event's
// `rungs` ladder in services/events.js. Prophecy tells you what's coming —
// scouting decides whether it lands.
export const EVENT_RUNG_BY_BAND = {
  Blind: 'blind',
  Outmatched: 'warned',
  Contested: 'warned',
  Superior: 'anticipated',
  Overwhelming: 'anticipated',
}

// Forage posture (Stage 4 1d): the band sets HOW the host forages. Owning the
// field lets foragers work in small dispersed parties — more ground swept
// (yield ×) and enemy parties screened off (clash odds ×, applied before
// CLASH_CAP). Losing it forces large defensive columns: less ground, and the
// enemy's riders pick the moments of contact. Outmatched you can STILL forage
// — just less of it — and Contested is exactly today's numbers. "Group size"
// is the fluff for these two multipliers; the player never micro-manages it.
export const FORAGE_YIELD_BY_BAND = {
  Overwhelming: 1.25,
  Superior: 1.1,
  Contested: 1,
  Outmatched: 0.85,
  Blind: 0.7,
}
export const FORAGE_CLASH_DAMPER_BY_BAND = {
  Overwhelming: 0.5,
  Superior: 0.75,
  Contested: 1,
  Outmatched: 1.25,
  Blind: 1.5,
}

// ── Raids (Stage 4 Part 2.5 — the scouting-points mini-game) ─────────────────
// Each turn opens with ONE base target (plus any counter-raids). The player
// then spends a pool of SCOUTING POINTS to shape the board: scout a new target,
// or reveal a target's hidden reward / per-type enemy strength. Points are
// derived from the army's own recon capability (scoutingPointsFor, capabilities
// .js) — a baseline human ≈ 1 point, summed raw over the army — so a bigger or
// scouting-heavier force gets more raids. Abundance is tamed by the FLAT costs
// below (not by the generation formula), which keep "more scouting → more
// raids" true while stopping a big army from trivially revealing everything.
export const RAID_BASE_TARGETS = 1
export const RAID_SCOUT_COST_ADD = 200 // scout a NEW target
export const RAID_SCOUT_COST_REVEAL = 50 // reveal one field (reward OR enemy) one level
// scoutingPointValue = (accuracy / BASELINE_ACCURACY) × (speed / foot) + reconTag,
// with accuracy = ballisticSkill × ACCURACY_PER_BALLISTIC. Named so no literal
// 10s leak into the formula; baseline human (bs 2 → acc 10, speed 10) = 1.0.
export const BASELINE_ACCURACY = 10
export const ACCURACY_PER_BALLISTIC = 5
// Player-facing reward/enemy bands are the true value ± this fraction (min
// width 1), pre-computed at generation; a reveal only pins them to exact.
export const RAID_RANGE_JITTER = 0.25
// The slice of the enemy host a raid targets (jittered per opportunity), and
// the party budget relative to the target's size-points — raids are small
// detachment actions, not the main battle by another door.
export const RAID_TARGET_FRACTION = 0.05
export const RAID_CAPACITY_RATIO = 1.25
// The user's party-cost formula (2026-07-13): one unit costs
// size × (40 − speed) / RAID_CAPACITY_SPEED_SCALE. See raidCapacityCost.
export const RAID_CAPACITY_SPEED_SCALE = 40
// Raids are short battles: the engine's max_turns for a raid input.
export const RAID_MAX_TURNS = 60
// Reward ranges ([lo, hi], rolled at generation): loot_supplies pays stores,
// rescue_troops frees bodies. destroy_detachment's reward IS the destruction
// (the target force leaves the hidden host); counter_event unmakes a sealed
// bad fate (reward = {slot}, hidden — it would out which vision was true).
export const RAID_LOOT_FOOD = [2000, 5000] // kg
export const RAID_LOOT_MATERIALS = [10, 30]
export const RAID_RESCUE_UNIT = 'Soldier'
export const RAID_RESCUE_COUNT = [10, 25]
// What the scouts SAY a raid target is — detachment-scale phrases, by unit
// count, descending. (The whole enemy host is now shown as a numeric recon
// bracket, not a phrase — see RECON_BRACKET_MULTIPLIERS.)
export const RAID_STRENGTH_BANDS = [
  { min: 60, label: 'a strong detachment' },
  { min: 25, label: 'a full company' },
  { min: 10, label: 'a small band' },
  { min: 0, label: 'a handful' },
]

// Turns of food the enemy has left (supplies ÷ its per-turn need) → supply
// phrase — flavour only now that the battle offer is meter-driven, not a
// supply threshold.
export const ENEMY_SUPPLY_BANDS = [
  { min: 3, label: 'well-provisioned' },
  { min: 1.5, label: 'strained' },
  { min: 0, label: 'near starving' },
]

// The shadowing enemy host (hidden from the player; scouting reveals it).
export const ENEMY_ARMY = {
  Soldier: 540,
  Archer: 150,
  Necromancer: 11,
  LightCavalry: 20,
}
// ~4 turns for the enemy host (21,868 kg per turn); its forage deficit is
// flavour only now — the battle offer is driven by the meter, not supply.
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
// cap so it's a steady trickle, not an instant army.
export const MILITIA_FOOD_COST = 2
export const MILITIA_MATERIAL_COST = 1
export const MILITIA_WORKER_COST = 1 // each militiaman IS a worker taken off the civilian pool
export const MILITIA_DAILY_CAP = 50
export const MILITIA_UNIT = 'Militia'

// ── Workers (civilian labour pool, off the campaign map) ─────────────────────
// A finite workforce that fortifications and militia both draw on. Tracked as
// total + used; available = total − used. Fort labour raises `used` — the
// worker is still around, just permanently busy maintaining the works.
// Militia is different: those workers LEAVE the civilian pool entirely to
// become roster soldiers, so buying militia decrements `total` instead (see
// the militia branch of POST /:id/spend in routes/campaigns.js). Neither
// direction replenishes yet (events / growth is a later SSOT run; see
// docs/CAMPAIGN_PLAN.md item 5). Deliberately large relative to the fighting
// roster. NOTE: the planned "workers eat food at 1/3 upkeep" step is
// intentionally NOT wired yet — at this pool size it would dwarf army upkeep;
// it waits on the replenishment design.
export const STARTING_WORKERS = 2000

// Enemy AI stance machine (services/enemyAi.js). `stance` is now driven by
// the boss-fight meter below (see METER_BANDS) except for the withdraw case,
// which stays an independent near-annihilation check.
export const ENEMY_WITHDRAW_FRACTION = 0.2 // withdraws (you win) below this strength

// ── Boss-fight meter (roguelite campaign loop) ───────────────────────────────
// Hidden per-campaign counter, 0 → BOSS_FIGHT_METER_THRESHOLD. Fills at
// end-of-day by CEILING − FLOOR × (troopsInCamp / totalRoster): everyone
// raiding/foraging fills it fastest (CEILING/turn), everyone held back in
// camp fills it slowest (FLOOR/turn) — see services/meter.js. Crossing the
// threshold sets campaign.bossFightDue; the decisive fight is due the NEXT
// day (see docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop").
export const BOSS_FIGHT_METER_THRESHOLD = 1000
export const BOSS_FIGHT_METER_FLOOR = 50
export const BOSS_FIGHT_METER_CEILING = 100
// Banded phrase (mirrors ENEMY_SUPPLY_BANDS) — the meter's level-0 form on the
// wire (recon R2 adds a numeric estimate above that). Also drives the enemy
// stance machine directly (calm ⇒ camp, else ⇒ shadowing; offering_battle is
// bossFightDue instead) — one banded signal instead of two systems that could
// disagree.
export const METER_BANDS = [
  { min: 667, label: 'imminent' },
  { min: 334, label: 'restless' },
  { min: 0, label: 'calm' },
]
