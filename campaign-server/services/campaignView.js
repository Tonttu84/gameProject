import { getCatalog } from '../utils/catalog.js'
import { armyFoodPerTurn, forageValue } from '../utils/capabilities.js'
import { FORAGE_KG_PER_POINT } from '../utils/campaignConfig.js'
import { forageCapacityKg } from './forage.js'

// THE single serializer between campaign documents and the client. Hidden
// information — enemy.army, enemy.plannedPlacement, event isReal flags,
// forage.enemyPlan — exists only server-side; every route responds with
// campaignView(campaign), never a raw document. tests/campaigns.test.js
// asserts the discipline.
//
// Async because it derives display values (food need, forage capacity) from
// the cached unit catalog — the client never re-implements campaign math.

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
    auguryScore: campaign.auguryScore,
    events: campaign.events.picked
      ? []
      : campaign.events.drawn.map(({ id, title, description, effect, probability }) => ({
          id,
          title,
          description,
          effect, // visible: with pick-a-card semantics the effect IS the choice
          probability,
        })),
    enemy: {
      stance: campaign.enemy.stance,
      battleOffer: campaign.enemy.stance === 'offering_battle',
    },
    battles: campaign.battles.map(String),
    log: campaign.log.slice(-10),
  }
}
