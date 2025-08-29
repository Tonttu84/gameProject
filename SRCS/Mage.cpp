/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Mage.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/28 17:18:44 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 10:43:34 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Mage.hpp"
#include "Cell.hpp"

Mage::Mage(int setTeam) noexcept: Human::Human(setTeam)
{
    setSpellcaster(true);
    printSymbol = 'M';
} 

Mage::Mage() noexcept {
        setSpellcaster(true);
        printSymbol = 'M';
}

static int calcCellValue(const Cell &targetCell, int myTeam)
{
    
    if (targetCell.getUnit() == nullptr)
        return 0;

    AUnit &targetUnit = *targetCell.getUnit();
    int retval = 0;
    if (10 + 2 > targetUnit.getArmour())
    {
        if (10 + 2 - targetUnit.getArmour() > targetUnit.getHp())
        {
            retval = (targetUnit.getHp() + 2) * targetUnit.getValue();
        }
        retval = (10 + 2 - targetUnit.getArmour()) * targetUnit.getValue();
    }
    else 
        retval = targetUnit.getValue();

    if (targetUnit.getTeam() == myTeam)
        return retval * -1;
    return retval; 
        
}

static int calcFireballValue(const AUnit& target, int myTeam)
{
    int retval = 0;
    int CellW = target.getCell()->wLoc;
    int CellH = target.getCell()->hLoc;
    Battlefield &myBattle = Utility::getBattlefield();
    
    retval = calcCellValue(myBattle._battlefield[CellH][CellW], myTeam) *2;
    if (CellH - 1 >= 0)
        retval += calcCellValue(myBattle._battlefield[CellH -1][CellW], myTeam);
    if (CellW - 1 >= 0)
        retval += calcCellValue(myBattle._battlefield[CellH][CellW - 1], myTeam);
    if (CellH < myBattle.height - 2)
        retval += calcCellValue(myBattle._battlefield[CellH + 1][CellW], myTeam);
    if (CellW < myBattle.width - 2)
        retval += calcCellValue(myBattle._battlefield[CellH][CellW + 1], myTeam);

    return retval;
    
}


static Cell *FindPriorityTarget(const std::vector<std::unique_ptr<AUnit>>& targetTeam, int (*validPriorityTarget)(const AUnit&, int), int myTeam)
{
     if (targetTeam.begin() == targetTeam.end())
     {
                return nullptr;
     }
     auto it = targetTeam.begin();
     int castValue = -1;
     Cell *targetPtr = nullptr;
     
     while (it != targetTeam.end())
     {
        int value = validPriorityTarget(*(*it), myTeam);
        if (value > castValue)
        {
            castValue = value;
            targetPtr = (*it)->getCell();
        }
        it++;
     }
     if (castValue > 0)
        return targetPtr;
    return nullptr;
}


Cell *Mage::findTarget(Cell &source)
{
    (void) source;
    Cell *target = nullptr;
    

    if (getTeam() == BLUETEAM)
        target = FindPriorityTarget(Utility::getBattlefield().getTeamRED(), calcFireballValue, BLUETEAM);
    else if (getTeam() == REDTEAM) 
        target = FindPriorityTarget(Utility::getBattlefield().getTeamBLUE(), calcFireballValue, REDTEAM);

    return target;
}

static void fireball(Cell &targetCell)
{
    Battlefield &myBattlefield = Utility::getBattlefield();
    int wLoc = targetCell.wLoc;
    int hLoc = targetCell.hLoc;

    if (targetCell.getUnit() == nullptr)
        return;
    targetCell.fire = true;
    if (targetCell.getUnit())
    {
        targetCell.getUnit()->takeDamage(10 + Utility::throwDice() - Utility::throwDice());
        
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc -1, wLoc);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(10 + Utility::throwDice() - Utility::throwDice());
    }

    {
         Cell *target = myBattlefield.safeGetCell(hLoc +1, wLoc);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(10 + Utility::throwDice() - Utility::throwDice());
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc, wLoc -1);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(10 + Utility::throwDice() - Utility::throwDice());
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc, wLoc +1);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(10 + Utility::throwDice() - Utility::throwDice());
    }
    
}

void Mage::castFireball()
{
    if (mana <= 0 || broken || alive == false || getCell() == nullptr)
        return;
   
 
    if (getCast() > 0)
    {
        setCast(getCast() - 1);
        return;
    }    
       
    Cell *targetCell = findTarget(*getCell());
    
    if (targetCell)
    {
        fireball(*targetCell);
        setCast(3);
        mana--;
    }
    
}

void Mage::special()
{
    castFireball();
}