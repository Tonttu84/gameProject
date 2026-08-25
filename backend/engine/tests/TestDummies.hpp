#pragma once

#include "AUnit.hpp"
#include "Anatomy.hpp"

// ── Shared test dummies ───────────────────────────────────────────────────────
// Convention: when a test needs the opposing side to sit tight, use an immobile
// dummy rather than holding a real unit — the intent reads straight off the
// type, and a later tuning pass on Soldier can't quietly start moving the
// "stationary" enemy. Three copies of this class had drifted apart across
// test_movement.cpp, test_battle_length.cpp and test_main.cpp; this header is
// the one definition they now share.
//
// Header-only on purpose: the Makefile compiles every *.cpp under tests/ into
// the binary, so a .cpp here would be a translation unit with nothing in it.

// Never moves, never breaks. Ordinary body otherwise — 10 HP, no armour — so a
// test that wants a killable target gets one for free.
class ImmobileDummy : public AUnit {
public:
    explicit ImmobileDummy(int t) : AUnit(t) {
        movementSpeed = 0;   // never moves — can never reach the enemy
        morale        = 99;  // never breaks/flees
        printSymbol   = 'D';
    }

    // A test dummy is still a body: AUnit::anatomy() is pure virtual (5-6), so
    // declaring one is not optional even here. Humanoid — no test reads it, and
    // the point of the pure virtual is that "nothing reads it" is not an excuse
    // to leave it vague.
    const Anatomy& anatomy() const override { return anatomy::HUMANOID; }
};

// An ImmobileDummy that bow fire cannot hurt (armour 200 >> BOWDAMAGE 5) and
// that outlasts any melee. For tests that need a permanent target — e.g. an
// archer emptying its quiver.
class HighArmorDummy : public ImmobileDummy {
public:
    explicit HighArmorDummy(int t) : ImmobileDummy(t) {
        armour    = 200;
        hitpoints = 9999;
        maxHP     = 9999;
    }
};
