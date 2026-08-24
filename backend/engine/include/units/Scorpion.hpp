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

    // Body plan (5-6): its own, because it is not a humanoid and not a horse.
    // Two CLAWS ride the `hand` slots — this is exactly the "4 armed monsters"
    // case decision 5-4 kept the counts flexible for, at two — and its eight
    // legs share one harness, the same way a horse's four do.
    const Anatomy& anatomy() const override { return CHELICERATE; }

private:
    static constexpr Anatomy CHELICERATE = slots(1, 1, 1, 2, 1);
};
