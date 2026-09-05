#pragma once

// How an area of effect spreads out from where a shot landed (T-6, slice TG-2).
//
// A shared header of its own rather than a member of RangedCombat.hpp: a
// SpellForm names its mode DESCRIPTIVELY (Spell.hpp) while the delivery layer
// is what walks it (RangedCombat.hpp), and roster data has no business pulling
// in the whole ranged-combat pipeline to say one word about itself.
//
// The area itself is measured in hex SIZE POINTS — the 640-slot currency a hex's
// bodies occupy — and a hex given points covers them as ONE CONTIGUOUS ARC, so
// which men are struck depends on where they stand rather than on how many
// times the blast rolls.
enum class AreaMode {
    // No area at all: the shot strikes its one body and is finished. Every
    // archer, and every spell but fireball's major form.
    None,
    // The points fill the landed hex first (640 of them covers it entirely),
    // then open the next ring outward, 640 per hex, until they run out. The
    // last hex reached gets the remainder as an arc.
    Explosion,
    // The points are split into AREA_CHUNK-sized chunks and each chunk is
    // dropped on a hex drawn uniformly from the smallest ring set that could
    // hold the whole area. Every hex that received points then covers them as
    // one arc, exactly as an explosion's hexes do.
    Random
};
