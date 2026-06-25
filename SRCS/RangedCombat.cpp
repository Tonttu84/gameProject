#include "../HDRS/RangedCombat.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"

std::unordered_map<const Hex*, RangedCombat::SlotCache> RangedCombat::cache;

void RangedCombat::resetCache()
{
    cache.clear();
}

const RangedCombat::SlotCache& RangedCombat::getSlotCache(const Hex* hex)
{
    auto it = cache.find(hex);
    if (it != cache.end()) return it->second;

    SlotCache& sc = cache[hex];
    for (AUnit* u : hex->units)
        if (u) sc.units.push_back(u);
    return sc;
}

AUnit* RangedCombat::pickHexTarget(const Hex* hex)
{
    const SlotCache& sc = getSlotCache(hex);
    if (sc.units.empty()) return nullptr;

    // Roll 1–640 and walk the cumulative size ranges to find who gets hit.
    // A hex with 3 size-10 humans occupies slots 1-30 out of 640;
    // the remaining 610 slots are empty ground — sparse lines are hard to hit.
    int roll       = Utility::getRandom(1, Hex::CAPACITY);
    int cumulative = 0;
    for (AUnit* u : sc.units) {
        cumulative += static_cast<int>(u->getSize());
        if (roll <= cumulative) return u;
    }
    return nullptr; // projectile hit empty ground
}

AUnit* RangedCombat::resolveHit(AUnit* intendedTarget, Hex* landedHex,
                                int distance, int accuracy)
{
    // Aimed individual hit: unit is still in the landed hex, within aimed range
    // (accuracy/10 hexes), and the accuracy roll succeeds.
    if (intendedTarget
        && intendedTarget->getAlive()
        && intendedTarget->getHex() == landedHex
        && distance <= accuracy / 10
        && Utility::getRandom(1, 100) <= accuracy)
    {
        return intendedTarget;
    }

    // Fallback: random weighted hit within the hex.
    return pickHexTarget(landedHex);
}
