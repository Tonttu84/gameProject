#pragma once

#include "AUnit.hpp"

// A plain mount: no independent attacks while stowed inside a MountedUnit.
// Fully normal AUnit otherwise — its own hitpoints/armour/defence/shield are
// what MountedUnit::defend()/takeDamage() resolve against when the mount is
// picked as the hit target. Once riderless (Cavalry::onRiderDeath), the
// surviving Cavalry object adopts these stats and reverts to looseCategory()
// (Beast by default — no rider to enforce the strict Mounted terrain ban) as
// a normal broken, fleeing unit — Horse itself is never placed in the hex
// grid independently.
class Horse : public AUnit
{
public:
    static constexpr int SIZE = 20;

    explicit Horse(int setTeam);
    ~Horse() noexcept override = default;
};
