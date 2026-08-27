// Shaped exactly like `./game dump-units` output (see backend UnitCatalog.hpp).
// Covers every type in STARTING_ROSTER + ENEMY_ARMY, plus the two the Recruit
// phase can add that neither starts with (Militia, Pikeman), so campaign math
// (food needs, forage values, clash strengths) has real sizes/speeds to work
// with for anything a campaign can actually come to own.
// Speeds, ballistic skills, recon tags and sizes match the engine-pinned
// values in backend/engine/tests/test_unit_catalog.cpp; the rest is
// shape-realistic.
//
// `anatomy` mirrors the engine's declared body plans (slice 9a, 5-6): humanoid
// for everything that walks on two legs, and no hands for a horse. It is
// required by the UnitType model, so a type missing it fails the sync the same
// way a drifted export would.
export const catalogFixture = {
  units: [
    {
      name: 'Soldier',
      symbol: 'X',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player', 'Enemy'],
      stats: { maxHP: 10, attack: 11, defence: 12, armour: 2, speed: 10, ballisticSkill: 4, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      // Never recruited and never loose by any other route: the only way a
      // campaign comes to own one is the royal_guard squad upgrade (4d), which
      // converts Soldiers. Same size as the Soldier it replaces, deliberately —
      // a guard squad measures exactly what a line squad measures.
      name: 'RoyalGuard',
      symbol: 'G',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player'],
      stats: { maxHP: 14, attack: 13, defence: 14, armour: 5, speed: 10, ballisticSkill: 4, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Militia',
      symbol: 'm',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player'],
      stats: { maxHP: 10, attack: 10, defence: 11, armour: 2, speed: 10, ballisticSkill: 4, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Pikeman',
      symbol: 'p',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player'],
      stats: { maxHP: 10, attack: 10, defence: 11, armour: 2, speed: 10, ballisticSkill: 4, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Archer',
      symbol: 'A',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player', 'Enemy'],
      stats: { maxHP: 10, attack: 10, defence: 12, armour: 2, speed: 10, ballisticSkill: 10, preferredRange: 3, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Mage',
      symbol: 'M',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player'],
      stats: { maxHP: 8, attack: 6, defence: 10, armour: 0, speed: 10, ballisticSkill: 12, preferredRange: 3, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Priest',
      symbol: 'P',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Player'],
      stats: { maxHP: 8, attack: 8, defence: 10, armour: 0, speed: 10, ballisticSkill: 4, preferredRange: 3, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Cavalry',
      symbol: 'C',
      size: 20,
      category: 'Mounted',
      forbiddenTerrain: ['Forest', 'Marsh'],
      roles: ['Player'],
      stats: { maxHP: 18, attack: 11, defence: 12, armour: 5, speed: 28, ballisticSkill: 4, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'LightCavalry',
      symbol: 'l',
      size: 20,
      category: 'Mounted',
      forbiddenTerrain: ['Forest', 'Marsh'],
      roles: ['Player', 'Enemy'],
      stats: { maxHP: 16, attack: 10, defence: 11, armour: 2, speed: 28, ballisticSkill: 8, preferredRange: 0, reconTag: 4 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Necromancer',
      symbol: 'N',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Enemy'],
      stats: { maxHP: 8, attack: 6, defence: 10, armour: 0, speed: 10, ballisticSkill: 3, preferredRange: 3, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      name: 'Zombie',
      symbol: 'Z',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Summon'],
      stats: { maxHP: 20, attack: 8, defence: 6, armour: 0, speed: 10, ballisticSkill: 1, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
    {
      // Crafted only (slice C3): forged at the foundry, never hired. Humanoid
      // on purpose (C-4) — it bears artifacts in a man's slots — and
      // preferredRange 0: a mindless character has no hang-back to default.
      name: 'Golem',
      symbol: 'g',
      size: 15,
      category: 'Foot',
      forbiddenTerrain: [],
      roles: ['Crafted'],
      stats: { maxHP: 35, attack: 12, defence: 12, armour: 7, speed: 8, ballisticSkill: 1, preferredRange: 0, reconTag: 0 },
      anatomy: { head: 1, torso: 1, legs: 1, hand: 2, misc: 1 },
    },
  ],
}
