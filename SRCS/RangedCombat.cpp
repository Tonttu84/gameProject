#include "../HDRS/RangedCombat.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"
#include <algorithm>

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

void RangedCombat::applyHit(AUnit* shooter, AUnit* target, const RangedShot& shot,
                            int baseDamage, int elevDmgBonus)
{
    bool extraBlocked   = target->tryBlockExtraShield();
    bool terrainBlocked = !extraBlocked && target->rollTerrainRangedBlock(shot.pen);
    bool blocked        = extraBlocked || terrainBlocked;

    if (shot.onHit) shot.onHit(shooter, target, blocked);

    // Forest cover (terrain block) is physical concealment: Piercing halves its
    // protection rather than negating it, matching defend()'s shield halving.
    // Extra-shield (force field) blocks aren't physical, so they keep the flat
    // reduction regardless of pen.
    int reduction = 0;
    if (blocked) {
        reduction = (terrainBlocked && shot.pen == ArmorPen::Piercing)
                    ? SHIELDREDUCTION / 2
                    : SHIELDREDUCTION;
    }

    int damage = baseDamage + elevDmgBonus - reduction;
    if (damage <= 0) return;

    target->takeDamage(damage, shot.pen);
    if (shot.onDamage) shot.onDamage(shooter, target, damage);
}

void RangedCombat::fire(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot)
{
    if (!shooter || !shooter->getHex() || !aimUnit || !aimUnit->getHex()) return;

    int dist = Utility::calcDistance(shooter->getHex(), aimUnit->getHex());

    int elevTiers    = std::clamp(shooter->getHex()->elevation - aimUnit->getHex()->elevation,
                                  -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;
    int shotAccuracy = std::clamp(shot.accuracy + elevTiers * ELEV_RANGED_BONUS * 10, 0, 100);

    Hex* landedHex = Utility::Deviate(*shooter->getHex(),
                                      aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r,
                                      shotAccuracy);
    if (!landedHex) return;

    AUnit* target = resolveHit(aimUnit, landedHex, dist, shotAccuracy);
    if (target && target->getAlive())
        applyHit(shooter, target, shot, shot.baseDamage, elevDmgBonus);

    // Splash always lands on the hex regardless of whether the primary shot
    // found someone — same as an inaccurate single shot falling back to
    // pickHexTarget() on the landed hex.
    for (int i = 0; i < shot.secondaryHits; ++i) {
        AUnit* hit = pickHexTarget(landedHex);
        if (hit && hit->getAlive())
            applyHit(shooter, hit, shot, shot.secondaryDamage, elevDmgBonus);
    }
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
