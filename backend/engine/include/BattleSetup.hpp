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
// Returns true if every unit was placed, false if the zone filled up first (army is left
// partially placed — units already placed keep getPlaced()==true; the rest do not). Does
// NOT terminate the process on failure (see SECURITY_NOTES.md #6) — callers must check the
// return value and decide how to handle a zone that's too small for the army.
// PlacementZone bounds ultimately trace back to a map file's deployment zone rows (see
// HexGrid::fromJson) — callers should not assume wEnd>=wStart/hEnd>=hStart without having
// gone through HexGrid's own validation first (asserted here, not re-checked).
bool randomPlaceArmy(Army& army, Battlefield& field, PlacementZone zone);
