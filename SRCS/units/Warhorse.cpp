#include "units/Warhorse.hpp"

Warhorse::Warhorse(int setTeam): Horse(setTeam)
{
    size      = SIZE;
    armour    = LIGHTARMOUR;
    attackPWR = 9;
    addWeapon(MeleeWeapons::Hoof);
}
