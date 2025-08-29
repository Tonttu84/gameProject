/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Human.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 09:00:00 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/28 17:44:26 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <unistd.h>
#include "BodyPart.hpp"
#include "AUnit.hpp"

class TODO;
class Hittable;

class Human : public AUnit
{

    public:
        size_t takeHit(TODO source, TODO type);
        void attacks(); //  cycles through all attacks
        Human() = default;
        ~Human() noexcept = default;
        Human(const Human &target) = default;
        
        Human(int team);

    protected:
        Hittable HitTable();
        BodyPart Head;
        BodyPart Body;
        BodyPart leftArm;
        BodyPart rightArm;
        BodyPart leftLeg;
        BodyPart rightLeg;
        
        int team;

        int strength = 10;
        int hitpoints = 10;
        int attackPWR = 10;
        int defence = 10;
        int morale = 10;
        int resistance = 10;
        int value = 10; //relative value that mages etc consider when trying to hit opponents, zombies etc chaff is not a priority target
        size_t size = 1; //how many grids it takes, humans should start at more than 1 so you can create smaller creatures more easily
        
    
};