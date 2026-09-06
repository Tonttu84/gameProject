#include "units/Golem.hpp"

// ALL NUMBERS BALANCE-DEFERRED (the C2 convention): chosen sane relative to
// the roster — tougher than a RoyalGuard, slower than any man — not tuned.
Golem::Golem(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 'g';
    // Mindless, not Undead: animated stone, never a corpse (C-4). Mindless
    // implies Fearless through the closure; NoCorpse is declared on its own
    // because what a golem leaves is rubble no necromancer can raise.
    setInnateAbilities(UnitAbility::Mindless | UnitAbility::NoCorpse);
    fatigueCost = 0;      // stone does not tire
    maxHP     = 35;
    hitpoints = 35;
    // A body of STONE, not a body OF armour (P-2): what used to be armour 7
    // is natural protection 7 and no armour at all, so a Stoneskin on a
    // golem finds him already past the floor and a suit of plate, if one is
    // ever forged for him, combines with the stone instead of stacking on it.
    armour            = 0;
    naturalProtection = GOLEM_NATURAL_PROTECTION;   // past plate (HEAVYARMOUR 5)
    defence   = 8;        // massive, not evasive
    attackPWR = 12;
    strength  = 20;
    unitValue = 18;       // a spell magnet, like the guard it out-weighs
    movementSpeed = 8;    // ponderous — slower than a marching man (10)
    setBallisticSkill(1); // it does not throw things
    resistance = RESIST_GOLEM;   // T-4: animated stone — the hardest thing to enchant
    addWeapon(MeleeWeapons::TitanFist);
    size = SIZE;
}
