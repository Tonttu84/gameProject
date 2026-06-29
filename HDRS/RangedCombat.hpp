#pragma once

#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include <functional>
#include <unordered_map>

class AUnit;

// Describes a single ranged shot. Callers fill in the relevant fields and
// optionally provide callbacks for attack-specific effects.
//
// fire() handles the structural pipeline (elevation, accuracy, deviation,
// hit resolution, universal block checks, damage, callbacks). Everything
// specific to a particular attack type — dice variance pre-rolled into
// baseDamage, physical shield rolls, magic resistance, AoE, life drain —
// belongs in onHit or onDamage.
struct RangedShot {
    int      baseDamage  = 0;
    int      accuracy    = 0;               // 0–100 base; fire() adjusts for elevation
    ArmorPen pen         = ArmorPen::Normal;

    // Called after the universal block checks (extraShield, terrain).
    // `blocked` is by reference so the callback can apply additional block
    // logic (physical shield, magic resist) and fire() will apply
    // SHIELDREDUCTION on the final value.
    // Both attacker and target are provided for stat-dependent effects
    // (magic penetration, life drain, etc.).
    std::function<void(AUnit* attacker, AUnit* target, bool& blocked)> onHit;

    // Called only when finalDamage > 0, after takeDamage.
    std::function<void(AUnit* attacker, AUnit* target, int damage)>    onDamage;
};

// All hit-resolution logic shared by ranged units (archers, mages, etc.).
//
// Slot-cache: the target hex is treated as a 640-slot pool keyed by unit size.
// The cache is built once per hex at the start of each special phase and reused
// for every shot that lands there. Units that die mid-phase stay in the table —
// arrows and spells don't have infinite speed.

class RangedCombat
{
public:
    // Call once at the start of every special phase to clear stale cache entries.
    static void resetCache();

    // Pick a random unit in a hex weighted by size (1–640 roll).
    // Returns nullptr if the hex was empty at phase start or the roll missed.
    static AUnit* pickHexTarget(const Hex* hex);

    // Resolve whether a shot hits the intended individual or a random unit in
    // the landed hex.
    //   - Aimed hit: intendedTarget is alive in landedHex, distance ≤ accuracy/10,
    //     and getRandom(1,100) ≤ accuracy.  Returns intendedTarget.
    //   - Otherwise: returns pickHexTarget(landedHex) — whoever the projectile
    //     finds in the formation.
    // Pass intendedTarget=nullptr to always get a random hex hit.
    static AUnit* resolveHit(AUnit* intendedTarget, Hex* landedHex,
                             int distance, int accuracy);

    // Full ranged attack pipeline: elevation, accuracy clamp, deviation,
    // hit resolution, universal block checks (extraShield + terrain),
    // onHit callback, damage, takeDamage, onDamage callback.
    //
    // Resource consumption (ammo, mana) and caller-specific accuracy
    // adjustments (e.g. forest aim penalty) are the caller's responsibility.
    static void fire(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot);

private:
    struct SlotCache {
        std::vector<AUnit*> units; // units present when the phase began
    };
    static std::unordered_map<const Hex*, SlotCache> cache;

    static const SlotCache& getSlotCache(const Hex* hex);

    RangedCombat() = delete;
};
