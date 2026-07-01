#pragma once
#include "AUnit.hpp"
#include "WeaponList.hpp"

class Skeleton : public AUnit
{
public:
    static constexpr int SIZE = 10;

    Skeleton(int setTeam);
    ~Skeleton() noexcept = default;
};
