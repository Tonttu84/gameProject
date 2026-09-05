#include "units/Zombie.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"


Zombie::Zombie(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 'Z';
    // Undead | Mindless — and Mindless IMPLIES Fearless, so the morale
    // immunity is declared once, here, rather than also faked with a morale
    // of 99 the way it used to be (slice 6, 6-4).
    setInnateAbilities(UnitAbility::Undead | UnitAbility::Mindless);
    attackPWR = 8;
    defence = 6;
    maxHP = 20;
    hitpoints = 20;
    unitValue = 5;
    strength = 12;
    addWeapon(MeleeWeapons::Claws);
    setBallisticSkill(1); // dead hands throw nothing straight
    fatigueCost = 0; //Undead dont need rest
    resistance = RESIST_UNDEAD;   // T-4: little left in it for a spell to work on
    size = SIZE;

}



