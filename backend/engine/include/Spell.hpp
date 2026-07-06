#pragma once
#include <string_view>

class AUnit;

// A castable spell — roster data one level up from Weapon: the unit provides
// the stats (mana pool, cast-cooldown slot), the spell provides everything
// that is delivered. See docs/UNITS_AS_DATA_PLAN.md Stage R0.

struct SpellRequirement {
    // Stopgap gate until casters have spell paths (Stage R4): non-empty means
    // only the unit type with exactly this catalog name knows the spell.
    // Paths will extend this struct rather than replace it — genuinely unique
    // spells keep their exact-name requirement by design.
    std::string_view exactUnitType;
};

struct Spell {
    std::string_view id;       // "fireball" | "bless" | "raise_dead" | ...
    int manaCost;
    int cooldown;              // fed to setCast() after a successful cast
    SpellRequirement requirement;

    // Targeting + effect, moved verbatim from the old special() bodies.
    // Returns true if the spell actually fired — only then does the caller
    // (AUnit::castSpells) spend mana and start the cooldown, preserving the
    // old "no target, no cost" behavior of fireball and bless. raise_dead
    // reports true whenever its gates pass, matching the old raiseDead()
    // which paid mana and cooldown even when every summon placement failed.
    bool (*cast)(AUnit& caster);
};
