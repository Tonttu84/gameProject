#include "units/Scorpion.hpp"

Scorpion::Scorpion(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 's';
    setCategory(UnitCategory::Mounted);
    hitpoints = 18;
    maxHP     = 18;
    armour    = LIGHTARMOUR;  // chitin shell
    defence   = 8;            // armored but not especially evasive
    attackPWR = 8;
    unitValue = 6;
    movementSpeed = 18;       // a scuttling giant animal — quicker than foot (10), no horse (28)
    setBallisticSkill(1);
    resistance = RESIST_BEAST;   // T-4: an animal has no will to speak of
    addWeapon(MeleeWeapons::Stinger);
    size      = SIZE;
}
