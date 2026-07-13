#include "units/Warhorse.hpp"

Warhorse::Warhorse(int setTeam): Horse(setTeam)
{
    size      = SIZE;
    armour    = LIGHTARMOUR;
    attackPWR = 9;
    reconTag  = -2; // bred for the charge, not the picket line
    addWeapon(MeleeWeapons::Hoof);
}
