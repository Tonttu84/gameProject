#pragma once
#include "Spell.hpp"
#include <vector>

class AUnit;

class Battlefield;
struct Reinforcement;

// The requirement-gated spell roster — mirrors WeaponList's role for weapons.
// Effect bodies live in SpellList.cpp as free functions; the engine stays a
// self-contained subprocess (no scripting layer, by decision in
// docs/UNITS_AS_DATA_PLAN.md).
namespace Spells
{
    const std::vector<Spell>& roster();

    // Can this caster cast this form right now? Checks BOTH gates a spell
    // passes (M-9): every path requirement against the caster's own levels, and
    // the school requirement against the ARMY's level for that side. Evaluated
    // per cast rather than once at construction, because research (M-6) and the
    // encounter (M-19) can both move the school line while the unit is alive.
    bool qualifies(const AUnit& caster, const SpellForm& form);

    // The caster's ordered default list — every roster entry, in roster order.
    // M-22: this walk IS a script, so slice 4 replaces the list rather than
    // adding a second selection path. Resolved once at unit construction
    // (AUnit::assignSpells).
    const std::vector<const Spell*>& defaultScript();

    // The garrison sally: a casterless reinforcement spell, modelled on
    // raise_dead. Summons `r.count` allied units of `r.unitType` (marked
    // battleSummon, so they never cross back as survivors) at the enemy's rear
    // edge and logs `r.message`. Unlike the roster spells above it takes no
    // AUnit caster — Battlefield::tick() invokes it on schedule. Written as a
    // free function so a future manual-cast path can call the same body.
    // Returns how many units were actually placed.
    int castGarrisonSally(Battlefield& field, const Reinforcement& r);
}
