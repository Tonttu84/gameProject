// THE single serializer between campaign documents and the client. Hidden
// information — enemy.army, enemy.plannedPlacement, event isReal flags —
// exists only server-side; every route responds with campaignView(campaign),
// never a raw document. tests/campaigns.test.js asserts the discipline.

export function campaignView(campaign) {
  return {
    id: campaign.id,
    day: campaign.day,
    status: campaign.status,
    battleFoughtToday: campaign.battleFoughtToday,
    resources: {
      food: campaign.resources.food,
      materials: campaign.resources.materials,
    },
    roster: Object.fromEntries(campaign.roster),
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
