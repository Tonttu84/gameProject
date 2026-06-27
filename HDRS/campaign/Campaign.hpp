#pragma once
#include "Battlefield.hpp"
#include "render/BattleRenderer.hpp"

// Full campaign: buy screen + three escalating battles.
void runCampaign(Battlefield& field, BattleRenderer& renderer);

// Dev shortcut: run the sample battle directly, no buy screen.
// Launch with:  ./game sample
void runSampleBattle(Battlefield& field, BattleRenderer& renderer);
