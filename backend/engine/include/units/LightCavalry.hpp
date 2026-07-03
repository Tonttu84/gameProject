#pragma once

#include "units/Cavalry.hpp"

// Light cavalry: an unarmoured spear-and-javelin rider on a plain Horse.
// Faster than heavy Cavalry (movementSpeed 3 vs 2) and javelin-trained
// (ballistic skill 8), at the cost of the Soldier rider's heavy armour and
// shield. The campaign layer derives foraging/scouting value from
// speed + ballistic skill, which is where this unit earns its keep; in
// battle it is a fast but fragile flanker. Same rider/mount death behaviour
// as Cavalry (dismount in place / mount bolts).
class LightCavalry : public Cavalry
{
public:
    explicit LightCavalry(int setTeam);
    ~LightCavalry() noexcept override = default;
};
