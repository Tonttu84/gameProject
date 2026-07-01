#include "catch.hpp"
#include "server/UnitRegistry.hpp"
#include "hex/HexGrid.hpp"
#include "Battlefield.hpp"
#include "units/Cavalry.hpp"
#include "units/Soldier.hpp"
#include "units/Horse.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

using json = nlohmann::json;

// ── buildInfoJson ─────────────────────────────────────────────────────────────

TEST_CASE("buildInfoJson: every unit entry has a placementSize > 0") {
    auto j = json::parse(buildInfoJson());
    REQUIRE(j.contains("units"));
    REQUIRE(!j["units"].empty());
    for (const auto& u : j["units"]) {
        INFO("unit: " << u["type"].get<std::string>());
        REQUIRE(u.contains("placementSize"));
        REQUIRE(u["placementSize"].get<int>() > 0);
    }
}

TEST_CASE("buildInfoJson: Cavalry placementSize equals Horse::SIZE (mount size)") {
    auto j = json::parse(buildInfoJson());
    const auto& units = j["units"];
    auto it = std::find_if(units.begin(), units.end(),
        [](const auto& u) { return u["type"] == "Cavalry"; });
    REQUIRE(it != units.end());
    REQUIRE((*it)["placementSize"].get<int>() == Horse::SIZE);
}

TEST_CASE("buildInfoJson: foot unit placementSize equals Soldier::SIZE") {
    auto j = json::parse(buildInfoJson());
    const auto& units = j["units"];
    auto it = std::find_if(units.begin(), units.end(),
        [](const auto& u) { return u["type"] == "Soldier"; });
    REQUIRE(it != units.end());
    REQUIRE((*it)["placementSize"].get<int>() == Soldier::SIZE);
}

TEST_CASE("buildInfoJson: Cavalry forbidden terrain contains Forest and Marsh") {
    auto j = json::parse(buildInfoJson());
    const auto& units = j["units"];
    auto it = std::find_if(units.begin(), units.end(),
        [](const auto& u) { return u["type"] == "Cavalry"; });
    REQUIRE(it != units.end());
    const auto& ft = (*it)["forbiddenTerrain"];
    REQUIRE(ft.is_array());
    bool hasForest = false, hasMarsh = false;
    for (const auto& t : ft) {
        if (t == "Forest") hasForest = true;
        if (t == "Marsh")  hasMarsh  = true;
    }
    REQUIRE(hasForest);
    REQUIRE(hasMarsh);
}

TEST_CASE("buildInfoJson: terrain array has 4 entries with name and # color") {
    auto j = json::parse(buildInfoJson());
    REQUIRE(j.contains("terrain"));
    REQUIRE(j["terrain"].size() == 4);
    for (const auto& t : j["terrain"]) {
        REQUIRE(t.contains("name"));
        REQUIRE(t.contains("color"));
        std::string color = t["color"].get<std::string>();
        REQUIRE(color.size() == 7);
        REQUIRE(color[0] == '#');
    }
}

TEST_CASE("buildInfoJson: grid.hexCapacity matches Hex::CAPACITY") {
    auto j = json::parse(buildInfoJson());
    REQUIRE(j.contains("grid"));
    REQUIRE(j["grid"]["hexCapacity"].get<int>() == Hex::CAPACITY);
}

// ── Map loading ───────────────────────────────────────────────────────────────

// Returns a minimal valid map JSON string (same schema as maps/sample_battle.json).
static std::string makeTestMapJson(int cols = 16, int rows = 20)
{
    json j;
    j["version"] = 1;
    j["cols"]    = cols;
    j["rows"]    = rows;
    j["hexes"]   = json::array({
        json{{"q", 5}, {"r", 3}, {"terrain", "Forest"}},
        json{{"q", 2}, {"r", 4}, {"terrain", "Marsh"}},
        json{{"q", 3}, {"r", 4}, {"terrain", "Rubble"}},
        json{{"q", 0}, {"r", 0}, {"impassable", true}},
    });
    return j.dump();
}

TEST_CASE("fromJson on map-format JSON applies terrain to existing grid") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeTestMapJson());

    REQUIRE(g.getHex({5, 3})->terrain   == TerrainType::Forest);
    REQUIRE(g.getHex({2, 4})->terrain   == TerrainType::Marsh);
    REQUIRE(g.getHex({3, 4})->terrain   == TerrainType::Rubble);
    REQUIRE(g.getHex({0, 0})->impassable == true);
    REQUIRE(g.getHex({1, 1})->terrain   == TerrainType::Open);  // untouched = default
}

TEST_CASE("fromJson: untouched hexes keep default terrain after map load") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeTestMapJson());

    // Hexes not listed in hexes[] remain Open and passable.
    for (int r = 0; r < 20; ++r) {
        for (int col = 0; col < 16; ++col) {
            int q = col - r / 2;
            Hex* h = g.getHex({q, r});
            REQUIRE(h != nullptr);
            if (q == 5 && r == 3) continue; // Forest
            if (q == 2 && r == 4) continue; // Marsh
            if (q == 3 && r == 4) continue; // Rubble
            if (q == 0 && r == 0) continue; // impassable
            REQUIRE(h->terrain == TerrainType::Open);
            REQUIRE(h->impassable == false);
        }
    }
}

// ── Player placement coordinate contract ─────────────────────────────────────

// The frontend converts visual (col, row) → axial (q, r) as:
//   q = col - floor(row / 2),  r = row
// The C++ side must then look up the hex by (q, r) and find it.

TEST_CASE("axial coords from visual offset resolve to correct hex") {
    HexGrid g;
    g.buildRect(16, 20);

    // Visual (8, 3) → axial q = 8 - 1 = 7, r = 3
    int col = 8, row = 3;
    int q = col - row / 2;  // integer division, same as frontend floor
    int r = row;

    Hex* h = g.getHex({q, r});
    REQUIRE(h != nullptr);
    REQUIRE(h->coord.q == q);
    REQUIRE(h->coord.r == r);
}

TEST_CASE("all visual-offset positions round-trip through axial lookup") {
    // Every (col, row) in a 16x20 grid must be retrievable by axial (col-row/2, row).
    HexGrid g;
    g.buildRect(16, 20);
    int missing = 0;
    for (int row = 0; row < 20; ++row) {
        for (int col = 0; col < 16; ++col) {
            int q = col - row / 2;
            Hex* h = g.getHex({q, row});
            if (!h) ++missing;
        }
    }
    REQUIRE(missing == 0);
}

TEST_CASE("player placement on map-terrain hex: unit gets correct terrain context") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeTestMapJson());

    // A unit placed at axial (5, 3) should see Forest terrain.
    Hex* h = g.getHex({5, 3});
    REQUIRE(h != nullptr);
    REQUIRE(h->terrain == TerrainType::Forest);

    // Cavalry is forbidden from Forest — this is the engine-level check the
    // C++ placement code should enforce (or at minimum the client enforces it).
    auto forbidden = forbiddenTerrainForCategory(UnitCategory::Mounted);
    bool forestForbidden = std::find(forbidden.begin(), forbidden.end(),
                                     TerrainType::Forest) != forbidden.end();
    REQUIRE(forestForbidden);
}

// ── Deployment zones (Step 5) ─────────────────────────────────────────────────

// Map with player_zone_rows [18,19] and enemy_zone_rows [0,1] on a 16×20 grid.
static std::string makeMapWithZones()
{
    json j;
    j["version"]          = 1;
    j["cols"]             = 16;
    j["rows"]             = 20;
    j["hexes"]            = json::array();
    j["player_zone_rows"] = json::array({18, 19});
    j["enemy_zone_rows"]  = json::array({0,  1 });
    return j.dump();
}

TEST_CASE("fromJson: player_zone_rows sets zone row accessors") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones());

    REQUIRE(g.playerZoneMinRow() == 18);
    REQUIRE(g.playerZoneMaxRow() == 19);
}

TEST_CASE("fromJson: enemy_zone_rows sets zone row accessors") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones());

    REQUIRE(g.enemyZoneMinRow() == 0);
    REQUIRE(g.enemyZoneMaxRow() == 1);
}

TEST_CASE("fromJson: map without zone_rows leaves zone unset") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeTestMapJson());

    REQUIRE(g.playerZoneMinRow() == -1);
    REQUIRE(g.playerZoneMaxRow() == -1);
    REQUIRE(g.enemyZoneMinRow()  == -1);
    REQUIRE(g.enemyZoneMaxRow()  == -1);
}

TEST_CASE("zone_rows survive toJson/fromJson round-trip") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones());
    std::string serialized = g.toJson(16, 20, "roundtrip");

    HexGrid g2;
    g2.buildRect(16, 20);
    g2.fromJson(serialized);

    REQUIRE(g2.playerZoneMinRow() == 18);
    REQUIRE(g2.playerZoneMaxRow() == 19);
    REQUIRE(g2.enemyZoneMinRow()  == 0);
    REQUIRE(g2.enemyZoneMaxRow()  == 1);
}

TEST_CASE("playerZone() returns all hexes whose r is in [minRow, maxRow]") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones());  // player rows 18-19

    auto pz = g.playerZone();
    REQUIRE(pz.size() == 32);  // 16 cols × 2 rows

    // Row 19, col 5 → axial q = 5 - 9 = -4
    bool found = false;
    for (const auto& c : pz)
        if (c.q == -4 && c.r == 19) { found = true; break; }
    REQUIRE(found);

    // No hex from outside the zone.
    for (const auto& c : pz)
        REQUIRE((c.r == 18 || c.r == 19));
}

TEST_CASE("enemyZone() returns all hexes whose r is in [minRow, maxRow]") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones());  // enemy rows 0-1

    auto ez = g.enemyZone();
    REQUIRE(ez.size() == 32);  // 16 cols × 2 rows

    for (const auto& c : ez)
        REQUIRE((c.r == 0 || c.r == 1));
}

TEST_CASE("playerZone() returns empty vector when no zone set") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeTestMapJson());

    REQUIRE(g.playerZone().empty());
    REQUIRE(g.enemyZone().empty());
}

// ── buildArmyFromPlacement (Step 5) ──────────────────────────────────────────

#include "server/UnitRegistry.hpp"  // already included at top; Army + buildArmyFromPlacement

TEST_CASE("buildArmyFromPlacement: correct team and hex assigned") {
    HexGrid g;
    g.buildRect(16, 20);

    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
        json{{"unit_type", "Archer"},  {"q", 4}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);

    REQUIRE(army.size() == 2);
    REQUIRE(army[0]->getTeam() == BLUETEAM);
    REQUIRE(army[0]->getHex() != nullptr);
    REQUIRE(army[0]->getHex()->coord.q == 3);
    REQUIRE(army[0]->getHex()->coord.r == 5);
}

TEST_CASE("buildArmyFromPlacement: unknown unit type is skipped") {
    HexGrid g;
    g.buildRect(16, 20);

    json placement = json::array({
        json{{"unit_type", "Dragon"},  {"q", 3}, {"r", 5}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), REDTEAM, g);

    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHex()->coord.q == 4);
    REQUIRE(army[0]->getTeam() == REDTEAM);
}

TEST_CASE("buildArmyFromPlacement: out-of-grid coord → unit is skipped") {
    HexGrid g;
    g.buildRect(16, 20);

    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 99}, {"r", 99}},  // out of grid — skipped
        json{{"unit_type", "Soldier"}, {"q", 3},  {"r", 5}},   // valid — included
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);

    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHex() != nullptr);
}

TEST_CASE("buildArmyFromPlacement: empty array returns empty army") {
    HexGrid g;
    g.buildRect(16, 20);
    auto army = buildArmyFromPlacement(json::array().dump(), BLUETEAM, g);
    REQUIRE(army.empty());
}
