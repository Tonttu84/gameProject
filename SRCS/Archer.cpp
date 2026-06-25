#include "../HDRS/Archer.hpp"


Archer::Archer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Shortsword)
{
    printSymbol = 'A';
    ammunition = BOWAMMO;
    armour = LIGHTARMOUR;
}

Archer::Archer() noexcept {
    printSymbol = 'A';
    ammunition = BOWAMMO;
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

    if (distance > BOWMAXRANGE || !target.getAlive())
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

    Hex* targetHex = Utility::Deviate(*getHex(), aimUnit->getHex()->coord.q, aimUnit->getHex()->coord.r, accuracy);
    ammunition--;

    if (!targetHex)
        return 3;

    AUnit* targetUnit = nullptr;
    for (AUnit* u : targetHex->units)
        if (u && u->getAlive()) { targetUnit = u; break; }
    if (!targetUnit)
        return 3;

    if (targetUnit->getShield() > 0 && Utility::throwDice() <= targetUnit->getShield())
    {
        int damage = BOWDAMAGE - SHIELDREDUCTION + Utility::throwDice() - Utility::throwDice();
        if (damage > 0)
        {
            targetUnit->setShield(targetUnit->getShield() - 1);
            targetUnit->takeDamage(damage);
        }
    }
    else
        targetUnit->takeDamage(BOWDAMAGE + Utility::throwDice() - Utility::throwDice());

    return 3;
}

void Archer::special()
{
    spentMove = fireBow();
}
