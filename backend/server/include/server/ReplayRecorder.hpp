#pragma once

#include "Battlefield.hpp"
#include "FormationLayout.hpp"
#include <string>
#include <unordered_map>
#include <vector>

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

// Records per-tick battle snapshots so a battle can be replayed (and scrubbed
// back and forth) from stored state instead of re-simulating — the engine RNG
// is intentionally nondeterministic, so snapshots are the replay source of
// truth. Usage: recordTick() once after loadArmies (tick 0 = deployment) and
// once after every Battlefield::tick(); toJson() yields the "replay" block of
// the battle-mode output that the campaign server stores in the DB.
class ReplayRecorder {
public:
    // Snapshot every alive, placed unit of both teams and drain the
    // battlefield's tick log. Units seen for the first time are assigned the
    // next serial replay id (stored on the unit itself — see AUnit::getReplayId).
    void recordTick(Battlefield& field);

    size_t tickCount() const { return _ticks.size(); }

    // {"map": <name>, "cols": …, "rows": …, "ticks": [{tick, units: [{id,
    //  type, team, q, r, hp}], log: [...]}, …]}
    nlohmann::json toJson(const std::string& mapName) const;

private:
    // Per-tick memo of layoutHexFormation results, keyed by hex, so each
    // occupied hex is laid out once even though teams are recorded separately.
    using LayoutCache = std::unordered_map<const Hex*, std::vector<UnitPlacement>>;

    void recordTeam(nlohmann::json& units, Battlefield& field, int team,
                    LayoutCache& layouts);

    nlohmann::json _ticks = nlohmann::json::array();
    int _nextId = 0;
};
