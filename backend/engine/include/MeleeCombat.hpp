#pragma once

#include "Defines.hpp"
#include <functional>

class AUnit;

// Describes a single melee attack. Callers pre-compute hitBonus and damage
// from weapon stats, strength, cohesion, elevation, and terrain, then
// provide optional callbacks for attack-specific effects.
struct MeleeAttack {
    int      hitBonus = 0;    // pre-computed attack-roll bonus (elevation, cohesion, etc.)
    int      damage   = 0;    // base damage (weapon + strength/divider + cohesion)
    ArmorPen pen      = ArmorPen::Normal;
    int      reach    = 0;    // attacker's weapon reach — only consulted by MountedUnit
                               // targets, to shift the mount/rider hit-roll toward the rider

    // Fires once the attacker's own attack roll (hitResult) is computed, but
    // BEFORE target->defend() is called — so before defend()'s own to-hit
    // check (does the attack beat the defender's defence roll at all), and
    // well before shield/armour/damage. Despite the name "onAttack" rather
    // than "onHit": this is the attack *attempt*, not a confirmed landed hit
    // — repel (see AUnit::resolveRepel()) deliberately uses this to interrupt
    // even attacks that would have missed anyway, matching its own
    // self-contained opposed roll rather than gating on the normal to-hit check.
    // Set blocked=true to fully intercept the attack — defend() is skipped.
    std::function<void(AUnit* attacker, AUnit* target, bool& blocked)> onAttack;

    // Fires only when finalDamage > 0, after defend() returns.
    std::function<void(AUnit* attacker, AUnit* target, int damage)> onDamage;
};

class MeleeCombat
{
public:
    // Full melee attack pipeline: attack roll, onAttack callback, defend() damage
    // phase (which applies the MULTI_ATTACK_DEFENCE_PENALTY per prior attack),
    // attacks-received counter increment, onDamage callback.
    //
    // The counter increments AFTER defend() so the first attacker in a turn
    // faces an unmodified defence; each subsequent attacker adds one penalty.
    // Counter is reset at the start of Battlefield::makeBattle() each tick.
    static void engage(AUnit* attacker, AUnit* target, const MeleeAttack& shot);

    MeleeCombat() = delete;
};
