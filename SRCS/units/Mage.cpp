#include "units/Mage.hpp"
#include <algorithm>

Mage::Mage(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'M';
    accuracy       = 60; // 60% aimed chance, 6-hex aimed range
    preferredRange = 3;
}

Mage::Mage() noexcept {
    setSpellcaster(true);
    printSymbol = 'M';
}

// Find the highest-value enemy within spell range, preferring dense hexes.
AUnit* Mage::findFireballTarget()
{
    int myTeam = getTeam();
    auto inRange = [this](const AUnit& target, int t) -> bool {
        if (!target.getAlive() || target.getTeam() == t || !target.getHex()) return false;
        int dist   = Utility::calcDistance(target.getHex(), getHex());
        int tiers  = std::clamp(getHex()->elevation - target.getHex()->elevation,
                                -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
        return dist - tiers <= SPELLRANGE;
    };
    auto scoreTarget = [this](const AUnit& target, int t) -> int {
        if (!target.getAlive() || target.getTeam() == t || !target.getHex()) return -1;
        int dist  = Utility::calcDistance(target.getHex(), getHex());
        int tiers = std::clamp(getHex()->elevation - target.getHex()->elevation,
                               -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
        if (dist - tiers > SPELLRANGE) return -1;
        // Prefer densely packed hexes at closer range.
        return target.getHex()->sizeUsed * 10 / (dist + 1);
    };
    return Utility::findTarget(
        Utility::getBattlefield().getTeam(3 - myTeam),
        inRange, scoreTarget, myTeam);
}

void Mage::special()
{
    if (!alive || mana < 1 || !getHex()) return;

    AUnit* aimUnit = findFireballTarget();
    if (!aimUnit || !aimUnit->getHex()) return;

    int dist = Utility::calcDistance(getHex(), aimUnit->getHex());

    // Elevation: higher ground extends range and increases spell power.
    int elevTiers    = std::clamp(getHex()->elevation - aimUnit->getHex()->elevation,
                                  -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;
    int shotAccuracy = std::clamp(accuracy + elevTiers * ELEV_RANGED_BONUS * 10, 0, 100);

    Hex* targetHex = Utility::Deviate(*getHex(), aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r, shotAccuracy);
    mana--;
    if (!targetHex) return;

    // Primary hit: aimed individual if accurate enough, otherwise random hex hit.
    // Forest absorbs heat — trees stop fireballs just as they stop arrows.
    // Force fields (extra shields) can also deflect the blast.
    AUnit* primary = RangedCombat::resolveHit(aimUnit, targetHex, dist, shotAccuracy);
    if (primary && primary->getAlive()) {
        bool extraBlocked   = primary->tryBlockExtraShield();
        bool terrainBlocked = !extraBlocked && primary->rollTerrainRangedBlock();
        int  dmg = FIREBALL_CENTRE + elevDmgBonus;
        if (extraBlocked || terrainBlocked) dmg -= SHIELDREDUCTION;
        if (dmg > 0) primary->takeDamage(dmg);
    }

    // Secondary blast hits: shrapnel from the detonation, same blocking rules.
    for (int i = 0; i < FIREBALL_SECONDARY; ++i) {
        AUnit* hit = RangedCombat::pickHexTarget(targetHex);
        if (!hit || !hit->getAlive()) continue;
        bool extraBlocked   = hit->tryBlockExtraShield();
        bool terrainBlocked = !extraBlocked && hit->rollTerrainRangedBlock();
        int  dmg = FIREBALL_BLAST + elevDmgBonus;
        if (extraBlocked || terrainBlocked) dmg -= SHIELDREDUCTION;
        if (dmg > 0) hit->takeDamage(dmg);
    }
}
