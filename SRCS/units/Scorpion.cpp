#include "units/Scorpion.hpp"

Scorpion::Scorpion(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 's';
    setCategory(UnitCategory::Mounted);
    hitpoints = 18;
    maxHP     = 18;
    armour    = LIGHTARMOUR;  // chitin shell
    defence   = 8;            // armored but not especially evasive
    attackPWR = 8;
    size      = 20;
    unitValue = 6;
    addWeapon(MeleeWeapons::Stinger);
}
