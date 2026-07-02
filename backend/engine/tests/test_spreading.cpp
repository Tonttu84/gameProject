#include "catch.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "units/Soldier.hpp"

static HexCoord viz(int col, int row) { return {col - row / 2, row}; }

static int aliveInCol(const HexGrid& grid, int col, int team) {
    int n = 0;
    for (int row = 0; row < Battlefield::height; ++row) {
        const Hex* h = grid.getHex(viz(col, row));
        if (!h) continue;
        for (AUnit* u : h->units)
            if (u && u->getAlive() && u->getTeam() == team) ++n;
    }
    return n;
}

static void placeGroup(Battlefield& bf, Army& army,
                       int col, int row, int count, int team) {
    Hex* h = bf.hexGrid.getHex(viz(col, row));
    REQUIRE(h != nullptr);
    for (int i = 0; i < count; ++i) {
        auto u = std::make_unique<Soldier>(team);
        u->setHex(h);
        u->setPlaced(true);
        army.push_back(std::move(u));
    }
}

// ── Spreading regression ──────────────────────────────────────────────────────

TEST_CASE("reinforce: blue spreads from an overfull center into an empty flank") {
    // Layout (even-r offset):
    //
    //   col 7   col 8
    //   [B×30]  empty    ← row 14  (blue)
    //   [R×10]           ← row 15  (red center only)
    //
    // Blue center (7,14) has one engaged side (FRONTAGE=40 -> 4/rank * 3 ranks
    // = 12 seated), leaving 18 of the 30 Soldiers as rank-0 overflow reserves.
    // (8,14) axial={1,14} is empty (0 reserves) and a legal neighbor of the
    // blue center, so it qualifies as a reinforcement target — no requirement
    // that it itself be engaged or enemy-adjacent. The other empty neighbor,
    // (6,14) axial={-1,14}, would equally qualify now that adjacency-to-enemy
    // isn't required of the destination, so it's sealed off (impassable)
    // along with the remaining neighbors to make (8,14) the only legal
    // target — otherwise overflow ties between the two and which one gets
    // filled in any given run depends on the shared global RNG stream.

    Battlefield bf;
    Army blue, red;

    placeGroup(bf, blue, 7, 14, 30, BLUETEAM);
    placeGroup(bf, red,  7, 15, 10, REDTEAM);

    bf.hexGrid.getHex({1, 13})->impassable  = true; // NE of blue center
    bf.hexGrid.getHex({-1, 15})->impassable = true; // SW of blue center
    bf.hexGrid.getHex({0, 13})->impassable  = true; // NW of blue center
    bf.hexGrid.getHex({-1, 14})->impassable = true; // W of blue center (col 6)

    bf.loadArmies(std::move(red), std::move(blue));

    // Seat both sides before any movement. The armies are placed already in
    // contact, a state that never survives a tick boundary in a real battle
    // (resolveEngagements runs every tick right after moveUnits, so units
    // arriving at the line are seated the same tick). Without this, the
    // first moveUnits pass sees ALL 40 units as rank-0 reserves — including
    // red's 10, who move first and scatter into the empty hexes around
    // their own hex, sometimes occupying (8,14) and locking blue out of it.
    bf.resolveEngagements();

    bool everBlueRIGHT = false;

    // Movement/seating only (no makeBattle()/cleanup()) — this is purely a
    // redistribution demonstration, not a combat-outcome test, and running
    // full combat let red get wiped out within a couple of real ticks
    // (10 v 30), closing the engaged window before overflow could ever
    // redistribute and making the "ever" check flaky.
    for (int t = 0; t < 20; ++t) {
        bf.moveUnits();
        bf.resolveEngagements();
        int c7 = aliveInCol(bf.hexGrid, 7, BLUETEAM);
        int c8 = aliveInCol(bf.hexGrid, 8, BLUETEAM);
        INFO("tick " << t + 1 << "  col7=" << c7 << "  col8=" << c8);
        if (c8 > 0) everBlueRIGHT = true;
    }

    CHECK(everBlueRIGHT);
}
