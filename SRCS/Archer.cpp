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

int Archer::calcCellValue(const Cell &targetCell, int myTeam)
{
    if (!targetCell.getUnit() || !targetCell.getUnit()->getAlive())
        return 0;

    AUnit &targetUnit = *targetCell.getUnit();
    int retval;
    if (BOWDAMAGE + 2 > targetUnit.getArmour())
    {
        // cap effective damage at hp+2 to avoid overvaluing overkill shots
        int pen = BOWDAMAGE + 2 - targetUnit.getArmour();
        retval = (pen > targetUnit.getHp() ? targetUnit.getHp() + 2 : pen) * targetUnit.getValue();
    }
    else
        retval = targetUnit.getValue();

    return targetUnit.getTeam() == myTeam ? retval * -1 : retval;
}

int Archer::calcShot(const AUnit& target, int myTeam)
{
    assert(target.getCell() && "Input with a target that doesn't have a location");
    ssize_t distance = Utility::calcDistance(target.getCell(), getCell());

    if (distance > BOWMAXRANGE || !target.getAlive())
        return -1;

    int CellW = target.getCell()->wLoc;
    int CellH = target.getCell()->hLoc;
    Battlefield &myBattle = Utility::getBattlefield();

    int retval = calcCellValue(myBattle._battlefield[CellH][CellW], myTeam) * 2;
    if (CellH - 1 >= 0)
        retval += calcCellValue(myBattle._battlefield[CellH - 1][CellW], myTeam);
    if (CellW - 1 >= 0)
        retval += calcCellValue(myBattle._battlefield[CellH][CellW - 1], myTeam);
    if (CellH < myBattle.height - 2)
        retval += calcCellValue(myBattle._battlefield[CellH + 1][CellW], myTeam);
    if (CellW < myBattle.width - 2)
        retval += calcCellValue(myBattle._battlefield[CellH][CellW + 1], myTeam);

    if (retval <= 1)
        return retval;
    return retval * accuracy / distance + Utility::throwDice();
}


bool Archer::accurateShot(const AUnit &target, int myTeam)
{
    if (!target.getAlive() || target.getTeam() == myTeam)
        return false;
    return Utility::calcDistance(target.getCell(), getCell()) < accuracy;
}


Cell *Archer::findArcherTarget()
{
    auto shotCalculator = [this](const AUnit& target, int myTeam) -> int {
        return this->calcShot(target, myTeam);
    };
    auto findShot = [this](const AUnit& target, int myTeam) -> int {
        return this->accurateShot(target, myTeam);
    };

    AUnit *targetUnit = Utility::findTarget(
        Utility::getBattlefield().getTeam(3 - getTeam()),
        findShot, shotCalculator, getTeam());

    return targetUnit ? targetUnit->getCell() : nullptr;
}


// Returns the spentMove cost (3) if a shot was fired, 0 otherwise.
int Archer::fireBow()
{
    if (broken || !alive || spentMove || ammunition == 0)
        return 0;

    Cell *targetCell = findArcherTarget();
    if (!targetCell)
        return 0;

    targetCell = Utility::Deviate(*getCell(), targetCell->hLoc, targetCell->wLoc, accuracy);
    ammunition--;

    if (!targetCell)
        return 3;

    targetCell->fire = true;
    AUnit *targetUnit = targetCell->getUnit();
    if (!targetUnit)
        return 3;

    if (targetUnit->getShield() > 0 && Utility::throwDice() <= targetUnit->getShield())
    {
        // Arrow hits shield; reduced damage, shield degrades on partial penetration
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
