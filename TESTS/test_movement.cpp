// Movement algorithm tests. Define DESIRED behavior; some will fail until the
// algorithm is improved (those are not tagged [.] so failures are visible).
// [.][debug] tests print the ASCII map each turn and are excluded from make test.

#include "catch.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Cavalry.hpp"
#include "../HDRS/hex/HexGrid.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/Squad.hpp"

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

// ── Cavalry targeting: forest deprioritization ───────────────────────────────
// Mounted searchers add CAVALRY_FOREST_TARGET_PENALTY to a forest-sheltered
// enemy's distance before comparing — prefer open ground, but still go for
// the forest enemy if it's the only option.

TEST_CASE("findTarget: Mounted searcher prefers a farther open enemy over a closer forest one") {
    Battlefield& field = Utility::getBattlefield();

    field.hexGrid.getHex({1, 10})->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setCategory(UnitCategory::Mounted);
    redPtr->setHex(field.hexGrid.getHex({0, 10}));

    auto forestEnemy = std::make_unique<Soldier>(BLUETEAM);
    forestEnemy->setHex(field.hexGrid.getHex({1, 10})); // distance 1, but Forest (+3 penalty = 4)
    auto openEnemy = std::make_unique<Soldier>(BLUETEAM);
    openEnemy->setHex(field.hexGrid.getHex({3, 10}));   // distance 3, Open

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(forestEnemy));
    blue.push_back(std::move(openEnemy));
    field.loadArmies(std::move(red), std::move(blue));

    Hex* target = field.findTarget(*field.getTeam(REDTEAM)[0]);
    REQUIRE(target != nullptr);
    REQUIRE(target->coord.q == 3); // picked the farther open enemy, not the closer forest one

    field.hexGrid.getHex({1, 10})->terrain = TerrainType::Open;
    field.extractResult();
}

TEST_CASE("findTarget: Mounted searcher still targets a forest enemy when it's the only one") {
    Battlefield& field = Utility::getBattlefield();

    field.hexGrid.getHex({1, 10})->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setCategory(UnitCategory::Mounted);
    redPtr->setHex(field.hexGrid.getHex({0, 10}));

    auto forestEnemy = std::make_unique<Soldier>(BLUETEAM);
    forestEnemy->setHex(field.hexGrid.getHex({1, 10}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(forestEnemy));
    field.loadArmies(std::move(red), std::move(blue));

    Hex* target = field.findTarget(*field.getTeam(REDTEAM)[0]);
    REQUIRE(target != nullptr);
    REQUIRE(target->coord.q == 1); // only option — still goes for it

    field.hexGrid.getHex({1, 10})->terrain = TerrainType::Open;
    field.extractResult();
}

// ── Riderless mount: reverts from Mounted to Beast, unlocking terrain ───────
// hexAcceptsUnit() flatly bans Mounted from Forest/Marsh; Beast has no such
// ban (just a cost penalty — see terrainMoveCost()). A Cavalry that loses its
// rider should go from being routed around a marsh to walking straight
// through it, with no category-specific casing beyond looseCategory().

TEST_CASE("moveToward: a Mounted unit routes around Marsh, but the same unit goes straight "
          "through it once it reverts to Beast after losing its rider") {
    Battlefield& field = Utility::getBattlefield();

    Hex* marsh = field.hexGrid.getHex({1, 5});
    marsh->terrain = TerrainType::Marsh;

    auto cavPtr = std::make_unique<Cavalry>(REDTEAM); // default Soldier rider + Horse mount
    Cavalry* cav = cavPtr.get();
    cav->setHex(field.hexGrid.getHex({0, 5}));

    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    bluePtr->setHex(field.hexGrid.getHex({2, 5}));

    Army red, blue;
    red.push_back(std::move(cavPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(cav->getCategory() == UnitCategory::Mounted);
    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({2, 5}));
    REQUIRE_FALSE(cav->getHex()->coord == HexCoord{1, 5}); // Mounted — routed around the marsh
    REQUIRE_FALSE(cav->getHex()->coord == HexCoord{0, 5}); // but it did move (laterally)

    // Reset to the start hex, then kill the rider in place (boundary=clamp(20-0,1,29)=20
    // for the default Horse(20)/Soldier(10) pairing — a roll of 25 routes to the rider,
    // same as the death-transition tests in test_combat.cpp).
    cav->setHex(field.hexGrid.getHex({0, 5}));
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(25);
    cav->defend(9999, 9999, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();
    REQUIRE(cav->getCategory() == UnitCategory::Beast);

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({2, 5}));
    CHECK(cav->getHex()->coord == HexCoord{1, 5}); // Beast — goes straight through the marsh

    marsh->terrain = TerrainType::Open;
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
    // Pass 2: engaged=true (enemy adjacent), hex is nowhere near its retention
    // threshold (one Soldier vs. 160 for one engaged open side) → shouldSpreadToward
    // returns false → lateral blocked. Unit must stay at {0,5}.
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

// ── Spreading to less-crowded engaged hexes ──────────────────────────────────
// shouldSpreadToward()/hexRetentionThreshold(): a hex retains
// effectiveFrontage(side)*ENGAGED_SIDE_RETENTION_MULTIPLIER fresh size-points
// per currently engaged side (one open-terrain side = 40*4 = 160) before its
// excess is willing to take a lateral move to another engaged hex holding
// fewer fresh troops right now.
//
// Geometry reused by all of these: a single Blue "apex" unit at {1,5} is
// simultaneously adjacent to {0,5} (its W side) and {1,4} (its NW side) — the
// same corner shape described in the design conversation, where one corner
// hex touches two segments of the line at once.

TEST_CASE("moveToward: a unit spreads from an over-threshold engaged hex to a less-crowded engaged neighbor") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // {0,5}: 17 fresh Soldiers (170 size) — over the 160 threshold for its
    // one engaged (open-terrain) side.
    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        red.push_back(std::move(u));
    }
    // {1,4}: a single lone Soldier — engaged via the same apex, far under {0,5}'s count.
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    AUnit* mover = field.getTeam(REDTEAM)[0].get();
    REQUIRE(mover->getHex() != nullptr);
    // Both {1,4} (engaged via apex) and {0,6} (adjacent to apex from another angle)
    // qualify; the random start direction in pickBestDirection may pick either.
    HexCoord dest = mover->getHex()->coord;
    CHECK((dest == HexCoord{1, 4} || dest == HexCoord{0, 6}));

    field.extractResult();
}

TEST_CASE("moveToward: a blocked hexside prevents spreading to the hex behind it") {
    Battlefield& field = Utility::getBattlefield();

    // Block the hexside between {1,4} and the apex {1,5}.
    // hexAdjacentToEnemy skips blocked sides, so {1,4} cannot see the enemy
    // and must not be picked as a spread target even though it would otherwise
    // be an equidistant lateral candidate.
    HexSide* wall = field.hexGrid.getSide({1, 4}, HexDirection::SE);
    REQUIRE(wall != nullptr);
    wall->blocked = true;

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        red.push_back(std::move(u));
    }
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    AUnit* mover = field.getTeam(REDTEAM)[0].get();
    REQUIRE(mover->getHex() != nullptr);
    // Must not have entered {1,4} — the blocked wall cuts it off from the enemy.
    // The unit may stay at {0,5} or spread to another qualifying neighbor.
    CHECK(mover->getHex()->coord != HexCoord{1, 4});

    wall->blocked = false;
    field.extractResult();
}

TEST_CASE("moveToward: a Mounted unit's spreading never enters Forest, even when it's the only "
          "candidate the rule would otherwise prefer") {
    Battlefield& field = Utility::getBattlefield();

    Hex* forestCandidate = field.hexGrid.getHex({1, 4});
    forestCandidate->terrain = TerrainType::Forest;
    // Remove the other equal-distance lateral tie so {1,4} (Forest) is the
    // *only* candidate the spreading rule would otherwise pick — isolates
    // whether Mounted's Forest ban actually holds under the new rule, rather
    // than the unit just happening to take the other tie instead.
    Hex* otherTie = field.hexGrid.getHex({0, 6});
    otherTie->impassable = true;

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    auto cavPtr = std::make_unique<Cavalry>(REDTEAM); // Mounted, size 20
    cavPtr->setHex(field.hexGrid.getHex({0, 5}));
    red.push_back(std::move(cavPtr));
    for (int i = 0; i < 16; ++i) { // pads {0,5} to 180 — over the 160 threshold
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        red.push_back(std::move(u));
    }
    // A lone Soldier in the forest hex would otherwise make it the obvious
    // (least-crowded, engaged) spread target for a Foot unit.
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(forestCandidate);
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    AUnit* cav = field.getTeam(REDTEAM)[0].get();
    REQUIRE(cav->getHex() != nullptr);
    CHECK(cav->getHex()->coord == HexCoord{0, 5}); // held — Mounted cannot enter Forest, spread or not

    forestCandidate->terrain = TerrainType::Open;
    otherTie->impassable = false;
    field.extractResult();
}

TEST_CASE("moveToward: an engaged unit keeps spreading on consecutive ticks instead of freezing after one lateral move") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        red.push_back(std::move(u));
    }
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));

    AUnit& mover = *field.getTeam(REDTEAM)[0];
    mover.setTookLateral(true); // simulate: unit already spread once last tick

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    REQUIRE(mover.getHex() != nullptr);
    // Must have spread — not frozen at {0,5}. Either {1,4} or {0,6} is valid.
    HexCoord dest2 = mover.getHex()->coord;
    CHECK((dest2 == HexCoord{1, 4} || dest2 == HexCoord{0, 6}));
    field.extractResult();
}

TEST_CASE("moveSquad: a squad redistributes to a less-crowded engaged neighbor once its hex is over threshold") {
    Battlefield& field = Utility::getBattlefield();

    auto sqOwned = std::make_unique<Squad>("Spreaders", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // {0,5}: squad of 4 (40 size) plus 17 lone Soldiers (170) — well past the
    // 160 threshold, with enough margin that the squad's full 40 can leave
    // and still leave 170 >= 160 behind.
    Hex* origin = field.hexGrid.getHex({0, 5});
    for (int i = 0; i < 4; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(origin);
        sq->addMember(u.get());
        red.push_back(std::move(u));
    }
    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(origin);
        red.push_back(std::move(u));
    }
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sqOwned));

    field.moveSquad(*sq);

    for (AUnit* m : sq->getMembers()) {
        REQUIRE(m->getHex() != nullptr);
        // Squad moves as a unit; {1,4} (engaged) and {0,6} (adjacent to enemy) both qualify.
        HexCoord sq_dest = m->getHex()->coord;
        CHECK((sq_dest == HexCoord{1, 4} || sq_dest == HexCoord{0, 6}));
    }

    field.extractResult();
}

TEST_CASE("moveSquad: a squad does not leave if doing so would drop its hex below the retention threshold") {
    Battlefield& field = Utility::getBattlefield();

    auto sqOwned = std::make_unique<Squad>("Holdouts", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // {0,5}: squad of 4 (40) + 13 lone Soldiers (130) = 170 — just over the
    // 160 threshold, but pulling the squad's 40 back out would drop it to
    // 130, below threshold, so the squad must hold position.
    Hex* origin = field.hexGrid.getHex({0, 5});
    for (int i = 0; i < 4; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(origin);
        sq->addMember(u.get());
        red.push_back(std::move(u));
    }
    for (int i = 0; i < 13; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(origin);
        red.push_back(std::move(u));
    }
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sqOwned));

    field.moveSquad(*sq);

    for (AUnit* m : sq->getMembers()) {
        REQUIRE(m->getHex() != nullptr);
        CHECK(m->getHex()->coord == HexCoord{0, 5}); // held — leaving would gut the hex below threshold
    }

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

// ── Flee: flyer ignores impassable terrain ───────────────────────────────────
// A full-row wall of impassable hexes (no gaps) lies between a broken flyer
// and its flee row. For a ground/mounted unit this would make every hex past
// the wall UNREACHABLE in the flee BFS table, so it would rally in place
// forever. Flyers ignore impassable hexes and hexsides entirely and use raw
// row-distance instead of the BFS table, so they should fly straight through.

TEST_CASE("flee: flying unit crosses a complete impassable wall blocking its only ground exit") {
    Battlefield& field = Utility::getBattlefield();

    // Full row wall at r=20, every valid q for that row (q = col - r/2, col 0..15).
    std::vector<Hex*> wall;
    for (int q = -10; q <= 5; ++q) {
        Hex* h = field.hexGrid.getHex({q, 20});
        REQUIRE(h != nullptr);
        h->impassable = true;
        wall.push_back(h);
    }

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setCategory(UnitCategory::Flyer);
    redPtr->setBroken(true);
    redPtr->setHex(field.hexGrid.getHex({3, 14})); // interior, north of the wall

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    // Flee repeatedly. A ground unit would be stuck rallying at the wall;
    // the flyer should make steady southward progress and either cross the
    // wall (r > 20) or flee off the southern edge entirely (alive == false).
    for (int turn = 0; turn < 25; ++turn) {
        AUnit* unit = field.getTeam(REDTEAM)[0].get();
        if (!unit->getAlive()) break;
        field.flee(field.getTeam(REDTEAM)[0]);
    }

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    bool crossedOrFled = !unit->getAlive() || unit->getHex()->coord.r > 20;
    REQUIRE(crossedOrFled);

    for (Hex* h : wall) h->impassable = false;
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

// ── Squad circumnavigation ────────────────────────────────────────────────────
// Same wall geometry as the individual-unit test. Verifies that moveSquad()
// uses BFS distances rather than straight-line distance, so the squad routes
// around the wall instead of getting stuck pressing into it.

TEST_CASE("moveSquad: squad routes around impassable wall to reach the other side") {
    Battlefield& field = Utility::getBattlefield();

    // Impassable wall at q=3, r=8..12. Direct E path from {0,10} to {6,10} is blocked.
    // Must be set before loadArmies so computeDistances sees the wall.
    std::vector<Hex*> wall;
    for (int r = 8; r <= 12; ++r) {
        Hex* h = field.hexGrid.getHex({3, r});
        REQUIRE(h != nullptr);
        h->impassable = true;
        wall.push_back(h);
    }

    // Squad must be declared before the unit objects so it outlives them
    // (member destructors call leaveSquad(), which touches the Squad object).
    auto sqOwned = std::make_unique<Squad>("TestSquad", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    Hex* startHex = field.hexGrid.getHex({0, 10});
    for (int i = 0; i < 4; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(startHex);
        sq->addMember(u.get());
        red.push_back(std::move(u));
    }

    // Blue dummies — static targets across the wall.
    for (int i = 0; i < 2; ++i) {
        auto u = std::make_unique<Soldier>(BLUETEAM);
        u->setHex(field.hexGrid.getHex({6, 10}));
        blue.push_back(std::move(u));
    }

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sqOwned));

    // Call moveSquad directly so only the red squad moves — blue dummies stay put.
    // 30 turns: the BFS path around the 5-hex wall is ~11 hops; lateral-flag overhead
    // means at most every other move is a lateral, so 30 turns is well sufficient.
    for (int turn = 0; turn < 30; ++turn) {
        bool crossed = false;
        for (AUnit* m : sq->getMembers())
            if (m && m->getAlive() && m->getHex() && m->getHex()->coord.q > 3)
                { crossed = true; break; }
        if (crossed) break;
        field.moveSquad(*sq);
    }

    bool anyCrossed = false;
    for (AUnit* m : sq->getMembers())
        if (m && m->getAlive() && m->getHex() && m->getHex()->coord.q > 3)
            { anyCrossed = true; break; }
    REQUIRE(anyCrossed);

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
