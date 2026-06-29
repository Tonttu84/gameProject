#pragma once

#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include <unordered_map>

class AUnit;

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

private:
    struct SlotCache {
        std::vector<AUnit*> units; // units present when the phase began
    };
    static std::unordered_map<const Hex*, SlotCache> cache;

    static const SlotCache& getSlotCache(const Hex* hex);

    RangedCombat() = delete;
};
