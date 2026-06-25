#pragma once
#include "Battlefield.hpp"
#include <memory>

struct PlacementZone
{
    int wStart;
    int wEnd;
    int hStart;
    int hEnd;
};

template<typename UnitType>
void appendArmy(Army& army, size_t count, int team)
{
    for (size_t i = 0; i < count; ++i)
        army.push_back(std::make_unique<UnitType>(team));
}

void randomPlaceArmy(Army& army, Battlefield& field, PlacementZone zone);
