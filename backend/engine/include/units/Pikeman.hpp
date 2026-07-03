#pragma once

#include "AUnit.hpp"
#include "Human.hpp"

// A two-handed pike (reach 4) — the long-reach infantry line that can still
// repel from support rank 2 (see [[design_repel]]/AUnit::resolveRepel()),
// where a reach-3 spear can only repel from the front rank.
class Pikeman : public Human
{
public:
    static constexpr int SIZE = 10;

    explicit Pikeman(int setTeam) noexcept;
    ~Pikeman() noexcept = default;
};
