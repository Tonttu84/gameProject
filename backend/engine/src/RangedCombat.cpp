#include "RangedCombat.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"
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
    if (damage <= 0) {
        // TRACE (L-4): a shot that arrived and did nothing. Worth a line of its
        // own — "no line at all" and "hit for zero" look identical in a log, and
        // this is exactly the case S4-8 flagged, where damage SPELLS resolve as
        // a RangedShot and so said nothing whatever about what they did.
        Utility::getBattlefield().logEvent(LogTier::Trace,
            target->logName() + " is grazed for nothing (base " + std::to_string(baseDamage)
            + (blocked ? ", blocked" : "") + ")");
        return;
    }

    Utility::getBattlefield().logEvent(LogTier::Trace,
        target->logName() + " is struck for " + std::to_string(damage)
        + " (base " + std::to_string(baseDamage)
        + (elevDmgBonus ? ", elevation " + std::to_string(elevDmgBonus) : "")
        + (blocked ? ", blocked -" + std::to_string(reduction) : "") + ")");

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
    secondaryHitsOn(shooter, landedHex, shot, elevDmgBonus);
}

void RangedCombat::secondaryHitsOn(AUnit* shooter, Hex* landedHex, const RangedShot& shot,
                                   int elevDmgBonus)
{
    if (!landedHex) return;
    for (int i = 0; i < shot.secondaryHits; ++i) {
        AUnit* hit = pickHexTarget(landedHex);
        if (hit && hit->getAlive())
            applyHit(shooter, hit, shot, shot.secondaryDamage, elevDmgBonus);
    }
}

// ── Spell delivery (T-1, slice TG-1) ─────────────────────────────────────────
//
// The two halves of T-1, sharing everything below the aiming with fire(): the
// elevation DAMAGE bonus, applyHit's block/armour/damage pipeline, and the
// splash loop. What they do NOT share is the archer's aiming — that is the
// whole point of the slice.

// The height difference the two hexes make, clamped to the ranged cap exactly
// as fire() clamps it. Both halves need it, and a precise strike needs it too:
// T-1 exempts a precise spell from the accuracy adjustment, never from the
// DAMAGE one — what a hit does is unchanged.
static int elevationTiers(const AUnit* shooter, const AUnit* target)
{
    return std::clamp(shooter->getHex()->elevation - target->getHex()->elevation,
                      -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
}

void RangedCombat::strike(AUnit* shooter, AUnit* target, const RangedShot& shot)
{
    // Null-safe like fire(): a shot comes FROM somewhere and lands SOMEWHERE.
    if (!shooter || !shooter->getHex() || !target || !target->getHex()) return;

    int elevDmgBonus = elevationTiers(shooter, target) * ELEV_RANGED_BONUS;

    // No Deviate, no resolveHit, no accuracy read anywhere: this is what
    // "precise" means. The man the resolver picked is the man who is hit.
    if (target->getAlive())
        applyHit(shooter, target, shot, shot.baseDamage, elevDmgBonus);

    // Fireball's blast still needs a hex to go off on, and it goes off on the
    // one the strike landed on. TG-2 replaces this with a real area.
    secondaryHitsOn(shooter, target->getHex(), shot, elevDmgBonus);
}

void RangedCombat::scatter(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot,
                           int accuracy)
{
    if (!shooter || !shooter->getHex() || !aimUnit || !aimUnit->getHex()) return;

    int elevTiers    = elevationTiers(shooter, aimUnit);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;
    // The height a caster shoots from helps a spell arrive, exactly as it helps
    // an arrow (T-1: "the elevation adjustment an arrow gets applied after").
    int shotAccuracy = std::clamp(accuracy + elevTiers * ELEV_RANGED_BONUS * 10, 0, 100);

    Hex* landedHex = Utility::Deviate(*shooter->getHex(),
                                      aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r,
                                      shotAccuracy);
    if (!landedHex) return;

    // Assistant's call 1: scatter is the whole of the miss. Stay on his hex and
    // the aimed man takes it; drift off it and the shot takes whoever stands
    // where it fell — friend included (T-7) — or nobody at all.
    AUnit* struck = (landedHex == aimUnit->getHex()) ? aimUnit
                                                     : pickHexTarget(landedHex);
    if (struck && struck->getAlive())
        applyHit(shooter, struck, shot, shot.baseDamage, elevDmgBonus);

    secondaryHitsOn(shooter, landedHex, shot, elevDmgBonus);
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
