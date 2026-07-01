#include "catch.hpp"
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/units/Soldier.hpp"

// Visual offset (col, row) → axial HexCoord  [same mapping as SampleBattle/SpreadTest]
static HexCoord viz(int col, int row) { return {col - row / 2, row}; }

// Count alive units of a given team in visual column `col` (all rows).
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

// Place `count` Soldiers of `team` onto visual hex (col, row).
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

TEST_CASE("shouldSpreadToward: blue spreads from overfull center into empty adjacent flanks") {
    // Scenario — pre-placed at rows 14-15 so engagement starts on tick 1:
    //
    //   col 6   col 7   col 8
    //   empty  [B×30]  empty    ← row 14 (blue side)
    //   [R×5]  [R×25]  [R×5]   ← row 15 (red side)
    //
    // Blue center (col 7): 30 Soldiers  → freshSize=300, threshold=160 → 300>160, can spread
    // Red flanks (col 6/8 row 15) are each adjacent to the empty blue flank hex
    //   in the same column at row 14.  After the fix to shouldSpreadToward, that
    //   adjacency qualifies the empty flank hex as a spread target.
    //
    // Root cause of the old bug: shouldSpreadToward required toHex to be already
    // engaged, which is circular — an empty hex can't be engaged until someone
    // moves there.  The fix also accepts hexes adjacent to an enemy.

    Battlefield bf;
    Army blue, red;

    placeGroup(bf, blue, 7, 14, 30, BLUETEAM);  // centre — overfull
    placeGroup(bf, red,  7, 15, 25, REDTEAM);   // centre enemy — enough to hold for ~20 ticks
    placeGroup(bf, red,  6, 15,  5, REDTEAM);   // left enemy  (adj to empty (6,14))
    placeGroup(bf, red,  8, 15,  5, REDTEAM);   // right enemy (adj to empty (8,14))

    bf.loadArmies(std::move(red), std::move(blue));

    // Track whether blue EVER occupied the flank columns during the battle —
    // a final-state check is fragile because those units might march elsewhere
    // after defeating the red flankers.
    bool everBlueLEFT = false, everBlueRIGHT = false;

    for (int t = 0; t < 40 && bf.tick(); ++t) {
        int c6 = aliveInCol(bf.hexGrid, 6, BLUETEAM);
        int c7 = aliveInCol(bf.hexGrid, 7, BLUETEAM);
        int c8 = aliveInCol(bf.hexGrid, 8, BLUETEAM);
        INFO("tick " << t + 1 << "  col6=" << c6 << "  col7=" << c7 << "  col8=" << c8);
        if (c6 > 0) everBlueLEFT  = true;
        if (c8 > 0) everBlueRIGHT = true;
    }

    CHECK(everBlueLEFT);
    CHECK(everBlueRIGHT);
}
