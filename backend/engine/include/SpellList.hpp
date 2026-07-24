#pragma once
#include "Spell.hpp"
#include <vector>

class Battlefield;
struct Reinforcement;

// The requirement-gated spell roster — mirrors WeaponList's role for weapons.
// Effect bodies live in SpellList.cpp as free functions; the engine stays a
// self-contained subprocess (no scripting layer, by decision in
// docs/UNITS_AS_DATA_PLAN.md).
namespace Spells
{
    const std::vector<Spell>& roster();

    // Every roster spell whose requirements `unitTypeName` satisfies, in
    // roster order. Resolved once at unit construction (AUnit::assignSpells).
    std::vector<const Spell*> forUnitType(std::string_view unitTypeName);

    // The garrison sally: a casterless reinforcement spell, modelled on
    // raise_dead. Summons `r.count` allied units of `r.unitType` (marked
    // battleSummon, so they never cross back as survivors) at the enemy's rear
    // edge and logs `r.message`. Unlike the roster spells above it takes no
    // AUnit caster — Battlefield::tick() invokes it on schedule. Written as a
    // free function so a future manual-cast path can call the same body.
    // Returns how many units were actually placed.
    int castGarrisonSally(Battlefield& field, const Reinforcement& r);
}
