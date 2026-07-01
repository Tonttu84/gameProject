#include "BattleSetup.hpp"
#include "Utility.hpp"
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

        int hIter = Utility::getRandom(zone.hStart, zone.hEnd);
        int wIter = Utility::getRandom(zone.wStart, zone.wEnd);
        bool placed = false;

        auto canPlace = [&](Hex* hex) -> bool {
            if (!hex) return false;
            if (hex->sizeUsed + static_cast<int>(unit->getSize()) > Hex::CAPACITY) return false;
            for (AUnit* u : hex->units)
                if (u && u->getAlive() && u->getTeam() != unit->getTeam()) return false;
            return true;
        };

        for (int h = hIter; h <= zone.hEnd && !placed; ++h)
        {
            for (int w = (h == hIter ? wIter : zone.wStart); w <= zone.wEnd && !placed; ++w)
            {
                Hex* hex = field.hexGrid.getHex({w - h / 2, h}); // visual col → axial q
                if (canPlace(hex)) {
                    unit->setHex(hex);
                    unit->setPlaced(true);
                    placed = true;
                }
            }
        }

        if (!placed)
        {
            for (int h = zone.hStart; h < hIter && !placed; ++h)
            {
                for (int w = zone.wStart; w <= zone.wEnd && !placed; ++w)
                {
                    Hex* hex = field.hexGrid.getHex({w - h / 2, h}); // visual col → axial q
                    if (canPlace(hex)) {
                        unit->setHex(hex);
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
        assert(unit->getHex() && "Unit was not placed");
}
