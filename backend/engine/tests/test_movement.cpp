// Movement algorithm tests. Define DESIRED behavior.
// Two known-failing cases (terrain-cost tiebreaking in moveToward/flee) live in
// test_known_failures.cpp instead of here — tagged [.] so they don't fail
// make test/make test-serial/CI, but are still tracked and runnable explicitly.
// Migrate them back here once the underlying bug is fixed.
// [.][debug] tests print the ASCII map each turn and are excluded from make test.

#include "catch.hpp"
#include <climits>
#include "units/Soldier.hpp"
#include "units/Cavalry.hpp"
#include "units/LightCavalry.hpp"
#include "hex/HexGrid.hpp"
#include "Utility.hpp"
#include "BattleSetup.hpp"
#include "Squad.hpp"

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

// ── Enemy-occupied hex ────────────────────────────────────────────────────────

TEST_CASE("moveToward: unit does not enter enemy-occupied adjacent hex") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue directly E at {1,5}.
    // Pass 1: {1,5} has enemy → hexAcceptsUnit false → skip.
    // Pass 2: engaged=true (enemy adjacent). resolveEngagements() seats the
    // lone Soldier at rank 1 (easily fits alone on the side) — seated units
    // never disengage, so the lateral/reinforcement path never even runs.
    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({1, 5}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.resolveEngagements();
    REQUIRE(field.getTeam(REDTEAM)[0]->getEngagedRank() == 1);

    field.moveToward(field.getTeam(REDTEAM)[0], field.hexGrid.getHex({1, 5}));

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex()->coord.q == 0);
    REQUIRE(unit->getHex()->coord.r == 5);

    field.extractResult();
}

// ── Reserve-based reinforcement: overflow units redistribute ────────────────
// A unit only counts as a "reserve" once _engagedRank == 0 — never seated on
// any HexSide (seating happens in resolveEngagements(), top-down rank 1→2→3
// per engaged side; FRONTAGE=40 -> 4 Soldiers/rank * 3 ranks = 12 seated per
// side). Seated units (any rank) never move; only genuine overflow does,
// purely by comparing reserve size-points against neighbors (no requirement
// that the destination itself be engaged).
//
// Geometry reused by all of these: a single Blue "apex" unit at {1,5} is
// simultaneously adjacent to {0,5} (its W side) and {1,4} (its NW side) — a
// corner hex touching two segments of the line at once. Per the axial-delta
// comment at the top of this file: NE={1,4} E={1,5}(apex) SE={0,6}
// SW={-1,6} W={-1,5} NW={0,4} relative to {0,5}.

TEST_CASE("moveToward: an overflow reserve unit redistributes to a less-crowded neighbor") {
    Battlefield& field = Utility::getBattlefield();

    // Seal off every neighbor of {0,5} except {1,4} (NE) and {0,6} (SE), so
    // only those two empty hexes can qualify as reinforcement targets.
    field.hexGrid.getHex({-1, 6})->impassable = true; // SW
    field.hexGrid.getHex({-1, 5})->impassable = true; // W
    field.hexGrid.getHex({0, 4})->impassable  = true; // NW

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // {0,5}: 17 fresh Soldiers on one engaged (open-terrain) side —
    // 4/rank * 3 ranks = 12 seated, 5 unseated (rank 0, reserve = 50).
    std::vector<AUnit*> stack;
    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        stack.push_back(u.get());
        red.push_back(std::move(u));
    }
    // {1,4}: a single lone Soldier — seats easily alone on its own side (via
    // the same apex), so its hex ends up with 0 reserves.
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));
    field.resolveEngagements();

    AUnit* overflow = nullptr;
    for (AUnit* u : stack) if (u->getEngagedRank() == 0) overflow = u;
    REQUIRE(overflow != nullptr);

    auto& teamUnits = field.getTeam(REDTEAM);
    std::unique_ptr<AUnit>* slot = nullptr;
    for (auto& up : teamUnits) if (up.get() == overflow) { slot = &up; break; }
    REQUIRE(slot != nullptr);

    field.moveToward(*slot, field.hexGrid.getHex({1, 5}));

    REQUIRE(overflow->getHex() != nullptr);
    // Both {1,4} (its lone occupant seated, 0 reserves) and {0,6} (empty, 0
    // reserves) qualify; the random start direction in bestReinforceNeighbor
    // may pick either.
    HexCoord dest = overflow->getHex()->coord;
    CHECK((dest == HexCoord{1, 4} || dest == HexCoord{0, 6}));

    field.hexGrid.getHex({-1, 6})->impassable = false;
    field.hexGrid.getHex({-1, 5})->impassable = false;
    field.hexGrid.getHex({0, 4})->impassable  = false;
    field.extractResult();
}

TEST_CASE("moveToward: a Mounted overflow reserve never enters Forest, even when it's the only "
          "candidate available") {
    Battlefield& field = Utility::getBattlefield();

    Hex* forestCandidate = field.hexGrid.getHex({1, 4}); // NE
    forestCandidate->terrain = TerrainType::Forest;
    // Seal off every other neighbor of {0,5} so Forest is the *only* legal
    // reinforcement candidate — isolates whether Mounted's Forest ban holds
    // even when it's the sole alternative to just holding position.
    field.hexGrid.getHex({0, 6})->impassable  = true; // SE
    field.hexGrid.getHex({-1, 6})->impassable = true; // SW
    field.hexGrid.getHex({-1, 5})->impassable = true; // W
    field.hexGrid.getHex({0, 4})->impassable  = true; // NW

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // 7 identical Cavalry (size 20, Mounted) on one engaged Open side:
    // 40 cap/rank / 20 = 2 per rank * 3 ranks = 6 seated; equal-size units
    // can't evict each other, so the 7th is guaranteed overflow (rank 0) —
    // deterministic regardless of seating order, unlike mixing in smaller
    // units a bigger one could just evict its way past.
    std::vector<Cavalry*> cavs;
    for (int i = 0; i < 7; ++i) {
        auto c = std::make_unique<Cavalry>(REDTEAM);
        c->setHex(field.hexGrid.getHex({0, 5}));
        cavs.push_back(c.get());
        red.push_back(std::move(c));
    }

    field.loadArmies(std::move(red), std::move(blue));
    field.resolveEngagements();

    Cavalry* overflow = nullptr;
    for (Cavalry* c : cavs) if (c->getEngagedRank() == 0) overflow = c;
    REQUIRE(overflow != nullptr);

    auto& teamUnits = field.getTeam(REDTEAM);
    std::unique_ptr<AUnit>* slot = nullptr;
    for (auto& up : teamUnits) if (up.get() == overflow) { slot = &up; break; }
    REQUIRE(slot != nullptr);

    field.moveToward(*slot, field.hexGrid.getHex({1, 5}));

    REQUIRE(overflow->getHex() != nullptr);
    CHECK(overflow->getHex()->coord != HexCoord{1, 4}); // never entered Forest
    CHECK(overflow->getHex()->coord == HexCoord{0, 5}); // held — nowhere legal to go

    forestCandidate->terrain = TerrainType::Open;
    field.hexGrid.getHex({0, 6})->impassable  = false;
    field.hexGrid.getHex({-1, 6})->impassable = false;
    field.hexGrid.getHex({-1, 5})->impassable = false;
    field.hexGrid.getHex({0, 4})->impassable  = false;
    field.extractResult();
}

TEST_CASE("moveToward: an overflow reserve keeps redistributing on consecutive ticks instead of freezing after one lateral move") {
    Battlefield& field = Utility::getBattlefield();

    field.hexGrid.getHex({-1, 6})->impassable = true; // SW
    field.hexGrid.getHex({-1, 5})->impassable = true; // W
    field.hexGrid.getHex({0, 4})->impassable  = true; // NW

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    std::vector<AUnit*> stack;
    for (int i = 0; i < 17; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 5}));
        stack.push_back(u.get());
        red.push_back(std::move(u));
    }
    auto thin = std::make_unique<Soldier>(REDTEAM);
    thin->setHex(field.hexGrid.getHex({1, 4}));
    red.push_back(std::move(thin));

    field.loadArmies(std::move(red), std::move(blue));
    field.resolveEngagements();

    AUnit* overflow = nullptr;
    for (AUnit* u : stack) if (u->getEngagedRank() == 0) overflow = u;
    REQUIRE(overflow != nullptr);
    overflow->setTookLateral(true); // simulate: unit already spread once last tick

    auto& teamUnits = field.getTeam(REDTEAM);
    std::unique_ptr<AUnit>* slot = nullptr;
    for (auto& up : teamUnits) if (up.get() == overflow) { slot = &up; break; }
    REQUIRE(slot != nullptr);

    field.moveToward(*slot, field.hexGrid.getHex({1, 5}));

    REQUIRE(overflow->getHex() != nullptr);
    // Must have redistributed — not frozen at {0,5} by the pre-contact
    // "no two laterals in a row" rule, which only applies before contact.
    HexCoord dest2 = overflow->getHex()->coord;
    CHECK((dest2 == HexCoord{1, 4} || dest2 == HexCoord{0, 6}));

    field.hexGrid.getHex({-1, 6})->impassable = false;
    field.hexGrid.getHex({-1, 5})->impassable = false;
    field.hexGrid.getHex({0, 4})->impassable  = false;
    field.extractResult();
}

TEST_CASE("moveSquad: an engaged squad holds position even in a badly overcrowded hex") {
    // Redistribution is a whole-squad move and only fires while the squad is
    // NOT engaged (see the spread test below). An engaged squad — in contact
    // with the enemy — always holds, no matter how many reserve size-points are
    // piled up around it: it does not abandon the line to equalize crowding.
    Battlefield& field = Utility::getBattlefield();

    auto sqOwned = std::make_unique<Squad>("Spreaders", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

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
        CHECK(m->getHex()->coord == HexCoord{0, 5}); // held — squads never redistribute
    }

    field.extractResult();
}

TEST_CASE("moveSquad: an engaged squad holds even when it would itself be the reserve") {
    Battlefield& field = Utility::getBattlefield();

    auto sqOwned = std::make_unique<Squad>("Holdouts", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    auto apex = std::make_unique<Soldier>(BLUETEAM);
    apex->setHex(field.hexGrid.getHex({1, 5}));
    blue.push_back(std::move(apex));

    // {0,5}: squad of 4 (40) + 13 lone Soldiers (130) — enough loners to
    // overflow the 3-rank capacity (12 seated), so some of them (and
    // possibly squad members too) end up rank-0 reserves. Doesn't matter:
    // an ENGAGED squad holds regardless of its own seating state — only a
    // non-engaged squad redistributes (see the spread test below).
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
        CHECK(m->getHex()->coord == HexCoord{0, 5}); // held — engaged squads never redistribute
    }

    field.extractResult();
}

TEST_CASE("moveSquad: a non-engaged squad blocked from advancing spreads into an emptier neighbor") {
    // Counterpart to the two 'engaged squad holds' cases above. A squad NOT in
    // contact, packed into a hex it cannot advance out of (the hex ahead is
    // full), relocates as one atomic block to the passable neighbor holding
    // strictly fewer reserve size-points — the whole-squad analogue of a loner's
    // reserve-gradient reinforcement, gated by the same capacity + 25% loner
    // displacement rules. (User, 2026-07-06: squads should also spread, but only
    // when the whole-squad move follows the rules, and only while non-engaged.)
    Battlefield field;

    // Axial neighbours of O={5,10}: NE{6,9} E{6,10} SE{5,11} SW{4,11} W{4,10} NW{5,9}.
    // Enemy at {8,10} → distance 3, so the squad is NOT engaged. Forward hex is
    // E{6,10} (distance 2). The spread target is W{4,10} (distance 4 — farther,
    // so never a decreasing or lateral move; today the squad simply holds).
    const HexCoord O{5, 10};
    const HexCoord ENEMY{8, 10};
    const HexCoord FWD{6, 10};
    const HexCoord SPREAD{4, 10};

    Army red, blue;

    auto enemy = std::make_unique<Soldier>(BLUETEAM);
    enemy->setHex(field.hexGrid.getHex(ENEMY));
    blue.push_back(std::move(enemy));

    Hex* origin = field.hexGrid.getHex(O);
    auto sqOwned = std::make_unique<Squad>("Spreaders", false);
    Squad* sq = sqOwned.get();
    for (int i = 0; i < 4; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(origin);
        sq->addMember(u.get());
        red.push_back(std::move(u));
    }

    // Fill the forward hex so the squad cannot advance-commit even after the
    // 25% loner displacement: sizeUsed 630 → available 10, max displace 10,
    // 10 + 10 = 20 < squad's 40. The forward hex stays passable, so BFS still
    // reaches the enemy (occupancy does not block pathing).
    Hex* fwd = field.hexGrid.getHex(FWD);
    for (int i = 0; i < 63; ++i) {
        auto u = std::make_unique<Soldier>(REDTEAM);
        u->setHex(fwd);
        red.push_back(std::move(u));
    }

    // Seal the other four neighbours so W{4,10} is the unique open spread target.
    field.hexGrid.getHex({6, 9})->impassable  = true; // NE
    field.hexGrid.getHex({5, 11})->impassable = true; // SE
    field.hexGrid.getHex({4, 11})->impassable = true; // SW
    field.hexGrid.getHex({5, 9})->impassable  = true; // NW

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sqOwned));

    field.moveSquad(*sq);

    for (AUnit* m : sq->getMembers()) {
        REQUIRE(m->getHex() != nullptr);
        CHECK(m->getHex()->coord == SPREAD); // spread as a whole block
    }
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

    // Both SE and SW are Open (cost 1) → equal-cost tie; getRandom(0,1) breaks it.
    // Either diagonal is correct; the test only checks r==15.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); // consumed by the equal-cost tiebreak

    field.flee(field.getTeam(REDTEAM)[0]);

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getAlive() == true);
    REQUIRE(unit->getHex()->coord.r == 15); // moved to higher r (south)

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

// ── Per-unit movement speed ──────────────────────────────────────────────────
// movementSpeed N = up to N one-hex steps per tick, re-evaluating target and
// engagement between steps. Terrain move-cost debt is paid one step at a time;
// fresh enemy contact ends the tick's movement.

namespace {
// Soldier with an overridden movement speed — for testing the step loop
// without depending on any particular unit type's stats.
struct FastSoldier : Soldier {
    FastSoldier(int t, int speed) : Soldier(t) { movementSpeed = speed; }
};
}

TEST_CASE("moveTeam: speed-3 LightCavalry covers three hexes in one tick", "[movement][speed]") {
    Battlefield& field = Utility::getBattlefield();

    auto cav = std::make_unique<LightCavalry>(REDTEAM);
    cav->setHex(field.hexGrid.getHex({0, 5}));
    auto enemy = std::make_unique<Soldier>(BLUETEAM);
    enemy->setHex(field.hexGrid.getHex({8, 5})); // distance 8 — no contact this tick

    Army red, blue;
    red.push_back(std::move(cav));
    blue.push_back(std::move(enemy));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveTeam(field.getTeamData(REDTEAM)); // blue never moves
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(HexGrid::distance(unit->getHex()->coord, {8, 5}) == 5);

    field.extractResult();
}

TEST_CASE("moveTeam: heavy Cavalry moves at the mount's pace of two", "[movement][speed]") {
    Battlefield& field = Utility::getBattlefield();

    auto cav = std::make_unique<Cavalry>(REDTEAM); // Soldier on a plain Horse — speed 2
    cav->setHex(field.hexGrid.getHex({0, 10}));
    auto enemy = std::make_unique<Soldier>(BLUETEAM);
    enemy->setHex(field.hexGrid.getHex({8, 10}));

    Army red, blue;
    red.push_back(std::move(cav));
    blue.push_back(std::move(enemy));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveTeam(field.getTeamData(REDTEAM));
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(HexGrid::distance(unit->getHex()->coord, {8, 10}) == 6);

    field.extractResult();
}

TEST_CASE("moveTeam: a fast unit stops stepping on fresh enemy contact", "[movement][speed]") {
    Battlefield& field = Utility::getBattlefield();

    // Distance 3 with speed 3: two steps reach adjacency; the third step must
    // NOT happen (no sliding along the front in the tick contact was made).
    auto cav = std::make_unique<LightCavalry>(REDTEAM);
    cav->setHex(field.hexGrid.getHex({0, 5}));
    auto enemy = std::make_unique<Soldier>(BLUETEAM);
    enemy->setHex(field.hexGrid.getHex({3, 5}));

    Army red, blue;
    red.push_back(std::move(cav));
    blue.push_back(std::move(enemy));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveTeam(field.getTeamData(REDTEAM));
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(HexGrid::distance(unit->getHex()->coord, {3, 5}) == 1);
    REQUIRE(unit->getHex()->coord == HexCoord{2, 5}); // straight approach, no lateral slide

    field.extractResult();
}

TEST_CASE("moveTeam: speed-2 unit pays forest move-cost debt within its own tick", "[movement][speed]") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {3,2}: NE into forest {1,4} (cost 2) is the
    // decreasing move. Step 1 enters the forest and takes 1 debt; step 2 pays
    // it off — so next tick the unit moves immediately instead of stalling.
    Hex* forestHex = field.hexGrid.getHex({1, 4});
    forestHex->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<FastSoldier>(REDTEAM, 2);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({3, 2}));

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    field.moveTeam(field.getTeamData(REDTEAM));
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex()->coord == HexCoord{1, 4});
    REQUIRE(unit->getSpentMove() == 0);

    forestHex->terrain = TerrainType::Open;
    field.extractResult();
}

TEST_CASE("moveUnits: a squad advances at its slowest member's speed", "[movement][speed][squad]") {
    Battlefield& field = Utility::getBattlefield();

    // Squads must be declared before the unit objects so they outlive them.
    auto fastOwned  = std::make_unique<Squad>("FastSquad", false);
    auto mixedOwned = std::make_unique<Squad>("MixedSquad", false);
    Squad* fastSq  = fastOwned.get();
    Squad* mixedSq = mixedOwned.get();

    Army red, blue;

    // Pure cavalry squad (all speed 2) at row 10.
    for (int i = 0; i < 2; ++i) {
        auto u = std::make_unique<Cavalry>(REDTEAM);
        u->setHex(field.hexGrid.getHex({0, 10}));
        fastSq->addMember(u.get());
        red.push_back(std::move(u));
    }
    // Mixed squad at row 18: a Cavalry slowed to a Soldier's walking pace.
    // Its target sits at distance 6, strictly nearer than the row-10 enemy
    // (distance 8 from {0,18}) so target choice can't tie on RNG.
    {
        auto c = std::make_unique<Cavalry>(REDTEAM);
        c->setHex(field.hexGrid.getHex({0, 18}));
        mixedSq->addMember(c.get());
        red.push_back(std::move(c));
        auto s = std::make_unique<Soldier>(REDTEAM);
        s->setHex(field.hexGrid.getHex({0, 18}));
        mixedSq->addMember(s.get());
        red.push_back(std::move(s));
    }
    // Static blue targets: hold forever so moveUnits() doesn't move them.
    for (HexCoord c : {HexCoord{8, 10}, HexCoord{6, 18}}) {
        auto u = std::make_unique<Soldier>(BLUETEAM);
        u->setHex(field.hexGrid.getHex(c));
        u->setHoldTurns(INT_MAX);
        blue.push_back(std::move(u));
    }

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(fastOwned));
    field.getTeamData(REDTEAM).squads.push_back(std::move(mixedOwned));

    field.moveUnits();

    REQUIRE(HexGrid::distance(fastSq->getFlagBearer()->getHex()->coord,  {8, 10}) == 6); // 2 steps
    REQUIRE(HexGrid::distance(mixedSq->getFlagBearer()->getHex()->coord, {6, 18}) == 5); // 1 step

    field.extractResult();
}

TEST_CASE("moveUnits: richer squad members aid a drained straggler at 3:1", "[movement][speed][squad]") {
    Battlefield& field = Utility::getBattlefield();

    auto sqOwned = std::make_unique<Squad>("EscortSquad", false);
    Squad* sq = sqOwned.get();

    Army red, blue;
    std::vector<AUnit*> cavs;
    for (int i = 0; i < 2; ++i) {
        auto u = std::make_unique<LightCavalry>(REDTEAM); // base 3 — can afford aid
        u->setHex(field.hexGrid.getHex({0, 10}));
        cavs.push_back(u.get());
        sq->addMember(u.get());
        red.push_back(std::move(u));
    }
    auto slowPtr = std::make_unique<Soldier>(REDTEAM); // base 1
    AUnit* slow = slowPtr.get();
    slow->setHex(field.hexGrid.getHex({0, 10}));
    slow->setMovePoints(-3); // deep in debt, e.g. after a marsh crossing
    sq->addMember(slow);
    red.push_back(std::move(slowPtr));

    auto enemy = std::make_unique<Soldier>(BLUETEAM);
    enemy->setHex(field.hexGrid.getHex({8, 10}));
    enemy->setHoldTurns(INT_MAX);
    blue.push_back(std::move(enemy));

    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sqOwned));

    // Tick 1: regain → cavs 3/3, straggler -2. Aid fires once (richest pays
    // 1 point three times → straggler +1 = -1), then nobody has 3 left, so
    // the squad waits in place.
    field.moveUnits();
    REQUIRE(HexGrid::distance(slow->getHex()->coord, {8, 10}) == 8);
    REQUIRE(slow->getMovePoints() == -1);

    // Tick 2: regain → cavs 3/3, straggler 0. Aid lifts him to +1 and the
    // squad finally advances a hex. Without aid he'd still be at 0, blocking.
    field.moveUnits();
    REQUIRE(HexGrid::distance(slow->getHex()->coord, {8, 10}) == 7);

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

// ── Flee: terrain cost preference ────────────────────────────────────────────
// The primary flee path tries SE and SW (red) and picks the cheaper one.
// With SW=Open (cost 1) and SE=Forest (cost 2), SW must win regardless of
// which diagonal is examined first.

TEST_CASE("flee: picks open SW over forest SE when both are primary flee directions") {
    Battlefield& field = Utility::getBattlefield();

    Hex* seHex = field.hexGrid.getHex({3, 15});
    seHex->terrain = TerrainType::Forest;

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setBroken(true);
    redPtr->setHex(field.hexGrid.getHex({3, 14}));

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    field.flee(field.getTeam(REDTEAM)[0]);

    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getAlive() == true);
    REQUIRE(unit->getHex()->coord.q == 2);
    REQUIRE(unit->getHex()->coord.r == 15);

    seHex->terrain = TerrainType::Open;
    field.extractResult();
}

// ── Hold order: movement suppression ─────────────────────────────────────────

TEST_CASE("hold order: lone unit does not advance while holdTurns > 0") {
    Battlefield& field = Utility::getBattlefield();

    // Red at {0,5}, Blue at {5,5}. Red would normally advance E each tick.
    auto redPtr  = std::make_unique<Soldier>(REDTEAM);
    auto bluePtr = std::make_unique<Soldier>(BLUETEAM);
    redPtr->setHex(field.hexGrid.getHex({0, 5}));
    bluePtr->setHex(field.hexGrid.getHex({5, 5}));
    redPtr->setHoldTurns(2);

    Army red, blue;
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    // Tick 1: still holding (holdTurns ticks from 2 → 1)
    field.moveUnits();
    AUnit* unit = field.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex()->coord.q == 0);
    REQUIRE(unit->getHoldTurns() == 1);

    // Tick 2: still holding (holdTurns ticks from 1 → 0)
    field.moveUnits();
    REQUIRE(unit->getHex()->coord.q == 0);
    REQUIRE(unit->getHoldTurns() == 0);

    // Tick 3: hold expired — unit should advance
    field.moveUnits();
    REQUIRE(HexGrid::distance(unit->getHex()->coord, {5, 5}) < 5);

    field.extractResult();
}

TEST_CASE("hold order: broken unit flees even when holdTurns > 0") {
    Battlefield& field = Utility::getBattlefield();

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setHex(field.hexGrid.getHex({3, 10}));
    redPtr->setBroken(true);
    redPtr->setHoldTurns(INT_MAX);

    Army red;
    red.push_back(std::move(redPtr));
    field.loadArmies(std::move(red), {});

    HexCoord before = field.getTeam(REDTEAM)[0]->getHex()->coord;
    field.moveUnits();
    HexCoord after  = field.getTeam(REDTEAM)[0]->getHex()->coord;
    REQUIRE(after != before); // fled despite hold order

    field.extractResult();
}

TEST_CASE("hold order: squad does not advance while holdTurns > 0") {
    Battlefield& field = Utility::getBattlefield();

    auto sq = std::make_unique<Squad>("Alpha", false);
    Squad* sqPtr = sq.get();

    auto a = std::make_unique<Soldier>(REDTEAM);
    auto b = std::make_unique<Soldier>(REDTEAM);
    a->setHex(field.hexGrid.getHex({0, 8}));
    b->setHex(field.hexGrid.getHex({0, 9}));
    sqPtr->setHoldTurns(2);

    Army red, blue;
    sqPtr->addMember(a.get());
    sqPtr->addMember(b.get());
    sqPtr->setFlagBearer(a.get());

    auto blueEnemy = std::make_unique<Soldier>(BLUETEAM);
    blueEnemy->setHex(field.hexGrid.getHex({5, 8}));
    blue.push_back(std::move(blueEnemy));
    red.push_back(std::move(a));
    red.push_back(std::move(b));
    field.loadArmies(std::move(red), std::move(blue));
    field.getTeamData(REDTEAM).squads.push_back(std::move(sq));

    HexCoord refBefore = field.getTeam(REDTEAM)[0]->getHex()->coord;

    // Two ticks: squad holds
    field.moveUnits();
    REQUIRE(field.getTeam(REDTEAM)[0]->getHex()->coord == refBefore);
    REQUIRE(sqPtr->getHoldTurns() == 1);

    field.moveUnits();
    REQUIRE(field.getTeam(REDTEAM)[0]->getHex()->coord == refBefore);
    REQUIRE(sqPtr->getHoldTurns() == 0);

    // Third tick: hold expired — squad advances
    field.moveUnits();
    REQUIRE(HexGrid::distance(field.getTeam(REDTEAM)[0]->getHex()->coord, {5, 8}) < 5);

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
