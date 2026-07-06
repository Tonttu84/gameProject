#include "units/Necromancer.hpp"

// Stats + weapon + symbol only — raise_dead (including zombie/skeleton
// placement) lives in the spell roster (SpellList.cpp), name-gated to
// "Necromancer". See docs/UNITS_AS_DATA_PLAN.md R0.

Necromancer::Necromancer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'N';
    preferredRange = 3;
    setBallisticSkill(4);
    size = SIZE;
    mana = 99;
    assignSpells("Necromancer");
}

Necromancer::Necromancer() noexcept {
    setSpellcaster(true);
    printSymbol = 'N';
    mana = 99;
    assignSpells("Necromancer");
}
