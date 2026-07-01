#include "server/UnitRegistry.hpp"
#include "AUnit.hpp"
#include "units/Soldier.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "units/Priest.hpp"
#include "units/Necromancer.hpp"
#include "units/Cavalry.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <cstdio>
#include <string>

using json = nlohmann::json;

// ── Unit factory ──────────────────────────────────────────────────────────────

static std::unique_ptr<AUnit> makeUnit(const std::string& type, int team)
{
    if (type == "Soldier")    return std::make_unique<Soldier>(team);
    if (type == "Archer")     return std::make_unique<Archer>(team);
    if (type == "Mage")       return std::make_unique<Mage>(team);
    if (type == "Priest")     return std::make_unique<Priest>(team);
    if (type == "Cavalry")    return std::make_unique<Cavalry>(team);
    if (type == "Necromancer")return std::make_unique<Necromancer>(team);
    return nullptr;
}

// ── Tiny JSON helpers ─────────────────────────────────────────────────────────

static std::string jsonStr(const char* s) {
    return std::string("\"") + s + "\"";
}

static std::string forbiddenTerrainJson(UnitCategory cat)
{
    auto vec = forbiddenTerrainForCategory(cat);
    if (vec.empty()) return "[]";
    std::string s = "[";
    for (size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) s += ",";
        s += "\"";
        s += terrainMeta(vec[i]).name;
        s += "\"";
    }
    return s + "]";
}

static std::string jsonEntry(const char* type, const char* symbol,
                              int placementSize, const char* category,
                              UnitCategory cat)
{
    char buf[256];
    std::snprintf(buf, sizeof(buf),
        "{\"type\":%s,\"symbol\":%s,\"placementSize\":%d,\"category\":%s,\"forbiddenTerrain\":%s}",
        jsonStr(type).c_str(),
        jsonStr(symbol).c_str(),
        placementSize,
        jsonStr(category).c_str(),
        forbiddenTerrainJson(cat).c_str());
    return buf;
}

static std::string jsonTerrainEntry(int idx)
{
    const TerrainMeta& m = TERRAIN_META[idx];
    char buf[128];
    std::snprintf(buf, sizeof(buf),
        "{\"id\":%d,\"name\":%s,\"color\":\"#%02x%02x%02x\"}",
        idx,
        jsonStr(m.name).c_str(),
        m.r, m.g, m.b);
    return buf;
}

// ── Public API ────────────────────────────────────────────────────────────────

std::string buildInfoJson()
{
    // Unit types available for player placement.
    // forbidden terrain is derived from forbiddenTerrainForCategory() — no hardcoded strings.
    std::string units =
        "[" +
        jsonEntry("Soldier", "X", Soldier::SIZE, "Foot",    UnitCategory::Foot)    + "," +
        jsonEntry("Archer",  "A", Archer::SIZE,  "Foot",    UnitCategory::Foot)    + "," +
        jsonEntry("Mage",    "M", Mage::SIZE,    "Foot",    UnitCategory::Foot)    + "," +
        jsonEntry("Priest",  "P", Priest::SIZE,  "Foot",    UnitCategory::Foot)    + "," +
        jsonEntry("Cavalry", "C", Cavalry::SIZE, "Mounted", UnitCategory::Mounted) +
        "]";

    // Terrain metadata — indices match TerrainType enum values.
    std::string terrains =
        "[" +
        jsonTerrainEntry(static_cast<int>(TerrainType::Open))   + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Forest)) + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Marsh))  + "," +
        jsonTerrainEntry(static_cast<int>(TerrainType::Rubble)) +
        "]";

    char buf[2048];
    std::snprintf(buf, sizeof(buf),
        "{"
        "\"grid\":{\"width\":%d,\"height\":%d,\"hexCapacity\":%d},"
        "\"playerZone\":{\"rowMin\":0,\"rowMax\":%d},"
        "\"enemyZone\":{\"rowMin\":%d,\"rowMax\":%d},"
        "\"units\":%s,"
        "\"terrain\":%s"
        "}",
        Battlefield::width,
        Battlefield::height,
        Hex::CAPACITY,
        Battlefield::height / 4,
        Battlefield::height * 3 / 4,
        Battlefield::height - 1,
        units.c_str(),
        terrains.c_str());

    return buf;
}

// ── buildArmyFromPlacement ────────────────────────────────────────────────────

Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid)
{
    Army army;
    json j = json::parse(placementJson);
    for (const auto& entry : j) {
        auto u = makeUnit(entry["unit_type"].get<std::string>(), team);
        if (!u) continue;
        Hex* h = grid.getHex({entry["q"].get<int>(), entry["r"].get<int>()});
        if (h) { u->setHex(h); u->setPlaced(true); }
        army.push_back(std::move(u));
    }
    return army;
}
