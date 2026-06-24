/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Necromancer.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/28 17:18:44 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 13:02:29 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Necromancer.hpp"
#include "Cell.hpp"



Necromancer::Necromancer(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::Dagger)
{
    setSpellcaster(true);
    printSymbol = 'N';
} 

Necromancer::Necromancer() noexcept {
        setSpellcaster(true);
        printSymbol = 'N';
}

//returns true on success
bool Necromancer::placeZombie(Cell *targetCell)
{
    if (targetCell && targetCell->getUnit() == nullptr)
    {
        if (Utility::getBattlefield().getCorpses())
            Utility::getBattlefield().setCorpses(Utility::getBattlefield().getCorpses() - 1);
        std::unique_ptr<AUnit> Bob = std::make_unique<Zombie>(getTeam());
        targetCell->setUnit(&(*Bob));
        Bob ->setCell(targetCell);
        Utility::getBattlefield().getTeam(team).push_back(std::move(Bob));

        return true;
    }
    return false;
}


void Necromancer:: raiseDead()
{
    Battlefield &myBattle = Utility::getBattlefield();
    
    if (getCast() > 0)
    {
        setCast(getCast() - 1);
        return;
    }    

    if (mana <= 0 || broken || alive == false || getCell() == nullptr)
        return;
    int wLoc = getCell()->wLoc;
    int hLoc = getCell()->hLoc;
    
    mana--;
    size_t summons = 3;
    if (myBattle.getCorpses() < 3)
    {
        summons = 1; //just summons a single skelleton but Ill use a zombie as a placeholder
    }
    else 
        myBattle.setCorpses(myBattle.getCorpses()- 3);
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc + 1, wLoc + 1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc + 1, wLoc);
        if (placeZombie(targetCell) == true)
            summons--;
    }
     if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc + 1, wLoc - 1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc, wLoc + 1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc, wLoc -1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc -1, wLoc +1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc -1, wLoc);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    if (summons)
    {
        Cell *targetCell = myBattle.safeGetCell(hLoc -1, wLoc -1);
        if (placeZombie(targetCell) == true)
            summons--;
    }
    setCast(6);

}

void Necromancer::special()
{
    raiseDead();
}