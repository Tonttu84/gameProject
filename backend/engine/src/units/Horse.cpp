#include "units/Horse.hpp"

Horse::Horse(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 'h';
    setCategory(UnitCategory::Mounted);
    hitpoints = 15;
    maxHP     = 15;
    armour    = 0;            // unarmored by default; a barded horse would set this higher
    defence   = 12;           // fast and evasive
    attackPWR = 0;             // never attacks independently while stowed
    unitValue = 5;
    size      = SIZE;
}
