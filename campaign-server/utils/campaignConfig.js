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
// (L0→1 = 50, L1→2 = 100 = 150 to max) plus a little for recruiting, so forts are
// visible/testable on the campaign map without a debug grant. See docs/CAMPAIGN_PLAN.md.
export const STARTING_MATERIALS = 200
// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"): both
// start at 0 — a fresh campaign has no gold or remounts, only the raw
// materials/food/workers economy. Both are earned the same two ways: off the
// raid board (destroy/loot pay gold, the horse drove pays horses) and from
// events (the garrison's paychest; A Captured Herd's keep-the-herd branch).
export const STARTING_GOLD = 0
export const STARTING_HORSES = 0

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

// Forage posture (Stage 4 1d, decision 8 of the effort slider): the band sets
// HOW efficiently the host forages. Owning the field lets foragers work in
// small dispersed parties — more ground swept per point. Losing it forces
// large defensive columns: less ground per point. Outmatched you can STILL
// forage — just less of it — and Contested is exactly the neutral baseline.
// "Group size" is the fluff for this multiplier; the player never
// micro-manages it. (Forager clashes, and this table's old clash-damper
// twin, are gone — S2 deleted the contention they applied to.)
export const FORAGE_YIELD_BY_BAND = {
  Overwhelming: 1.25,
  Superior: 1.1,
  Contested: 1,
  Outmatched: 0.85,
  Blind: 0.7,
}

// ── Raids (Stage 4 Part 2.5 — the scouting-points mini-game) ─────────────────
// Each turn opens with ONE base target (plus any counter-raids). The player
// then spends a pool of SCOUTING POINTS to shape the board: scout a new target,
// or reveal a target's hidden reward / per-type enemy strength. Points are the
// (1 − forage.share) slice of the army's one field-points pool (fieldPointsFor,
// capabilities.js) — a baseline human ≈ 1 point, summed raw over the army — so
// a bigger or scouting-heavier force (or a share weighted toward scouting)
// gets more raids. Abundance is tamed by the FLAT costs below (not by the
// generation formula), which keep "more scouting → more raids" true while
// stopping a big army from trivially revealing everything.
export const RAID_BASE_TARGETS = 1
export const RAID_SCOUT_COST_ADD = 200 // scout a NEW target
export const RAID_SCOUT_COST_REVEAL = 50 // reveal one field (reward OR enemy) one level
// fieldPointValue = (accuracy / BASELINE_ACCURACY) × (speed / foot) + reconTag,
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
// Gold off a won raid (docs/CAMPAIGN_PLAN.md "Recruit phase" — the currency the
// caster lane spends: Mage 100, Priest 80). Coin per unit of the target force,
// so a bigger detachment carries more; destroy pays better than loot per head
// (spoils stripped off the dead vs a paychest riding with the wagons).
export const RAID_GOLD_PER_UNIT = { destroy_detachment: 1.2, loot_supplies: 0.8 }
// …times a WIDE independent variance roll, so size and payoff are correlated
// but far from locked together: at the same guard strength one target is a
// bargain and the next is barely worth the ride. That spread is what makes
// buying the reward field with scouting points worth the points (user,
// 2026-08-03) — without it, strengthBand alone would tell you everything.
export const RAID_GOLD_VARIANCE = [0.5, 2.0]
// Horses off a won `seize_horses` raid — "The Horse Drove", a dealer's string
// of remounts under hired guard (grilled 2026-08-03). Deliberately NOT the
// enemy's own cavalry: the card is ungated, so it draws whatever the host is
// made of, and beating the guard never thins the host. Same shape as gold —
// guard headcount × rate × a WIDE independent variance roll — so the
// bargain-target property holds here too and buying the reveal is worth the
// points. At 5 horses per Cavalry/LightCavalry hire, 0.4 makes a typical drove
// a few hires' worth, never a mounted army off one card.
export const RAID_HORSES_PER_UNIT = 0.4
export const RAID_HORSES_VARIANCE = [0.5, 2.0]
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

// S4 "starve the enemy": the host's supply state is a PER-TURN BALANCE, not a
// stockpile — income ÷ consumption this turn, with no running total carried
// between turns (user, 2026-08-09: "either they have too much, enough or not
// enough … just turn by turn"). Bands are that ratio → the phrase the scouts
// report. The dead band around 1.0 keeps a mixed-ring draw from flickering
// between states on rounding alone.
// Pick a band's label for a value: the tables below are ordered high→low and
// every one ends at min 0, so the first match wins. Lives here, beside the band
// tables it reads, because it was previously defined privately in BOTH
// campaignView.js and raid.js — and S4 would have made it three copies.
export const bandLabel = (value, bands) => bands.find(({ min }) => value >= min).label

export const ENEMY_SUPPLY_BANDS = [
  { min: 1.1, label: 'well-provisioned' },
  { min: 0.9, label: 'steady' },
  { min: 0, label: 'near starving' },
]

// The shadowing enemy host (hidden from the player; scouting reveals it).
export const ENEMY_ARMY = {
  Soldier: 540,
  Archer: 150,
  Necromancer: 11,
  LightCavalry: 20,
}
// How the host's numbers answer its supply state each turn (S4 v1, deliberately
// blunt): a surplus buys recruits, a deficit bleeds deserters, steady holds.
// Applied to EVERY unit type so the host's composition is preserved.
export const ENEMY_REINFORCE_RATE = 0.03
export const ENEMY_DESERTION_RATE = 0.05

// Daily food need per unit = size² × this (kg); a turn consumes 14 days of it.
// The square makes big mounts expensive: cavalry is a supply decision.
export const FOOD_KG_PER_SIZE_SQ_PER_DAY = 0.02

// When food is exhausted, this fraction of every roster line deserts per turn.
export const DESERTION_FRACTION = 0.1

// ── Foraging (S2 "effort slider" — docs/CAMPAIGN_PLAN.md) ────────────────────
// Foraging is passive now: there is no per-unit assignment or forager clash.
// The whole army's fieldPointsFor pool (utils/capabilities.js) is snapshotted
// once at newDay (campaign.forage.pool) and split by the player's slider
// (campaign.forage.share) between food/materials and scouting points.
//
// Distance rings around the shared camp area, in kg of gatherable food. No
// regrowth: ring depletion is the campaign clock — when the land is picked
// clean, somebody has to fight. Scaled up ~4× from the pre-slider numbers
// (decision 7: the old rings would strip in ~5 turns against foraging alone;
// this land should cover a whole 10–20 turn campaign even at a high forage
// share) — approximate/tunable, like FORAGE_KG_PER_POINT below.
export const FORAGE_RINGS = [80000, 140000, 220000] // near / mid / far
// One pool point gathers this many kg per turn. Calibrated (decision 6) so
// spending ~70% of the starting army's pool (≈1112 pts) on foraging roughly
// breaks even against its own consumption (≈12,432 kg/turn): 0.7 × 1112 ×
// 16 ≈ 12,454 kg gathered — feeding the army is the default burden, scouting
// is bought with hunger.
export const FORAGE_KG_PER_POINT = 16
// Harvest splits into rations and useful salvage (timber, iron, cordage).
export const FORAGE_FOOD_SHARE = 0.8
export const FORAGE_MATERIALS_SHARE = 0.2
// Distance yield penalty (decision 5): spilling into a farther ring nets less
// credit per kg physically swept — without forager clashes to contest them,
// the three rings would otherwise be one pool wearing three gauges.
export const FORAGE_RING_YIELD = [1.0, 0.8, 0.6] // near / mid / far
// The enemy's abstract per-turn drain on the shared rings (decision 4): no
// more enemy army composition, no contention, no clashes — it just eats land
// and gets no credit for it. Roughly the enemy's old forage-plan magnitude
// (~9,084 kg/turn at ENEMY_FORAGE_FRACTION 0.4 of its host), kept as a flat
// number now that nothing derives it from the hidden army.
export const ENEMY_DRAIN_KG_PER_TURN = 9000
// S4 "starve the enemy": what the host must find every turn to hold its
// strength. Defined AS the mid-ring take (drain × FORAGE_RING_YIELD[1] =
// 9000 × 0.8 = 7200), so the intended design falls out of the arithmetic
// instead of being tuned into it: the host forages the NEAR ring at a surplus
// (ratio 1.25), the MID ring exactly break-even (1.00), and the FAR ring at
// starvation (0.75). Derived, not a magic number — retuning the drain or the
// yield curve moves break-even along with it. MUST stay below both constants
// it reads (they are `const`, so referencing them earlier is a TDZ crash).
export const ENEMY_CONSUMPTION_KG_PER_TURN = ENEMY_DRAIN_KG_PER_TURN * FORAGE_RING_YIELD[1]
// The forage/scouting split's default and STICKY starting value (a fresh
// campaign's forage.share) — 10% steps, sticky across turns (decision 13).
// 0 (all-scouting) continues the pre-slider default exactly: the old
// forage.assignment started empty (nobody foraging) until the player chose
// otherwise, and every point of a 0-share pool flows to scouting just like
// the old unsplit scoutingPoints pool did.
export const DEFAULT_FORAGE_SHARE = 0

// ── Fortifications (materials sink, Stage 3) ─────────────────────────────────
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

// ── Workers (civilian labour pool, off the campaign map) ─────────────────────
// A finite workforce that fortifications and Recruit hires both draw on.
// Tracked as total + used; available = total − used. Fort labour raises `used`
// — the worker is still around, just permanently busy maintaining the works.
// A hire is different: those workers LEAVE the civilian pool entirely to
// become roster soldiers, so hiring decrements `total` instead (see applyHire
// in services/recruit.js). Neither
// direction replenishes yet (events / growth is a later SSOT run; see
// docs/CAMPAIGN_PLAN.md item 5). Deliberately large relative to the fighting
// roster. NOTE: the planned "workers eat food at 1/3 upkeep" step is
// intentionally NOT wired yet — at this pool size it would dwarf army upkeep;
// it waits on the replenishment design.
export const STARTING_WORKERS = 2000

// ── Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") ────
// One hire per day: the phase offers up to 2 eligible+affordable options from
// services/recruit.js's RECRUIT_POOL, the player picks one (or gets the free
// Militia fallback below if nothing is affordable). This REPLACED the old
// MILITIA_* purchase constants (removed in S4) — Militia is the base tier of
// RECRUIT_POOL now, not its own mechanic.
export const RECRUITING_FERVOR_START = 0
// A boosted troop-lane hire that CAN afford double pays double for double the
// count; one that can't gets this fraction knocked off the normal cost for
// the normal count instead. Same ratio drives the caster-lane fallback (a
// discount on the single hire when the bonus second hire isn't affordable).
export const RECRUIT_BOOST_DISCOUNT = 0.3
// Granted automatically, no choice shown, on a day where nothing in the pool
// is affordable — keeps a stalled economy from being unable to recruit at all.
export const FREE_MILITIA_AMOUNT = 5

// Near-annihilation win: once the enemy host drops below this fraction of its
// starting strength it melts away and you take the country (checked directly in
// services/dayResolution.js end conditions — the ambient path, independent of
// the boss-fight meter).
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
// wire (recon R2 adds a numeric estimate above that). Narratively this is the
// state of Karrowgate's walls under the enemy's assault: the meter climbing 0→
// threshold IS the walls going from intact to breached (the frontend renders it
// as a DRAINING integrity gauge). Also the single signal for the enemy's
// disposition: the reveal/council flavor is derived from this band plus
// bossFightDue (intact/damaged/breached, then the pitched battle once the walls
// are breached) — one banded signal, no separate stance machine.
export const METER_BANDS = [
  { min: 667, label: 'breached' },
  { min: 334, label: 'damaged' },
  { min: 0, label: 'intact' },
]

// ── Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison-support epic") ─────────
// Standing between your relief army and Karrowgate's besieged garrison, a
// 0..100 track (campaign.garrison.resolve). Cooperation events AWARD it (the
// `garrison` effect); it's read as an event GATE (requires minResolve/maxResolve,
// events.js eventEligible), it slows the wall meter (the passive centerpiece,
// slice 2), and it drives the pitched-battle sally support (S5→S7). The S5
// redesign (2026-07-24): the garrison is now SHOWN as a visible HUD gauge — a
// proportional bar + one of three LEVEL words (garrisonLevel, services/
// garrison.js) — since you're in signalling contact with them; only the raw
// integer stays hidden. And resolve at/under the surrender floor ends the
// campaign: the garrison opens Karrowgate's gates (a second loss condition,
// independent of the walls meter — checked in dayResolution).
export const GARRISON_RESOLVE_MIN = 0
export const GARRISON_RESOLVE_MAX = 100
export const GARRISON_RESOLVE_START = 45
// At/under this the garrison surrenders and the campaign is LOST (dayResolution
// step 6), regardless of the walls. Neglect the relationship and Karrowgate
// falls before the walls ever breach. Tunable; the clamp floor is the MIN above.
export const GARRISON_SURRENDER_FLOOR = 0
// Slice 2 — the passive wall-slow (the centerpiece: this is the ONE lever the
// player has to push the breach back). A heartened, coordinated garrison holds
// Karrowgate's walls better, so the boss-fight meter (the walls under assault)
// fills more slowly: the day's fill is reduced by wallSlowFactor(resolve) ∈
// [0, GARRISON_WALL_SLOW_MAX], linear in resolve (services/garrison.js). Capped
// well below 1 so even a devoted garrison can't freeze the clock outright — the
// walls always give a little each turn (the floor kept honest, per the design).
export const GARRISON_WALL_SLOW_MAX = 0.4
// Band-cross decay: when the walls are battered into a worse damage band
// (METER_BANDS: intact→damaged→breached), the garrison feels abandoned and
// their resolve slips this much (hidden, like the `garrison` effect — the
// player reads only the band word dropping). Tunable; balance stays rough.
export const GARRISON_BAND_CROSS_DECAY = 10
// The sally (payoff 2). At the decisive pitched battle a garrison that trusts
// you sorties from Karrowgate's gates. GRADUATED by level (S7): the garrison's
// men enter the fight as allied reinforcements storming the enemy's rear — the
// casterless auto-cast spell (S6), fed via BattleInput's `reinforcements`. The
// count is keyed on garrisonLevel: low sends no one, normal some, determined
// more. All tunable; balance stays rough.
//   - GARRISON_SALLY_TROOPS: units the garrison commits, by level.
//   - GARRISON_SALLY_TICK: the turn they arrive at the enemy rear.
//   - GARRISON_SALLY_UNIT: what they field (foot for now).
//   - GARRISON_SALLY_TEAM: 2 = BLUETEAM, the player's side (engine Defines.hpp).
//   - GARRISON_SALLY_BATTLE_MESSAGE: the replay log line the sally prints (the
//     engine keeps campaign fiction out of itself and logs whatever we pass).
export const GARRISON_SALLY_TROOPS = { low: 0, normal: 40, determined: 80 }
export const GARRISON_SALLY_TICK = 4
export const GARRISON_SALLY_UNIT = 'Soldier'
export const GARRISON_SALLY_TEAM = 2
export const GARRISON_SALLY_BATTLE_MESSAGE =
  "Karrowgate's garrison throws open its gates — allies storm the enemy's rear!"
// The determined-level floor (67). Retained as the `garrisonSallies` predicate's
// threshold (services/garrison.js) — "is the garrison determined?"; the sally
// itself is now graduated via GARRISON_SALLY_TROOPS above.
export const GARRISON_SALLY_THRESHOLD = 67
// The three garrison LEVELS shown to the player (S5 redesign — replaces the old
// faltering/wary/steadfast/devoted bands). Descending {min, label} (same
// convention as METER_BANDS). 0 is the surrender floor (campaign lost), so the
// `low` band nominally covers 1..33, `normal` 34..66, `determined` 67..100; a
// resolve of 0 reads `low` for the brief moment before dayResolution ends it.
export const GARRISON_BANDS = [
  { min: 67, label: 'determined' },
  { min: 34, label: 'normal' },
  { min: 0, label: 'low' },
]
