import mongoose from 'mongoose'
import config from '../utils/config.js'
import {
  GARRISON_RESOLVE_START,
  RECRUITING_FERVOR_START,
  DEFAULT_FORAGE_SHARE,
  ENEMY_SUPPLY_BANDS,
  RESEARCH_DEFAULT_FOCUS,
  RESEARCH_START_LEVEL,
  SPELL_SCHOOLS,
} from '../utils/campaignConfig.js'

// One roguelite campaign run per document. HIDDEN INFORMATION lives here in
// plain fields — enemy.army, enemy.plannedPlacement, augury.trueEvent/
// decoyEvent/prediction internals, forage.enemyDrainKg below the Outmatched
// recon band — and must NEVER reach a
// client through Mongoose toJSON. Every response goes
// through services/campaignView.js, the single serializer that decides what
// the player may see. Do not add routes that res.json() a campaign document.

const auguryEventSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    // 1 minor … 3 major — the event's POOL. A slot's true/false pair shares
    // one pool, and the reading modifier comes from the pool
    // (events.js POOL_LEGIBILITY), so the shown odds can't out the truth.
    severity: { type: Number, required: true },
    effect: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false },
)

// One raid opportunity (Stage 4 Part 2.5, the scouting-points mini-game): a
// capacity-limited target resolved as a real short engine battle. targetForce
// (the slice of the hidden host the raid fights) and reward (counter_event's
// slot index would out which vision was true) stay HIDDEN as ground truth;
// what campaignView exposes depends on how much the player has PAID to reveal.
// Each of reward and enemy has its own reveal LEVEL (an int, not a bool, so
// unknown→range→tighter→exact can grow later): 0 shows the range, 1 the exact
// value. The player-facing ranges are pre-computed so a reveal only pins them.
// An enemy champion carrying real gear (slice 9a, decisions 9-12/9-13).
//
// GENERATED PER ENCOUNTER and never persisted as a roster (9-13): no enemy
// captain has a name to remember, and nothing about one survives its fight. A
// named enemy who returns is the beginning of an opponent, and standing
// principle 1 rules that out — a champion with a blade is DATA, not behaviour.
// He decides nothing; he is a harder unit with better kit.
//
// SEALED at the moment the encounter is dealt, exactly as the augury slots and
// 12's mission offer are, because a card advertises what it carries: rolling it
// at launch would let a reload reroll the reward the player chose the raid FOR.
const enemyBearerSchema = new mongoose.Schema(
  {
    // A catalog unit type, the body the champion IS.
    type: { type: String, required: true },
    // ITEM_CATALOG ids he carries. Real gear: he fights with its mods and
    // abilities, and drops it when you take the field (9-11).
    items: { type: [String], default: [] },
  },
  { _id: false },
)

const raidOpportunitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      // Additive only — a new value leaves every stored opportunity readable,
      // so this needs no CAMPAIGN_SCHEMA_VERSION bump (in-flight campaigns
      // simply never dealt the newest card).
      enum: [
        'destroy_detachment', 'loot_supplies', 'rescue_troops', 'counter_event',
        'garrison_sortie', 'seize_horses',
      ],
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    targetForce: { type: Map, of: Number, required: true }, // HIDDEN ground truth
    strengthBand: { type: String, required: true },
    capacity: { type: Number, required: true },
    reward: { type: mongoose.Schema.Types.Mixed, default: null }, // HIDDEN ground truth
    // Player-facing bands bracketing the hidden truth, shown until revealed:
    // rewardRange {food:[lo,hi], materials:[lo,hi], roster:{type:[lo,hi]}} —
    // only the keys the reward actually has; enemyRange {type:[lo,hi]} per unit
    // type in targetForce (fantasy rosters read per-type, never one headcount).
    rewardRange: { type: mongoose.Schema.Types.Mixed, default: null },
    enemyRange: { type: mongoose.Schema.Types.Mixed, default: null },
    rewardReveal: { type: Number, default: 0 }, // 0 range, 1 exact
    enemyReveal: { type: Number, default: 0 }, // 0 range, 1 exact
    source: {
      type: String,
      enum: ['base', 'scouted', 'counter_event', 'garrison_sortie', 'forage_modifier'],
      default: 'base',
    },
    // Persistent raids (S3): an ordinary unresolved card is DROPPED when the
    // board is redealt at newDay, but a persistent one is carried over intact —
    // same already-rolled targetForce/reward/reveal levels — so a standing
    // problem stays on the board until the player actually deals with it
    // instead of being reshuffled away. Only resolving it removes it.
    persistent: { type: Boolean, default: false },
    // The forage modifier (forage.modifiers[].id) this card exists to undo.
    // Winning the raid lifts that modifier — the generic hook in applyRaidReward,
    // independent of the card's `type`. Same direction as counter_event's
    // reward.slot: the card points at the thing it unmakes.
    modifierId: { type: String, default: null },
    // Garrison sortie (slice 4): a WON sortie of this kind inflicts its real
    // battle casualties on the hidden host, win or lose — like destroy_detachment
    // but per-opportunity (a sortie version may thin the besiegers OR pay other
    // loot instead). A control flag, never exposed by campaignView.
    thinsEnemy: { type: Boolean, default: false },
    // The champion riding with this target, or null (9-12). SEALED here when the
    // board is drawn, and scaled by `strengthBand` above — the field prestige
    // already scales on, so a harder card is where the better relic is.
    // HIDDEN ground truth: campaignView reveals it by recon band (9-14).
    bearer: { type: enemyBearerSchema, default: null },
    // The paths the target's casters command (S2-10), one bag per caster body
    // in `targetForce`, in the order the launch-time spread lays them out.
    // SEALED when the board is dealt, exactly like `bearer` above and for the
    // same reason — HIDDEN ground truth, never projected by campaignView.
    casterPaths: { type: [mongoose.Schema.Types.Mixed], default: () => [] },
    resolved: { type: Boolean, default: false },
    outcome: { type: mongoose.Schema.Types.Mixed, default: null }, // {winner, battleId} once resolved
  },
  { _id: false },
)

// A standing pressure on one of the two forage kg figures (S3). Applied in
// resolveForaging as base × Π(factor) + Σ(deltaKg), clamped at 0 — so a factor
// scales and a deltaKg shifts, and a modifier may carry either or both.
const forageModifierSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    // Player-facing name — this is the ONLY part of an enemyDrain modifier the
    // player ever sees, and even that is recon-gated (campaignView).
    label: { type: String, required: true },
    // Which kg figure it bends: the player's sweeping capacity, or the enemy's
    // drain on the same rings.
    target: { type: String, enum: ['playerYield', 'enemyDrain'], required: true },
    factor: { type: Number, default: 1 },
    deltaKg: { type: Number, default: 0 },
    // Turns remaining, decremented at newDay AFTER the day resolves. null (the
    // default) = permanent: the campaign is short enough that a real setback or
    // victory should mark the rest of it, so expiry is the exception.
    turnsLeft: { type: Number, default: null },
    // If set, the raid board spawns ONE persistent card per turn-less modifier
    // that has none yet, and winning it lifts this modifier. A modifier without
    // the flag simply stands (or times out) with no way to fight it off.
    raidable: { type: Boolean, default: false },
  },
  { _id: false },
)

// Forage rings around the shared camp area: near/mid/far, near depletes
// first, no regrowth — the emptying land is the campaign clock.
const ringSchema = new mongoose.Schema(
  {
    ring: { type: Number, required: true }, // 0 near, 1 mid, 2 far
    richness: { type: Number, required: true },
    initialRichness: { type: Number, required: true },
  },
  { _id: false },
)

// One school of magic's standing (docs/CAMPAIGN_PLAN.md "▶ SLICE 2", S2-7):
// the level the army has reached, and the part-finished progress toward the
// next one. Both are stored PER SCHOOL, which is the whole of what makes
// switching focus free — a school parks its partial where it was earned and
// picks it up untouched later.
const researchSchoolSchema = new mongoose.Schema(
  {
    level:  { type: Number, default: RESEARCH_START_LEVEL },
    points: { type: Number, default: 0 },
  },
  { _id: false },
)

// The four schools as named fields rather than a Map, built from SPELL_SCHOOLS
// so that list stays the single source of which four there are. Named because
// the engine's set is fixed and declared — `research.schools.evocation.level`
// is a plain path mongoose tracks like any other leaf, where a Map of
// sub-documents would need `.get()` at every call site for nothing gained.
const researchSchoolsSchema = new mongoose.Schema(
  Object.fromEntries(
    SPELL_SCHOOLS.map((school) => [
      school,
      { type: researchSchoolSchema, default: () => ({}) },
    ]),
  ),
  { _id: false },
)

// What the host knows (S2-9): ONE SEALED NUMBER PER ENCOUNTER, written onto the
// campaign at creation exactly like its bearer. The host never reacts to
// anything — a later act simply authors higher numbers, which is the dial M-19
// asked for, and a value that moved with the day would be a difficulty curve
// nobody designed.
//
// HIDDEN, like everything else under `enemy`: campaignView never projects it.
const enemyMagicSchema = new mongoose.Schema(
  {
    schools:  { type: Map, of: Number, default: () => new Map() },
    channels: { type: Number, default: 0 },
  },
  { _id: false },
)

// Bump this whenever the campaign document shape changes incompatibly (new
// required fields, changed semantics). There is NO backwards compatibility:
// a roguelite run is disposable, so any stored campaign whose version differs
// — including pre-versioning docs that lack the field — is deleted on the
// next listing instead of being served to campaignView, where missing fields
// render as nonsense (the "food stuck at 100 kg, Land 0%" playtest bug).
// The turn's phases, in order. Exported because the routes' phase guard, the
// advance route and the tests all need the SAME ladder — index order IS the
// forward-only rule (docs/CAMPAIGN_PLAN.md "Effort slider", decision 12).
// These are TURN phases only: the client has extra screens of its own
// (report/placement/battling/result/replay) that are pure UI and never travel
// to the server — 'deploy' is the server's name for all of the battle ones.
export const TURN_PHASES = ['prepare', 'omens', 'raids', 'recruit', 'deploy']

export const CAMPAIGN_SCHEMA_VERSION = 43 // v43: Construction slice C1, the forge (docs/CAMPAIGN_PLAN.md “THE CONSTRUCTION INTERVIEW”, C-1..C-8) — `resources.mithril` (the forge's metal, seeded at STARTING_MITHRIL and fed by raid loot, events and the garrison's trust per C-7; required, so the bump is what guarantees living campaigns carry it) and `characters[].forgedDay` (the once-per-turn stamp, C-6 — a mage who forged today is excluded from that day's research accrual, which with the row's mithril price is the WHOLE cost). NOTHING MIGRATES, as ever — a save from another schema version is deleted on listing; v42: the magic system slice 4, scripting (docs/CAMPAIGN_PLAN.md "▶ SLICE 4 — CHOSEN SPELLS") — `characters[].script`, the ordered spell ids a caster reaches for first, capped at MAX_CHOSEN_SPELLS and set from his own sheet. A PREFERENCE and not a repertoire (S4-1): the engine leads his walk with them and keeps the rest of the roster behind, so the empty list every fresh hire carries is exactly the pre-slice-4 behaviour and NOTHING MIGRATES — as ever, a save from another schema version is deleted on listing. No other field moved: the enemy authors no scripts yet (S4-6), and the list rides the wire off the RECORD through characterEntryFor like `paths` does; v41: the magic system slice 2, the campaign layer (docs/CAMPAIGN_PLAN.md "▶ SLICE 2 — THE CAMPAIGN LAYER") — `research` (the focus, the lent allies and the four schools' banked level/points), `characters[].paths` (the hire roll, S2-3/S2-4, rolled inside mintCharacter so a recruit card offers "a Mage" and the log names what took service), and `enemy.magic` + `paths` on the sealed enemy placements (S2-9/S2-10). NOTHING MIGRATES and nothing needs to: a save from another schema version is deleted on listing, so the six starting casters are minted fresh with their rolls rather than backfilled. The banner CHANNEL pool (S2-8) is deliberately absent from this list — it is set at battle start from the fielded squads, drained by the engine and never persisted, so it needs no field at all; v40: enemy bearers, decision 9 slice 9a (docs/CAMPAIGN_PLAN.md "DECISION 9 — CHARACTER EQUIPMENT") — `raid.opportunities[].bearer` and `enemy.bearer`, the champion carrying real gear on a raid target and with the shadowing host. SEALED where it is dealt (the board at newDay, the host at creation) for the reason every other drawn thing is: a card advertises what it carries, and rolling at launch would let a reload reroll the reward the raid was chosen FOR. Generated per encounter and never a roster (9-13) — no enemy captain has a name to remember, because a named enemy who returns is the beginning of an opponent and standing principle 1 rules that out. Nothing else about the document changed for 9a: `campaign.items` and `characters[].items` already had the shapes gear needed; v39: missions, decision 12 (docs/CAMPAIGN_PLAN.md "DECISION 12 — MISSIONS") — squads[].mission, the {untilDay, eventId} a charter is away under, which is the SECOND notion of busy beside raid.squadAssignment rather than an extension of it (12-3): a raid is spent-today and wiped at newDay, a mission spans turns and lives on the charter. A charter on one is off the raid board, off the battlefield and out of the boss-fight meter, but still eats (12-5), and it leaves the moment the fate is answered at the omens rather than at nightfall (12-7); v38: automatic reinforcement, 13-2 (docs/CAMPAIGN_PLAN.md "NEXT UP: DECISION 13") — squads[].reinforcedDay is GONE with the mechanic it metered: the player no longer drafts replacements, so there is no once-per-turn action to stamp. Every charter now refills at end of turn from the loose pool, up to its archetype's intake, paying the same recipe prices out of the treasury (13-3) and clamping at every gate instead of refusing (13-2); v37: banners and the item store, slice 6 (docs/CAMPAIGN_PLAN.md "SLICE 6 — BANNERS, ITEMS AND THE ABILITY SYSTEM") — `items`, the store holding every item NOT currently on something, and `squads[].banner`, the ITEM_CATALOG id bound permanently to a charter; the banner TIER (plain/basic/item) stays derived from the rank ladder plus that one field, and the ability the banner grants reaches the battlefield as `squad_abilities` on each placement entry, so the engine learns the word `fearless` and never the word `banner`; v36: characters, slice 5a (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS") — the singular `character` Mixed placeholder becomes `characters`, an array of real entities, and Mage/Priest leave `roster` ENTIRELY (5-1): a caster is now an individual with a name, an attachment, a hang-back toggle, a permanent death that keeps its record, and an empty modifier layer (items/experience/wounds) for the later slices to fill; the same six bodies still eat, fill the meter and cost raid capacity, because a character is a special kind of troop (5-0); v35: squad overhaul slice 4a (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE CATALOG") — squads[].upgrades, the PERMANENT ids a charter has taken, and squads[].upgradeOffer, the three-row draft drawn at newDay for any charter with a free slot and consumed by the pick; slots and the Seasoned banner are DERIVED from prestige through the rank ladder and deliberately not stored, so this is the first slice where prestige gates anything; v34: squad overhaul slice 3 (docs/CAMPAIGN_PLAN.md "SLICE 3 — reinforcement") — squads[].reinforcedDay, the once-per-turn ledger for the new POST /:id/squads/:squadId/reinforce; the slice gives slice 2's caps their teeth (a pooled per-squad intake metered on the output side, a hex size-budget gate, and SQUAD_REINFORCE_POOL recipes whose inputs are DESTROYED and outputs CREATED, never matched); v33: squad overhaul slice 2 (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL", decisions 2-4) — squads[].archetype, the id of a SQUAD_ARCHETYPES row carrying the charter's permitted troop types, its per-type caps and its intake rate; the row is looked up, never copied onto the document, and nothing reads it until reinforcement (slice 3); v32: squad overhaul slice 1 (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD OVERHAUL") — squads[].prestige, the PERMANENT rank that gates squad upgrades and is never spent, earned from raids scaled by the target's strength band; the same slice stops the raid/battle reconciliations DISBANDING a wiped squad (a charter now stays on the rolls at composition {} carrying its prestige, per decision 14) and refuses to send an empty one; v31: "starve the enemy" S1 (docs/CAMPAIGN_PLAN.md) — enemy.supplies (a stockpile seeded once, drained by upkeep forever, never replenished, with no consequence at zero) is REPLACED by enemy.supplyState, the per-turn verdict of income ÷ consumption; the host now feeds itself from the rings it drains, so stripping the inner rings starves it; v30: effort slider S3 (docs/CAMPAIGN_PLAN.md "Effort slider — one points pool") — forage.modifiers (standing pressures on the player's capacity / the enemy's drain, granted by the new `forage_modifier` effect, permanent by default) plus raid.opportunities.persistent/modifierId, the carried-over card that lifts one by being beaten; v29: effort slider S2 (docs/CAMPAIGN_PLAN.md "Effort slider — one points pool") — forage.assignment/enemyPlan are GONE, replaced by forage.pool (the day's field-points snapshot), forage.share (the player's slider split, sticky across turns) and forage.enemyDrainKg (a flat abstract number, no longer derived from the enemy's army); forager clashes and services/skirmish.js are deleted; v28: effort slider S1 (docs/CAMPAIGN_PLAN.md "Effort slider — one points pool") — the new `phase` field makes the turn a server-owned one-way march (every mutating route asserts its phase), generalising and replacing the ad-hoc recruit lock; v27: Recruit phase S8 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") — the offer is drawn LAZILY at POST /:id/recruit/open instead of at creation/end-day, sealed by the new recruit.drawnDay, which doubles as the phase lock (every other turn action 400s once it's stamped); the free-Militia auto-grant is gone, replaced by the always-affordable Travellers card that pads the offer to two, and skipping is gone with it — the hire is the only exit; v26: Recruit phase S4 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") — the old ad-hoc militia purchase is GONE (POST /:id/spend {action:'militia'}, the MILITIA_* constants, CampPanel's slider); Militia is the base tier of RECRUIT_POOL now, so `militiaBoughtToday` (its per-turn cap counter) is dropped from the document; v25: Recruit phase S2 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") — recruit.dailyOptions/boosted/hiredToday (the day's offer + one-hire cadence), drawn at creation and redrawn at end-day like augury/raid.opportunities; v24: Recruit phase S1 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") — new required resources.gold/resources.horses + recruit.fervor; the bump ensures fresh campaigns carry them (pre-existing docs would otherwise fail the resources required-field validation); v23: garrison-support S8 (scripted siege spine — three GUARANTEED chained choice beats seeded onto scheduledEvents at creation, turns 2/5/8: siege_lines_close / breach_threatens / wardens_van, forced into their day's augury by the schedule drain; the bump ensures fresh campaigns carry the spine); v22: Garrison Resolve slice 4 (garrison_sortie raid type — a resolve-gated coordinated sally spawned onto the raid board by GARRISON_SORTIE_EVENTS; a raid.opportunities.thinsEnemy flag lets a sortie inflict real casualties like destroy_detachment); v21: Garrison Resolve slice 1 (garrison.resolve standing track — awarded by the `garrison` effect, read as a `requires` minResolve/maxResolve event gate; wall-slow + sally hang off it in later slices); v20: squad-only raiding (raid.squadAssignment ledger — raids launch whole squads, not loose troop counts); v19: removed enemy.stance (the boss-fight meter + bossFightDue now drive everything stance did; withdraw-win is a direct near-annihilation check); v18 was event chains (scheduledEvents queue — `schedule` effect drains into forced augury slots; `chained` events out of the random pool); v17 was event prerequisites (eventFlags state + `requires`-gated draws)

const campaignSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The magic-item STORE (slice 6, decisions 17 and 6-10): ITEM_CATALOG ids for
  // every item the campaign holds that is NOT currently on something. Every won
  // item lands here first — storage is the first step of item handling, not a
  // fallback for when nothing qualifies — and for reversible kinds it is where
  // an unassigned one returns to. Banners are the exception and never come back
  // (decision 10).
  //
  // ONE list, never a per-kind field: a `banners: []` would have to be joined
  // by `weapons: []` and `relics: []`, each with its own branch, which is the
  // placeable/spawnable mistake again. The item declares its own kind, target
  // and permanence; the store stays ignorant of what kinds exist.
  items: { type: [String], default: [] },
  schemaVersion: { type: Number, default: CAMPAIGN_SCHEMA_VERSION },
  // The build that created this campaign. Saves from any OTHER build are
  // deleted on listing, exactly like a schema mismatch — even a compatible
  // save isn't worth the risk while the game changes daily (user, 2026-07-05).
  buildVersion: { type: String, default: () => config.APP_VERSION },
  status: { type: String, enum: ['active', 'won', 'lost'], default: 'active' },
  // One `day` = one campaign turn = two weeks of campaigning (DAYS_PER_TURN).
  day: { type: Number, default: 1 },
  battleFoughtToday: { type: Boolean, default: false },

  // The turn's PHASE (docs/CAMPAIGN_PLAN.md "Effort slider", decision 12). The
  // turn is a one-way march: each phase is entered once, its decisions are
  // committed when you leave it, and every mutating route asserts the phase it
  // belongs to (routes/campaigns.js `rejectIfNotPhase`). Server-owned so the
  // rule survives a reload and can't be walked around by the client — this
  // generalises the recruit lock (`recruit.drawnDay`) that used to be the only
  // enforced door. Reset to 'prepare' at newDay. Passed phases stay VIEWABLE:
  // the client renders them read-only, the server just refuses their writes.
  phase: { type: String, enum: TURN_PHASES, default: 'prepare' },

  // The boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop"):
  // fills at end-of-day based on how many troops sat idle in camp (raiding/
  // foraging fills it faster), crossing BOSS_FIGHT_METER_THRESHOLD flips
  // `bossFightDue` — the decisive boss fight is due the NEXT day. Hidden by
  // default (campaignView exposes only a banded phrase at recon level 0, a
  // numeric bracket above that, exact at the top — see recon.brackets below).
  meter: {
    value: { type: Number, default: 0 },
  },
  bossFightDue: { type: Boolean, default: false },

  // Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison-support epic"): the
  // standing between your relief army and Karrowgate's besieged garrison, 0..100.
  // Cooperation events AWARD it (applyEffect `garrison`) and fates GATE on it
  // (events.js `requires` minResolve/maxResolve). It slows the wall meter
  // (wallSlowFactor), drives the pitched-battle sally support, and — S5 — a
  // resolve of 0 SURRENDERS the garrison (a second loss condition). campaignView
  // exposes it as one of three level words (garrisonLevel) for the HUD gauge;
  // the raw number stays server-side.
  garrison: {
    resolve: { type: Number, default: GARRISON_RESOLVE_START },
  },

  // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
  // Recruiting Fervor, a plain integer 1:1 with the percent chance (clamped
  // 0-100 at roll time only) that a day's hire offer is boosted. Uncapped in
  // both directions — deliberately NOT a banded meter like garrison.resolve,
  // so every event that moves it is individually visible to the player.
  recruit: {
    fervor: { type: Number, default: RECRUITING_FERVOR_START },
    // The day's offer (docs/CAMPAIGN_PLAN.md): up to 2 RECRUIT_POOL ids (plus
    // the Travellers pad) drawn by pickDailyOptions, looked up again at
    // hire/view time via findRecruitEntry — never the resolved cost/count.
    // `boosted` is the day's ONE Fervor roll (applies to whichever option is
    // picked); `hiredToday` marks the day's one-hire cadence as spent (only a
    // real hire can set it now — skipping is gone).
    //
    // `drawnDay` is the seal AND the phase gate: the offer is drawn lazily
    // when the player opens the Recruit phase (POST /:id/recruit/open), not at
    // creation or end-day, so this turn's raid gold is already in the stores
    // when the affordable pool is computed. Stamping it makes re-entering the
    // phase idempotent rather than a reroll, and it closes the camp for the
    // day — once it equals `day`, every other turn action is refused and the
    // hire is the only way forward. It self-resets as the day increments, so
    // end-day needs no bookkeeping for it.
    dailyOptions: { type: [String], default: [] },
    boosted: { type: Boolean, default: false },
    hiredToday: { type: Boolean, default: false },
    drawnDay: { type: Number, default: 0 },
  },

  // Recon (docs/CAMPAIGN_PLAN.md "Recon rework"): leftover scouting points that
  // weren't spent on the raid board accumulate here at end-of-turn (no decay).
  // `points` alone determines the scouting LEVEL (reconLevel/reconBand in
  // utils/capabilities.js) that drives the enemy reveal ladder, forage posture,
  // and recon-sensitive event rungs — the old passive troop-coverage band is
  // gone. `brackets` holds the graduated numeric estimates recon R2 gates: for
  // the enemy total count and the meter value, a stored ABSOLUTE offset pair
  // ({floorOffset ≤ 0, ceilOffset ≥ 0}) plus the recon level it was set at.
  // Displayed as [live truth + floorOffset, live truth + ceilOffset] (floor
  // clamped ≥ 0), so casualties slide the bracket without leaking width; re-set
  // (narrower) only on a level-up, never re-rolled per turn (services/recon.js).
  recon: {
    points: { type: Number, default: 0 },
    brackets: {
      enemyCount: {
        atLevel: { type: Number, default: 0 },
        floorOffset: { type: Number, default: 0 },
        ceilOffset: { type: Number, default: 0 },
      },
      meter: {
        atLevel: { type: Number, default: 0 },
        floorOffset: { type: Number, default: 0 },
        ceilOffset: { type: Number, default: 0 },
      },
    },
  },

  resources: {
    food: { type: Number, required: true },
    materials: { type: Number, required: true },
    // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
    // gold funds the caster lane (Mage/Priest) and horses funds Cavalry/
    // LightCavalry hires. Both start at 0 — a fresh campaign has no gold or
    // remounts on hand, only the raw materials/food/workers economy.
    gold: { type: Number, required: true },
    horses: { type: Number, required: true },
    // Construction slice C1 (docs/CAMPAIGN_PLAN.md C-6/C-7): the forge's
    // metal. Required like the pair above and for the same reason — the v43
    // bump is what guarantees every living campaign carries it.
    mithril: { type: Number, required: true },
  },
  // Unit-type name -> count. Names validated against the unittypes collection
  // at the routes that mutate it.
  roster: { type: Map, of: Number, required: true },

  // Persistent, player-facing squads (playtest item 1, docs/CAMPAIGN_PLAN.md).
  // A squad's `composition` is always a subset reflected inside the matching
  // `roster` counts, never a separate pool — "loose" (unassigned) count for a
  // type = roster[type] − Σ squads[*].composition[type] (foraging is passive
  // since S2 — see forage.share below — and no longer removes named units).
  // `id` is a small campaign-scoped int (not an ObjectId) since it flows
  // straight into the engine's placement JSON as squad_id. Seeded once at
  // campaign creation from STARTING_SQUADS; there is no squad create/split/
  // merge/rename UI yet, so no id-allocation counter is needed either.
  squads: {
    type: [
      new mongoose.Schema(
        {
          id:          { type: Number, required: true },
          name:        { type: String, required: true },
          composition: { type: Map, of: Number, required: true },
          // Squad prestige (docs/CAMPAIGN_PLAN.md "NEXT UP — THE SQUAD
          // OVERHAUL", decision 5): a PERMANENT rank that gates squad upgrades
          // and is NEVER SPENT — upgrades are paid for in resources. Earned
          // mainly from raids (utils/capabilities.js raidPrestige, scaled by
          // the target's strength band); events and turns survived are later
          // sources. It only climbs, and it SURVIVES A WIPE: a charter whose
          // troops all die stays on the rolls at composition {} carrying its
          // prestige, which is why the reconciliations keep it instead of
          // filtering it out. Own info — campaignView exposes it with its rank
          // word (squadRank). Nothing reads it for gating yet.
          prestige:    { type: Number, default: 0 },
          // Which SQUAD_ARCHETYPES row this charter is (docs/CAMPAIGN_PLAN.md
          // decisions 2-4): the id only — permitted types, per-type caps and
          // the intake rate are looked up from config, never copied here, so
          // a rebalance reaches campaigns already in flight. Seeded from
          // STARTING_SQUADS today; acquisition (decision 11) is what hands out
          // archetypes later, which is why this is a plain string and not an
          // enum — a new row must not need a schema change. Nothing READS it
          // yet: reinforcement (slice 3) is the first caller, and it is stored
          // now because a cap that arrives after the squads it governs would
          // have no way to know what they were meant to be.
          archetype:   { type: String },
          // The upgrades this charter has TAKEN (docs/CAMPAIGN_PLAN.md
          // "SLICE 4 — THE UPGRADE CATALOG"): SQUAD_UPGRADE_POOL ids, in the
          // order taken. PERMANENT — there is no swap at any price, which is
          // the whole cost of an upgrade that is otherwise free (the interview
          // considered charging resources and prestige and rejected both).
          // Ids only, never the resolved effect: a rebalance must reach
          // campaigns already in flight, exactly like `archetype`.
          //
          // What is NOT stored, deliberately: the slot COUNT and the BANNER.
          // Both are derived from prestige through the rank ladder
          // (services/squadUpgrades.js slotsFor/hasBanner), so a document
          // cannot drift out of step with a retuned ladder.
          upgrades: { type: [String], default: [] },
          // The ITEM banner bound to this charter (slice 6, decisions 6-10 and
          // 10): an ITEM_CATALOG id, or absent. HOLDER-SIDE on purpose — the
          // store (campaign.items) holds what is on nothing, and a bound item
          // lives on its holder, exactly as characters[].items does. So "in the
          // store" means precisely "attached to nothing", with no flag to keep
          // in step.
          //
          // Binding is ONE-WAY: a banner leaves the store and never returns
          // (decision 10). Later kinds are expected to move freely, which is
          // why permanence is declared per ITEM in the catalog rather than
          // assumed here.
          //
          // The TIER is still not stored — see the note on `upgrades` above.
          // services/items.js bannerTier() derives plain / basic / item from
          // the rank ladder plus this one field.
          banner: { type: String },
          // The draft currently in front of the player: up to
          // SQUAD_UPGRADE_DRAW ids, of which exactly one may be kept. Drawn at
          // newDay for any charter with a slot free, consumed by the pick, and
          // absent the rest of the time. `rank` stamps which rung paid for it,
          // so an offer cannot outlive the reason it was drawn.
          upgradeOffer: {
            type: new mongoose.Schema(
              {
                rank: { type: String, required: true },
                options: { type: [String], default: [] },
              },
              { _id: false },
            ),
          },
          // The MISSION this charter is away on (docs/CAMPAIGN_PLAN.md
          // "DECISION 12 — MISSIONS"), or absent when it is in camp.
          // `untilDay` is the day it comes BACK — on that day's newDay the
          // mission ends, the prestige is paid and the field clears, so the
          // charter is free the moment the player sees that turn.
          //
          // A SECOND notion of busy, deliberately (12-3). raid.squadAssignment
          // still holds "spent on a raid today" and is still wiped at newDay;
          // this one spans turns and lives on the charter. The user chose two
          // states over one because they read differently to a player — back
          // tonight is not the same promise as back on day 9 — which is why
          // availability asks two questions rather than one, and why the squad
          // screen has three states rather than two.
          //
          // `eventId` is kept for the report line and for a later chained
          // beat; nothing derives behaviour from it. The prestige and the
          // length are NOT stored: they come from the event's effect row, so a
          // retune reaches missions already under way, exactly like archetype
          // and upgrades above.
          mission: {
            type: new mongoose.Schema(
              {
                untilDay: { type: Number, required: true },
                eventId:  { type: String },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
    ],
    default: [],
  },

  // Abstract fortification level (0..FORTIFICATION_MAX_LEVEL). Spending
  // materials at the camp raises it; a higher level walls a wider span of the
  // player's front deployment edge (services/fortification.js →
  // fortifiedSidesFor), injected into the battle input. Own info, not hidden.
  fortificationLevel: { type: Number, default: 0 },

  // Civilian labour pool (off-map, not on the campaign map). Fortifications
  // and Recruit hires both draw on it, but differently: fort labour
  // permanently grows `used` (the worker is still around, just always busy); a
  // hire permanently shrinks `total` (the worker left to become a soldier).
  // available = total − used either way. No replenishment yet (later SSOT
  // run). Own info.
  workers: {
    total: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
  },

  // Persistent event bookkeeping (R1 prerequisites): named markers/counters an
  // event's outcome sets (applyEffect `flag`) and a later fate gates on
  // (events.js `requires`/eventEligible). HIDDEN server state — the chain's
  // story reaches the player only through event text, never these values; do
  // not surface them through campaignView.
  eventFlags: { type: Map, of: Number, default: {} },

  // Event chains (part 2): guaranteed follow-up fates an outcome scheduled
  // (applyEffect `schedule`). Each entry names the event and the campaign day
  // it is due; drawAugury drains every due entry into a FORCED augury slot
  // (the scheduled event as truth + a same-tier decoy) and removes it, so a
  // chained beat is guaranteed to reach the player when its turn comes.
  // `chained:true` (events.js) keeps these follow-ups OUT of the random pool
  // so they surface ONLY when scheduled. HIDDEN state like eventFlags — the
  // player learns of a coming beat only when it lands as a fate, never from
  // this queue; do not surface it through campaignView.
  scheduledEvents: {
    type: [
      new mongoose.Schema(
        {
          eventId: { type: String, required: true },
          day: { type: Number, required: true }, // campaign day it becomes due
        },
        { _id: false },
      ),
    ],
    default: [],
  },

  // The turn's fates: AUGURY_SLOTS independent true/false event pairs, each
  // with its own odds. Every slot's trueEvent applies at end-of-turn
  // regardless of the reading; the client sees the shown card + odds per
  // slot once consulted, never the pair or the outcome.
  augury: {
    slots: {
      type: [
        new mongoose.Schema(
          {
            trueEvent: { type: auguryEventSchema, required: true }, // HIDDEN
            falseEvent: { type: auguryEventSchema, required: true }, // HIDDEN
            // Chance the vision shows the truth: rolled at consult from the
            // open-ended reading (throwDice + base + mage/character +
            // trueEvent.baseAccuracy, × 5%, clamped). Null until consulted;
            // public from then on — exactly the number the vision was
            // rolled against.
            odds: { type: Number, default: null },
            // null until consulted; then whether the vision showed the truth — HIDDEN
            shownTrue: { type: Boolean, default: null },
            // A won counter_event raid unmade this fate: end-day skips its
            // effect and the reveal reports it averted. Own info once set —
            // the player earned it with a raid.
            countered: { type: Boolean, default: false },
            // Set ONLY on a DEFERRED slot (a still-unresolved counter_event
            // raid targets it at acceptance): the rung that will apply at
            // end-day unless countered first. Non-null ⇔ "still owes its
            // effect". Immediately-applied slots never use these two.
            firedRungName: { type: String, default: null },
            // The branch picked for a deferred choice-fate (applied at
            // end-day); immediate choice-fates apply on pick instead.
            chosenChoice: { type: String, default: null },
            // The CHARTER picked alongside it, when that branch was a mission
            // (decision 12). Carried because a deferred fate applies at end-day
            // and the pick would otherwise be lost between the two — a mission
            // that quietly sent nobody. Null on every other branch.
            chosenSquadId: { type: Number, default: null },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    consulted: { type: Boolean, default: false },
    // Fates sealed and revealed at the tent (POST /augury/accept): plain
    // effects applied immediately, deferred ones recorded per slot. Reset
    // naturally when drawAugury() replaces the augury at new day.
    accepted: { type: Boolean, default: false },
    rerollsRemaining: { type: Number, required: true },
  },

  // Decisions owed by the player (events with choices, resolve-then-choose):
  // a fired choice-fate's effect is NOT applied at end-day — the decision is
  // recorded here and every other mutating route 409s until it's made.
  // Deliberately minimal and self-contained: options/effects are looked up in
  // EVENT_POOL by eventId+rung at view/choose time (the sealed-fate rule, same
  // as rung ladders), and `slot` is only historical correlation — end-day's
  // step 7 redraws augury.slots before the player ever sees the reveal.
  pendingChoices: {
    type: [
      new mongoose.Schema(
        {
          slot: { type: Number, required: true },
          eventId: { type: String, required: true },
          rung: { type: String, required: true },
          day: { type: Number, required: true },
          // A deferred pending (its slot is counter-raid-targeted): the pick
          // is recorded on the slot and applies at end-day; non-deferred
          // picks apply immediately (the default path).
          deferred: { type: Boolean, default: false },
          // The charters this mission fate offered (12-1), SEALED at the moment
          // the decision was pended. Stored rather than recomputed for the same
          // reason the upgrade draft is: the offer is a random draw of two, so
          // a reload that redrew it would let a player reroll until they liked
          // the pair. `locked` is the near-miss shown but unpickable when only
          // one charter qualified — it names a real charter, so the player
          // learns WHY (it is away, or it was wiped).
          //
          // Absent on every non-mission fate, which is most of them.
          missionOffer: {
            type: new mongoose.Schema(
              {
                picks:  { type: [Number], default: [] },
                locked: { type: Number, default: null },
              },
              { _id: false },
            ),
          },
        },
        { _id: false },
      ),
    ],
    default: [],
  },

  forage: {
    rings: { type: [ringSchema], required: true },
    // The day's total field-points pool (fieldPointsFor over the roster),
    // SNAPSHOTTED at newDay from the start-of-turn roster (S2 decision 1) —
    // fixed for the whole turn even as raids spend down the roster during the
    // day. Feeds BOTH tracks: `share` of it converts to forage kg below, the
    // rest seeds raid.scoutingPoints.
    pool: { type: Number, default: 0 },
    // The player's split of today's pool between foraging (this fraction)
    // and scouting (the rest), 0..1 — STICKY across turns (never reset at
    // newDay, unlike the old per-unit assignment): the last choice carries
    // forward as-is until the slider moves again. Seals the moment Prepare is
    // left (routes' rejectIfPhasePassed) — POST /:id/effort is the only way
    // to change it.
    share: { type: Number, default: DEFAULT_FORAGE_SHARE },
    // The enemy's abstract per-turn drain on the shared rings (S2 decision 4)
    // — HIDDEN below the Outmatched recon band (campaignView gates it like
    // the enemy view). It earns no forage credit; it's clock pressure only,
    // and the seam a later "starve the enemy" system hangs off.
    enemyDrainKg: { type: Number, default: 0 },
    // Standing pressures on the two figures above (S3) — see
    // forageModifierSchema. Granted by the `forage_modifier` event effect,
    // lifted by winning a linked persistent raid or by running out of turns.
    modifiers: { type: [forageModifierSchema], default: [] },
  },

  // The day's raid opportunities — redealt every new turn (step 7): one base
  // target plus any counter-raids, which the player then grows/reveals by
  // spending scoutingPoints. See raidOpportunitySchema above.
  raid: {
    opportunities: { type: [raidOpportunitySchema], default: [] },
    // The per-turn scouting-points pool: the (1 − forage.share) slice of
    // forage.pool, set at newDay and whenever POST /:id/effort changes the
    // split — spent to scout new targets or reveal a target's reward/enemy
    // intel. Fractional (no rounding) and drawable at any point in the turn,
    // so a future event can grant or spend points without touching the turn
    // flow.
    scoutingPoints: { type: Number, default: 0 },
    // This turn's cumulative committed-to-a-raid party, unit-type -> count.
    // A unit sent on ANY raid this turn (win or lose) stays counted here for
    // the rest of the day even though it isn't removed from `roster`
    // (survivors rejoin immediately): otherwise the same living roster count
    // is free to join every raid opportunity the same day. Cleared at newDay.
    // Deliberately does NOT gate the day's main battle (open decision, raids
    // stay independent of it) or foraging (passive since S2 — see
    // forage.share above) — only further raids.
    assignment: { type: Map, of: Number, default: {} },
    // Squad-only raiding (2026-07-21): the ids of squads already sent on a raid
    // this turn — the squad twin of `assignment`. A squad goes whole, so this
    // ledger (not the per-type counts alone) is what stops a squad raiding
    // twice in one day. Cleared at newDay alongside `assignment`.
    squadAssignment: { type: [Number], default: [] },
  },

  enemy: {
    army: { type: Map, of: Number, required: true }, // HIDDEN
    initialStrength: { type: Number, required: true },
    // S4 "starve the enemy": the host's supply state is a PER-TURN VERDICT, not
    // a stockpile. The old `supplies` running total is GONE — it was seeded
    // once, drained by upkeep forever, never replenished, and had no consequence
    // at zero. What is stored now is only the answer to "did they feed
    // themselves THIS turn", recomputed at each end-day from income ÷
    // consumption, because that is all any consumer needs (user, 2026-08-09:
    // "we don't need to keep track of the running total just turn by turn").
    // Persisted rather than derived in the view so the phrase the scouts report
    // is the verdict of the turn that actually resolved.
    supplyState: {
      type: String,
      enum: ENEMY_SUPPLY_BANDS.map((b) => b.label),
      default: ENEMY_SUPPLY_BANDS[0].label,
    },
    // Exact placement the engine will receive today — HIDDEN until a
    // scouting reveal is purchased (later stage).
    plannedPlacement: { type: [mongoose.Schema.Types.Mixed], default: null },
    // Free-reveal window (Stage 4 1c, the anticipated Night Raid): while
    // day ≤ this, campaignView widens the enemy view to the full
    // Overwhelming tier regardless of the scouting band. Additive with a
    // default, so no schema-version bump — older docs read as 0 (no reveal).
    revealedUntilDay: { type: Number, default: 0 },
    // The champion riding with the shadowing host (user, 2026-08-24: bearers on
    // "raids + boss host, any battle we dont need a special rule"). Sealed at
    // creation and carried for the campaign, because the host is ONE host — a
    // per-battle roll would reroll on a reload, and the decisive battle is
    // fought once. Revealed by the same recon ladder as everything else the
    // scouts learn about them.
    bearer: { type: enemyBearerSchema, default: null },
    // What the host knows (S2-9) — see enemyMagicSchema above. Sealed at
    // creation and carried for the campaign, like the bearer beside it.
    magic: { type: enemyMagicSchema, default: () => ({}) },
  },

  // The four schools of magic (docs/CAMPAIGN_PLAN.md "▶ SLICE 2 — THE
  // CAMPAIGN LAYER"). ALL FOUR START AT 0 (S2-2), so on day 1 the three
  // starting Mages can cast nothing at all while the three Priests bless from
  // the first battle — Holy carries no school gate (M-14). That dead first
  // turn is deliberate: research is immediately the most valuable thing on the
  // board and the first unlock is an event the player feels. If it reads badly
  // the lever is RESEARCH_LEVEL_COST, not this.
  //
  // OWN INFO, not hidden — campaignView projects the whole block. What the
  // army knows about magic is the army's to know.
  research: {
    // Where this turn's study lands (S2-12). A camp decision: `prepare` only,
    // and freely re-settable, because nothing is spent by changing it. It is
    // gated to that phase rather than open in every one so that study cannot be
    // re-aimed after seeing the omens and the raid board — information the
    // choice is not supposed to get.
    focus: { type: String, enum: SPELL_SCHOOLS, default: RESEARCH_DEFAULT_FOCUS },
    // Mages lent by a fate (S2-11), each studying like one of your own. PERMANENT
    // — this only goes up, barring an event that takes one away, which is how
    // forage.modifiers already reads. A per-ally expiry was considered and
    // rejected: this is meant to be the quiet background source.
    allies: { type: Number, default: 0 },
    schools: { type: researchSchoolsSchema, default: () => ({}) },
  },

  // Characters (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS"). This REPLACES
  // the singular `character` Mixed placeholder the augury bonus used to read.
  //
  // A character is a special kind of TROOP (5-0) that happens to have a name:
  // it eats, fills the boss-fight meter and costs raid capacity like any body,
  // and the exceptions are the few written into the slice — it sits outside a
  // squad's per-type caps, its identity survives its death, and it can be told
  // to hang back. The base unit type is NEVER modified (5-2): everything a
  // character gains rides the modifier layer below.
  characters: {
    type: [
      new mongoose.Schema(
        {
          // Small campaign-scoped int, like a squad's — it flows into the
          // engine's placement JSON as character_id. Allocated as max+1 and
          // NEVER reused, which dead characters staying on the rolls makes
          // both possible and necessary.
          id:      { type: Number, required: true },
          name:    { type: String, required: true },
          // A catalog unit type (CHARACTER_TYPES). The character IS one of
          // these bodies on the field — that is why survival needs no
          // machinery of its own.
          type:    { type: String, required: true },
          // The squad this character rides with, or null in camp. Free to
          // change at any time, in any phase (5-7). Attached means the
          // character goes wherever the squad goes, raids included (5-8).
          squadId: { type: Number, default: null },
          // "Hang back unless we run out of troops" (5-8). Every character
          // carries the toggle whatever their type; only the DEFAULT is
          // type-derived (ranged/casters on, melee off — see
          // services/characters.js hangsBackByDefault).
          hangBack: { type: Boolean, default: true },

          // Death is permanent, but the record and its data are KEPT (5-9) so
          // a later recovery — a spell, mummification — has something to work
          // from. Nothing in this slice may prune a dead character or strip
          // their gear; live readers filter on `alive` instead.
          alive:   { type: Boolean, default: true },
          diedDay: { type: Number, default: null },

          // ── The modifier layer (5-2/5-3) ───────────────────────────────
          // SOURCES are stored; the stat bag is DERIVED from them by
          // services/characters.js characterMods(), which returns {} while
          // these are empty. Storing the derived bag instead would leave every
          // save wrong the first time an item's numbers are retuned — the same
          // reason squad upgrades store taken ids and derive their slots.
          //
          // Nothing fills these yet. They exist now because planning for them
          // is cheaper than refactoring into them later (the user's call), and
          // an empty field costs a save nothing.
          //
          // items: a SPARSE list of {slot, index, itemId} — only what is
          // actually worn. Slot layouts belong to the creature and live in the
          // engine catalog (5-6), so a hydra's several heads or a four-armed
          // monster's four hands need no document surgery here.
          items:      { type: [mongoose.Schema.Types.Mixed], default: () => [] },
          experience: { type: Number, default: 0 },
          wounds:     { type: [mongoose.Schema.Types.Mixed], default: () => [] },

          // The paths this caster commands (docs/CAMPAIGN_PLAN.md "▶ SLICE 2",
          // S2-3/S2-4): engine path name → level, e.g. {fire: 2, water: 1}.
          //
          // ROLLED ONCE, AT HIRE, and fixed from then on — services/magic.js
          // rollPaths, called from mintCharacter so the roll happens at the one
          // place characters are already minted (S2-5). A Mage draws a primary
          // at 2 from the eight non-Holy paths plus one 25% check; a Priest is
          // flat Holy 2, because priesthood is formal and not skill. That
          // asymmetry IS the difference between the two hire lanes.
          //
          // Sparse: only what they actually have. The zeros the engine needs
          // are added on the way out (services/magic.js enginePaths), never
          // stored — the document says what a caster IS, and the wire says
          // what the engine must not assume.
          //
          // NOT modified by items or experience, unlike the stat bag above.
          // Moving a path is what a rare event or a relic is for (M-5), and
          // when one lands it will move THIS number, because a character's
          // paths are who they are rather than what they are carrying.
          paths:      { type: Map, of: Number, default: () => new Map() },

          // The CHOSEN SPELLS this caster reaches for first (slice 4, S4-1):
          // an ORDERED list of engine spell ids, e.g. ['fireball', 'bless'],
          // capped at MAX_CHOSEN_SPELLS.
          //
          // A PREFERENCE, never a repertoire. The engine puts these at the head
          // of the caster's walk and keeps the rest of the roster behind them,
          // so an empty list — which is what every fresh hire carries — is
          // exactly the behaviour of every battle fought before this slice.
          //
          // Ids, not forms (S4-2): the engine still takes the strongest form
          // the caster qualifies for within a spell. Compacted, never sparse:
          // clearing the first choice promotes the second, so there are no
          // holes and position IS priority.
          //
          // Nothing prunes this list, and nothing needs to. Paths are fixed at
          // hire (M-5) and school levels only ever rise (S2-7), so a line that
          // was castable when it was chosen stays castable for good.
          script:     { type: [String], default: () => [] },

          // The day this character last forged (Construction slice C1, C-6):
          // the once-per-turn stamp, the same shape as recruit.drawnDay. Null
          // means never. Compared against campaign.day, so it expires by the
          // day moving on and nothing ever clears it. Only Mages forge, but
          // the field lives on every character because the schema does not
          // branch on type — a non-Mage simply never gets stamped.
          forgedDay:  { type: Number, default: null },
        },
        { _id: false },
      ),
    ],
    default: () => [],
  },

  battles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Battle' }],
  log: {
    type: [
      new mongoose.Schema(
        { day: Number, entries: [String] },
        { _id: false },
      ),
    ],
    default: [],
  },
})

export default mongoose.model('Campaign', campaignSchema)
