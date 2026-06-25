#include "../HDRS/BattleSetup.hpp"
#include "../HDRS/Utility.hpp"
#include <cassert>
#include <iostream>

void randomPlaceArmy(Army& army, Battlefield& field, PlacementZone zone)
{
    assert(zone.wEnd >= zone.wStart && "wEnd must be >= wStart");
    assert(zone.hEnd >= zone.hStart && "hEnd must be >= hStart");

    for (auto& unit : army)
    {
        if (unit->getPlaced())
            continue;

        int HIter = Utility::getRandom(zone.hStart, zone.hEnd);
        int WIter = Utility::getRandom(zone.wStart, zone.wEnd);
        bool placed = false;

        for (int h = HIter; h <= zone.hEnd && !placed; ++h)
        {
            for (int w = (h == HIter ? WIter : zone.wStart); w <= zone.wEnd && !placed; ++w)
            {
                if (field._battlefield[h][w].getUnit() == nullptr)
                {
                    field._battlefield[h][w].setUnit(unit.get());
                    unit->setCell(&field._battlefield[h][w]);
                    unit->setPlaced(true);
                    placed = true;
                }
            }
        }

        if (!placed)
        {
            for (int h = zone.hStart; h < HIter && !placed; ++h)
            {
                for (int w = zone.wStart; w <= zone.wEnd && !placed; ++w)
                {
                    if (field._battlefield[h][w].getUnit() == nullptr)
                    {
                        field._battlefield[h][w].setUnit(unit.get());
                        unit->setCell(&field._battlefield[h][w]);
                        unit->setPlaced(true);
                        placed = true;
                    }
                }
            }
        }

        if (!placed)
        {
            std::cerr << "randomPlaceArmy: zone is full\n";
            exit(1);
        }
    }

    for (const auto& unit : army)
        assert(unit->getCell() && "Unit was not placed");
}
