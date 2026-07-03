// A campaignView object as the server returns it (services/campaignView.js):
// no enemy army, no planned placement, no isReal flags — the client never
// sees those.
export const campaignFixture = {
  id: 'c1',
  day: 1,
  status: 'active',
  battleFoughtToday: false,
  resources: { food: 100, materials: 0 },
  roster: { Soldier: 300, Archer: 50, Mage: 3, Priest: 3, Cavalry: 10, LightCavalry: 12 },
  auguryScore: 50,
  events: [
    { id: 'supply', title: 'Supply Cache', description: 'Scouts find an abandoned depot.', effect: { type: 'food', delta: 30 }, probability: 50 },
    { id: 'weather', title: 'Harsh Weather', description: 'Cold snap drains rations.', effect: { type: 'food', delta: -10 }, probability: 25 },
    { id: 'plague', title: 'Plague', description: 'Disease thins the ranks by 5%.', effect: { type: 'all_roster', factor: 0.95 }, probability: 25 },
  ],
  enemy: { stance: 'camp', battleOffer: false },
  battles: [],
  log: [],
}
