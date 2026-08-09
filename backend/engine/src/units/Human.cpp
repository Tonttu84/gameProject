#include "units/Human.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"


Human::Human(int setTeam, Weapon setWeapon): AUnit::AUnit(setTeam)
{
    this->printSymbol = 'X';
    addWeapon(setWeapon);
}



