/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.cpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:46:16 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/20 11:28:08 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/AUnit.hpp"
#include "../HDRS/Cell.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/Battlefield.hpp"


AUnit::AUnit(const int newTeam)
:team(newTeam)
{
    
}

AUnit::~AUnit()
{
    if (getCell())
        getCell() -> reset();
    currentCell = nullptr;
}

void AUnit::setCell(Cell* cell) {
    
    if (cell &&  cell->getUnit() && cell->getUnit() != this) {
        assert(currentCell->getUnit() == this && "Unit's current cell doesn't match!");
    }
    currentCell = cell;
}

 Cell* AUnit::getCell() const {
        return currentCell;
    }

    void AUnit::reset()
{
    currentCell = nullptr;
}


int AUnit::getTeam() const
{
    return team;
}

int AUnit::defend(int AttackAttempt, int damage)
{
    if (defence + Utility::throwDice() >= AttackAttempt)
        return 0;
    
    int resultDMG = damage + Utility::throwDice() - Utility::throwDice();
    if (resultDMG > 0)
    {
        if (resultDMG + Utility::throwDice() > morale + Utility::throwDice())
            {
                broken = true;
                std::cout << "One coward valued his life more than his honor" << std::endl;
            }
        hitpoints = hitpoints - resultDMG;
        if (hitpoints < 1)
            alive = false;
        return resultDMG;
    }
    return 0;
}

int constexpr placeholderWeapon = 5;

void AUnit::attack(AUnit &target)
{   
    int HitResult = this -> attackPWR + Utility::throwDice();
    
    target.defend(HitResult, placeholderWeapon + strength / 3);
    
}

AUnit *AUnit::find_target(Battlefield &myBattlefield)
{
    AUnit *retval = nullptr;

    if (getCell() == nullptr)
        return nullptr;
    Cell *thisCell = getCell();

    if (thisCell->hLoc > 0)
    {
        if (thisCell -> wLoc >0)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc -1][thisCell->wLoc - 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive())
                return retval;
        }
        retval = myBattlefield._battlefield[thisCell->hLoc -1][thisCell->wLoc].getUnit();
        if (retval && retval->team != team && retval -> getAlive())
            return retval;
        if (thisCell->wLoc < myBattlefield.width - 2)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc -1][thisCell->wLoc + 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive())
            return retval;
        }
    }
    if (thisCell->hLoc < myBattlefield.height - 2 )
    {
        if (thisCell->wLoc > 0)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc +1][thisCell->wLoc - 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive())
                return retval;
        }
        retval = myBattlefield._battlefield[thisCell->hLoc +1][thisCell->wLoc].getUnit();
        if (retval && retval->team != team && retval -> getAlive())
            return retval;
        if (thisCell->wLoc < myBattlefield.width - 2)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc +1][thisCell->wLoc + 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive())
            return retval;
        }
    }
     if (thisCell->wLoc > 0)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc][thisCell->wLoc - 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive())
                return retval;
        }
    if (thisCell->wLoc < myBattlefield.width - 2)
        {
            retval = myBattlefield._battlefield[thisCell->hLoc][thisCell->wLoc - 1].getUnit();
            if (retval && retval->team != team && retval -> getAlive() )
                return retval;
        }
    return nullptr;

}

    void AUnit::battle(Battlefield &myBattlefield)
    {
        if (broken || getCell() == nullptr)
            return;
        AUnit *target = find_target(myBattlefield);
        if (target)
            attack(*target);
    }

    bool AUnit::getAlive() const
    {
        return alive;
    }

    bool AUnit::getBroken() const
    {
        return broken;
    }

    void AUnit::setAlive(bool newAlive)
    {
        alive = newAlive;
    }

    bool AUnit::rally()
    {
        if (broken == false)
            return 0; //unnecessary rally always fails
        if ((morale + Utility::throwDice() - Utility::throwDice()) >= 12)
        {
            std::cout << "With nowhere to flee to a soldier rallies" << std::endl;
            broken = true;
            return 0;
        }
        return 1;
    }


    int AUnit::getHp() const
    {
    return hitpoints; 
    }
    int AUnit::getmaxHP() const
    {
        return maxHP;
    }

     void AUnit::setBroken(bool value)
     {
        broken = value;
     }
    void  AUnit::heal(int value)
    {
        if (value < 0)
            return;
        if (value + hitpoints > maxHP)
            hitpoints = maxHP;
        else
            hitpoints = hitpoints + value;
    }

     void AUnit::setSpellcaster(bool value)
     {
        spellcaster = value;
     }

     bool AUnit::getSpellCaster() const
     {
        return spellcaster;
     }