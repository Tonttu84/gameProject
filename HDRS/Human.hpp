/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Human.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 09:00:00 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/04 17:26:56 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <unistd.h>
#include "BodyPart.hpp"
#include "AUnit.hpp"

class TODO;
class Hittable;
class Cell;

class Human : public AUnit
{

    public:
        size_t takeHit(TODO source, TODO type);
        void attacks(); //  cycles through all attacks
        Human() = default;
        ~Human() noexcept = default;
        Human(const Human &target) = default;
        
        Human(int team, Weapon weapon);

    protected:
        Hittable HitTable();
        BodyPart Head;
        BodyPart Body;
        BodyPart leftArm;
        BodyPart rightArm;
        BodyPart leftLeg;
        BodyPart rightLeg;
        
        
    
};