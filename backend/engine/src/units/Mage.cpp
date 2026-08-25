#include "units/Mage.hpp"

// Stats + weapon + symbol only — the fireball lives in the spell roster
// (SpellList.cpp), reached through Fire 1 rather than a
// name gate (M-18). See "THE MAGIC SYSTEM" in docs/CAMPAIGN_PLAN.md.

Mage::Mage(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'M';
    setBallisticSkill(12); // derives accuracy 60: 60% aimed chance, 6-hex aimed range
    preferredRange = 3;
    size = SIZE;
    setPathLevel(SpellPath::Fire, 1);
    assignSpells("Mage");
}

Mage::Mage() noexcept {
    setSpellcaster(true);
    printSymbol = 'M';
    setPathLevel(SpellPath::Fire, 1);
    assignSpells("Mage");
}
