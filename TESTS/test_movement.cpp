// Movement algorithm tests. Define DESIRED behavior; some will fail until the
// algorithm is improved (those are not tagged [.] so failures are visible).
// [.][debug] tests print the ASCII map each turn and are excluded from make test.

#include "catch.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/hex/HexGrid.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/BattleSetup.hpp"

// ── Basic approach ────────────────────────────────────────────────────────────
// Grid: buildRect(16,30). Axial: q = col - r/2.
// r=5: valid q in -2..13. NE=(+1,-1) E=(+1,0) SE=(0,+1) SW=(-1,+1) W=(-1,0) NW=(0,-1)

TEST_CASE("moveToward: unit advances one step toward enemy across open field") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5} (col 2, r 5), Blue at {5,5} (col 7, r 5). Distance = 5.
    // Only E reduces distance; unit should reach {1,5} with newDist=4.
    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({5, 5}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({5, 5}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex() != nullptr);
    REQUIRE(HexGrid::distance(unit->getHex()->coord, {5, 5}) == 4);

    field.extractResult();
}

// ── Terrain tiebreaker ────────────────────────────────────────────────────────
// CURRENTLY FAILS: the algorithm picks direction index 0 (NE) first regardless
// of terrain cost. Fix: when multiple neighbors tie on distance reduction,
// prefer the one with the lowest terrain move cost.

TEST_CASE("moveToward: prefers open hex over forest when both close distance equally") {
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

// ── Enemy-occupied hex ────────────────────────────────────────────────────────

TEST_CASE("moveToward: unit does not enter enemy-occupied adjacent hex") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue directly E at {1,5}.
    // Pass 1: {1,5} has enemy → hexAcceptsUnit false → skip.
    // Pass 2: engaged=true (enemy adjacent), crowded=false → lateral blocked.
    // Unit must stay at {0,5}.
    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({1, 5}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex()->coord.q == 0);
    REQUIRE(unit->getHex()->coord.r == 5);

    field.extractResult();
}

// ── Impassable hex ────────────────────────────────────────────────────────────

TEST_CASE("moveToward: unit does not enter impassable hex") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {2,5}. Direct E path passes through {1,5} (impassable).
    // Pass 1 fails. Pass 2 (not engaged): unit routes laterally to NE or SE.
    Hex* wall = field.hexGrid.getHex({1, 5});
    wall->impassable = true;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({2, 5}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({2, 5}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE_FALSE(unit->getHex()->coord == HexCoord{1, 5}); // did not enter impassable
    REQUIRE_FALSE(unit->getHex()->coord == HexCoord{0, 5}); // did move somewhere

    wall->impassable = false;
    field.extractResult();
}

// ── Blocked hexside ───────────────────────────────────────────────────────────

TEST_CASE("moveToward: unit does not cross blocked hexside") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {5,5}. Block the E side of {0,5} (cliff/wall).
    // Pass 1: E side blocked → skip {1,5}.
    // No other forward move exists. Pass 2 (not engaged): lateral to NE or SE.
    HexSide* wall = field.hexGrid.getSide({0, 5}, HexDirection::E);
    REQUIRE(wall != nullptr);
    wall->blocked = true;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({5, 5}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({5, 5}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE_FALSE(unit->getHex()->coord == HexCoord{1, 5}); // didn't cross blocked side
    REQUIRE_FALSE(unit->getHex()->coord == HexCoord{0, 5}); // unit still moved laterally

    wall->blocked = false;
    field.extractResult();
}

// ── Movement debt (terrain cost) ──────────────────────────────────────────────

TEST_CASE("moveToward: entering forest applies spentMove debt and holds next turn") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {2,3}. Only NE closes distance → {1,4}.
    // {1,4} is Forest (cost 2). After first call: unit at {1,4}, spentMove=1.
    // Second call: debt consumed, unit stays at {1,4}.
    Hex* forestHex = field.hexGrid.getHex({1, 4});
    forestHex->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({2, 3}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    Hex* targetHex = field.hexGrid.getHex({2, 3});

    field.moveToward(field.getTeam(REDTEAM)[0], targetHex);
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex()->coord.q == 1);
    REQUIRE(unit->getHex()->coord.r == 4);
    REQUIRE(unit->getSpentMove() == 1);

    // Second call: debt decrements, no move
    field.moveToward(field.getTeam(REDTEAM)[0], targetHex);
    REQUIRE(unit->getHex()->coord.q == 1);
    REQUIRE(unit->getHex()->coord.r == 4);
    REQUIRE(unit->getSpentMove() == 0);

    forestHex->terrain = TerrainType::Open;
    field.extractResult();
}

// ── Flee: correct direction ───────────────────────────────────────────────────

TEST_CASE("flee: red broken unit moves toward higher r (south away from blue edge)") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {3,14}: interior, q≠0, q≠15, r≠0, r≠29. Flee should go SE or SW.
    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setBroken(true);
    redPtr->setHex(field.hexGrid.getHex({3, 14}));

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); // getRandom(0,1)=1 → swap=false → order: SE,SW,E,W,NE,NW

    field.flee(field.getTeam(REDTEAM)[0]);

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getAlive() == true);
    REQUIRE(unit->getHex()->coord.r == 15); // moved to higher r (south)

    Utility::clearDiceRolls();
    field.extractResult();
}

// ── Flee: terrain cost preference ────────────────────────────────────────────
// CURRENTLY FAILS: flee picks the first valid direction, not the cheapest.
// Fix: among the primary flee directions (SE/SW for Red), prefer lower terrain cost.

TEST_CASE("flee: picks open SW over forest SE when both are primary flee directions") {
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

// ── Flee: boundary removal ────────────────────────────────────────────────────

TEST_CASE("flee: unit at r==0 boundary is removed (alive=false)") {
    Battlefield& field = Utility::getBattlefield();

    // r==0 is height boundary (height-1 is r==29, r==0 is the opposite edge).
    // The flee boundary check fires immediately before trying to move.
    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setBroken(true);
    redPtr->setHex(field.hexGrid.getHex({5, 0})); // r=0 → boundary

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    field.flee(field.getTeam(REDTEAM)[0]);

    REQUIRE(field.getTeam(REDTEAM)[0]->getAlive() == false);

    field.extractResult();
}

// ── Mountain-range circumnavigation ──────────────────────────────────────────
// Wall of impassable hexes blocks the direct east path. Unit must route around
// via the gap above the wall. Verifies the BFS correctly finds the detour.

TEST_CASE("moveToward: unit routes around impassable wall to reach the other side") {
    Battlefield& field = Utility::getBattlefield();

    // Impassable wall at q=3, r=8..12. Direct E path from {0,10} to {6,10} is blocked.
    // BFS routes north: {0,10}→{1,9}→{2,8}→{3,7} (gap above wall)→{4,7}→{4,8}→…→{6,10}.
    std::vector<Hex*> wall;
    for (int r = 8; r <= 12; ++r) {
        Hex* h = field.hexGrid.getHex({3, r});
        REQUIRE(h != nullptr);
        h->impassable = true;
        wall.push_back(h);
    }

    auto redPtr  = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 10}));
    bluePtr->setHex(field.hexGrid.getHex({6, 10}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    Hex* targetHex = field.hexGrid.getHex({6, 10});
    AUnit* unit = field.getTeam(REDTEAM)[0].get();

    // Run up to 25 moves. The lateral flag means at most every other move is a
    // lateral — so 25 turns guarantees ≥12 forward (decreasing-distance) moves,
    // more than enough for the 9-hop BFS path.
    for (int turn = 0; turn < 25; ++turn) {
        if (unit->getHex() && unit->getHex()->coord.q > 3) break;
        field.moveToward(field.getTeam(REDTEAM)[0], targetHex);
    }

    REQUIRE(unit->getHex() != nullptr);
    // Unit must have crossed to q>3, proving it routed around the wall (not through it).
    REQUIRE(unit->getHex()->coord.q > 3);

    for (Hex* h : wall) h->impassable = false;
    field.extractResult();
}

// ── Debug: battle with terrain forcing a detour ───────────────────────────────
// Run with: ./run_tests "[debug]"

TEST_CASE("movement debug: forest strip forces units to route around", "[.][debug]") {
    Battlefield& field = Utility::getBattlefield();

    // Vertical forest strip near the center column — units must go around.
    std::vector<Hex*> forestHexes;
    for (int r = 5; r <= 24; ++r) {
        // Column 8 in offset coords → axial q = 8 - r/2
        Hex* h = field.hexGrid.safeGetHex(8 - r / 2, r);
        if (h) { h->terrain = TerrainType::Forest; forestHexes.push_back(h); }
    }

    Army red, blue;
    appendArmy<Soldier>(red,  15, REDTEAM);
    appendArmy<Soldier>(blue, 15, BLUETEAM);
    randomPlaceArmy(red,  field, {field.width * 3/4, field.width - 1, 0, field.height - 1});
    randomPlaceArmy(blue, field, {0, field.width / 4,                 0, field.height - 1});
    field.loadArmies(std::move(red), std::move(blue));

    for (int turn = 1; turn <= 50; ++turn) {
        field.printText(turn);
        if (!field.tick()) break;
    }

    for (Hex* h : forestHexes) h->terrain = TerrainType::Open;
    field.extractResult();
}

// ── Debug: flee path zigzag ───────────────────────────────────────────────────

TEST_CASE("movement debug: fleeing units zigzag south", "[.][debug]") {
    Battlefield& field = Utility::getBattlefield();

    // Ten red soldiers pre-broken, placed at the north half.
    // Watch them flee toward the south edge over several ticks.
    Army red;
    for (int i = 0; i < 10; ++i) {
        auto s = std::make_unique<Soldier>(REDTEAM);
        s->setBroken(true);
        red.push_back(std::move(s));
    }
    randomPlaceArmy(red, field, {field.width / 4, field.width * 3/4, 0, field.height / 2});
    field.loadArmies(std::move(red), {});

    for (int turn = 1; turn <= 30; ++turn) {
        field.printText(turn);
        // Manually drive flee for each broken unit (tick() would skip blue phase too)
        for (auto& u : field.getTeam(REDTEAM))
            if (u && u->getAlive() && u->getBroken())
                field.flee(u);
    }

    field.extractResult();
}
