#include "units/Militia.hpp"

Militia::Militia(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Spear)
{
    printSymbol = 'm';
    armour = LIGHTARMOUR;
    setBallisticSkill(4); // drilled javelin throws, nothing more
    size = SIZE;
}
