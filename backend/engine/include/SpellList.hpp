#pragma once
#include "Spell.hpp"
#include <vector>

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
}
