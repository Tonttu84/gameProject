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
Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid);
