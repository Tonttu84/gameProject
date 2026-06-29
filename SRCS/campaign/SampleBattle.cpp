#include "campaign/SampleBattle.hpp"
#include "BattleSetup.hpp"
#include "Squad.hpp"
#include "units/Soldier.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "units/Priest.hpp"
#include "units/Necromancer.hpp"

void setupSampleBattle(Battlefield& field)
{
    // ── Terrain setup ─────────────────────────────────────────────────────────
    // Terrain MUST be set before loadArmies so computeDistances sees the
    // correct passability layout.
    // Visual col c at row r → axial q = c - r/2  (even-r offset from buildRect)
    auto setTerrain = [&](int visualCol, int row, TerrainType t) {
        Hex* h = field.hexGrid.getHex({visualCol - row / 2, row});
        if (h) h->terrain = t;
    };
    auto setElev = [&](int visualCol, int row, int elev) {
        Hex* h = field.hexGrid.getHex({visualCol - row / 2, row});
        if (h) h->elevation = elev;
    };
    auto setImpassable = [&](int visualCol, int row) {
        Hex* h = field.hexGrid.getHex({visualCol - row / 2, row});
        if (h) h->impassable = true;
    };

    // Forest: left flank, cols 0-4, rows 13-17
    for (int r = 13; r <= 17; ++r)
        for (int c = 0; c <= 4; ++c)
            setTerrain(c, r, TerrainType::Forest);

    // Rubble: right flank, cols 11-15, rows 13-17
    for (int r = 13; r <= 17; ++r)
        for (int c = 11; c <= 15; ++c)
            setTerrain(c, r, TerrainType::Rubble);

    // Marsh: in front of the ridge, cols 6-9, rows 11-12
    for (int r = 11; r <= 12; ++r)
        for (int c = 6; c <= 9; ++c)
            setTerrain(c, r, TerrainType::Marsh);

    // Elevation ridge: centre, cols 5-10, rows 14-15 (tier 1)
    for (int r = 14; r <= 15; ++r)
        for (int c = 5; c <= 10; ++c)
            setElev(c, r, 1);

    // Rocky outcrop: centre, cols 6-9, rows 9-10.
    // Impassable cliff between the two armies — forces routing via forest (left)
    // or rubble (right) flanks instead of marching straight through the centre.
    for (int r = 9; r <= 10; ++r)
        for (int c = 6; c <= 9; ++c)
            setImpassable(c, r);

    // ── Armies ───────────────────────────────────────────────────────────────
    // Red: undead horde — soldiers, archers, necromancers raising zombies
    Army red;
    appendArmy<Soldier>     (red, 540, REDTEAM);
    appendArmy<Archer>      (red, 150, REDTEAM);
    appendArmy<Necromancer> (red,  11, REDTEAM);
    randomPlaceArmy(red, field, {0, field.width - 1, field.height * 3/4, field.height - 1});

    // Red squads: placed manually on specific hexes AFTER randomPlaceArmy so
    // they aren't scattered. Both hexes are in the red deployment zone (rows 22-29).
    auto redSq1 = std::make_unique<Squad>("Ironguard", false);
    {
        Hex* h = field.hexGrid.getHex({0, 23});
        for (int i = 0; i < 12; ++i) {
            auto u = std::make_unique<Soldier>(REDTEAM);
            u->setHex(h);
            redSq1->addMember(u.get());
            red.push_back(std::move(u));
        }
    }

    auto redSq2 = std::make_unique<Squad>("Bloodfist", false);
    {
        Hex* h = field.hexGrid.getHex({-1, 26});
        for (int i = 0; i < 15; ++i) {
            auto u = std::make_unique<Soldier>(REDTEAM);
            u->setHex(h);
            redSq2->addMember(u.get());
            red.push_back(std::move(u));
        }
    }

    // Blue: holy order — soldiers, archers, mages and priests
    Army blue;
    appendArmy<Soldier>(blue, 450, BLUETEAM);
    appendArmy<Archer> (blue, 150, BLUETEAM);
    appendArmy<Mage>   (blue,   7, BLUETEAM);
    appendArmy<Priest> (blue,   7, BLUETEAM);
    randomPlaceArmy(blue, field, {0, field.width - 1, 0, field.height / 4});

    // Blue squads: placed in the blue deployment zone (rows 0-7).
    auto blueSq1 = std::make_unique<Squad>("Silverbolt", false);
    {
        Hex* h = field.hexGrid.getHex({5, 4});
        for (int i = 0; i < 10; ++i) {
            auto u = std::make_unique<Soldier>(BLUETEAM);
            u->setHex(h);
            blueSq1->addMember(u.get());
            blue.push_back(std::move(u));
        }
    }

    auto blueSq2 = std::make_unique<Squad>("Dawnshield", false);
    {
        Hex* h = field.hexGrid.getHex({2, 7});
        for (int i = 0; i < 13; ++i) {
            auto u = std::make_unique<Soldier>(BLUETEAM);
            u->setHex(h);
            blueSq2->addMember(u.get());
            blue.push_back(std::move(u));
        }
    }

    // loadArmies calls computeDistances — terrain must be set before this line.
    field.loadArmies(std::move(red), std::move(blue));

    field.getTeamData(REDTEAM).squads.push_back(std::move(redSq1));
    field.getTeamData(REDTEAM).squads.push_back(std::move(redSq2));
    field.getTeamData(BLUETEAM).squads.push_back(std::move(blueSq1));
    field.getTeamData(BLUETEAM).squads.push_back(std::move(blueSq2));
}
