#include "server/UnitRegistry.hpp"
#include "AUnit.hpp"
#include "UnitCatalog.hpp"

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

// ── Tiny JSON helpers ─────────────────────────────────────────────────────────

static std::string jsonStr(const char* s) {
    return std::string("\"") + s + "\"";
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
    // Unit types available for player placement — the catalog's placeable
    // entries, with every value read off a live instance so this can never
    // drift from the unit constructors (see UnitCatalog.hpp).
    json unitsJson = json::array();
    for (const auto& entry : unitCatalog()) {
        if (!entry.placeable) continue;
        auto u = entry.make(BLUETEAM);
        json forbidden = json::array();
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            forbidden.push_back(terrainMeta(t).name);
        unitsJson.push_back({
            {"type",             entry.typeName},
            {"symbol",           std::string(1, u->getPrintSymbol())},
            {"placementSize",    static_cast<int>(u->getSize())},
            {"category",         categoryName(u->getCategory())},
            {"forbiddenTerrain", forbidden},
        });
    }
    std::string units = unitsJson.dump();

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

// Upper bound on total requested unit size, in the same hex-capacity size-points
// Hex::CAPACITY is measured in (NOT a unit/entry count — see SECURITY_NOTES.md #4). A
// single unit can be as large as an entire hex (640 size-points), so a flat count of
// "units" doesn't bound resource usage the way a size-points budget does. Scales with
// whatever map is loaded: the whole grid could never legitimately hold more than
// hexCount() * Hex::CAPACITY size-points total, so nothing beyond that is worth
// processing regardless of team/zone. Every entry with a valid type counts toward this
// total as soon as it's constructed, even if it's later rejected for that specific hex
// (capacity/terrain/zone) — otherwise a flood of entries all targeting one full hex would
// bypass the budget entirely.
static size_t placementSizeBudget(const HexGrid& grid)
{
    return static_cast<size_t>(grid.hexCount()) * static_cast<size_t>(Hex::CAPACITY);
}

// Secondary, generous hard cap on raw entry count — defense in depth against a flood of
// minimum-size (currently as small as 10, but DESIGN.md plans size-1 creatures) units,
// which the size-points budget alone would process a lot of before exhausting.
static constexpr size_t MAX_PLACEMENT_ENTRIES = 50000;

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

    const size_t sizeBudget = placementSizeBudget(grid);
    size_t totalRequestedSize = 0;
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

        auto u = makeUnitByName(typeIt->get<std::string>(), team);
        if (!u) continue;

        int unitSize = static_cast<int>(u->getSize());
        if (totalRequestedSize + static_cast<size_t>(unitSize) > sizeBudget) break;
        totalRequestedSize += static_cast<size_t>(unitSize);

        HexCoord coord{qIt->get<int>(), rIt->get<int>()};
        Hex* h = grid.getHex(coord);

        // Reject missing or impassable hexes.
        if (!h || h->impassable) continue;

        // Reject hexes outside the placing team's deployment zone (only
        // checked when that zone exists). BLUETEAM deploys in the player
        // zone, REDTEAM (enemy_placement, campaign armies) in the enemy zone
        // — before this was team-aware, every enemy_placement entry was
        // silently dropped for being outside the PLAYER zone, leaving an
        // empty red army.
        if (team == BLUETEAM && grid.hasPlayerZone()) {
            int r = coord.r;
            if (r < grid.playerZoneMinRow() || r > grid.playerZoneMaxRow()) continue;
        }
        if (team == REDTEAM && grid.hasEnemyZone()) {
            int r = coord.r;
            if (r < grid.enemyZoneMinRow() || r > grid.enemyZoneMaxRow()) continue;
        }

        // Reject forbidden terrain for this unit category.
        bool forbidden = false;
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            if (h->terrain == t) { forbidden = true; break; }
        if (forbidden) continue;

        // Reject if placement would exceed hex capacity.
        int& used = usedPerHex[coord];
        if (used + unitSize > Hex::CAPACITY) continue;
        used += unitSize;

        // Optional hold_turns: integer >= 0. Non-integer or negative → 0.
        auto holdIt = entry.find("hold_turns");
        if (holdIt != entry.end() && holdIt->is_number_integer()) {
            int ht = holdIt->get<int>();
            if (ht > 0) u->setHoldTurns(ht);
        }

        u->setHex(h);
        u->setPlaced(true);
        army.push_back(std::move(u));
    }
    return army;
}
