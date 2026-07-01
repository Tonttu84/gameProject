#pragma once
#include "Battlefield.hpp"
#include "render/BattleRenderer.hpp"
#include <string>

void setupSampleBattle(Battlefield& field);
BattleResult runBattleLoop(Battlefield& field, BattleRenderer& renderer,
                           const std::string& title);
void runSampleBattle(Battlefield& field, BattleRenderer& renderer);
