#include "units/Priest.hpp"

// Stats + weapon + symbol only — bless lives in the spell roster
// (SpellList.cpp), name-gated to "Priest". See docs/UNITS_AS_DATA_PLAN.md R0.

Priest::Priest(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::MaceAndShield)
{
    setSpellcaster(true);
    printSymbol    = 'P';
    preferredRange = 3;
    setBallisticSkill(4);
    size = SIZE;
    mana = 99;
    assignSpells("Priest");
}

Priest::Priest() noexcept {
    setSpellcaster(true);
    mana = 99;
    assignSpells("Priest");
}
