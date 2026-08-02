import mongoose from 'mongoose'
import config from '../utils/config.js'
import { GARRISON_RESOLVE_START, RECRUITING_FERVOR_START } from '../utils/campaignConfig.js'

// One roguelite campaign run per document. HIDDEN INFORMATION lives here in
// plain fields — enemy.army, enemy.plannedPlacement, augury.trueEvent/
// decoyEvent/prediction internals, forage.enemyPlan — and must NEVER reach a
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
const raidOpportunitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['destroy_detachment', 'loot_supplies', 'rescue_troops', 'counter_event', 'garrison_sortie'],
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
      enum: ['base', 'scouted', 'counter_event', 'garrison_sortie'],
      default: 'base',
    },
    // Garrison sortie (slice 4): a WON sortie of this kind inflicts its real
    // battle casualties on the hidden host, win or lose — like destroy_detachment
    // but per-opportunity (a sortie version may thin the besiegers OR pay other
    // loot instead). A control flag, never exposed by campaignView.
    thinsEnemy: { type: Boolean, default: false },
    resolved: { type: Boolean, default: false },
    outcome: { type: mongoose.Schema.Types.Mixed, default: null }, // {winner, battleId} once resolved
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

// Bump this whenever the campaign document shape changes incompatibly (new
// required fields, changed semantics). There is NO backwards compatibility:
// a roguelite run is disposable, so any stored campaign whose version differs
// — including pre-versioning docs that lack the field — is deleted on the
// next listing instead of being served to campaignView, where missing fields
// render as nonsense (the "food stuck at 100 kg, Land 0%" playtest bug).
export const CAMPAIGN_SCHEMA_VERSION = 24 // v24: Recruit phase S1 (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops") — new required resources.gold/resources.horses + recruit.fervor; the bump ensures fresh campaigns carry them (pre-existing docs would otherwise fail the resources required-field validation); v23: garrison-support S8 (scripted siege spine — three GUARANTEED chained choice beats seeded onto scheduledEvents at creation, turns 2/5/8: siege_lines_close / breach_threatens / wardens_van, forced into their day's augury by the schedule drain; the bump ensures fresh campaigns carry the spine); v22: Garrison Resolve slice 4 (garrison_sortie raid type — a resolve-gated coordinated sally spawned onto the raid board by GARRISON_SORTIE_EVENTS; a raid.opportunities.thinsEnemy flag lets a sortie inflict real casualties like destroy_detachment); v21: Garrison Resolve slice 1 (garrison.resolve standing track — awarded by the `garrison` effect, read as a `requires` minResolve/maxResolve event gate; wall-slow + sally hang off it in later slices); v20: squad-only raiding (raid.squadAssignment ledger — raids launch whole squads, not loose troop counts); v19: removed enemy.stance (the boss-fight meter + bossFightDue now drive everything stance did; withdraw-win is a direct near-annihilation check); v18 was event chains (scheduledEvents queue — `schedule` effect drains into forced augury slots; `chained` events out of the random pool); v17 was event prerequisites (eventFlags state + `requires`-gated draws)

const campaignSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  schemaVersion: { type: Number, default: CAMPAIGN_SCHEMA_VERSION },
  // The build that created this campaign. Saves from any OTHER build are
  // deleted on listing, exactly like a schema mismatch — even a compatible
  // save isn't worth the risk while the game changes daily (user, 2026-07-05).
  buildVersion: { type: String, default: () => config.APP_VERSION },
  status: { type: String, enum: ['active', 'won', 'lost'], default: 'active' },
  // One `day` = one campaign turn = two weeks of campaigning (DAYS_PER_TURN).
  day: { type: Number, default: 1 },
  battleFoughtToday: { type: Boolean, default: false },

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
  },
  // Unit-type name -> count. Names validated against the unittypes collection
  // at the routes that mutate it.
  roster: { type: Map, of: Number, required: true },

  // Persistent, player-facing squads (playtest item 1, docs/CAMPAIGN_PLAN.md).
  // A squad's `composition` is always a subset reflected inside the matching
  // `roster` counts, never a separate pool — "loose" (unassigned) count for a
  // type = roster[type] − Σ squads[*].composition[type] − forage.assignment[type].
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
  // Militia bought this turn — caps the per-turn militia purchase; reset at
  // newDay.
  militiaBoughtToday: { type: Number, default: 0 },

  // Civilian labour pool (off-map, not on the campaign map). Fortifications
  // and militia both draw on it, but differently: fort labour permanently
  // grows `used` (the worker is still around, just always busy); militia
  // permanently shrinks `total` (the worker left to become a roster soldier).
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
        },
        { _id: false },
      ),
    ],
    default: [],
  },

  forage: {
    rings: { type: [ringSchema], required: true },
    // This turn's player forager assignment, unit-type → count. Assigned
    // units are unavailable for the turn's battle; cleared at newDay.
    assignment: { type: Map, of: Number, default: {} },
    // Forage capacity (in kg) the enemy commits this turn — HIDDEN (knowing
    // the enemy's forage effort is scouting intel, not free information).
    enemyPlan: { type: Number, default: 0 },
  },

  // The day's raid opportunities — redealt every new turn (step 7): one base
  // target plus any counter-raids, which the player then grows/reveals by
  // spending scoutingPoints. See raidOpportunitySchema above.
  raid: {
    opportunities: { type: [raidOpportunitySchema], default: [] },
    // The per-turn scouting-points pool, DERIVED from the army's recon
    // capability (scoutingPointsFor) and reset at the start of every turn —
    // spent to scout new targets or reveal a target's reward/enemy intel.
    // Fractional (no rounding) and drawable at any point in the turn, so a
    // future event can grant or spend points without touching the turn flow.
    scoutingPoints: { type: Number, default: 0 },
    // This turn's cumulative committed-to-a-raid party, unit-type -> count —
    // the raid twin of forage.assignment. A unit sent on ANY raid this turn
    // (win or lose) stays counted here for the rest of the day even though it
    // isn't removed from `roster` (survivors rejoin immediately): otherwise
    // the same living roster count is free to join every raid opportunity the
    // same day. Cleared at newDay alongside forage.assignment. Deliberately
    // does NOT gate the day's main battle (open decision, raids stay
    // independent of it) or foraging — only further raids.
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
    supplies: { type: Number, required: true },
    // Exact placement the engine will receive today — HIDDEN until a
    // scouting reveal is purchased (later stage).
    plannedPlacement: { type: [mongoose.Schema.Types.Mixed], default: null },
    // Free-reveal window (Stage 4 1c, the anticipated Night Raid): while
    // day ≤ this, campaignView widens the enemy view to the full
    // Overwhelming tier regardless of the scouting band. Additive with a
    // default, so no schema-version bump — older docs read as 0 (no reveal).
    revealedUntilDay: { type: Number, default: 0 },
  },

  // Placeholder for the character system: augury reads
  // character?.auguryBonus ?? 0. TODO flesh out when characters land.
  character: { type: mongoose.Schema.Types.Mixed, default: null },

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
