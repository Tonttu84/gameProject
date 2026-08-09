#include "units/Zombie.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"


Zombie::Zombie(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 'Z';
    undead = true;
    morale = 99;
    attackPWR = 8;
    defence = 6;
    maxHP = 20;
    hitpoints = 20;
    unitValue = 5;
    strength = 12;
    addWeapon(MeleeWeapons::Claws);
    setBallisticSkill(1); // dead hands throw nothing straight
    fatigueCost = 0; //Undead dont need rest
    size = SIZE;

}



