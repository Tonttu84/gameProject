#include "units/RoyalGuard.hpp"


RoyalGuard::RoyalGuard(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Halberd)
{
    printSymbol = 'G';
    armour = HEAVYARMOUR;
    hitpoints = 14;
    maxHP     = 14;
    attackPWR = 13;
    defence   = 14;   // set flat, so the halberd's own modifier is not counted twice
    morale    = 13;
    unitValue = 15;   // the obvious spell target — the counter to a guard squad
    setBallisticSkill(4); // drilled javelin throws, nothing more
    fatigueCost++; // Ekstra +1 fatigue from heavy armor
    size = SIZE;
}
