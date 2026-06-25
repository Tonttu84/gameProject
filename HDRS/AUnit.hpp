/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:27:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:57:50 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include <memory>
#include <assert.h>
#include "Macros.hpp"
#include "Weapon.hpp"
#include "WeaponList.hpp"
#include <vector>
#include "Defines.hpp"
#include "Battlefield.hpp"
#include "Cell.hpp"
#include "Utility.hpp"




class AUnit : public std::enable_shared_from_this<AUnit> {
public:
    AUnit() = default;
    virtual ~AUnit();
    AUnit(const int newTeam);

    void setCell(Cell* cell);
    void attack(AUnit &target, const Weapon &attackWeapon);
    
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
    virtual void special() {};
    int getCast() const;
    void setCast(int setCast);
    bool testMorale(int damage);

    void setSpellcaster(bool value);
    bool getSpellCaster() const;

    void setPlaced(bool value);
    bool getPlaced() const;

    void setBattleSummon(bool value);
    bool getBattleSummon() const;
     int getArmour() const;
     
    int getShield() const;
    void setShield(int newVal);


     int getValue() const;
     bool getUndead() const;
    void addWeapon(Weapon newWeapon);
    int getFatigue() const;
    bool getEngaged(Battlefield &myBattlefield) const;
    
    void increaseFatigue();

    void recover();

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
    int shield = 0;

    int fatigue = 0;
    int fatiguelvl = 0;
    int fatigueCost = 4;
    
    int resistance = 10;
    int unitValue = 10; // relative priority: mages weigh this to avoid wasting spells on low-value chaff
    size_t size = 1;
    char printSymbol = '?';

    bool alive = true;
    bool broken = false;
    bool spellcaster = false;
    bool placed = false;
    bool undead = false;
    bool battleSummon = false;
    size_t spentMove = 0;

    std::vector<Weapon> _attacks;

};


