/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:27:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/19 13:54:07 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <memory>
#include <assert.h>
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
    bool getAlive();
    bool getBroken();
    void setAlive(bool);
    bool rally();

private:
    int team = 0;
    Cell* currentCell = nullptr;
    int hitpoints = 10;
    int attackPWR = 10;
    int defence = 10;
    int morale = 10;
    int strength = 10;
    
    int resistance = 10;
    int value = 10; //relative value that mages etc consider when trying to hit opponents, zombies etc chaff is not a priority target
    size_t size = 1;

    bool alive = true;
    bool broken = false;
    
};


