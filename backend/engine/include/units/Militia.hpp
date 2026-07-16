#pragma once

#include "AUnit.hpp"
#include "Human.hpp"

// A spear-armed levy (reach 3) — cheap camp-raised bodies, one reach step
// short of Pikeman's dedicated Pike (reach 4) and without Soldier's trained
// attack/defence bonus or heavy armour. See docs/CAMPAIGN_PLAN.md (Stage 3
// militia follow-up) and docs/ADDING_UNITS.md for how this type is wired in.
class Militia : public Human
{
public:
    static constexpr int SIZE = 10;

    explicit Militia(int setTeam) noexcept;
    ~Militia() noexcept = default;
};
