#include "units/Mage.hpp"

// Stats + weapon + symbol only — the fireball lives in the spell roster
// (SpellList.cpp), name-gated to "Mage". See docs/UNITS_AS_DATA_PLAN.md R0.

Mage::Mage(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'M';
    setBallisticSkill(12); // derives accuracy 60: 60% aimed chance, 6-hex aimed range
    preferredRange = 3;
    size = SIZE;
    mana = 99;
    assignSpells("Mage");
}

Mage::Mage() noexcept {
    setSpellcaster(true);
    printSymbol = 'M';
    mana = 99;
    assignSpells("Mage");
}
