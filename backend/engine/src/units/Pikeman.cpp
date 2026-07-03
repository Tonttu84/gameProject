#include "units/Pikeman.hpp"

Pikeman::Pikeman(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Pike)
{
    printSymbol = 'p';
    armour = LIGHTARMOUR;
    size = SIZE;
}
