#pragma once

#include "units/MountedUnit.hpp"
#include "units/Horse.hpp"

// First concrete MountedUnit. No lance/charge bonus yet — kept deliberately
// simple. The default constructor pairs a real Soldier rider with a real
// plain Horse — no hand-typed/duplicated stats, just two real unit types.
class Cavalry : public MountedUnit
{
public:
    static constexpr int SIZE = Horse::SIZE;

    explicit Cavalry(int setTeam);                                          // Soldier on a plain Horse
    Cavalry(int setTeam, std::unique_ptr<AUnit> rider, std::unique_ptr<AUnit> mount); // any rider on any mount
    ~Cavalry() noexcept override = default;

protected:
    void onMountDeath() override;
    void onRiderDeath() override;
};
