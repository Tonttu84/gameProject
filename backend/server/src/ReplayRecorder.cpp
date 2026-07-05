#include "server/ReplayRecorder.hpp"
#include "UnitCatalog.hpp"
#include "Squad.hpp"

using json = nlohmann::json;

void ReplayRecorder::recordTeam(json& units, Battlefield& field, int team)
{
    const char* teamName = (team == REDTEAM) ? "red" : "blue";
    for (auto& u : field.getTeam(team)) {
        if (!u || !u->getAlive() || !u->getHex()) continue;
        if (u->getReplayId() < 0) u->setReplayId(_nextId++);

        std::string type = unitNameForSymbol(u->getPrintSymbol());
        if (type.empty()) type = std::string(1, u->getPrintSymbol());

        json ju = {
            {"id",   u->getReplayId()},
            {"type", type},
            {"team", teamName},
            {"q",    u->getHex()->coord.q},
            {"r",    u->getHex()->coord.r},
            {"hp",   u->getHp()},
        };

        // Formation state for the web replay's SFML-parity rendering: squad
        // identity (squad coloring) and, when engaged, which hex side the
        // unit fights on (HexDirection 0-5) at which rank. Omitted when
        // absent to keep replay documents lean.
        if (Squad* sq = u->getSquad()) ju["squad"] = sq->getName();
        if (HexSide* fs = u->getFormationSide()) {
            for (int d = 0; d < 6; ++d) {
                if (u->getHex()->sides[d] == fs) {
                    ju["side"] = d;
                    ju["rank"] = u->getEngagedRank();
                    break;
                }
            }
        }

        units.push_back(std::move(ju));
    }
}

void ReplayRecorder::recordTick(Battlefield& field)
{
    json units = json::array();
    recordTeam(units, field, REDTEAM);
    recordTeam(units, field, BLUETEAM);

    _ticks.push_back({
        {"tick",  _ticks.size()},
        {"units", std::move(units)},
        {"log",   field.takeTickLog()},
    });
}

json ReplayRecorder::toJson(const std::string& mapName) const
{
    return {
        {"map",   mapName},
        {"cols",  Battlefield::width},
        {"rows",  Battlefield::height},
        {"ticks", _ticks},
    };
}
