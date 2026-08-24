#pragma once
#include "AUnit.hpp"
#include "WeaponList.hpp"

class Skeleton : public AUnit
{
public:
    static constexpr int SIZE = 10;

    Skeleton(int setTeam);
    ~Skeleton() noexcept = default;

    // Body plan (5-6): humanoid. It wears what a man wears — being dead does
    // not change where a helmet goes.
    const Anatomy& anatomy() const override { return anatomy::HUMANOID; }
};
