#include "catch.hpp"
#include "server/UnitRegistry.hpp"
#include "server/BattleServer.hpp"
#include "hex/HexGrid.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "units/Cavalry.hpp"
#include "units/Soldier.hpp"
#include "units/Horse.hpp"
#include "Squad.hpp"

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

// The campaign layer's raid party-builder needs per-unit speed client-side,
// so the placement info exports it alongside placementSize (same live-instance
// read as the catalog — it can never drift from the constructors).
TEST_CASE("buildInfoJson: every unit entry exports its movement speed") {
    auto j = json::parse(buildInfoJson());
    REQUIRE(!j["units"].empty());
    for (const auto& u : j["units"]) {
        INFO("unit: " << u["type"].get<std::string>());
        REQUIRE(u.contains("speed"));
        REQUIRE(u["speed"].is_number_integer());
        REQUIRE(u["speed"].get<int>() >= 1);
    }
    auto speedOf = [&](const char* type) {
        for (const auto& u : j["units"])
            if (u["type"] == type) return u["speed"].get<int>();
        FAIL("missing type: " << type);
        return -1;
    };
    REQUIRE(speedOf("Soldier") == 10);
    REQUIRE(speedOf("Cavalry") == 28);
    REQUIRE(speedOf("LightCavalry") == 28);
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

TEST_CASE("playerZone() returns all hexes whose r is in (minRow..maxRow)") {
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

TEST_CASE("enemyZone() returns all hexes whose r is in (minRow..maxRow)") {
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

// Regression: the zone check must be per-team. It used to test every entry
// against the PLAYER zone, which silently dropped every enemy_placement
// entry (they are in the enemy zone by construction) and produced an empty
// red army — battles "won" in two ticks against nobody.
TEST_CASE("buildArmyFromPlacement: each team is confined to its own deployment zone") {
    HexGrid g;
    g.buildRect(16, 20);
    g.fromJson(makeMapWithZones()); // player rows 18-19, enemy rows 0-1

    json blue = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3 - 9}, {"r", 18}},  // in player zone → kept
        json{{"unit_type", "Soldier"}, {"q", 3},     {"r", 0}},   // enemy zone → rejected
        json{{"unit_type", "Soldier"}, {"q", 3},     {"r", 10}},  // no-man's land → rejected
    });
    auto blueArmy = buildArmyFromPlacement(blue.dump(), BLUETEAM, g);
    REQUIRE(blueArmy.size() == 1);
    REQUIRE(blueArmy[0]->getHex()->coord.r == 18);

    json red = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3},     {"r", 0}},   // in enemy zone → kept
        json{{"unit_type", "Soldier"}, {"q", 3 - 9}, {"r", 18}},  // player zone → rejected
        json{{"unit_type", "Soldier"}, {"q", 3},     {"r", 10}},  // no-man's land → rejected
    });
    auto redArmy = buildArmyFromPlacement(red.dump(), REDTEAM, g);
    REQUIRE(redArmy.size() == 1);
    REQUIRE(redArmy[0]->getHex()->coord.r == 0);
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

// ── applyFortifiedSides (Stage 3 battle-input seam) ──────────────────────────

TEST_CASE("applyFortifiedSides: marks exactly the named sides fortified with durability") {
    HexGrid g;
    g.buildRect(16, 20);

    // {5,5} and {6,6} are interior — all 6 sides exist.
    json forts = json::array({
        json{{"q", 5}, {"r", 5}, {"dir", "NE"}, {"durability", 120}},
        json{{"q", 6}, {"r", 6}, {"dir", "SW"}, {"durability", 200}},
    });
    int applied = applyFortifiedSides(forts.dump(), g);
    REQUIRE(applied == 2);

    HexSide* a = g.getSide({5, 5}, HexDirection::NE);
    REQUIRE(a != nullptr);
    REQUIRE(a->fortified == true);
    REQUIRE(a->fortifiedDefender == g.getHex({5, 5}));  // the {q,r} hex is the defender
    REQUIRE(a->fortDurability == 120);

    HexSide* b = g.getSide({6, 6}, HexDirection::SW);
    REQUIRE(b != nullptr);
    REQUIRE(b->fortified == true);
    REQUIRE(b->fortifiedDefender == g.getHex({6, 6}));
    REQUIRE(b->fortDurability == 200);

    // A side not named stays unfortified.
    HexSide* c = g.getSide({5, 5}, HexDirection::E);
    REQUIRE(c != nullptr);
    REQUIRE(c->fortified == false);
}

TEST_CASE("applyFortifiedSides: durability defaults to DEFAULT_FORT_DURABILITY when omitted") {
    HexGrid g;
    g.buildRect(16, 20);
    json forts = json::array({ json{{"q", 5}, {"r", 5}, {"dir", "E"}} });
    REQUIRE(applyFortifiedSides(forts.dump(), g) == 1);

    HexSide* s = g.getSide({5, 5}, HexDirection::E);
    REQUIRE(s != nullptr);
    REQUIRE(s->fortified == true);
    REQUIRE(s->fortDurability == DEFAULT_FORT_DURABILITY);
}

TEST_CASE("applyFortifiedSides: malformed/invalid entries are skipped, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    json forts = json::array({
        42,                                                     // not an object
        json{{"q", 5}, {"r", 5}},                                // missing dir
        json{{"q", 5}, {"r", 5}, {"dir", "UP"}},                 // bad dir name
        json{{"q", "x"}, {"r", 5}, {"dir", "NE"}},               // wrong-typed q
        json{{"q", 999}, {"r", 999}, {"dir", "NE"}},             // off-grid hex
        json{{"q", 5}, {"r", 5}, {"dir", "SE"}},                 // valid — the only one applied
    });
    int applied = 0;
    REQUIRE_NOTHROW(applied = applyFortifiedSides(forts.dump(), g));
    REQUIRE(applied == 1);
    REQUIRE(g.getSide({5, 5}, HexDirection::SE)->fortified == true);
    REQUIRE(g.getSide({5, 5}, HexDirection::NE)->fortified == false);
}

TEST_CASE("applyFortifiedSides: malformed top-level JSON / non-array is a no-op, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    int applied = 1;
    REQUIRE_NOTHROW(applied = applyFortifiedSides("{not valid json", g));
    REQUIRE(applied == 0);
    REQUIRE_NOTHROW(applied = applyFortifiedSides(json{{"dir", "NE"}}.dump(), g)); // object, not array
    REQUIRE(applied == 0);
}

// The engine already implements the fortified-side combat penalty; this pins the
// contract the Stage 3 seam relies on: an attacker engaged across a side whose
// fortifiedDefender is the ENEMY hex eats FORTIFIED_ATK_PENALTY, and it does NOT
// apply when the fortification protects the attacker's own hex.
TEST_CASE("fortified side: attacker crossing into the defender's work eats the attack penalty") {
    Battlefield bf;
    Hex* atkHex = bf.hexGrid.getHex({1, 14});
    Hex* defHex = bf.hexGrid.getHex({1, 13});
    REQUIRE(atkHex != nullptr);
    REQUIRE(defHex != nullptr);

    HexSide side;
    side.hexA = atkHex;
    side.hexB = defHex;

    Soldier attacker(REDTEAM);
    attacker.setHex(atkHex);
    attacker.setEngagedSide(&side);

    // A defender engaged on the same side, so the undefended-side bonus does NOT
    // muddy the baseline (baseline attack bonus = 0).
    Soldier defender(BLUETEAM);
    defender.setHex(defHex);
    defender.setEngagedSide(&side);

    REQUIRE(attacker.computeMeleeAttackBonus() == 0);

    // Fortify the side in favor of the defender's hex → attacker eats the penalty.
    side.fortified        = true;
    side.fortifiedDefender = defHex;
    REQUIRE(attacker.computeMeleeAttackBonus() == -FORTIFIED_ATK_PENALTY);

    // A fort protecting the attacker's OWN hex gives the attacker no penalty.
    side.fortifiedDefender = atkHex;
    REQUIRE(attacker.computeMeleeAttackBonus() == 0);
}

// ── SECURITY_NOTES.md #1: path traversal ─────────────────────────────────────

TEST_CASE("isSafeMapName: rejects parent-directory traversal") {
    REQUIRE_FALSE(isSafeMapName(".."));
    REQUIRE_FALSE(isSafeMapName("../../etc/passwd"));
    REQUIRE_FALSE(isSafeMapName("foo/../../bar"));
}

TEST_CASE("isSafeMapName: rejects path separators") {
    REQUIRE_FALSE(isSafeMapName("sub/dir"));
    REQUIRE_FALSE(isSafeMapName("sub\\dir"));
    REQUIRE_FALSE(isSafeMapName("/etc/passwd"));
}

TEST_CASE("isSafeMapName: rejects empty name") {
    REQUIRE_FALSE(isSafeMapName(""));
}

TEST_CASE("isSafeMapName: accepts a normal map name") {
    REQUIRE(isSafeMapName("sample_battle"));
    REQUIRE(isSafeMapName("my-map_2"));
}

// ── SECURITY_NOTES.md #3, #4: malformed/oversized placement JSON ────────────

TEST_CASE("buildArmyFromPlacement: entry missing unit_type is skipped, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"q", 3}, {"r", 5}},                                    // missing unit_type
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}},          // valid
    });
    Army army;
    REQUIRE_NOTHROW(army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g));
    REQUIRE(army.size() == 1);
}

TEST_CASE("buildArmyFromPlacement: wrong-typed q/r is skipped, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", "not-a-number"}, {"r", 5}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}},          // valid
    });
    Army army;
    REQUIRE_NOTHROW(army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g));
    REQUIRE(army.size() == 1);
}

TEST_CASE("buildArmyFromPlacement: non-object array entry is skipped, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({ 42, "oops", json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}} });
    Army army;
    REQUIRE_NOTHROW(army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g));
    REQUIRE(army.size() == 1);
}

TEST_CASE("buildArmyFromPlacement: malformed top-level JSON returns empty army, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    Army army;
    REQUIRE_NOTHROW(army = buildArmyFromPlacement("{not valid json", BLUETEAM, g));
    REQUIRE(army.empty());
}

TEST_CASE("buildArmyFromPlacement: non-array top-level JSON returns empty army, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    Army army;
    REQUIRE_NOTHROW(army = buildArmyFromPlacement(json{{"unit_type", "Soldier"}}.dump(), BLUETEAM, g));
    REQUIRE(army.empty());
}

// The size-points budget must be measured in size-points, not raw entry/unit count —
// hex capacity itself is size-points (Hex::CAPACITY = 640), and a future unit could be as
// large as a full hex. This test proves the budget is consumed by *requested* size
// regardless of whether a given entry is ultimately placeable, by exhausting it entirely
// with entries that (beyond the first 64) all fail the per-hex capacity check anyway —
// then showing a handful of entries at a completely different, empty hex are never
// reached, even though that hex has ample room on its own.
TEST_CASE("buildArmyFromPlacement: total requested size-points, not entry count, is capped") {
    HexGrid g;
    g.buildRect(16, 20); // 320 hexes * 640 capacity = 204800 size-point budget

    json placement = json::array();
    // Batch 1: 20480 Soldier (size 10) entries all targeting hex (3,5) = 204800
    // size-points requested. Only the first 64 (640/10) can ever be placed there.
    for (int i = 0; i < 20480; ++i)
        placement.push_back(json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}});
    // Batch 2: a few entries at an entirely different, untouched hex with room to spare.
    for (int i = 0; i < 5; ++i)
        placement.push_back(json{{"unit_type", "Soldier"}, {"q", 7}, {"r", 7}});

    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);

    int atFirstHex = 0, atSecondHex = 0;
    for (const auto& u : army) {
        if (u->getHex()->coord.q == 3 && u->getHex()->coord.r == 5) ++atFirstHex;
        if (u->getHex()->coord.q == 7 && u->getHex()->coord.r == 7) ++atSecondHex;
    }
    REQUIRE(atFirstHex == Hex::CAPACITY / Soldier::SIZE); // that one hex filled to capacity
    REQUIRE(atSecondHex == 0); // never reached — size-points budget exhausted by batch 1
}

TEST_CASE("buildArmyFromPlacement: legitimate armies well within grid capacity are unaffected") {
    HexGrid g;
    g.buildRect(16, 20);

    // The built-in default enemy army (540+150+11 = 701 units) is representative of a
    // real request — must place in full, nowhere near either cap.
    json placement = json::array();
    for (int i = 0; i < 701; ++i) {
        int col = i % 16, row = i % 20;
        int q = col - row / 2; // visual offset → axial, same conversion the frontend uses
        placement.push_back(json{{"unit_type", "Soldier"}, {"q", q}, {"r", row}});
    }

    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 701);
}

// ── SECURITY_NOTES.md #7: invalid deployment zone rows ───────────────────────

TEST_CASE("fromJson: negative zone rows are rejected, zone stays unset") {
    HexGrid g;
    g.buildRect(16, 20);
    json j;
    j["cols"] = 16; j["rows"] = 20;
    j["player_zone_rows"] = json::array({-1, 5});
    g.fromJson(j.dump());
    REQUIRE(g.hasPlayerZone() == false);
}

TEST_CASE("fromJson: inverted zone rows (min > max) are rejected, zone stays unset") {
    HexGrid g;
    g.buildRect(16, 20);
    json j;
    j["cols"] = 16; j["rows"] = 20;
    j["enemy_zone_rows"] = json::array({10, 2});
    g.fromJson(j.dump());
    REQUIRE(g.hasEnemyZone() == false);
}

// ── SECURITY_NOTES.md #3, #8: malformed/oversized map JSON ───────────────────

TEST_CASE("fromJson: hex entry missing q or r is skipped, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    json j;
    j["cols"] = 16; j["rows"] = 20;
    j["hexes"] = json::array({
        json{{"q", 3}, {"terrain", "Forest"}},                    // missing r — skipped
        json{{"q", 5}, {"r", 5}, {"terrain", "Forest"}},          // valid
    });
    REQUIRE_NOTHROW(g.fromJson(j.dump()));
    REQUIRE(g.getHex({5, 5})->terrain == TerrainType::Forest);
}

TEST_CASE("fromJson: malformed top-level JSON is a no-op, not thrown") {
    HexGrid g;
    g.buildRect(16, 20);
    REQUIRE_NOTHROW(g.fromJson("{not valid json"));
    REQUIRE(g.getHex({0, 0}) != nullptr); // grid untouched, still usable
}

TEST_CASE("fromJson: oversized cols/rows on an empty grid leaves it unbuilt, not thrown") {
    HexGrid g; // never built — fromJson must build it itself
    json j;
    j["cols"] = 1000000000;
    j["rows"] = 1000000000;
    REQUIRE_NOTHROW(g.fromJson(j.dump()));
    REQUIRE(g.hexCount() == 0);
}

TEST_CASE("fromJson: negative cols/rows on an empty grid leaves it unbuilt, not thrown") {
    HexGrid g;
    json j;
    j["cols"] = -5;
    j["rows"] = 20;
    REQUIRE_NOTHROW(g.fromJson(j.dump()));
    REQUIRE(g.hexCount() == 0);
}

TEST_CASE("fromJson: cols/rows within bounds still builds normally") {
    HexGrid g;
    json j;
    j["cols"] = 16;
    j["rows"] = 20;
    g.fromJson(j.dump());
    REQUIRE(g.hexCount() == 16 * 20);
}

// ── hold_turns in placement JSON ──────────────────────────────────────────────

TEST_CASE("buildArmyFromPlacement: hold_turns is applied when present") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"hold_turns", 4}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHoldTurns() == 4);
}

TEST_CASE("buildArmyFromPlacement: missing hold_turns defaults to 0") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHoldTurns() == 0);
}

TEST_CASE("buildArmyFromPlacement: negative hold_turns is clamped to 0") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"hold_turns", -3}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHoldTurns() == 0);
}

TEST_CASE("buildArmyFromPlacement: non-integer hold_turns is ignored, unit still placed with holdTurns=0") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"hold_turns", "forever"}},
        json{{"unit_type", "Archer"},  {"q", 4}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 2);
    REQUIRE(army[0]->getHoldTurns() == 0);
}

// ── squad_id / squad_name in placement JSON (persistent campaign squads) ──────

TEST_CASE("buildArmyFromPlacement: squad_id/squad_name are applied when present") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"squad_name", "1st Cohort"}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getSquadId() == 7);
    REQUIRE(army[0]->getSquadName() == "1st Cohort");
}

TEST_CASE("buildArmyFromPlacement: missing squad_id defaults to unassigned (0)") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getSquadId() == 0);
}

TEST_CASE("buildArmyFromPlacement: squad_id 0 or negative is treated as unassigned") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 0}},
        json{{"unit_type", "Archer"},  {"q", 3}, {"r", 5}, {"squad_id", -1}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 2);
    REQUIRE(army[0]->getSquadId() == 0);
    REQUIRE(army[1]->getSquadId() == 0);
}

// ── squad_mods in placement JSON (campaign squad upgrades, slice 4b) ─────────
//
// The campaign layer attaches these server-side from a squad's taken upgrades.
// The browser never sends its own, so these cases are as much about what a
// FORGED one cannot do as about what a legitimate one does.

TEST_CASE("buildArmyFromPlacement: squad_mods apply flat stat modifiers") {
    HexGrid g;
    g.buildRect(16, 20);
    json plain = json::array({ json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}} });
    auto base = buildArmyFromPlacement(plain.dump(), BLUETEAM, g);
    REQUIRE(base.size() == 1);
    const int baseAttack = base[0]->getAttackPWR();
    const int baseArmour = base[0]->getArmour();

    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_mods", json{{"attack", 1}, {"armour", 1}}}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getAttackPWR() == baseAttack + 1);
    REQUIRE(army[0]->getArmour() == baseArmour + 1);
}

// accuracy is DERIVED from ballisticSkill (accuracy = bs * 5). Writing the
// member directly would leave the two disagreeing, so the mod must go through
// setBallisticSkill — this is the test that catches that regression.
TEST_CASE("buildArmyFromPlacement: a ballisticSkill mod carries accuracy with it") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Archer"}, {"q", 3}, {"r", 5},
             {"squad_mods", json{{"ballisticSkill", 1}}}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getAccuracy() == army[0]->getBallisticSkill() * 5);
}

TEST_CASE("buildArmyFromPlacement: unknown or malformed squad_mods are inert") {
    HexGrid g;
    g.buildRect(16, 20);
    json plain = json::array({ json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}} });
    auto base = buildArmyFromPlacement(plain.dump(), BLUETEAM, g);
    const int baseAttack = base[0]->getAttackPWR();

    json placement = json::array({
        // a stat the engine does not know, a non-integer value, and a
        // squad_mods that is not an object at all
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_mods", json{{"charisma", 5}, {"attack", "lots"}}}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}, {"squad_mods", "attack"}},
        json{{"unit_type", "Soldier"}, {"q", 5}, {"r", 5}, {"squad_mods", json::array({1, 2})}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 3);
    for (const auto& u : army) REQUIRE(u->getAttackPWR() == baseAttack);
}

// ── squad_abilities in placement JSON (banners, slice 6 decision 6-7) ───────
//
// The campaign layer attaches these server-side from the banner bound to the
// unit's squad. The engine learns the word `fearless` and never the word
// `banner`, so these cases speak the ability vocabulary only — and, like
// squad_mods above, they are as much about what a FORGED one cannot do.

TEST_CASE("buildArmyFromPlacement: squad_abilities land in the GRANTED set") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_abilities", json::array({"fearless"})}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    // Granted, not innate: what a banner gave must stay separable from what the
    // creature is, or revoking it would strip the creature's own nature too.
    REQUIRE(hasAbilityFlag(army[0]->getGrantedAbilities(), UnitAbility::Fearless));
    REQUIRE(army[0]->getInnateAbilities() == UnitAbility::None);
}

TEST_CASE("buildArmyFromPlacement: a granted ability only bites inside the squad") {
    // buildArmyFromPlacement does not form squads (that happens later), so this
    // is also the case that pins 6-6: parsed but unattached grants nothing.
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_abilities", json::array({"fearless"})}},
    });
    // Declared before the army so it outlives its members: ~Squad does not
    // clear members' back-pointers, so a Squad dying first leaves the units'
    // destructors calling leaveSquad() on freed memory.
    Squad sq("Household");
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE_FALSE(army[0]->hasAbility(UnitAbility::Fearless));

    sq.addMember(army[0].get());
    REQUIRE(army[0]->hasAbility(UnitAbility::Fearless));
}

TEST_CASE("buildArmyFromPlacement: unknown or malformed squad_abilities are inert") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        // a name the engine does not know, a non-string entry, a
        // squad_abilities that is not an array, and an empty array
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_abilities", json::array({"invincible", 7})}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}, {"squad_abilities", "fearless"}},
        json{{"unit_type", "Soldier"}, {"q", 5}, {"r", 5}, {"squad_abilities", json::array()}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 3);
    for (const auto& u : army) REQUIRE(u->getGrantedAbilities() == UnitAbility::None);
}

TEST_CASE("buildArmyFromPlacement: a granted flag still closes through the table") {
    // Nothing grants Mindless today, but the closure must not care where a flag
    // came from — otherwise a future granted flag would silently skip its
    // implications.
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_abilities", json::array({"mindless"})}},
    });
    Squad sq("Sworn");  // must outlive its members
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    sq.addMember(army[0].get());
    REQUIRE(army[0]->hasAbility(UnitAbility::Fearless));
}

// ── formationFighter: the real-vs-packing size split (slice 4c) ──────────────
//
// The rule the split encodes (user, 2026-08-18): does a caller measure ROOM ON
// THE GROUND, or THE MAN? These pin the two halves apart, because a call site
// that quietly picks the wrong one is a balance bug nothing else would catch.

TEST_CASE("formationFighter: packing size shrinks, real size does not") {
    Soldier s(BLUETEAM);
    const size_t real = s.getSize();
    REQUIRE(s.getPackingSize() == real);

    REQUIRE(s.applyStatMod("formationFighter", 2));
    REQUIRE(s.getSize() == real);          // the man is unchanged — food, raid
                                            // cost and the drawn glyph follow this
    REQUIRE(s.getPackingSize() == real - 2); // the room he takes is not
}

// The adjustment runs BOTH WAYS: a long weapon can make a man occupy more room
// just as drill can make him occupy less, so nothing may assume packing ≤ real.
TEST_CASE("formationFighter: a negative value packs LOOSER than real size") {
    Soldier s(BLUETEAM);
    const size_t real = s.getSize();
    REQUIRE(s.applyStatMod("formationFighter", -3));
    REQUIRE(s.getPackingSize() == real + 3);
    REQUIRE(s.getSize() == real);
}

// A packing size of 0 is not "very tight" — it is UNLIMITED, because every
// capacity and frontage gate is `used + size > cap`, which a zero always
// passes. The floor is 1 rather than something proportional deliberately: no
// real unit wants more than half, but a hard rule at half would fence off a
// modder doing something crazy (user, 2026-08-18).
TEST_CASE("formationFighter: packing size floors at 1, never 0") {
    Soldier s(BLUETEAM);
    REQUIRE(s.applyStatMod("formationFighter", AUnit::MAX_STAT_MOD));
    REQUIRE(s.applyStatMod("formationFighter", AUnit::MAX_STAT_MOD));
    REQUIRE(s.getPackingSize() >= 1);
}

TEST_CASE("buildArmyFromPlacement: a formationFighter mod packs more bodies into a hex") {
    HexGrid g;
    g.buildRect(16, 20);

    // Fill one hex with plain Soldiers (size 10, capacity 640 → 64 fit), then
    // the same request with formation fighter 2 (packing 8 → 80 fit).
    auto fillHex = [&](int mod) {
        json placement = json::array();
        for (int i = 0; i < 100; ++i) {
            json e{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}};
            if (mod) e["squad_mods"] = json{{"formationFighter", mod}};
            placement.push_back(e);
        }
        return buildArmyFromPlacement(placement.dump(), BLUETEAM, g).size();
    };

    REQUIRE(fillHex(0) == 64);
    REQUIRE(fillHex(2) == 80);
}

// The ordering this depends on is easy to break: squad_mods must be parsed
// BEFORE the per-hex capacity accounting, or a drilled squad never fits the
// extra bodies it just paid a permanent slot for.
TEST_CASE("buildArmyFromPlacement: a placed unit charges its hex the PACKING size") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_mods", json{{"formationFighter", 2}}}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 1);
    REQUIRE(army[0]->getHex() != nullptr);
    REQUIRE(army[0]->getHex()->sizeUsed == 8);
}

// The trust boundary: placement JSON is attacker-controlled, so a forged mod
// must be bounded rather than believed.
TEST_CASE("buildArmyFromPlacement: a hostile squad_mods is clamped, not obeyed") {
    HexGrid g;
    g.buildRect(16, 20);
    json plain = json::array({ json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}} });
    auto base = buildArmyFromPlacement(plain.dump(), BLUETEAM, g);
    const int baseAttack = base[0]->getAttackPWR();

    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5},
             {"squad_mods", json{{"attack", 1000000}}}},
        // Driving a stat negative is the other half of the same attack: speed
        // floors at 1 so a unit always advances, rather than freezing or
        // walking backwards through the movement bank.
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5},
             {"squad_mods", json{{"speed", -1000000}, {"attack", -1000000}}}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 2);
    REQUIRE(army[0]->getAttackPWR() == baseAttack + AUnit::MAX_STAT_MOD);
    REQUIRE(army[1]->getMovementSpeed() >= 1);
    REQUIRE(army[1]->getAttackPWR() >= 0);
}

// ── buildSquadsFromArmy: explicit squad_id grouping ────────────────────────────

// NOTE on declaration order below: `squads` (vector<unique_ptr<Squad>>) is
// declared BEFORE `army` (vector<unique_ptr<AUnit>>) in every test here, so
// that C++'s reverse-destruction-order destroys `army` FIRST. AUnit::~AUnit()
// calls leaveSquad() -> Squad::removeMember(), which dereferences the unit's
// live _squad pointer — that Squad must still be alive when a member unit is
// destroyed, or it's a use-after-free. This mirrors how Team (Battlefield.hpp)
// declares its `squads` member before `units` for exactly the same reason.

TEST_CASE("buildSquadsFromArmy: mixed-type placement entries sharing one squad_id become one squad") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"squad_name", "Vanguard"}},
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"squad_name", "Vanguard"}},
        json{{"unit_type", "Archer"},  {"q", 3}, {"r", 5}, {"squad_id", 7}, {"squad_name", "Vanguard"}},
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    REQUIRE(squads.size() == 1);
    REQUIRE(squads[0]->getName() == "Vanguard");
    REQUIRE(squads[0]->totalCount() == 3);
    for (const auto& u : army)
        REQUIRE(squads[0]->hasMember(u.get()));
}

TEST_CASE("buildSquadsFromArmy: a lone tagged unit still forms a squad (unlike untagged loners)") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"squad_name", "Lonesome"}},
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    REQUIRE(squads.size() == 1);
    REQUIRE(squads[0]->totalCount() == 1);
}

TEST_CASE("buildSquadsFromArmy: untagged same-type stacks keep the original ad hoc behavior") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
        json{{"unit_type", "Archer"},  {"q", 3}, {"r", 5}}, // lone archer — no squad
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    REQUIRE(squads.size() == 1); // only the 2-soldier stack forms a squad
    REQUIRE(squads[0]->totalCount() == 2);
}

TEST_CASE("buildSquadsFromArmy: squad-level hold order is set once from the tagged entries") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"hold_turns", 4}},
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}, {"hold_turns", 4}},
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    REQUIRE(squads.size() == 1);
    REQUIRE(squads[0]->getHoldTurns() == 4);
}

// ── squadSurvivorJson (blue_squads/red_squads battle-output contract) ─────────

TEST_CASE("squadSurvivorJson: buckets tagged survivors by squadId, untagged ones are skipped") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}},
        json{{"unit_type", "Archer"},  {"q", 3}, {"r", 5}, {"squad_id", 7}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}}, // untagged — excluded
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    json out = squadSurvivorJson(army);
    REQUIRE(out.size() == 1); // only squadId 7 appears
    REQUIRE(out["7"]["survivors"]["Soldier"] == 1);
    REQUIRE(out["7"]["survivors"]["Archer"]  == 1);
    REQUIRE(out["7"]["wiped"] == false); // both still attached to their live Squad
}

TEST_CASE("squadSurvivorJson: wiped is true once every tagged survivor has left the squad") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}},
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}},
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    // Simulate both members having broken and fled (Battlefield::moveUnits
    // calls leaveSquad() on break) — they're alive survivors, but stragglers.
    for (const auto& u : army)
        u->leaveSquad();

    json out = squadSurvivorJson(army);
    REQUIRE(out["7"]["survivors"]["Soldier"] == 2);
    REQUIRE(out["7"]["wiped"] == true);
}

TEST_CASE("squadSurvivorJson: wiped is false if even one tagged survivor is still attached") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}},
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}, {"squad_id", 7}},
    });
    std::vector<std::unique_ptr<Squad>> squads;
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    squads = buildSquadsFromArmy(army);

    army[0]->leaveSquad(); // one straggler broke and fled...
    // ...but army[1] is still standing with the formation.

    json out = squadSurvivorJson(army);
    REQUIRE(out["7"]["survivors"]["Soldier"] == 2); // both counted as survivors
    REQUIRE(out["7"]["wiped"] == false);             // formation held — regroups
}

// ── character_id / avoids_melee in placement JSON (slice 5) ──────────────────
//
// Both are attached SERVER-SIDE by the campaign layer, like squad_id and
// squad_mods before them, so these cases are as much about a forged or
// malformed one being harmless as about a legitimate one working.

TEST_CASE("buildArmyFromPlacement: character_id and avoids_melee tag the individual") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Mage"}, {"q", 3}, {"r", 5},
             {"character_id", 4}, {"avoids_melee", true}},
        json{{"unit_type", "Soldier"}, {"q", 4}, {"r", 5}}, // an ordinary body
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 2);
    REQUIRE(army[0]->getCharacterId() == 4);
    REQUIRE(army[0]->getAvoidsMelee() == true);
    // The default is the ordinary one: no character, and willing to fight.
    REQUIRE(army[1]->getCharacterId() == 0);
    REQUIRE(army[1]->getAvoidsMelee() == false);
}

TEST_CASE("buildArmyFromPlacement: malformed character_id or avoids_melee is inert") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Mage"}, {"q", 3}, {"r", 5}, {"character_id", "seven"}},
        json{{"unit_type", "Mage"}, {"q", 4}, {"r", 5}, {"character_id", 0}},
        json{{"unit_type", "Mage"}, {"q", 5}, {"r", 5}, {"character_id", -3}},
        json{{"unit_type", "Mage"}, {"q", 6}, {"r", 5}, {"avoids_melee", "yes"}},
        json{{"unit_type", "Mage"}, {"q", 7}, {"r", 5}, {"avoids_melee", 1}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);
    REQUIRE(army.size() == 5);
    // Every one of them is placed — a bad tag is never a rejected request —
    // and every one of them carries the default rather than the junk.
    for (const auto& u : army) {
        CHECK(u->getCharacterId() == 0);
        CHECK(u->getAvoidsMelee() == false);
    }
}

// ── characterSurvivorJson (blue_characters/red_characters output contract) ───

TEST_CASE("characterSurvivorJson: lists tagged survivors, sorted, untagged skipped") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Priest"},  {"q", 3}, {"r", 5}, {"character_id", 9}},
        json{{"unit_type", "Mage"},    {"q", 4}, {"r", 5}, {"character_id", 2}},
        json{{"unit_type", "Soldier"}, {"q", 5}, {"r", 5}}, // untagged — excluded
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);

    json out = characterSurvivorJson(army);
    REQUIRE(out == json::array({2, 9}));
}

// The campaign layer reconciles by asking who it SENT: an id it committed and
// does not find here is dead, permanently. So the empty case has to be an
// empty array rather than null — "nobody came home" is an answer, not a
// missing field.
TEST_CASE("characterSurvivorJson: an army with no characters is an empty array") {
    HexGrid g;
    g.buildRect(16, 20);
    json placement = json::array({
        json{{"unit_type", "Soldier"}, {"q", 3}, {"r", 5}},
    });
    auto army = buildArmyFromPlacement(placement.dump(), BLUETEAM, g);

    json out = characterSurvivorJson(army);
    REQUIRE(out.is_array());
    REQUIRE(out.empty());
}
