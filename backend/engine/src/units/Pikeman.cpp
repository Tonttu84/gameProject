#include "units/Pikeman.hpp"

Pikeman::Pikeman(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Pike)
{
    printSymbol = 'p';
    armour = LIGHTARMOUR;
    setBallisticSkill(4); // drilled javelin throws, nothing more
    size = SIZE;
}
