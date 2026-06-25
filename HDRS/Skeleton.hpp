#pragma once
#include "AUnit.hpp"
#include "WeaponList.hpp"

class Skeleton : public AUnit
{
public:
    Skeleton(int setTeam);
    ~Skeleton() noexcept = default;
};
