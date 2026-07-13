import { getCatalog } from '../utils/catalog.js'
import { armyFoodPerTurn, forageValue } from '../utils/capabilities.js'
import { FORAGE_KG_PER_POINT, AUGURY_DEBUG_SHOW_TRUTH, MAP_NAME } from '../utils/campaignConfig.js'
import { forageCapacityKg } from './forage.js'
import { fortifyCost, fortifyWorkerCost, atFortCap, fortifiedSidesFor } from './fortification.js'

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

const visionCard = ({ id, title, description, severity, effect }) => ({
  id,
  title,
  description,
  severity,
  effect, // what WOULD happen if the vision is true — not a leak
})

export async function campaignView(campaign) {
  const catalog = await getCatalog()
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
      capacityKg: forageCapacityKg(campaign.forage.assignment, catalog),
      // kg one unit of each roster type gathers per turn, so the client can
      // preview capacity while the player drags steppers — values come from
      // the server, the formula stays here.
      kgPerUnit: Object.fromEntries(
        [...campaign.roster.keys()].map((type) => [
          type,
          (catalog.get(type) ? forageValue(catalog.get(type).stats) : 0) * FORAGE_KG_PER_POINT,
        ]),
      ),
    },
    augury: auguryView(campaign.augury),
    enemy: {
      stance: campaign.enemy.stance,
      battleOffer: campaign.enemy.stance === 'offering_battle',
    },
    battles: campaign.battles.map(String),
    log: campaign.log.slice(-10),
  }
}
