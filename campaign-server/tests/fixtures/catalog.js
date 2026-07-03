// Shaped exactly like `./game dump-units` output (see backend UnitCatalog.hpp).
export const catalogFixture = {
  units: [
    {
      name: 'Soldier',
      symbol: 'X',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      placeable: true,
      spawnable: true,
      stats: { maxHP: 10, attack: 11, defence: 12, armour: 2, speed: 1, ballisticSkill: 4, preferredRange: 0 },
    },
    {
      name: 'Cavalry',
      symbol: 'C',
      size: 20,
      category: 'Mounted',
      forbiddenTerrain: ['Forest', 'Marsh'],
      placeable: true,
      spawnable: true,
      stats: { maxHP: 18, attack: 11, defence: 12, armour: 2, speed: 3, ballisticSkill: 4, preferredRange: 0 },
    },
    {
      name: 'Zombie',
      symbol: 'Z',
      size: 10,
      category: 'Foot',
      forbiddenTerrain: [],
      placeable: false,
      spawnable: false,
      stats: { maxHP: 20, attack: 8, defence: 6, armour: 0, speed: 1, ballisticSkill: 1, preferredRange: 0 },
    },
  ],
}
