#include "units/Warhorse.hpp"

Warhorse::Warhorse(int setTeam): Horse(setTeam)
{
    armour    = LIGHTARMOUR;
    attackPWR = 9;
    addWeapon(MeleeWeapons::Hoof);
}
