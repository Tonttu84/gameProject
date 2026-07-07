#pragma once
#include "Battlefield.hpp"
#include <functional>
#include <string>

class ReplayRecorder;

void setupSampleBattle(Battlefield& field);
// Headless battle loop: tick() to completion, returning the result. onTick
// (optional) runs after every Battlefield::tick(), including the final one —
// battle mode uses it to record per-tick replay snapshots.
// maxTicks: the day ends after this many turns and the battle is scored as it
// stands (both sides alive = draw in extractResult()).
BattleResult runBattleLoop(Battlefield& field,
                           const std::string& title,
                           const std::function<void()>& onTick = {},
                           int maxTicks = DEFAULT_MAX_BATTLE_TICKS);

// Serialize a recorded scenario battle to `outPath` in the SAME shape as the
// campaign battle-mode `replay` block ({map, cols, rows, ticks}), creating
// parent dirs as needed. Phase 2 loads these into the browser ReplayView so
// the visual combat-feel debugger uses the one and only renderer.
void writeReplayJson(const ReplayRecorder& recorder, const std::string& mapName,
                     const std::string& outPath);

// Run the sample battle headless and write its replay JSON to outPath
// (default replays/sample.json). Result summary goes to stderr.
void runSampleBattle(Battlefield& field, const std::string& outPath = "replays/sample.json");
