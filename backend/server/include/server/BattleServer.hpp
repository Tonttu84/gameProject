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

// True if `name` is safe to interpolate into "maps/" + name + ".json" — rejects empty
// names, path separators, and "..". Guards GET /api/map's ?name= param and POST /api/battle's
// "map" field against path traversal. See SECURITY_NOTES.md #1. Exposed (not static) so it's
// unit-testable from backend/engine/tests/.
bool isSafeMapName(const std::string& name);
