import { getCatalog } from '../utils/catalog.js'
import {
  armyFoodPerTurn,
  forageValue,
  reconBand,
  reconLevel,
  SCOUTING_BANDS,
} from '../utils/capabilities.js'
import {
  FORAGE_KG_PER_POINT,
  AUGURY_DEBUG_SHOW_TRUTH,
  MAP_NAME,
  ENEMY_SUPPLY_BANDS,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
} from '../utils/campaignConfig.js'
import { armyTotal } from './enemyAi.js'
import { meterBand } from './meter.js'
import { garrisonLevel } from './garrison.js'
import { displayBracket } from './recon.js'
import { effectiveForageCapacityKg, forageYieldMultiplier } from './forage.js'
import { fortifyCost, fortifyWorkerCost, atFortCap, fortifiedSidesFor } from './fortification.js'
import { eventValenceFor, choiceRung } from './events.js'
import { RECRUIT_POOL, resolveHire } from './recruit.js'

// THE single serializer between campaign documents and the client. Hidden
// information — enemy.army, enemy.plannedPlacement, the augury's true/decoy
// events and prediction internals (total/threshold/accurate — the raw dice
// roll alone can't reconstruct accuracy without the hidden bonuses),
// forage.enemyPlan — exists only server-side; every route responds with
// campaignView(campaign), never a raw document. tests/campaigns.test.js
// asserts the discipline.
//
// Async because it derives display values (food need, forage capacity) from
// the cached unit catalog — the client never re-implements campaign math.

// The fates as the player sees them: after consulting, one shown card per
// slot WITH that slot's odds (the number the vision was rolled against — the
// reroll minigame needs it). NEVER the true/false pair, shownTrue, or an
// event's hidden legibility (baseAccuracy) — those stay hidden until the
// end-of-turn reveal.
const auguryView = (augury) => {
  // Each vision card gains its slot's TRUE card once the turn's reroll is
  // spent — the payoff beat of the reroll minigame (user, 2026-07-05). While
  // AUGURY_DEBUG_SHOW_TRUTH is on (playtesting) the truth shows immediately
  // on consult instead.
  const truthRevealed = AUGURY_DEBUG_SHOW_TRUTH || augury.rerollsRemaining <= 0
  return {
    consulted: augury.consulted,
    // Fates sealed at the tent (own info): tells the client whether the
    // accept beat still awaits or the player can march.
    accepted: augury.accepted === true,
    rerollsRemaining: augury.rerollsRemaining,
    visions: augury.consulted
      ? augury.slots.map((slot) => ({
          ...visionCard(slot.shownTrue ? slot.trueEvent : slot.falseEvent),
          odds: slot.odds,
          truth: truthRevealed ? visionCard(slot.trueEvent) : null,
        }))
      : null,
  }
}

// Descending {min, label} table → the first phrase the value qualifies for.
const bandLabel = (value, bands) => bands.find(({ min }) => value >= min).label

// A raid target's reward as the player may see it (mini-game reveal, Stage 4
// Part 2.5): a range until the reward field is bought (rewardReveal >= 1), then
// the exact numbers — but ONLY the numeric keys the range already bracketed
// (food/materials/roster). A counter_event's reward is {slot}, which has no
// range (rewardRange is null) and would out which fate is bad, so it stays
// null on BOTH channels — the exact side is keyed off rewardRange, never the
// raw reward, so `slot` can't leak even once revealed.
const rewardView = (opp) => {
  const range = opp.rewardRange
  if (!range) return null
  if (opp.rewardReveal < 1) return range
  const exact = {}
  if (range.food) exact.food = opp.reward.food
  if (range.materials) exact.materials = opp.reward.materials
  if (range.roster) {
    exact.roster = {}
    for (const type of Object.keys(range.roster)) exact.roster[type] = opp.reward.roster[type]
  }
  return exact
}

// The graduated enemy reveal (Stage 4 1b): the scouting band decides how much
// of the hidden enemy the serializer lets through, keys ACCUMULATING with
// rank — Blind: nothing (the host is unseen); Outmatched/Contested: + bucketed
// strength phrase and supply state; Superior: + composition by category %;
// Overwhelming: + exact counts and the REAL planned placement (aggregated per
// hex for the placement grid). Everything stays a phrase or a band until the
// top rung — tests/campaigns.test.js pins the exact key set per band. (Whether
// the enemy offers battle is the top-level campaign.bossFightDue flag now, not
// an enemy-view key — the retired stance concept.)
const enemyView = (enemy, band, level, countBracket, catalog, revealed = false) => {
  const view = {}
  // A free reveal (Stage 4 1c, the anticipated Night Raid's prisoners) opens
  // the full Overwhelming tier for the turn regardless of the band; the
  // `revealed` flag tells the client (and the hidden-info tests) why.
  if (revealed) {
    band = 'Overwhelming'
    view.revealed = true
  }
  const rank = SCOUTING_BANDS.indexOf(band)
  if (rank >= SCOUTING_BANDS.indexOf('Outmatched')) {
    // Numeric estimate of the total host (recon R2) — replaces the old banded
    // strength phrase. Stored offsets against the LIVE count (so casualties slide
    // it without leaking width); a free reveal (prisoners) shows it exact.
    const total = armyTotal(enemy.army)
    view.count = revealed ? { low: total, high: total } : displayBracket(countBracket, total, level)
    view.supplies = bandLabel(
      enemy.supplies / Math.max(1, armyFoodPerTurn(enemy.army, catalog)),
      ENEMY_SUPPLY_BANDS,
    )
  }
  if (rank >= SCOUTING_BANDS.indexOf('Superior')) {
    // Category shares by headcount, rounded — "mostly foot, a little horse".
    const counts = {}
    let total = 0
    for (const [type, count] of enemy.army) {
      if (count <= 0) continue
      const category = catalog.get(type)?.category ?? 'Unknown'
      counts[category] = (counts[category] ?? 0) + count
      total += count
    }
    view.composition = Object.fromEntries(
      Object.entries(counts).map(([category, n]) => [category, Math.round((100 * n) / total)]),
    )
  }
  if (rank >= SCOUTING_BANDS.indexOf('Overwhelming')) {
    view.units = Object.fromEntries(enemy.army)
    const perHex = new Map()
    for (const { unit_type, q, r } of enemy.plannedPlacement ?? []) {
      const key = `${unit_type}|${q}|${r}`
      perHex.set(key, (perHex.get(key) ?? 0) + 1)
    }
    view.placements = [...perHex.entries()].map(([key, count]) => {
      const [type, q, r] = key.split('|')
      return { type, q: Number(q), r: Number(r), count }
    })
  }
  return view
}

const visionCard = ({ id, title, description, severity, effect }) => ({
  id,
  title,
  description,
  severity,
  // The shown card's mood (good/bad/neutral), derived from its own effect so
  // the augur's header labels the flavour on display — never the hidden truth.
  // No leak: the shown card's nature is already fully visible. A choice event
  // has no single effect, so its declared valence (pool lookup) is used.
  valence: eventValenceFor({ id, effect }),
  effect, // what WOULD happen if the vision is true — not a leak
})

export async function campaignView(campaign) {
  const catalog = await getCatalog()
  const points = campaign.recon?.points ?? 0
  const band = reconBand(points)
  const level = reconLevel(points)
  return {
    id: campaign.id,
    day: campaign.day,
    status: campaign.status,
    battleFoughtToday: campaign.battleFoughtToday,
    // The boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop"):
    // hidden by default. At recon level 0 only the banded phrase crosses the
    // wire; recon R2 adds a numeric `estimate` [low, high] above that (null at
    // level 0), narrowing with the recon level and exact ({v, v}) at the top —
    // same discipline as the enemy `count` below. `bossFightDue` itself is own
    // info — it's what unlocks the decisive battle, not a secret.
    meter: {
      band: meterBand(campaign.meter.value),
      estimate: displayBracket(campaign.recon?.brackets?.meter, campaign.meter.value, level),
    },
    bossFightDue: campaign.bossFightDue,
    // Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison-support epic"): shown as
    // one of three LEVEL words (low/normal/determined) — the HUD renders a gauge
    // from it. The raw resolve number stays server-side (it's what the
    // wall-slow/sally/surrender read); the level is the player's read. Defaults
    // to the starting level for a campaign that predates the field.
    garrison: { level: garrisonLevel(campaign.garrison?.resolve) },
    resources: {
      food: campaign.resources.food,
      materials: campaign.resources.materials,
      // Recruit phase (docs/CAMPAIGN_PLAN.md): gold funds caster hires,
      // horses fund Cavalry/LightCavalry hires. Own info, not hidden.
      gold: campaign.resources.gold,
      horses: campaign.resources.horses,
      // What the current roster will eat at the coming end-of-turn.
      foodNeedPerTurn: armyFoodPerTurn(campaign.roster, catalog),
    },
    roster: Object.fromEntries(campaign.roster),
    // Persistent, player-facing squads (own info, not hidden — same tier as
    // fortificationLevel). A squad's composition is always a subset already
    // reflected inside `roster` above; the client derives the loose
    // (unassigned) remainder the same way it already derives forage
    // availability — roster minus what's committed elsewhere.
    squads: campaign.squads.map(({ id, name, composition }) => ({
      id,
      name,
      composition: Object.fromEntries(composition),
    })),
    // Civilian labour pool (own info): available = total − used. Forts and
    // Recruit hires both spend it; the client gates their buttons on
    // `available`.
    workers: {
      total: campaign.workers.total,
      used: campaign.workers.used,
      available: campaign.workers.total - campaign.workers.used,
    },
    // Own info (not hidden): the fort level, what the next level costs in
    // materials AND workers (both null at cap), and the actual walled sides so
    // the placement grid can draw the wall the player deploys behind.
    // fortifiedSides reuses the same source the battle input does, so screen
    // and battle can't drift.
    fortification: {
      level: campaign.fortificationLevel,
      atCap: atFortCap(campaign.fortificationLevel),
      nextCost: atFortCap(campaign.fortificationLevel)
        ? null
        : fortifyCost(campaign.fortificationLevel),
      nextWorkerCost: atFortCap(campaign.fortificationLevel)
        ? null
        : fortifyWorkerCost(campaign.fortificationLevel),
      sides: fortifiedSidesFor(MAP_NAME, campaign.fortificationLevel),
    },
    forage: {
      rings: campaign.forage.rings.map(({ ring, richness, initialRichness }) => ({
        ring,
        richness,
        initialRichness,
      })),
      assignment: Object.fromEntries(campaign.forage.assignment),
      capacityKg: effectiveForageCapacityKg(campaign.forage.assignment, catalog, band),
      // kg one unit of each roster type gathers per turn, so the client can
      // preview capacity while the player drags steppers — values come from
      // the server, the formula stays here. Both carry the scouting band's
      // forage-posture multiplier (Stage 4 1d), the SAME one end-day applies:
      // the preview the player plans against is what the resolution delivers.
      kgPerUnit: Object.fromEntries(
        [...campaign.roster.keys()].map((type) => [
          type,
          Math.round(
            (catalog.get(type) ? forageValue(catalog.get(type).stats) : 0) *
              FORAGE_KG_PER_POINT *
              forageYieldMultiplier(band),
          ),
        ]),
      ),
    },
    // Raid opportunities (Stage 4 Part 2 + the 2.5 scouting mini-game): the
    // hidden targetForce and reward stay server-side; the player sees per-type
    // enemy RANGES and (where the reward has numbers) a reward range, each of
    // which spending scouting points pins to the exact value (enemyReveal /
    // rewardReveal >= 1). strengthBand stays a coarse always-on summary. A
    // resolved opportunity shows its outcome; the battle replay is the reveal
    // of what the party actually met.
    raid: {
      opportunities: campaign.raid.opportunities.map((opp) => ({
        id: opp.id,
        type: opp.type,
        title: opp.title,
        description: opp.description,
        strengthBand: opp.strengthBand,
        capacity: opp.capacity,
        source: opp.source,
        // Range pre-reveal, exact once bought — per unit TYPE, never one
        // headcount (a fantasy roster reads "3 Giants + 20 spearmen").
        enemy: opp.enemyReveal >= 1 ? Object.fromEntries(opp.targetForce) : opp.enemyRange,
        enemyReveal: opp.enemyReveal,
        reward: rewardView(opp),
        rewardReveal: opp.rewardReveal,
        resolved: opp.resolved,
        outcome: opp.resolved ? opp.outcome : null,
      })),
      // Troops already committed to a raid today (own resources — no hidden
      // info here), so the party-builder can share one pool across every
      // still-open opportunity. See the schema comment on raid.assignment.
      assignment: Object.fromEntries(campaign.raid.assignment),
      // Squads already sent on a raid this turn (own info) — the squad-picker
      // greys these out. See the schema comment on raid.squadAssignment.
      squadAssignment: [...campaign.raid.squadAssignment],
      // The per-turn scouting-points pool + what each action costs, so the
      // client can render the mini-game and clamp its buttons.
      scoutingPoints: campaign.raid.scoutingPoints,
      scoutCost: { addTarget: RAID_SCOUT_COST_ADD, reveal: RAID_SCOUT_COST_REVEAL },
    },
    // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops",
    // S2): today's up-to-2-option offer, drawn at creation/end-day. Options are
    // looked up fresh from RECRUIT_POOL by id (the sealed-pool-lookup
    // convention pendingChoices below already uses — an id that's left the
    // pool mid-campaign is dropped, degrade-safely) and resolved through
    // resolveHire against the LIVE resources/workers so count/cost reflect
    // exactly what hiring would do right now, including the day's boosted
    // roll — never the stale numbers from when the offer was drawn.
    recruit: {
      fervor: campaign.recruit.fervor,
      boosted: campaign.recruit.boosted,
      hiredToday: campaign.recruit.hiredToday,
      options: (campaign.recruit.dailyOptions ?? []).flatMap((id) => {
        const entry = RECRUIT_POOL.find((e) => e.id === id)
        if (!entry) return []
        const resolved = resolveHire(entry, campaign.recruit.boosted, {
          resources: campaign.resources,
          workersFree: campaign.workers.total - campaign.workers.used,
        })
        return [{ id: entry.id, unit: entry.unit, lane: entry.lane, ...resolved }]
      }),
    },
    // Decisions owed (events with choices): display fields + option CARDS
    // only — branch effects, the pool id, and the fired rung stay server-side
    // (looked up again at choose time). An entry whose event has left the
    // pool is dropped, the same degrade-safely convention as elsewhere.
    pendingChoices: (campaign.pendingChoices ?? []).flatMap(({ slot, eventId, rung }) => {
      const def = choiceRung(eventId, rung)
      if (!def) return []
      return [{
        slot,
        title: def.title,
        description: def.description,
        options: def.choices.map(({ id, label, description }) => ({ id, label, description })),
      }]
    }),
    // Scouting: derived at view time (like foodNeedPerTurn), no schema field.
    // ONLY the banded label crosses the hidden-info boundary — the raw
    // coverage/ratio would let the client solve for the enemy composition.
    scouting: { band },
    augury: auguryView(campaign.augury),
    // What the band licenses the player to know about the enemy — see
    // enemyView above. A live free-reveal window (prisoners taken) trumps
    // the band for the turn; scouting.band above still reports the real
    // contest.
    enemy: enemyView(
      campaign.enemy,
      band,
      level,
      campaign.recon?.brackets?.enemyCount,
      catalog,
      (campaign.enemy.revealedUntilDay ?? 0) >= campaign.day,
    ),
    battles: campaign.battles.map(String),
    log: campaign.log.slice(-10),
  }
}
