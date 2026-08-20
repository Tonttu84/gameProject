#include "Abilities.hpp"

#include <cstddef>
#include <iterator>

namespace {
    struct Implication { UnitAbility from; UnitAbility to; };

    // The whole table. Add a row here — never a second `|=` at a call site.
    constexpr Implication IMPLICATIONS[] = {
        { UnitAbility::Mindless, UnitAbility::Fearless },
        { UnitAbility::Undead,   UnitAbility::NoCorpse },
    };
}

UnitAbility abilityClosure(UnitAbility declared)
{
    // Fixed point rather than one pass: an implication whose target is itself
    // the source of another (A => B => C) must still resolve, and the table is
    // small enough that iterating to stability costs nothing. Bounded by the
    // table size — every round either adds a flag or is the last one.
    UnitAbility set = declared;
    for (size_t round = 0; round <= std::size(IMPLICATIONS); ++round) {
        UnitAbility before = set;
        for (const Implication& rule : IMPLICATIONS)
            if (hasAbilityFlag(set, rule.from)) set |= rule.to;
        if (set == before) break;
    }
    return set;
}
