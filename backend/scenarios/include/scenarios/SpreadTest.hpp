#pragma once
#include "Battlefield.hpp"
#include <string>

// Run the spreading scenario headless over each terrain and write one replay
// JSON per terrain into outDir (default replays/), e.g. replays/spread_open.json.
// Result summaries go to stderr.
void runSpreadTest(Battlefield& field, const std::string& outDir = "replays");
