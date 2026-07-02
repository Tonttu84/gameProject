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
#include <unordered_map>

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

// Upper bound on how many placement entries a single request will process (see
// SECURITY_NOTES.md #4). Comfortably above any legitimate army (the built-in default
// armies top out around 700 units) and far below what would make per-entry unit
// allocation a viable resource-exhaustion vector.
static constexpr size_t MAX_PLACEMENT_ENTRIES = 5000;

Army buildArmyFromPlacement(const std::string& placementJson, int team, HexGrid& grid)
{
    Army army;

    json j;
    try {
        j = json::parse(placementJson);
    } catch (const json::parse_error&) {
        return army; // malformed JSON — treat as no placements rather than throwing
    }
    if (!j.is_array()) return army;

    // Track capacity used per hex during this placement pass (sizeUsed on the
    // Hex struct is only updated by setHex/clearHex during the battle itself).
    std::unordered_map<HexCoord, int, HexCoordHash> usedPerHex;

    size_t processed = 0;
    for (const auto& entry : j) {
        if (processed++ >= MAX_PLACEMENT_ENTRIES) break;

        // SECURITY (see SECURITY_NOTES.md #3): entry is attacker-controlled — validate
        // shape/types before touching a field, rather than letting operator[]/.get<T>()
        // throw on a missing key or wrong type.
        if (!entry.is_object()) continue;
        auto typeIt = entry.find("unit_type");
        auto qIt    = entry.find("q");
        auto rIt    = entry.find("r");
        if (typeIt == entry.end() || !typeIt->is_string()) continue;
        if (qIt == entry.end() || !qIt->is_number_integer()) continue;
        if (rIt == entry.end() || !rIt->is_number_integer()) continue;

        auto u = makeUnit(typeIt->get<std::string>(), team);
        if (!u) continue;

        HexCoord coord{qIt->get<int>(), rIt->get<int>()};
        Hex* h = grid.getHex(coord);

        // Reject missing or impassable hexes.
        if (!h || h->impassable) continue;

        // Reject hexes outside the player zone (only checked when a zone exists).
        if (grid.hasPlayerZone()) {
            int r = coord.r;
            if (r < grid.playerZoneMinRow() || r > grid.playerZoneMaxRow()) continue;
        }

        // Reject forbidden terrain for this unit category.
        bool forbidden = false;
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            if (h->terrain == t) { forbidden = true; break; }
        if (forbidden) continue;

        // Reject if placement would exceed hex capacity.
        int& used = usedPerHex[coord];
        int unitSize = static_cast<int>(u->getSize());
        if (used + unitSize > Hex::CAPACITY) continue;
        used += unitSize;

        u->setHex(h);
        u->setPlaced(true);
        army.push_back(std::move(u));
    }
    return army;
}
