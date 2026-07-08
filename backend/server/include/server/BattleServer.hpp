#pragma once
#include "Battlefield.hpp"
#include <string>

// HTTP campaign server. Blocks until the server is stopped.
// binaryPath: path to the game binary (used to spawn ./game battle subprocesses).
void runServer(int port, const std::string& binaryPath);

// Battle-from-JSON mode: read BattleInput JSON from stdin, set up the field,
// run the battle headless (recording every tick), write BattleResult JSON to stdout.
void runBattleFromJson(Battlefield& field);

// Run an already-set-up field to completion, recording every tick, and print the
// {winner, *_survivors, replay} envelope to stdout — the exact JSON contract the
// campaign server reads (services/engine.js). Shared by `battle` (field built from
// stdin JSON) and `sample` (field built by the C++ scenario): the field SOURCE
// differs, the run/record/emit tail is one path so their output can never diverge.
void runAndEmitBattle(Battlefield& field, const std::string& mapName,
                      const std::string& title, int maxTicks = DEFAULT_MAX_BATTLE_TICKS);

// True if `name` is safe to interpolate into "maps/" + name + ".json" — rejects empty
// names, path separators, and "..". Guards GET /api/map's ?name= param and POST /api/battle's
// "map" field against path traversal. See SECURITY_NOTES.md #1. Exposed (not static) so it's
// unit-testable from backend/engine/tests/.
bool isSafeMapName(const std::string& name);

// Clamp BattleInput's attacker-controlled "max_turns" to a sane battle length:
// < 1 (or absent/mistyped, handled at the call site) → DEFAULT_MAX_BATTLE_TICKS,
// otherwise capped at MAX_BATTLE_TICKS_CAP. Exposed for unit tests.
int clampMaxTurns(int requested);
