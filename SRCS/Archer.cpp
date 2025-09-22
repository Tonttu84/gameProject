


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
    
    if (targetCell.getUnit() == nullptr || targetCell.getUnit()->getAlive() == false)
        return 0;

    AUnit &targetUnit = *targetCell.getUnit();
    int retval = 0;
    if (BOWDAMAGE + 2 > targetUnit.getArmour())
    {
        if (BOWDAMAGE + 2 - targetUnit.getArmour() > targetUnit.getHp())
        {
            retval = (targetUnit.getHp() + 2) * targetUnit.getValue();
        }
        retval = (BOWDAMAGE + 2 - targetUnit.getArmour()) * targetUnit.getValue();
    }
    else 
        retval = targetUnit.getValue();


    if (targetUnit.getTeam() == myTeam)
        return retval * -1;
    return retval; 
        
}

int Archer::calcShot(const AUnit& target, int myTeam)
{
    assert(target.getCell() && "Input with a target that doesn't have a location");
    int retval = 0;
    int CellW = target.getCell()->wLoc;
    int CellH = target.getCell()->hLoc;
    Battlefield &myBattle = Utility::getBattlefield();
    ssize_t distance = Utility::calcDistance(target.getCell(), getCell());
    
    if (distance > BOWMAXRANGE || target.getAlive() == false)
        return -1;

    retval = calcCellValue(myBattle._battlefield[CellH][CellW], myTeam) *2 ;
    if (CellH - 1 >= 0)
        retval += calcCellValue(myBattle._battlefield[CellH -1][CellW], myTeam);
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
    if(target.getAlive() == false || target.getTeam() == myTeam)
        return false;
    if (Utility::calcDistance(target.getCell(), getCell()) < accuracy)
    {
        return true;
    }
    return false;

}


Cell *Archer::findArcherTarget()
{
    Cell *target = nullptr;

    auto shotCalculator = [this](const AUnit& target, int myTeam) -> int {
    return this->calcShot(target, myTeam);
    };

     auto findShot = [this](const AUnit& target, int myTeam) -> int {
    return this->accurateShot(target, myTeam);
    };

    AUnit *targetUnit = Utility::findTarget(Utility::getBattlefield().getTeam(3 - getTeam()), findShot, shotCalculator, getTeam());

    if (targetUnit)
        target = targetUnit->getCell();
    return target;
}


//returns true if the archer fired a shot
int Archer::fireBow()
{
    if (broken || alive == false || spentMove || ammunition == 0)
        return 0;
    Cell *targetCell = findArcherTarget();
    if (!targetCell)
        return 0;
    targetCell = Utility::Deviate(*getCell(), targetCell->hLoc, targetCell->wLoc, accuracy);
    if (targetCell) 
    {
        AUnit *targetUnit = targetCell->getUnit();
        if (targetUnit)
        {
            // First arrow would preferrably test against shield * 2, then later ones vs shield, arrows should cause distracted status
            //additional distraction if it wounds, maybe also just for hit

            if (targetUnit->getShield() > 0 && Utility::throwDice() <= targetUnit->getShield())
            {
                int damage = BOWDAMAGE - SHIELDREDUCTION + Utility::throwDice() - Utility::throwDice();
                if (damage > 0)
                {   
                    targetUnit->setShield(getShield() - 1);
                    targetCell->getUnit()->takeDamage(damage);
                }
            }

            targetCell->getUnit()->takeDamage(BOWDAMAGE + Utility::throwDice() - Utility::throwDice());
        }
        targetCell->fire = true;
    }
    ammunition --;
    return 3;
}

void Archer::special()
{
    spentMove = fireBow();
}