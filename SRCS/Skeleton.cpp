#include "../HDRS/Skeleton.hpp"
#include "../HDRS/Utility.hpp"

Skeleton::Skeleton(int setTeam) : AUnit(setTeam)
{
    printSymbol = 'S';
    undead      = true;
    morale      = 99;  // undead — never breaks
    fatigueCost = 0;   // no flesh, no fatigue
    unitValue   = 4;

    // Skilled but fragile: more nimble than a zombie, shatters when hit.
    // HP=4 (~40% of a human's 10). Low strength — old bones have no muscle.
    attackPWR = 9;
    defence   = 7;  // base before weapon modifier
    strength  = 6;
    maxHP     = 4;
    hitpoints = 4;

    // Random weapon — skeletons rise with whatever they were buried with.
    int weaponRoll = Utility::getRandom(1, 3);
    if (weaponRoll == 1) {
        addWeapon(MeleeWeapons::SwordAndShield);   // shield+sword: defensive, skilled
    } else if (weaponRoll == 2) {
        // Two-handed weapon: offensive, no shield
        int twoHander = Utility::getRandom(1, 3);
        if      (twoHander == 1) addWeapon(MeleeWeapons::Greatsword);
        else if (twoHander == 2) addWeapon(MeleeWeapons::Halberd);
        else                     addWeapon(MeleeWeapons::Greataxe);
    } else {
        addWeapon(MeleeWeapons::Claws);            // no weapon — bare bones
    }

    // Random armor — some skeletons still wear their burial kit.
    // 50% bare, 30% light (leather/chain), 20% heavy (old plate)
    int armorRoll = Utility::getRandom(1, 10);
    if      (armorRoll <= 5) armour = 0;
    else if (armorRoll <= 8) armour = LIGHTARMOUR;
    else                     armour = HEAVYARMOUR;
}
