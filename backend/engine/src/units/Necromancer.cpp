#include "units/Necromancer.hpp"

// Stats + weapon + symbol only — raise_dead (including zombie/skeleton
// placement) lives in the spell roster (SpellList.cpp), reached through Death 1
// rather than a name gate (M-18). See "THE MAGIC SYSTEM" in docs/CAMPAIGN_PLAN.md.

Necromancer::Necromancer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'N';
    preferredRange = 3;
    setBallisticSkill(4);
    size = SIZE;
    resistance = RESIST_CASTER;   // T-4: a trained will
    setPathLevel(SpellPath::Death, 1);
    assignSpells("Necromancer");
}

Necromancer::Necromancer() noexcept {
    setSpellcaster(true);
    printSymbol = 'N';
    resistance = RESIST_CASTER;
    setPathLevel(SpellPath::Death, 1);
    assignSpells("Necromancer");
}
