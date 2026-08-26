// A campaignView object as the server returns it (services/campaignView.js):
// no enemy army, no planned placement, no true/decoy events, no prediction
// internals (total/threshold/accurate), no enemy forage plan — the client
// never sees those. One `day` = one two-week turn; food in kg.
export const campaignFixture = {
  id: 'c1',
  day: 1,
  status: 'active',
  battleFoughtToday: false,
  // The turn's phase (server-owned since the one-way march landed): screens
  // route off this, and any screen BEHIND it renders read-only. A fixture
  // starts where a turn starts.
  phase: 'prepare',
  // Boss-fight meter (docs/CAMPAIGN_PLAN.md "Boss-fight campaign loop"):
  // banded phrase always; a numeric estimate ([low,high], exact {v,v} at the
  // top recon level) once recon reveals it — null while Blind (recon level 0).
  // `remaining` is the gap left to the threshold, derived server-side from that
  // estimate (so: null here too, and the forage panel's turns-to-breach readout
  // falls back to its relative phrasing).
  meter: { band: 'intact', estimate: null, remaining: null },
  bossFightDue: false,
  // Garrison Resolve (docs/CAMPAIGN_PLAN.md "Garrison Resolve"): own info shown
  // as a coarse band word only — the raw resolve number never crosses the wire.
  garrison: { level: 'normal' },
  resources: { food: 50000, materials: 0, gold: 0, horses: 0, mithril: 10, foodNeedPerTurn: 12432 },
  roster: { Soldier: 300, Archer: 50, Mage: 3, Priest: 3, Cavalry: 10, LightCavalry: 12 },
  // Persistent player-facing squads (playtest item 1) — a subset of roster
  // organized into named formations; the remainder stays loose.
  // `caps`/`intake` are RESOLVED server-side from the stored archetype id
  // (slice 2/3) — what the end-of-turn refill (13-2) works to. The starting
  // squads sit exactly AT their caps, so a fresh fixture has no room to take
  // anyone on, which is a full formation reading correctly.
  // `nextRank` is the rung above and its threshold (13-14) — shipped, never
  // re-derived here. `refill` is tonight's automatic refill forecast (13-6):
  // what will join, what it will cost, or the one word for why nobody does.
  // The starting squads are AT their caps in the types they hold, so a fresh
  // fixture forecasts nobody — 'pool' where a capped type has room but the
  // loose ranks hold none of it, 'full' where there is no room at all.
  squads: [
    {
      id: 1, name: '1st Cohort', composition: { Soldier: 40 }, prestige: 0, rank: 'Untested',
      nextRank: { label: 'Blooded', at: 10 },
      archetype: 'line', caps: { Soldier: 40, Pikeman: 10 }, intake: 10,
      refill: { outputs: {}, cost: {}, bodies: 0, blocked: 'pool' },
    },
    {
      id: 2, name: 'Skirmishers', composition: { Archer: 30 }, prestige: 0, rank: 'Untested',
      nextRank: { label: 'Blooded', at: 10 },
      archetype: 'skirmish', caps: { Archer: 30, Militia: 10 }, intake: 6,
      refill: { outputs: {}, cost: {}, bodies: 0, blocked: 'pool' },
    },
    {
      id: 3, name: 'Vanguard Riders', composition: { Cavalry: 6, LightCavalry: 6 }, prestige: 0, rank: 'Untested',
      nextRank: { label: 'Blooded', at: 10 },
      archetype: 'vanguard', caps: { Cavalry: 6, LightCavalry: 6 }, intake: 2,
      refill: { outputs: {}, cost: {}, bodies: 0, blocked: 'full' },
    },
  ],
  // roster minus every charter's composition — the bodies the end-of-turn
  // refill eats (13-13 protects none of it) and the ones the player hand-places
  // at deploy.
  loose: { Soldier: 260, Archer: 20, Mage: 3, Priest: 3, Cavalry: 4, LightCavalry: 6 },
  // Civilian labour pool: available = total − used. Forts + militia spend it.
  workers: { total: 2000, used: 0, available: 2000 },
  // Own info (not hidden): fort level + next-level material/worker cost + the
  // walled sides the placement grid draws. sides is empty at level 0.
  fortification: { level: 0, atCap: false, nextCost: 50, nextWorkerCost: 500, sides: [] },
  forage: {
    rings: [
      { ring: 0, richness: 80000, initialRichness: 80000 },
      { ring: 1, richness: 140000, initialRichness: 140000 },
      { ring: 2, richness: 220000, initialRichness: 220000 },
    ],
    pool: 1112,
    share: 0.5,
    kgPerPoint: 16,
    foodShare: 0.8,
    materialsShare: 0.2,
    capacityKg: 0,
    meterFillAtNoForage: 10,
    meterFillAtFullForage: 20,
    enemyDrainKg: null,
  },
  // Raid opportunities (Stage 4 Part 2): public projection only — the hidden
  // target slice is stripped to its strength band; outcome appears once
  // resolved. Empty by default so tests opt in per case.
  raid: { opportunities: [], assignment: {}, squadAssignment: [], scoutingPoints: 0, scoutCost: { addTarget: 8, reveal: 3 } },
  // Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"):
  // hiredToday defaults true (nothing to pick, cadence already spent) so
  // marchToDeployment reaches the deploy exit without an extra hire/skip
  // click — recruitPanel.test.jsx overrides this to exercise the offer itself.
  recruit: { fervor: 0, boosted: false, hiredToday: true, drawn: true, options: [] },
  augury: { consulted: false, rerollsRemaining: 1, visions: null },
  // Only the banded label crosses the boundary — never coverage numbers.
  scouting: { band: 'Contested' },
  // Band-gated enemy view (Stage 4 1b + recon R2): at Contested the scouts add
  // a numeric count estimate ([low,high], recon.js displayBracket) + supply
  // state; higher bands add composition, exact counts and the revealed
  // placement (see scoutingReveal.test.jsx).
  enemy: {
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
