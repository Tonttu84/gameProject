#pragma once
#include "Battlefield.hpp"
#include "render/BattleRenderer.hpp"
#include <string>

// HTTP campaign server. Blocks until the server is stopped.
// binaryPath: path to the game binary (used to spawn ./game battle subprocesses).
void runServer(int port, const std::string& binaryPath);

// Battle-from-JSON mode: read BattleInput JSON from stdin, set up the field,
// run the SFML battle, write BattleResult JSON to stdout.
void runBattleFromJson(Battlefield& field, BattleRenderer& renderer);
