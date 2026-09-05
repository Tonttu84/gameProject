#include "units/Priest.hpp"

// Stats + weapon + symbol only — bless lives in the spell roster
// (SpellList.cpp), reached through Holy 1 rather than a
// name gate (M-18). See "THE MAGIC SYSTEM" in docs/CAMPAIGN_PLAN.md.

Priest::Priest(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::MaceAndShield)
{
    setSpellcaster(true);
    printSymbol    = 'P';
    preferredRange = 3;
    setBallisticSkill(4);
    size = SIZE;
    resistance = RESIST_CASTER;   // T-4: a trained will
    setPathLevel(SpellPath::Holy, 1);
    assignSpells("Priest");
}

Priest::Priest() noexcept {
    setSpellcaster(true);
    resistance = RESIST_CASTER;
    setPathLevel(SpellPath::Holy, 1);
    assignSpells("Priest");
}
