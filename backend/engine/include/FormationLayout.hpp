#pragma once
#include <vector>

struct Hex;
class AUnit;

// One unit's cosmetic position within its hex, in hex-radius units of the
// engine's flat pixel space (multiply by the hex size and add the hex centre
// to get pixels; the React replay applies its axis transpose on top).
//
//   ox, oy  — offset from the hex centre, |ox|,|oy| <= 1
//   scale   — glyph size in the same units (rank multiplier already applied)
struct UnitPlacement {
    AUnit* unit;
    float  ox;
    float  oy;
    float  scale;
};

// Pure in-hex formation layout — the single source of unit layout for every
// viewer: BattleRenderer consumes it live each frame, ReplayRecorder writes
// its offsets into replay ticks so the web ReplayView needs no geometry of
// its own. Reads engine state only (units, engagement sides/ranks), draws
// nothing.
//
// Returns one placement per alive unit, in back-to-front draw order
// (support pool, then engaged ranks deepest-first so the frontline lands
// on top).
std::vector<UnitPlacement> layoutHexFormation(const Hex& hex);
