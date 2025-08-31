/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Mage.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/28 17:18:44 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 12:22:46 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Mage.hpp"
#include "Cell.hpp"



Mage::Mage(int setTeam) noexcept: Human::Human(setTeam)
{
    setSpellcaster(true);
    printSymbol = 'M';
    accuracy = 8; //mages are no longer young
} 

Mage::Mage() noexcept {
        setSpellcaster(true);
        printSymbol = 'M';
}

static int calcCellValue(const Cell &targetCell, int myTeam)
{
    
    if (targetCell.getUnit() == nullptr || targetCell.getUnit()->getAlive() == false)
        return 0;

    AUnit &targetUnit = *targetCell.getUnit();
    int retval = 0;
    if (FIREBALL_CENTRE + 2 > targetUnit.getArmour())
    {
        if (FIREBALL_CENTRE + 2 - targetUnit.getArmour() > targetUnit.getHp())
        {
            retval = (targetUnit.getHp() + 2) * targetUnit.getValue();
        }
        retval = (FIREBALL_CENTRE + 2 - targetUnit.getArmour()) * targetUnit.getValue();
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
    assert(target.getCell() && "Target doesnt have a valid location\n");
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





Cell *Mage::findMageTarget(Cell &source)
{
    (void) source;
    Cell *target = nullptr;
    
    target = Utility::FindPriorityTarget(Utility::getBattlefield().getTeam(3 - getTeam()), calcFireballValue, getTeam());

    return target;
}

static void fireball(Cell &targetCell)
{
    Battlefield &myBattlefield = Utility::getBattlefield();
    int wLoc = targetCell.wLoc;
    int hLoc = targetCell.hLoc;

    targetCell.fire = true;
    if (targetCell.getUnit())
    {
        targetCell.getUnit()->takeDamage(FIREBALL_CENTRE + Utility::throwDice() - Utility::throwDice());
        
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc -1, wLoc);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(FIREBALL_BLAST + Utility::throwDice() - Utility::throwDice());
    }

    {
         Cell *target = myBattlefield.safeGetCell(hLoc +1, wLoc);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(FIREBALL_BLAST + Utility::throwDice() - Utility::throwDice());
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc, wLoc -1);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(FIREBALL_BLAST + Utility::throwDice() - Utility::throwDice());
    }

    {
        Cell *target = myBattlefield.safeGetCell(hLoc, wLoc +1);
        if (target)
            target->fire = true;
        if (target && target->getUnit())
            target->getUnit()->takeDamage(FIREBALL_BLAST + Utility::throwDice() - Utility::throwDice());
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
    
    Cell *targetCell = findMageTarget(*getCell());
    
    if (!targetCell)
        return;
    targetCell = Utility::Deviate(*getCell(), targetCell->hLoc, targetCell->wLoc, accuracy -4);
    if (targetCell)
    {
        fireball(*targetCell);
        setCast(5);
        mana--;
    }
}

void Mage::special()
{
    castFireball();
}