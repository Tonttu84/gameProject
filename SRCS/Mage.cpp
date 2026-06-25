/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Mage.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/28 17:18:44 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/19 20:23:54 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Mage.hpp"
#include "Cell.hpp"



Mage::Mage(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
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
    if (!targetCell.getUnit() || !targetCell.getUnit()->getAlive())
        return 0;

    AUnit &targetUnit = *targetCell.getUnit();
    int retval;
    if (FIREBALL_CENTRE + 2 > targetUnit.getArmour())
    {
        // cap effective damage at hp+2 to avoid overvaluing overkill shots
        int pen = FIREBALL_CENTRE + 2 - targetUnit.getArmour();
        retval = (pen > targetUnit.getHp() ? targetUnit.getHp() + 2 : pen) * targetUnit.getValue();
    }
    else
        retval = targetUnit.getValue();

    return targetUnit.getTeam() == myTeam ? retval * -1 : retval;
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





Cell *Mage::findMageTarget()
{
    return Utility::FindPriorityTarget(
        Utility::getBattlefield().getTeam(3 - getTeam()),
        calcFireballValue, getTeam());
}

static void blastCell(Cell *cell, int damage)
{
    if (!cell)
        return;
    cell->fire = true;
    if (cell->getUnit())
        cell->getUnit()->takeDamage(damage + Utility::throwDice() - Utility::throwDice());
}

static void fireball(Cell &targetCell)
{
    Battlefield &field = Utility::getBattlefield();
    int h = targetCell.hLoc;
    int w = targetCell.wLoc;

    blastCell(&targetCell,                        FIREBALL_CENTRE);
    blastCell(field.safeGetCell(h - 1, w),        FIREBALL_BLAST);
    blastCell(field.safeGetCell(h + 1, w),        FIREBALL_BLAST);
    blastCell(field.safeGetCell(h,     w - 1),    FIREBALL_BLAST);
    blastCell(field.safeGetCell(h,     w + 1),    FIREBALL_BLAST);
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
    
    Cell *targetCell = findMageTarget();
    
    if (!targetCell)
        return;
    targetCell = Utility::Deviate(*getCell(), targetCell->hLoc, targetCell->wLoc, accuracy -3);
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