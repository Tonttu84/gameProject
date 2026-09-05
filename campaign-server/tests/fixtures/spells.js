// A spell roster shaped exactly like `./game dump-spells`, small enough to
// reason about: two Evocation forms at different school levels, one
// Conjuration, one school-less (granted) form, two Enchantment battlefield
// forms, and nothing at all in Construction.
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
    // TG-1's delivery fields, on EVERY row as the real export carries them
    // (T-1/T-2): the two thrown Fire forms scatter, everything else is precise.
    accuracy: 0, precise: false, range: 10,
    // TG-2's area (T-6), likewise on every row: 'none'/0 unless the form covers
    // ground rather than a man. Ember is one bolt.
    areaMode: 'none', area: 0,
    // TG-3's resistance and duration (T-4/T-5), on every row too. Every form in
    // this fixture is an untimed, unresistible one — which is what 'none'/0/0
    // says, and what most of the real roster is. A view test that needs a
    // tagged or timed row overrides these on a copy, rather than making one of
    // the six rows below unrepresentative of the shape it is here to stand for.
    resist: 'none', resistMod: 0, duration: 0,
  },
  {
    spell: 'fireball', form: 'major', label: 'Fireball',
    description: 'A detonation at range.',
    school: 'evocation', schoolLevel: 3,
    paths: [{ path: 'fire', level: 3 }], fatigue: 22, castingTime: 2,
    accuracy: 0, precise: false, range: 10,
    // The one area on the roster: an explosion of a hundred hex points.
    areaMode: 'explosion', area: 100,
    resist: 'none', resistMod: 0, duration: 0,
  },
  {
    spell: 'raise_dead', form: 'minor', label: 'Raise Skeleton',
    description: 'One skeleton claws up from old bones.',
    school: 'conjuration', schoolLevel: 1,
    paths: [{ path: 'death', level: 1 }], fatigue: 12, castingTime: 1,
    accuracy: 100, precise: true, range: 10,
    areaMode: 'none', area: 0,
    resist: 'none', resistMod: 0, duration: 0,
  },
  // Granted, not researched (M-14) — school null. The Study must not show it.
  {
    spell: 'bless', form: 'minor', label: 'Blessing',
    description: 'One wounded or broken man is healed and steadied.',
    school: null, schoolLevel: 0,
    paths: [{ path: 'holy', level: 1 }], fatigue: 10, castingTime: 1,
    accuracy: 100, precise: true, range: 10,
    areaMode: 'none', area: 0,
    resist: 'none', resistMod: 0, duration: 0,
  },
  // The battlefield-wide enchantments (E-1/E-6). SINGLE-FORM by construction
  // (form 'battlefield'), and the two fields the ordinary rows above leave off:
  // `battlefield` marks them script-only (E-3) and `poolCost` is what they draw
  // from the army's pool (E-2). Two of them, at different prices, because the
  // sentence the server writes quotes the row's own number.
  {
    spell: 'soothing_winds', form: 'battlefield', label: 'Soothing Winds',
    description: 'A kind wind runs the line, and every friendly body breathes easier.',
    school: 'enchantment', schoolLevel: 2,
    paths: [{ path: 'nature', level: 2 }], fatigue: 20, castingTime: 3,
    accuracy: 100, precise: true, range: 10,
    areaMode: 'none', area: 0,
    resist: 'none', resistMod: 0, duration: 0,
    battlefield: true, poolCost: 2,
  },
  {
    spell: 'leaden_air', form: 'battlefield', label: 'Leaden Air',
    description: 'The air thickens, and every living body on the field tires faster.',
    school: 'enchantment', schoolLevel: 2,
    paths: [{ path: 'death', level: 2 }], fatigue: 24, castingTime: 3,
    accuracy: 100, precise: true, range: 10,
    areaMode: 'none', area: 0,
    resist: 'none', resistMod: 0, duration: 0,
    battlefield: true, poolCost: 3,
  },
]
