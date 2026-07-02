#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Soldier.hpp"

// ── Reserve-based reinforcement ──────────────────────────────────────────────
//
// "Reserve" = a unit with _engagedRank == 0 (never seated on any HexSide this
// tick, or evicted with nowhere to go) sitting in a hex that has at least one
// live adjacent enemy (AUnit::getEngaged()). Anything seated on a side — rank
// 1 (frontline), 2 (backup), or 3 (reserve-of-that-side) — is committed and
// never moves laterally; only unseated overflow is eligible to redistribute,
// purely by comparing reserve size-points against neighbors (no other
// qualifier on the destination).
//
// Coordinate reused from test_engagements.cpp: col=8, r=14 -> q = 8 - 14/2 = 1,
// all 6 neighbours valid in the 16x30 grid. nb[0]=NE nb[1]=E nb[2]=SE
// nb[3]=SW nb[4]=W nb[5]=NW.
static constexpr HexCoord RED_HEX = {1, 14};

static std::vector<AUnit*> placeSoldiers(Army& army, Hex* hex, int count, int team) {
    std::vector<AUnit*> ptrs;
    for (int i = 0; i < count; ++i) {
        auto u = std::make_unique<Soldier>(team);
        u->setHex(hex);
        ptrs.push_back(u.get());
        army.push_back(std::move(u));
    }
    return ptrs;
}

static int aliveInHex(const Hex* hex, int team) {
    int n = 0;
    for (AUnit* u : hex->units)
        if (u && u->getAlive() && u->getTeam() == team) ++n;
    return n;
}

TEST_CASE("reinforce: overflow reserve unit leaves a saturated engaged hex for an empty neighbor") {
    // 13 loners on one engaged side: FRONTAGE=40, Soldier size=10 -> 4 per rank
    // x 3 ranks = 12 seated, 13th stays unseated (rank 0) — same capacity math
    // as the "beyond 3-rank capacity" combat-ranks test.
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(RED_HEX);
    Hex* enHex = bf.hexGrid.getHex(nb[0]);
    REQUIRE(enHex != nullptr);

    Army red, blue;
    auto reds  = placeSoldiers(red, redHex, 13, REDTEAM);
    placeSoldiers(blue, enHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();

    AUnit* overflow = nullptr;
    int seatedCount = 0;
    for (AUnit* u : reds) {
        if (u->getEngagedRank() == 0) overflow = u;
        else ++seatedCount;
    }
    REQUIRE(overflow != nullptr);
    REQUIRE(seatedCount == 12);

    bf.moveUnits();

    // The overflow unit must leave redHex for some passable neighbor (not the
    // enemy-occupied hex); every seated unit must stay put.
    CHECK(overflow->getHex() != redHex);
    CHECK(overflow->getHex() != enHex);
    for (AUnit* u : reds)
        if (u != overflow) CHECK(u->getHex() == redHex);
}

TEST_CASE("reinforce: a seated unit never moves even when a neighbor is completely empty") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(RED_HEX);
    Hex* enHex = bf.hexGrid.getHex(nb[0]);
    REQUIRE(enHex != nullptr);

    Army red, blue;
    auto reds = placeSoldiers(red, redHex, 1, REDTEAM);
    placeSoldiers(blue, enHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();
    REQUIRE(reds[0]->getEngagedRank() == 1); // alone on the side, easily seated

    bf.moveUnits();

    CHECK(reds[0]->getHex() == redHex);
}

TEST_CASE("reinforce: picks the most-needy (fewest-reserve) neighbor when two qualify") {
    // 15 loners -> 12 seated + 3 unseated (reserve = 30 size-points).
    // Neighbor E has 1 soldier (reserve 10), neighbor SE has 2 (reserve 20) —
    // both qualify (< 30) but E is needier. SW/W/NW are sealed off (impassable)
    // so they can't undercut the comparison with an even-emptier hex.
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(RED_HEX);
    Hex* enHex = bf.hexGrid.getHex(nb[0]);
    Hex* nbE   = bf.hexGrid.getHex(nb[1]);
    Hex* nbSE  = bf.hexGrid.getHex(nb[2]);
    Hex* nbSW  = bf.hexGrid.getHex(nb[3]);
    Hex* nbW   = bf.hexGrid.getHex(nb[4]);
    Hex* nbNW  = bf.hexGrid.getHex(nb[5]);
    REQUIRE(enHex != nullptr);
    REQUIRE(nbE   != nullptr);
    REQUIRE(nbSE  != nullptr);
    REQUIRE(nbSW  != nullptr);
    REQUIRE(nbW   != nullptr);
    REQUIRE(nbNW  != nullptr);
    nbSW->impassable = true;
    nbW->impassable  = true;
    nbNW->impassable = true;

    // Seed units in nbE/nbSE are exhausted so moveTeam() skips them outright —
    // otherwise they'd chase the same distant enemy themselves (their own
    // nearest-enemy advance) and scramble the counts this test controls for.
    Army red, blue;
    placeSoldiers(red, redHex, 15, REDTEAM);
    for (AUnit* u : placeSoldiers(red, nbE,  1, REDTEAM)) u->addFatigue(FATIGUE_MAX);
    for (AUnit* u : placeSoldiers(red, nbSE, 2, REDTEAM)) u->addFatigue(FATIGUE_MAX);
    placeSoldiers(blue, enHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();
    bf.moveUnits();

    // Exactly one transfer happens (redHex 30 -> 20, nbE 10 -> 20; nbE then
    // ties redHex and stops qualifying, so nbSE never receives anyone).
    CHECK(aliveInHex(nbE,  REDTEAM) == 2);
    CHECK(aliveInHex(nbSE, REDTEAM) == 2);
    CHECK(aliveInHex(redHex, REDTEAM) == 14); // 12 seated + 2 remaining unseated
}

TEST_CASE("reinforce: no move when every neighbor's reserves are already >= the source's") {
    // 13 loners -> 1 unseated (reserve 10). Every other neighbor also holds
    // exactly 1 soldier (reserve 10, tied) -> nothing strictly less -> no move.
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(RED_HEX);
    Hex* enHex = bf.hexGrid.getHex(nb[0]);
    REQUIRE(enHex != nullptr);

    // Seed units are exhausted so moveTeam() skips them outright — see the
    // "most-needy neighbor" test above for why (otherwise they'd chase the
    // distant enemy themselves instead of sitting still as reserve markers).
    Army red, blue;
    auto reds = placeSoldiers(red, redHex, 13, REDTEAM);
    std::vector<Hex*> others;
    for (size_t i = 1; i < nb.size(); ++i) {
        Hex* h = bf.hexGrid.getHex(nb[i]);
        REQUIRE(h != nullptr);
        for (AUnit* u : placeSoldiers(red, h, 1, REDTEAM)) u->addFatigue(FATIGUE_MAX);
        others.push_back(h);
    }
    placeSoldiers(blue, enHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();
    AUnit* overflow = nullptr;
    for (AUnit* u : reds) if (u->getEngagedRank() == 0) overflow = u;
    REQUIRE(overflow != nullptr);

    bf.moveUnits();

    CHECK(overflow->getHex() == redHex);
    for (Hex* h : others)
        CHECK(aliveInHex(h, REDTEAM) == 1); // unchanged
}

TEST_CASE("reinforce: a hex with no adjacent enemy never triggers reserve redistribution") {
    // No enemy neighbors redHex at all here -> AUnit::getEngaged() is false for
    // everyone in it, so the whole reserve-comparison path must never run, no
    // matter how empty a neighbor is. Enemy is placed far away purely so
    // findTarget() still returns something (a fully targetless unit returns
    // from moveToward before any movement logic runs at all, which would make
    // this test pass vacuously and prove nothing).
    Battlefield bf;
    HexCoord testCoord = {1, 10};
    Hex* testHex = bf.hexGrid.getHex(testCoord);
    REQUIRE(testHex != nullptr);
    HexCoord farCoord = {1, 25};
    Hex* farHex = bf.hexGrid.getHex(farCoord);
    REQUIRE(farHex != nullptr);

    Army red, blue;
    auto reds = placeSoldiers(red, testHex, 5, REDTEAM);
    placeSoldiers(blue, farHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    // Neighbor with the WORST (largest) distance to the enemy: ordinary
    // advance logic (decreasing or equal distance only) would never pick it,
    // so if the unit ends up there, only a wrongly-unconditional reserve scan
    // could have sent it — exactly what this test guards against.
    auto nb = bf.hexGrid.neighbors(testCoord);
    int curDist = HexGrid::distance(testCoord, farCoord);
    Hex* awayHex = nullptr;
    int worstDist = curDist;
    for (const HexCoord& nc : nb) {
        Hex* nh = bf.hexGrid.getHex(nc);
        if (!nh) continue;
        int d = HexGrid::distance(nc, farCoord);
        if (d > worstDist) { worstDist = d; awayHex = nh; }
    }
    REQUIRE(awayHex != nullptr);

    bf.resolveEngagements(); // no engaged side touches testHex; all ranks stay 0
    for (AUnit* u : reds) REQUIRE(u->getEngagedRank() == 0);

    bf.moveUnits();

    for (AUnit* u : reds)
        CHECK(u->getHex() != awayHex);
}

TEST_CASE("reinforce: overflow self-balances across neighbors within a single tick") {
    // 15 loners -> 12 seated + 3 unseated (reserve 30). Two empty, otherwise
    // equally-reachable neighbors (E, SE); the rest sealed off as impassable
    // so they can't interfere. Each unit's move re-reads live reserve counts,
    // so the transfers should stop exactly at the 10/10/10 equilibrium
    // regardless of which neighbor happens to be tried first.
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(RED_HEX);
    Hex* enHex = bf.hexGrid.getHex(nb[0]);
    Hex* nbE   = bf.hexGrid.getHex(nb[1]);
    Hex* nbSE  = bf.hexGrid.getHex(nb[2]);
    Hex* nbSW  = bf.hexGrid.getHex(nb[3]);
    Hex* nbW   = bf.hexGrid.getHex(nb[4]);
    Hex* nbNW  = bf.hexGrid.getHex(nb[5]);
    REQUIRE(enHex != nullptr);
    REQUIRE(nbE   != nullptr);
    REQUIRE(nbSE  != nullptr);
    REQUIRE(nbSW  != nullptr);
    REQUIRE(nbW   != nullptr);
    REQUIRE(nbNW  != nullptr);
    nbSW->impassable = true;
    nbW->impassable  = true;
    nbNW->impassable = true;

    Army red, blue;
    placeSoldiers(red, redHex, 15, REDTEAM);
    placeSoldiers(blue, enHex, 1, BLUETEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();
    bf.moveUnits();

    CHECK(aliveInHex(redHex, REDTEAM) == 13); // 12 seated + 1 remaining unseated
    CHECK(aliveInHex(nbE,  REDTEAM) == 1);
    CHECK(aliveInHex(nbSE, REDTEAM) == 1);
}
