#pragma once
#include "Spell.hpp"
#include <string>
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

    // The roster as JSON, one row per FORM — the campaign server imports this
    // at boot the way it imports `dump-units`, so the C++ table stays the single
    // source of truth for what a spell costs and what it requires (slice 3,
    // S3-1). Pure-Holy and pure-Unholy forms export `school: null` rather than
    // being dropped: the whole roster crosses, and deciding which rows a screen
    // shows is the reader's business.
    std::string spellCatalogJson();

    // The garrison sally: a casterless reinforcement spell, modelled on
    // raise_dead. Summons `r.count` allied units of `r.unitType` (marked
    // battleSummon, so they never cross back as survivors) at the enemy's rear
    // edge and logs `r.message`. Unlike the roster spells above it takes no
    // AUnit caster — Battlefield::tick() invokes it on schedule. Written as a
    // free function so a future manual-cast path can call the same body.
    // Returns how many units were actually placed.
    int castGarrisonSally(Battlefield& field, const Reinforcement& r);
}
