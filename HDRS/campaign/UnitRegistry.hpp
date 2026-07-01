#pragma once
#include <string>

// Builds a JSON string describing all placeable unit types, hex capacity,
// terrain metadata, and player/enemy placement zones. Used by the campaign
// HTTP server's GET /api/info endpoint so React reads the truth from C++
// headers rather than maintaining a duplicate registry.
std::string buildInfoJson();
