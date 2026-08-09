
#include "units/Soldier.hpp"


Soldier::Soldier(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::SwordAndShield)
{
    printSymbol = 'X';
    armour = HEAVYARMOUR;
    attackPWR = 11;
    defence = 12;
    setBallisticSkill(4); // drilled javelin throws, nothing more
    fatigueCost++; // Ekstra +1 fatigue from heavy armor
    size = SIZE;
}
