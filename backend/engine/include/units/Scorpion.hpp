#pragma once

#include "AUnit.hpp"

// A combat-trained mount with unusually long reach (a tail stinger) — unlike
// Warhorse's Hoof (reach 0), Scorpion's Stinger (reach 3) can out-reach most
// riders, so it's the case where the *mount* — not the rider — is the one
// that can repel an attacker. See [[design_repel]].
class Scorpion : public AUnit
{
public:
    static constexpr int SIZE = 20;

    explicit Scorpion(int setTeam);
    ~Scorpion() noexcept override = default;
};
