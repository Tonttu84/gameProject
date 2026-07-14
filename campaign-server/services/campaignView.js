import { getCatalog } from '../utils/catalog.js'
import {
  armyFoodPerTurn,
  forageValue,
  scoutingCoverage,
  scoutingBand,
  SCOUTING_BANDS,
} from '../utils/capabilities.js'
import {
  FORAGE_KG_PER_POINT,
  AUGURY_DEBUG_SHOW_TRUTH,
  MAP_NAME,
  ENEMY_STRENGTH_BANDS,
  ENEMY_SUPPLY_BANDS,
} from '../utils/campaignConfig.js'
import { armyTotal } from './enemyAi.js'
import { effectiveForageCapacityKg, forageYieldMultiplier } from './forage.js'
import { fortifyCost, fortifyWorkerCost, atFortCap, fortifiedSidesFor } from './fortification.js'
import { eventValence } from './events.js'

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

// The graduated enemy reveal (Stage 4 1b): the scouting band decides how much
// of the hidden enemy the serializer lets through, keys ACCUMULATING with
// rank — Blind: stance only; Outmatched/Contested: + bucketed strength phrase
// and supply state; Superior: + composition by category %; Overwhelming:
// + exact counts and the REAL planned placement (aggregated per hex for the
// placement grid). Everything stays a phrase or a band until the top rung —
// tests/campaigns.test.js pins the exact key set per band.
const enemyView = (enemy, band, catalog, revealed = false) => {
  const view = { stance: enemy.stance, battleOffer: enemy.stance === 'offering_battle' }
  // A free reveal (Stage 4 1c, the anticipated Night Raid's prisoners) opens
  // the full Overwhelming tier for the turn regardless of the band; the
  // `revealed` flag tells the client (and the hidden-info tests) why.
  if (revealed) {
    band = 'Overwhelming'
    view.revealed = true
  }
  const rank = SCOUTING_BANDS.indexOf(band)
  if (rank >= SCOUTING_BANDS.indexOf('Outmatched')) {
    view.strength = bandLabel(armyTotal(enemy.army), ENEMY_STRENGTH_BANDS)
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
  // No leak: the shown card's nature is already fully visible.
  valence: eventValence(effect),
  effect, // what WOULD happen if the vision is true — not a leak
})

export async function campaignView(campaign) {
  const catalog = await getCatalog()
  const band = scoutingBand(
    scoutingCoverage(campaign.roster, catalog),
    scoutingCoverage(campaign.enemy.army, catalog),
  )
  return {
    id: campaign.id,
    day: campaign.day,
    status: campaign.status,
    battleFoughtToday: campaign.battleFoughtToday,
    resources: {
      food: campaign.resources.food,
      materials: campaign.resources.materials,
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
    // militia both spend it; the client gates their buttons on `available`.
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
    // Raid opportunities (Stage 4 Part 2): the hidden targetForce is stripped
    // to its strength band, and the reward stays server-side (a counter_event
    // reward's slot index would out which vision was true — the card's text
    // carries the promise instead). A resolved opportunity shows its outcome;
    // the battle replay is the reveal of what the party actually met.
    raid: {
      opportunities: campaign.raid.opportunities.map(
        ({ id, type, title, description, strengthBand, capacity, resolved, outcome }) => ({
          id,
          type,
          title,
          description,
          strengthBand,
          capacity,
          resolved,
          outcome: resolved ? outcome : null,
        }),
      ),
    },
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
      catalog,
      (campaign.enemy.revealedUntilDay ?? 0) >= campaign.day,
    ),
    battles: campaign.battles.map(String),
    log: campaign.log.slice(-10),
  }
}
