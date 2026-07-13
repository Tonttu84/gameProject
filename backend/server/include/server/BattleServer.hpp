#pragma once
#include "Battlefield.hpp"
#include <string>

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

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

// Apply a battle-input "fortified_sides" JSON array to the grid, on top of any forts
// baked into the map file. `json` is the array string (e.g. j["fortified_sides"].dump()).
// Each entry: {q, r, dir, durability?} — dir is a hexside name (NE/E/SE/SW/W/NW) and the
// {q,r} hex is the defended (player-side) hex; durability defaults to
// DEFAULT_FORT_DURABILITY. Attacker-controlled input: malformed entries are skipped and
// nothing throws. Exposed for unit tests. Returns the number of sides fortified.
int applyFortifiedSides(const std::string& json, HexGrid& grid);

// Clamp BattleInput's attacker-controlled "max_turns" to a sane battle length:
// < 1 (or absent/mistyped, handled at the call site) → DEFAULT_MAX_BATTLE_TICKS,
// otherwise capped at MAX_BATTLE_TICKS_CAP. Exposed for unit tests.
int clampMaxTurns(int requested);

// Per-campaign-squad survivor breakdown for one side's surviving Army, keyed
// by stringified squadId (JSON object keys must be strings):
//   {"<id>": {"survivors": {"Soldier": 26, "Archer": 3}, "wiped": false}}
// Only units carrying a persistent squadId (AUnit::getSquadId() > 0) are
// bucketed; untagged survivors belong only in the flat *_survivors counts.
// "wiped" is false iff at least one tagged survivor is still attached to its
// live in-battle Squad (getSquad() != nullptr) — the formation held to the
// end, however reduced; true means every tagged survivor already left the
// squad (broke and fled), so the campaign layer should fold them back into
// the loose pool instead of reforming the squad. Exposed for unit tests.
nlohmann::json squadSurvivorJson(const Army& army);
