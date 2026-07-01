#include "campaign/SpreadTest.hpp"
#include "campaign/SampleBattle.hpp"
#include "BattleSetup.hpp"
#include "units/Soldier.hpp"
#include "hex/HexGrid.hpp"
#include <iostream>

// Scenario: 3×2 grid of hexes — two engaged hexes per team, with the centre hex
// "overfull" and the flanks "light".  When both centre hexes are engaged, the
// shouldSpreadToward() logic should pull excess units from the centre outward
// into the flanking engaged hexes.
//
// Visual layout (even-r offset col, row — battle area rows 12-17):
//
//   col:  6        7        8
//  row 12: [B-lt] [B-FULL] [B-lt]   <- blue light / full / light (adjacent cols)
//  row 17: [R-lt] [R-FULL] [R-lt]   <- red  light / full / light
//
// Blue centre (7,12): 40 Soldiers  — "full"
// Blue left   (5,12): 15 Soldiers  — "light"
// Blue right  (9,12): 15 Soldiers  — "light"
// Red  centre (7,17): 40 Soldiers  — "full"
// Red  left   (5,17): 15 Soldiers  — "light"
// Red  right  (9,17): 15 Soldiers  — "light"
//
// Terrain is set on the gap rows (cols 4-10, rows 13-16) to the current type,
// then cycled through Open / Forest / Marsh / Rubble.

static void setTerrainBlock(Battlefield& field, TerrainType t)
{
    for (int r = 13; r <= 16; ++r)
        for (int c = 4; c <= 10; ++c) {
            Hex* h = field.hexGrid.getHex({c - r / 2, r});
            if (h) h->terrain = t;
        }
}

static void resetTerrainBlock(Battlefield& field)
{
    // Restore the battle-area gap rows back to Open so sub-battles don't
    // inherit the previous terrain type.
    setTerrainBlock(field, TerrainType::Open);
}

static void placeUnits(Army& army, Battlefield& field, int col, int row,
                       int count, int team)
{
    Hex* h = field.hexGrid.getHex({col - row / 2, row});
    if (!h) {
        std::cerr << "[SpreadTest] WARNING: hex (" << col << "," << row
                  << ") not found — skipping " << count << " units\n";
        return;
    }
    for (int i = 0; i < count; ++i) {
        auto u = std::make_unique<Soldier>(team);
        u->setHex(h);
        u->setPlaced(true);
        army.push_back(std::move(u));
    }
}

static void setupSpreadBattle(Battlefield& field, TerrainType t)
{
    // 1. Set terrain on the gap rows BEFORE loadArmies (computeDistances uses it).
    setTerrainBlock(field, t);

    // 2. Build armies with manually placed units.
    Army blue;
    placeUnits(blue, field, 7, 12, 40, BLUETEAM);  // centre — overfull
    placeUnits(blue, field, 6, 12, 15, BLUETEAM);  // left   — light (col 6 adj to col 7)
    placeUnits(blue, field, 8, 12, 15, BLUETEAM);  // right  — light (col 8 adj to col 7)

    Army red;
    placeUnits(red, field, 7, 17, 40, REDTEAM);    // centre — overfull
    placeUnits(red, field, 6, 17, 15, REDTEAM);    // left   — light
    placeUnits(red, field, 8, 17, 15, REDTEAM);    // right  — light

    // loadArmies takes ownership and calls computeDistances.
    field.loadArmies(std::move(red), std::move(blue));
}

void runSpreadTest(Battlefield& field, BattleRenderer& renderer)
{
    struct TerrainCase {
        TerrainType type;
        const char* label;
    };

    constexpr TerrainCase cases[] = {
        { TerrainType::Open,   "Spreading: Open"   },
        { TerrainType::Forest, "Spreading: Forest" },
        { TerrainType::Marsh,  "Spreading: Marsh"  },
        { TerrainType::Rubble, "Spreading: Rubble" },
    };

    for (const auto& tc : cases) {
        // reset() clears units and hex occupancy but NOT terrain — we do that
        // explicitly inside setupSpreadBattle via setTerrainBlock().
        field.reset();
        resetTerrainBlock(field); // ensure previous sub-battle terrain is gone

        setupSpreadBattle(field, tc.type);

        BattleResult result = runBattleLoop(field, renderer, tc.label);

        std::cout << "\n[SpreadTest] " << tc.label << " ended. ";
        if      (result.winner == REDTEAM)  std::cout << "Red wins.\n";
        else if (result.winner == BLUETEAM) std::cout << "Blue wins.\n";
        else                                std::cout << "Draw.\n";
        std::cout << "  Red survivors: "  << result.redSurvivors.size()
                  << "  Blue survivors: " << result.blueSurvivors.size() << "\n";

        // If the window was closed mid-battle, stop.
        if (!renderer.getWindow().isOpen())
            return;
    }
}
