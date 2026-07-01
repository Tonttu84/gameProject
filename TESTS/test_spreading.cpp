#include "catch.hpp"
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/units/Soldier.hpp"

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

TEST_CASE("shouldSpreadToward: blue spreads from overfull center into enemy-adjacent empty flank") {
    // Layout (even-r offset):
    //
    //   col 7   col 8
    //   [B×30]  empty    ← row 14  (blue)
    //   [R×10]           ← row 15  (red center only)
    //
    // Blue center (7,14) has ONE engaged side → threshold = 40×4 = 160 < 300 fresh.
    // Axial: blue={0,14}, red={0,15}.
    // (8,14) axial={1,14} is adjacent to red {0,15} → qualifies via hexAdjacentToEnemy.
    // (6,14) axial={-1,14} is NOT adjacent to red → never qualifies, not checked.
    //
    // This test specifically validates the hexAdjacentToEnemy fix: before the fix,
    // shouldSpreadToward required toHex to already be engaged, which was circular.

    Battlefield bf;
    Army blue, red;

    placeGroup(bf, blue, 7, 14, 30, BLUETEAM);
    placeGroup(bf, red,  7, 15, 10, REDTEAM);

    bf.loadArmies(std::move(red), std::move(blue));

    bool everBlueRIGHT = false;

    for (int t = 0; t < 20 && bf.tick(); ++t) {
        int c7 = aliveInCol(bf.hexGrid, 7, BLUETEAM);
        int c8 = aliveInCol(bf.hexGrid, 8, BLUETEAM);
        INFO("tick " << t + 1 << "  col7=" << c7 << "  col8=" << c8);
        if (c8 > 0) everBlueRIGHT = true;
    }

    CHECK(everBlueRIGHT);
}
