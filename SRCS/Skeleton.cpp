#include "../HDRS/Skeleton.hpp"

Skeleton::Skeleton(int setTeam) : AUnit(setTeam)
{
    printSymbol = 'S';
    undead      = true;
    morale      = 99;   // undead — never breaks
    fatigueCost = 0;    // no fatigue, no flesh to tire
    unitValue   = 3;

    // More skilled than a zombie (faster, precise strikes) but fragile —
    // brittle old bones with no muscle mass.
    // HP: ~40% of a human's 10 = 4. One solid hit ends it.
    // AttackPWR/defence above zombie (8/6) but below human (10/10).
    // Low strength: deals less raw damage despite high accuracy.
    attackPWR  = 9;
    defence    = 9;  // +Claws(-1) = 8 effective
    strength   = 6;
    maxHP      = 4;
    hitpoints  = 4;

    addWeapon(MeleeWeapons::Claws);
}
