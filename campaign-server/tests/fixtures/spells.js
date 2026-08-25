// A spell roster shaped exactly like `./game dump-spells`, small enough to
// reason about: two Evocation forms at different school levels, one
// Conjuration, one school-less (granted) form, and nothing at all in
// Construction.
//
// A FIXTURE rather than the real export, so a retune in the C++ table cannot
// break assertions about VIEW SHAPE that have nothing to do with balance. The
// agreement between this shape and the binary's is pinned separately, against
// the real roster, in engine.integration.test.js.
export const spellsFixture = [
  {
    spell: 'fireball', form: 'minor', label: 'Ember',
    description: 'A single bolt of fire at range.',
    school: 'evocation', schoolLevel: 1,
    paths: [{ path: 'fire', level: 1 }], fatigue: 8, castingTime: 1,
  },
  {
    spell: 'fireball', form: 'major', label: 'Fireball',
    description: 'A detonation at range.',
    school: 'evocation', schoolLevel: 3,
    paths: [{ path: 'fire', level: 3 }], fatigue: 22, castingTime: 2,
  },
  {
    spell: 'raise_dead', form: 'minor', label: 'Raise Skeleton',
    description: 'One skeleton claws up from old bones.',
    school: 'conjuration', schoolLevel: 1,
    paths: [{ path: 'death', level: 1 }], fatigue: 12, castingTime: 1,
  },
  // Granted, not researched (M-14) — school null. The Study must not show it.
  {
    spell: 'bless', form: 'minor', label: 'Blessing',
    description: 'One wounded or broken man is healed and steadied.',
    school: null, schoolLevel: 0,
    paths: [{ path: 'holy', level: 1 }], fatigue: 10, castingTime: 1,
  },
]
