// A campaignView object as the server returns it (services/campaignView.js):
// no enemy army, no planned placement, no isReal flags, no enemy forage plan —
// the client never sees those. One `day` = one two-week turn; food in kg.
export const campaignFixture = {
  id: 'c1',
  day: 1,
  status: 'active',
  battleFoughtToday: false,
  resources: { food: 50000, materials: 0, foodNeedPerTurn: 12432 },
  roster: { Soldier: 300, Archer: 50, Mage: 3, Priest: 3, Cavalry: 10, LightCavalry: 12 },
  forage: {
    rings: [
      { ring: 0, richness: 20000, initialRichness: 20000 },
      { ring: 1, richness: 35000, initialRichness: 35000 },
      { ring: 2, richness: 55000, initialRichness: 55000 },
    ],
    assignment: {},
    capacityKg: 0,
    kgPerUnit: { Soldier: 30, Archer: 30, Mage: 30, Priest: 30, Cavalry: 60, LightCavalry: 90 },
  },
  auguryScore: 50,
  events: [
    { id: 'supply', title: 'Supply Cache', description: 'Scouts find an abandoned depot. +3000 kg food.', effect: { type: 'food', delta: 3000 }, probability: 50 },
    { id: 'weather', title: 'Harsh Weather', description: 'A hard fortnight drains rations.', effect: { type: 'food', delta: -1000 }, probability: 25 },
    { id: 'plague', title: 'Plague', description: 'Disease thins the ranks by 5%.', effect: { type: 'all_roster', factor: 0.95 }, probability: 25 },
  ],
  enemy: { stance: 'camp', battleOffer: false },
  battles: [],
  log: [],
}
