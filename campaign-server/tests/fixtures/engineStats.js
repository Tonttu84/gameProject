// Engine-exported combat stats, hand-pinned per unit type — the inputs the
// derived-capability tests (capabilities.test.js) compute their expected
// values from. Exactly the stat fields the campaign capability formulas read;
// preferredRange is deliberately omitted (no capability uses it).
//
// These values ARE hand-copied from the C++ constructors, which is normally
// forbidden (memory: never hand-copy unit facts) — the license for it is that
// tests/engine.integration.test.js asserts every entry here against a real
// `./game dump-units` run, so any drift from the engine fails the suite on
// any machine with the binary built. Add a unit here only if a capability
// test needs it; keep the field set identical across entries.
export const engineStatsFixture = {
  Soldier:      { maxHP: 10, attack: 11, defence: 12, armour: 5, speed: 10, ballisticSkill: 4,  reconTag: 0 },
  Archer:       { maxHP: 10, attack: 10, defence: 12, armour: 2, speed: 10, ballisticSkill: 10, reconTag: 0 },
  // Mounted composites report their RIDER's stats (MountedUnit delegates to
  // effectTarget) and their MOUNT's speed — Cavalry rides as a Soldier,
  // LightCavalry as the lighter javelin-armed LightRider, both on a Horse.
  Cavalry:      { maxHP: 10, attack: 11, defence: 12, armour: 5, speed: 28, ballisticSkill: 4,  reconTag: 0 },
  LightCavalry: { maxHP: 10, attack: 10, defence: 11, armour: 2, speed: 28, ballisticSkill: 8,  reconTag: 4 },
  Horse:        { maxHP: 15, attack: 0,  defence: 12, armour: 0, speed: 28, ballisticSkill: 1,  reconTag: 0 },
  Warhorse:     { maxHP: 15, attack: 9,  defence: 13, armour: 2, speed: 28, ballisticSkill: 1,  reconTag: -2 },
}
