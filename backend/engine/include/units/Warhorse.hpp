#pragma once

#include "units/Horse.hpp"

// A combat-trained mount: lightly armored and capable of attacking on its
// own (hoof strikes) when ridden — unlike a plain Horse, which carries no
// weapon and never fights (MountedUnit::battle() only triggers a mount
// attack when the mount actually has one).
class Warhorse : public Horse
{
public:
    static constexpr int SIZE = Horse::SIZE;

    explicit Warhorse(int setTeam);
    ~Warhorse() noexcept override = default;
};
