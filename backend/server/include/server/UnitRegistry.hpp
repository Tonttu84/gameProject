#pragma once
#include "Battlefield.hpp"
#include "hex/HexGrid.hpp"
#include <string>

// Builds a JSON string describing all placeable unit types, hex capacity,
// terrain metadata, and player/enemy placement zones.
std::string buildInfoJson();

// Creates an Army from a JSON placement array string:
// [{"unit_type":"Soldier","q":3,"r":5}, ...]
// Entries are skipped entirely (not added to the returned Army) if: unit_type is unknown,
// malformed (missing/wrong-typed unit_type/q/r), q/r doesn't resolve to a hex in the grid,
// the hex is impassable or outside the placement zone (when one is set), the unit's category
// forbids the hex's terrain, or placing it would exceed the hex's remaining capacity.
//
// BOUNDARY (see SECURITY_NOTES.md #3, #4, #5): placementJson is attacker-controlled — it is
// the "player_placement"/"enemy_placement" field of a POST /api/battle body, forwarded
// verbatim. Every entry's fields are validated for presence/type before use (malformed
// entries are skipped, not thrown); total requested unit size is capped in size-points
// (hexCount() * Hex::CAPACITY — the same unit hex capacity is measured in, not a raw
// entry/unit count, since a single unit can be as large as a full hex). There is NO check
// against any campaign-level roster/budget — only per-hex capacity and terrain rules are
// enforced.
Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid);
