#include "catch.hpp"
#include "hex/HexGrid.hpp"

// ── HexGrid JSON round-trip tests ────────────────────────────────────────────

TEST_CASE("HexGrid::toJson/fromJson round-trip: terrain and elevation") {
    HexGrid g;
    g.buildRect(16, 10);

    Hex* h1 = g.getHex({2, 3});
    REQUIRE(h1 != nullptr);
    h1->terrain   = TerrainType::Forest;
    h1->elevation = 1;

    Hex* h2 = g.getHex({-1, 5});
    REQUIRE(h2 != nullptr);
    h2->terrain = TerrainType::Marsh;

    Hex* h3 = g.getHex({0, 0});
    REQUIRE(h3 != nullptr);
    // default — should NOT appear in the JSON output

    std::string js = g.toJson(16, 10, "test");

    HexGrid g2;
    g2.fromJson(js);

    REQUIRE(g2.getHex({2, 3}) != nullptr);
    REQUIRE(g2.getHex({2, 3})->terrain   == TerrainType::Forest);
    REQUIRE(g2.getHex({2, 3})->elevation == 1);

    REQUIRE(g2.getHex({-1, 5}) != nullptr);
    REQUIRE(g2.getHex({-1, 5})->terrain == TerrainType::Marsh);

    // Default hex stays default
    REQUIRE(g2.getHex({0, 0})->terrain   == TerrainType::Open);
    REQUIRE(g2.getHex({0, 0})->elevation == 0);
    REQUIRE(g2.getHex({0, 0})->impassable == false);
}

TEST_CASE("HexGrid::toJson/fromJson round-trip: impassable") {
    HexGrid g;
    g.buildRect(16, 10);

    Hex* hi = g.getHex({3, 4});
    REQUIRE(hi != nullptr);
    hi->impassable = true;

    HexGrid g2;
    g2.fromJson(g.toJson(16, 10, "imp_test"));

    REQUIRE(g2.getHex({3, 4})->impassable == true);
    REQUIRE(g2.getHex({0, 0})->impassable == false);
}

TEST_CASE("HexGrid::toJson/fromJson round-trip: blocked hexside") {
    HexGrid g;
    g.buildRect(16, 10);

    // {5,5} is interior — all 6 neighbors exist in a 16x10 grid.
    HexSide* hs = g.getSide({5, 5}, HexDirection::NE);
    REQUIRE(hs != nullptr);
    hs->blocked = true;

    HexGrid g2;
    g2.fromJson(g.toJson(16, 10, "side_test"));

    HexSide* hs2 = g2.getSide({5, 5}, HexDirection::NE);
    REQUIRE(hs2 != nullptr);
    REQUIRE(hs2->blocked == true);

    // Unrelated side should not be blocked
    HexSide* hs3 = g2.getSide({5, 5}, HexDirection::E);
    REQUIRE(hs3 != nullptr);
    REQUIRE(hs3->blocked == false);
}

TEST_CASE("HexGrid::toJson/fromJson round-trip: all terrain types") {
    HexGrid g;
    g.buildRect(16, 10);

    g.getHex({0, 1})->terrain = TerrainType::Forest;
    g.getHex({1, 1})->terrain = TerrainType::Marsh;
    g.getHex({2, 1})->terrain = TerrainType::Rubble;
    g.getHex({3, 1})->terrain = TerrainType::Open; // explicit default

    HexGrid g2;
    g2.fromJson(g.toJson(16, 10, "terrain_test"));

    REQUIRE(g2.getHex({0, 1})->terrain == TerrainType::Forest);
    REQUIRE(g2.getHex({1, 1})->terrain == TerrainType::Marsh);
    REQUIRE(g2.getHex({2, 1})->terrain == TerrainType::Rubble);
    REQUIRE(g2.getHex({3, 1})->terrain == TerrainType::Open);
}

TEST_CASE("HexGrid::fromJson: builds grid from JSON when empty") {
    HexGrid g;
    g.buildRect(8, 6);
    g.getHex({2, 2})->elevation = 2;
    std::string js = g.toJson(8, 6, "build_test");

    // g2 starts empty — fromJson should call buildRect internally
    HexGrid g2;
    g2.fromJson(js);

    REQUIRE(g2.getHex({2, 2}) != nullptr);
    REQUIRE(g2.getHex({2, 2})->elevation == 2);
    REQUIRE(g2.hexCount() == g.hexCount());
}
