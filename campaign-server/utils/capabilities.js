// Campaign-layer unit capabilities, DERIVED from the engine-exported combat
// stats (unittypes collection, i.e. `./game dump-units`). Nothing here is
// hand-maintained per unit type: a future Flyer or new skirmisher gets its
// scouting/foraging role purely from its stats, keeping the C++ constructors
// the single source of truth.
//
// Scales: speed 1 = foot, 2 = heavy cavalry, 3 = light cavalry.
// ballisticSkill is on the melee-attack scale: 10 = trained archer,
// 1 = animal with no ranged sense. All multipliers are tuning knobs.

// Scouting: fast units that can actually observe, report, and skirmish at a
// distance. Ranged sense gates it: a quick but ranged-blind animal (Horse,
// ballisticSkill 1) scores barely above a foot soldier.
export const scoutValue = (stats) =>
  stats.speed * 3 + Math.floor(stats.ballisticSkill / 3)

// Foraging: covering ground is what matters — riders sweep a wide area dry
// long before infantry could.
export const forageValue = (stats) => Math.max(1, stats.speed * 2)

// Screening (protecting foragers / countering enemy harassment): armoured,
// dangerous, and mobile enough to intercept — heavy cavalry's specialty.
// Armour weighs fully so heavy cavalry (armour 5, speed 2) beats light
// (armour 2, speed 3).
export const screenValue = (stats) =>
  stats.armour + Math.floor(stats.attack / 6) + stats.speed
