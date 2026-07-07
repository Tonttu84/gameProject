#include "server/ReplayRecorder.hpp"
#include "FormationLayout.hpp"
#include "UnitCatalog.hpp"
#include "Squad.hpp"

using json = nlohmann::json;

namespace {

// Layout offsets rounded to 3 decimals — plenty for sub-hex positioning,
// keeps tick documents lean.
double round3(float v) { return std::round(v * 1000.f) / 1000.0; }

} // namespace

void ReplayRecorder::recordTeam(json& units, Battlefield& field, int team,
                                LayoutCache& layouts)
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

        // In-hex layout from the shared FormationLayout — the web replay
        // reproduces formations exactly by drawing center + offset * hexSize.
        // ox/oy are offsets from the hex centre and sz the glyph size, all in
        // hex-radius units.
        const Hex* hex = u->getHex();
        auto cached = layouts.find(hex);
        if (cached == layouts.end())
            cached = layouts.emplace(hex, layoutHexFormation(*hex)).first;
        for (const UnitPlacement& p : cached->second) {
            if (p.unit != u.get()) continue;
            ju["ox"] = round3(p.ox);
            ju["oy"] = round3(p.oy);
            ju["sz"] = round3(p.scale);
            break;
        }

        // Formation FACTS (not layout): squad identity for coloring and,
        // when engaged, which hex side the unit fights on (HexDirection 0-5)
        // at which rank — queryable/testable state; the web replay styles by
        // rank but no longer derives positions from it. Omitted when absent
        // to keep replay documents lean.
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

        // Visual-state cues the SFML renderer showed and ReplayView now mirrors:
        // a broken unit routs (drawn orange), a casting unit is mid-spell (yellow).
        // Omitted at their defaults (not broken / not casting) to keep docs lean.
        if (u->getBroken())    ju["broken"] = true;
        if (u->getCast() != 0) ju["cast"]   = u->getCast();

        units.push_back(std::move(ju));
    }
}

void ReplayRecorder::recordTick(Battlefield& field)
{
    json units = json::array();
    LayoutCache layouts; // one layout per occupied hex per tick
    recordTeam(units, field, REDTEAM, layouts);
    recordTeam(units, field, BLUETEAM, layouts);

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
