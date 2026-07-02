#pragma once
#include "Battlefield.hpp"
#include <memory>

struct PlacementZone
{
    int wStart;
    int wEnd;
    int hStart;
    int hEnd;
};

// No upper bound on `count` here — callers that source count from external input (e.g.
// UnitRegistry::buildArmyFromPlacement) are responsible for capping it themselves.
template<typename UnitType>
void appendArmy(Army& army, size_t count, int team)
{
    for (size_t i = 0; i < count; ++i)
        army.push_back(std::make_unique<UnitType>(team));
}

// Randomly places every not-yet-placed unit of `army` within `zone`.
// PlacementZone bounds ultimately trace back to a map file's deployment zone rows (see
// HexGrid::fromJson) — callers should not assume wEnd>=wStart/hEnd>=hStart without having
// gone through HexGrid's own validation first (asserted here, not re-checked).
// CURRENT BEHAVIOR (see SECURITY_NOTES.md #6): calls exit(1) if the zone fills up before
// every unit is placed, terminating the whole process rather than failing gracefully.
void randomPlaceArmy(Army& army, Battlefield& field, PlacementZone zone);
