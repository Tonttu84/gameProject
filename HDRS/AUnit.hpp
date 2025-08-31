/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:27:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 14:57:28 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <memory>
#include <assert.h>
#include "Macros.hpp"
class Battlefield;

class Cell;

class AUnit : public std::enable_shared_from_this<AUnit> {
public:
    AUnit() = default;
    virtual ~AUnit();
    AUnit(const int newTeam);

    void setCell(Cell* cell);
    void attack(AUnit &target);
    
    Cell* getCell() const;
    void reset();
    int getTeam() const;
    int takeDamage(int amount);
    int defend(int AttackAttempt, int damage);
    void battle(Battlefield &myBattlefield);
    AUnit *find_target(Battlefield &myBattlefield);
    bool getAlive() const;
    bool getBroken() const;
    void setAlive(bool);
    bool rally();
    int getHp() const;
    int getmaxHP() const;
    void setBroken(bool value);
    void heal(int value);
    virtual void special(){};
    int getCast();
    void setCast(int setCast);
    bool testMorale(int damage);

    void setSpellcaster(bool value);
    bool getSpellCaster() const;

    void setPlaced(bool value);
    bool getPlaced();
     int getArmour();
     int getValue();
     bool getUndead();
    

    void setSpentMove(size_t setMove);
    size_t getSpentMove();
    char getPrintSymbol();

protected:
    int team = 0;
    Cell* currentCell = nullptr;
    int hitpoints = 10;
    int attackPWR = 10;
    int defence = 10;
    int morale = 10;
    int strength = 10;
    int maxHP = 10;
    int cast = 0;
    int armour = 0;
    int accuracy = 10;
    int ammunition = 0;
    
    int resistance = 10;
    int value = 10; //relative value that mages etc consider when trying to hit opponents, zombies etc chaff is not a priority target
    size_t size = 1;
    char printSymbol = '?';

    bool alive = true;
    bool broken = false;
    bool spellcaster = false;
    bool placed = false;
    bool undead = false;
    size_t spentMove = 0;

};


