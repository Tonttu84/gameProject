// A campaignView object as the server returns it (services/campaignView.js):
// no enemy army, no planned placement, no true/decoy events, no prediction
// internals (total/threshold/accurate), no enemy forage plan — the client
// never sees those. One `day` = one two-week turn; food in kg.
export const campaignFixture = {
  id: 'c1',
  day: 1,
  status: 'active',
  battleFoughtToday: false,
  // Boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop"):
  // banded phrase always; a numeric estimate ([low,high], exact {v,v} at the
  // top recon level) once recon reveals it — null while Blind (recon level 0).
  meter: { band: 'calm', estimate: null },
  bossFightDue: false,
  resources: { food: 50000, materials: 0, foodNeedPerTurn: 12432 },
  roster: { Soldier: 300, Archer: 50, Mage: 3, Priest: 3, Cavalry: 10, LightCavalry: 12 },
  // Persistent player-facing squads (playtest item 1) — a subset of roster
  // organized into named formations; the remainder stays loose.
  squads: [
    { id: 1, name: '1st Cohort', composition: { Soldier: 40 } },
    { id: 2, name: 'Skirmishers', composition: { Archer: 30 } },
    { id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 } },
  ],
  // Civilian labour pool: available = total − used. Forts + militia spend it.
  workers: { total: 2000, used: 0, available: 2000 },
  // Own info (not hidden): fort level + next-level material/worker cost + the
  // walled sides the placement grid draws. sides is empty at level 0.
  fortification: { level: 0, atCap: false, nextCost: 50, nextWorkerCost: 500, sides: [] },
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
  // Raid opportunities (Stage 4 Part 2): public projection only — the hidden
  // target slice is stripped to its strength band; outcome appears once
  // resolved. Empty by default so tests opt in per case.
  raid: { opportunities: [], assignment: {}, scoutingPoints: 0, scoutCost: { addTarget: 8, reveal: 3 } },
  augury: { consulted: false, rerollsRemaining: 1, visions: null },
  // Only the banded label crosses the boundary — never coverage numbers.
  scouting: { band: 'Contested' },
  // Band-gated enemy view (Stage 4 1b + recon R2): at Contested the scouts add
  // a numeric count estimate ([low,high], recon.js displayBracket) + supply
  // state; higher bands add composition, exact counts and the revealed
  // placement (see scoutingReveal.test.jsx).
  enemy: {
    stance: 'camp',
    battleOffer: false,
    count: { low: 400, high: 900 },
    supplies: 'well-provisioned',
  },
  battles: [],
  log: [],
}

// The view's augury after consulting: one shown vision card per fate slot,
// each with the slot's odds of being true (the server's own roll target —
// the reroll minigame runs on these). Whether a vision actually WAS true
// never appears — that's the end-of-turn reveal.
export const consultedAugury = {
  consulted: true,
  // Fates already sealed at the tent — muster-flow tests march straight
  // through; tent/acceptance tests override this to false explicitly.
  accepted: true,
  rerollsRemaining: 1,
  visions: [
    {
      id: 'supply',
      title: 'Supply Cache',
      description: 'Scouts find an abandoned depot. +3 t of food.',
      severity: 1,
      valence: 'good',
      effect: { type: 'food', delta: 3000 },
      odds: 0.75,
      // Truth revealed (debug flag / reroll spent): this vision holds.
      truth: { id: 'supply', title: 'Supply Cache', severity: 1 },
    },
    {
      id: 'weather',
      title: 'Harsh Weather',
      description: 'A hard fortnight drains rations. -1 t of food.',
      severity: 2,
      valence: 'bad',
      effect: { type: 'food', delta: -1000 },
      odds: 0.3,
      // ...and this vision lied: the truth is a different same-pool event.
      truth: { id: 'desertion', title: 'Desertion', severity: 2 },
    },
    {
      id: 'plague',
      title: 'Plague',
      description: 'Disease thins the ranks.',
      severity: 3,
      valence: 'bad',
      effect: { type: 'all_roster', factor: 0.95 },
      odds: 0.9,
    },
  ],
}
