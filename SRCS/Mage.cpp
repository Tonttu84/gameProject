#include "../HDRS/Mage.hpp"

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
        return Utility::calcDistance(target.getHex(), getHex()) <= SPELLRANGE;
    };
    auto scoreTarget = [this](const AUnit& target, int t) -> int {
        if (!target.getAlive() || target.getTeam() == t || !target.getHex()) return -1;
        int dist = Utility::calcDistance(target.getHex(), getHex());
        if (dist > SPELLRANGE) return -1;
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
    Hex* targetHex = Utility::Deviate(*getHex(), aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r, accuracy);
    mana--;
    if (!targetHex) return;

    // Primary hit: aimed individual if accurate enough, otherwise random hex hit.
    AUnit* primary = RangedCombat::resolveHit(aimUnit, targetHex, dist, accuracy);
    if (primary && primary->getAlive())
        primary->takeDamage(FIREBALL_CENTRE);

    // Secondary blast hits: always random weighted picks from the same hex.
    // The explosion doesn't care who it catches — it just burns whoever is there.
    for (int i = 0; i < FIREBALL_SECONDARY; ++i) {
        AUnit* hit = RangedCombat::pickHexTarget(targetHex);
        if (hit && hit->getAlive())
            hit->takeDamage(FIREBALL_BLAST);
    }
}
