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

    mana--;

    RangedShot shot;
    shot.baseDamage = FIREBALL_CENTRE;
    shot.accuracy   = accuracy;
    shot.pen        = ArmorPen::Normal;
    // Secondary blast hits: shrapnel from the detonation, same blocking rules.
    // Elevation recomputed from attacker position so it matches the primary hit.
    shot.onHit = [](AUnit* attacker, AUnit* target, bool& /*blocked*/) {
        int tiers     = std::clamp(attacker->getHex()->elevation - target->getHex()->elevation,
                                   -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
        int elevBonus = tiers * ELEV_RANGED_BONUS;
        for (int i = 0; i < FIREBALL_SECONDARY; ++i) {
            AUnit* hit = RangedCombat::pickHexTarget(target->getHex());
            if (!hit || !hit->getAlive()) continue;
            bool xBlocked = hit->tryBlockExtraShield();
            bool tBlocked = !xBlocked && hit->rollTerrainRangedBlock();
            int  dmg      = FIREBALL_BLAST + elevBonus - ((xBlocked || tBlocked) ? SHIELDREDUCTION : 0);
            if (dmg > 0) hit->takeDamage(dmg);
        }
    };

    RangedCombat::fire(this, aimUnit, shot);
}
