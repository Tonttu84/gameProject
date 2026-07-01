#include "units/Mage.hpp"
#include <algorithm>

Mage::Mage(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol    = 'M';
    accuracy       = 60; // 60% aimed chance, 6-hex aimed range
    preferredRange = 3;
    size = SIZE;
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
    shot.baseDamage      = FIREBALL_CENTRE;
    shot.accuracy        = accuracy;
    shot.pen             = ArmorPen::Normal;
    // Secondary blast hits: shrapnel from the detonation, landing on the same
    // hex as the primary shot regardless of whether the primary found a target.
    shot.secondaryHits   = FIREBALL_SECONDARY;
    shot.secondaryDamage = FIREBALL_BLAST;

    RangedCombat::fire(this, aimUnit, shot);
}
