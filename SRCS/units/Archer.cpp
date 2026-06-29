#include "units/Archer.hpp"
#include <algorithm>


Archer::Archer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Shortsword)
{
    printSymbol = 'A';
    ammunition  = BOWAMMO;
    armour      = LIGHTARMOUR;
    // accuracy is a 0-100 percentage: aimed-shot success chance and
    // aimed range (accuracy/10 hexes). 50 → 50% chance, 5-hex aimed range.
    accuracy       = 50;
    preferredRange = 3; // hold bow range; drops to 1 when ammo runs out
}

Archer::Archer() noexcept {
    printSymbol = 'A';
    ammunition  = BOWAMMO;
}

int Archer::calcUnitValue(const AUnit& targetUnit, int myTeam)
{
    if (!targetUnit.getAlive())
        return 0;

    int retval;
    if (BOWDAMAGE + 2 > targetUnit.getArmour())
    {
        int pen = BOWDAMAGE + 2 - targetUnit.getArmour();
        retval = (pen > targetUnit.getHp() ? targetUnit.getHp() + 2 : pen) * targetUnit.getValue();
    }
    else
        retval = targetUnit.getValue();

    return targetUnit.getTeam() == myTeam ? retval * -1 : retval;
}

int Archer::calcShot(const AUnit& target, int myTeam)
{
    assert(target.getHex() && "Input with a target that doesn't have a location");
    int distance = Utility::calcDistance(target.getHex(), getHex());

    int elevTiers = std::clamp(getHex()->elevation - target.getHex()->elevation,
                               -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    if (distance - elevTiers > BOWMAXRANGE || !target.getAlive())
        return -1;

    Battlefield& myBattle = Utility::getBattlefield();
    int retval = calcUnitValue(target, myTeam) * 2;

    auto nbCoords = myBattle.hexGrid.neighbors(target.getHex()->coord);
    for (const HexCoord& nc : nbCoords) {
        Hex* nh = myBattle.hexGrid.getHex(nc);
        if (!nh) continue;
        for (AUnit* u : nh->units)
            if (u) retval += calcUnitValue(*u, myTeam);
    }

    if (retval <= 1)
        return retval;
    return retval * accuracy / distance + Utility::throwDice();
}

bool Archer::accurateShot(const AUnit &target, int myTeam)
{
    if (!target.getAlive() || target.getTeam() == myTeam)
        return false;
    return Utility::calcDistance(target.getHex(), getHex()) < accuracy;
}

AUnit* Archer::findArcherTarget()
{
    auto shotCalculator = [this](const AUnit& target, int myTeam) -> int {
        return this->calcShot(target, myTeam);
    };
    auto findShot = [this](const AUnit& target, int myTeam) -> bool {
        return this->accurateShot(target, myTeam);
    };

    return Utility::findTarget(
        Utility::getBattlefield().getTeam(3 - getTeam()),
        findShot, shotCalculator, getTeam());
}

// Returns the spentMove cost (3) if a shot was fired, 0 otherwise.
int Archer::fireBow()
{
    if (broken || !alive || spentMove || ammunition == 0)
        return 0;

    AUnit* aimUnit = findArcherTarget();
    if (!aimUnit || !aimUnit->getHex())
        return 0;

    int dist = Utility::calcDistance(getHex(), aimUnit->getHex());

    // Elevation: positive tiers = shooter higher (bonus), negative = shooter lower (penalty).
    int elevTiers    = std::clamp(getHex()->elevation - aimUnit->getHex()->elevation,
                                  -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;

    // Forest cover reduces aimed-shot accuracy (arrows through tree cover).
    bool aimInForest = aimUnit->getHex()->terrain == TerrainType::Forest;
    int shotAccuracy = std::clamp(accuracy + elevTiers * ELEV_RANGED_BONUS * 10
                                  - (aimInForest ? FOREST_RANGED_PENALTY * 10 : 0),
                                  0, 100);

    Hex* targetHex = Utility::Deviate(*getHex(), aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r, shotAccuracy);
    ammunition--;
    if (ammunition == 0) preferredRange = 1; // out of arrows — advance to melee

    if (!targetHex) return 3;

    AUnit* targetUnit = RangedCombat::resolveHit(aimUnit, targetHex, dist, shotAccuracy);
    if (!targetUnit || !targetUnit->getAlive()) return 3; // missed or hit a corpse

    // Extra shields (force fields): skill-independent, block ranged and melee alike.
    bool extraBlocked  = targetUnit->tryBlockExtraShield();
    // Forest cover: ranged-only, skill-independent. Only checked if no extra shield blocked.
    bool forestCover   = !extraBlocked && targetUnit->getHex() &&
                         targetUnit->getHex()->terrain == TerrainType::Forest;
    bool branchDeflect = forestCover && Utility::throwDice() <= FOREST_COVER_DEF_BONUS;
    // Physical shield: skill-based (defence stat contributes).
    bool shieldBlocked = !extraBlocked && !branchDeflect
                         && targetUnit->getShield() > 0
                         && Utility::throwDice() <= targetUnit->getShield();

    if (extraBlocked || branchDeflect || shieldBlocked)
    {
        int damage = BOWDAMAGE + elevDmgBonus - SHIELDREDUCTION
                     + Utility::throwDice() - Utility::throwDice();
        if (damage > 0)
        {
            if (shieldBlocked)
                targetUnit->setShield(targetUnit->getShield() - 1);
            targetUnit->takeDamage(damage);
        }
    }
    else
        targetUnit->takeDamage(BOWDAMAGE + elevDmgBonus + Utility::throwDice() - Utility::throwDice());

    return 3;
}

void Archer::special()
{
    spentMove = fireBow();
}

void Archer::restoreForNextBattle()
{
    AUnit::restoreForNextBattle();
    ammunition     = BOWAMMO;
    preferredRange = 3; // reset to bow range — was set to 1 when ammo ran out
}
