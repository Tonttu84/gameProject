#pragma once

#include "AUnit.hpp"

// A forged construct (docs/CAMPAIGN_PLAN.md, Construction slice C3 / C-4): the
// only unit that enters play through the Crafted role — a mage's turn and a
// mithril price, never a recruit row. Campaign-side it is a CHARACTER (the
// special, likely only, mindless one); here it is simply a big, slow, tireless
// body that bears artifacts.
class Golem : public AUnit
{
public:
    static constexpr int SIZE = 15;

    explicit Golem(int setTeam);
    ~Golem() noexcept override = default;

    // Body plan (5-6): shaped like the man it is a statue of, and bearing
    // artifacts is the Dominions golem's whole point (C-4) — so the humanoid
    // layout, not a plan of its own.
    const Anatomy& anatomy() const override { return anatomy::HUMANOID; }
};
