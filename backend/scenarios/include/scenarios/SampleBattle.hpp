#pragma once
#include "Battlefield.hpp"
#include <functional>
#include <string>

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
void runSampleBattle(Battlefield& field);
