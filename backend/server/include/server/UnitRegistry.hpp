#pragma once
#include "Battlefield.hpp"
#include "hex/HexGrid.hpp"
#include <string>

// Builds a JSON string describing all placeable unit types, hex capacity,
// terrain metadata, and player/enemy placement zones.
std::string buildInfoJson();

// Creates an Army from a JSON placement array string:
// [{"unit_type":"Soldier","q":3,"r":5}, ...]
// Unknown unit types are skipped. Coords not in grid leave the unit with no hex.
//
// BOUNDARY (see SECURITY_NOTES.md #3, #4, #5): placementJson is attacker-controlled — it is
// the "player_placement"/"enemy_placement" field of a POST /api/battle body, forwarded
// verbatim. Every entry's fields are validated for presence/type before use (malformed
// entries are skipped, not thrown); the array length is capped. There is NO check against
// any campaign-level roster/budget — only per-hex capacity and terrain rules are enforced.
Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid);
