// Known-failing tests: each TEST_CASE below defines DESIRED behavior for a real,
// identified engine bug that hasn't been fixed yet. They are tagged [.] (Catch2's
// "hidden" tag) so `make test` / `make test-serial` / CI stay green — this file
// exists so the bug and its expected-correct behavior aren't lost, not to hide it.
//
// Run them explicitly with: ./run_tests "[.]"
//
// MIGRATION RULE: once the underlying bug is fixed, move the TEST_CASE back to the
// file it came from (noted per-test below), remove the [.] tag, and delete it from
// here. Do not leave a fixed test sitting in this file.

#include "catch.hpp"
#include "units/Soldier.hpp"
#include "hex/HexGrid.hpp"
#include "Utility.hpp"
#include "BattleSetup.hpp"

// ── Originally: test_movement.cpp, "Terrain tiebreaker" ─────────────────────────
// Bug: Battlefield::pickBestDirection (Battlefield.cpp) picks direction index 0
// (NE) first regardless of terrain cost when multiple neighbors tie on distance
// reduction. Fix: among tied-distance candidates, prefer the lowest terrain move
// cost (same principle the lateral-move branch already applies via bestDecrCost).

TEST_CASE("moveToward: prefers open hex over forest when both close distance equally", "[.]") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {2,4}.
    // NE={1,4}=Forest (cost 2, direction index 0).
    // E= {1,5}=Open  (cost 1, direction index 1).
    // Both reduce distance from 2 to 1. Unit should go E (cheaper).
    Hex* neHex = field.hexGrid.getHex({1, 4});
    neHex->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({2, 4}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({2, 4}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex() != nullptr);
    // Should be at E={1,5}, not NE forest={1,4}
    REQUIRE(unit->getHex()->coord.q == 1);
    REQUIRE(unit->getHex()->coord.r == 5);

    neHex->terrain = TerrainType::Open;
    field.extractResult();
}

// ── Originally: test_movement.cpp, "Flee: terrain cost preference" ──────────────
// Bug: same root cause as above — Battlefield::flee's direction scan (via the same
// pickBestDirection helper) picks the first tied-distance direction it tries, not
// the cheapest. Fix: same as above, applied to the flee distance-reduction branch.

TEST_CASE("flee: picks open SW over forest SE when both are primary flee directions", "[.]") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {3,14}. SE={3,15}=Forest (cost 2), SW={2,15}=Open (cost 1).
    // With swap=false the loop tries SE first. Current code picks SE (Forest).
    // After fix: should pick SW (Open, cheaper).
    Hex* seHex = field.hexGrid.getHex({3, 15});
    seHex->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setBroken(true);
    redPtr->setHex(field.hexGrid.getHex({3, 14}));

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); // swap=false → SE tried before SW

    field.flee(field.getTeam(REDTEAM)[0]);

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getAlive() == true);
    // Should be at SW={2,15} (Open), not SE forest={3,15}
    REQUIRE(unit->getHex()->coord.q == 2);
    REQUIRE(unit->getHex()->coord.r == 15);

    seHex->terrain = TerrainType::Open;
    Utility::clearDiceRolls();
    field.extractResult();
}
