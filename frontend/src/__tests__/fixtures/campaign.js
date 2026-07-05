// A campaignView object as the server returns it (services/campaignView.js):
// no enemy army, no planned placement, no true/decoy events, no prediction
// internals (total/threshold/accurate), no enemy forage plan — the client
// never sees those. One `day` = one two-week turn; food in kg.
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
  augury: { consulted: false, rerollsRemaining: 1, visions: null },
  enemy: { stance: 'camp', battleOffer: false },
  battles: [],
  log: [],
}

// The view's augury after consulting: one shown vision card per fate slot.
// Whether a vision is TRUE never appears — that's the end-of-turn reveal.
// No vision here has a '%' of its own, so the "no stated odds" test can
// blanket-assert the augury UI adds none (real event descriptions may still
// contain incidental percentages — that's effect flavor, not confidence).
export const consultedAugury = {
  consulted: true,
  rerollsRemaining: 1,
  visions: [
    {
      id: 'supply',
      title: 'Supply Cache',
      description: 'Scouts find an abandoned depot. +3 t of food.',
      severity: 1,
      effect: { type: 'food', delta: 3000 },
    },
    {
      id: 'weather',
      title: 'Harsh Weather',
      description: 'A hard fortnight drains rations. -1 t of food.',
      severity: 2,
      effect: { type: 'food', delta: -1000 },
    },
    {
      id: 'plague',
      title: 'Plague',
      description: 'Disease thins the ranks.',
      severity: 3,
      effect: { type: 'all_roster', factor: 0.95 },
    },
  ],
}
