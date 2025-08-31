/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Human.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 09:00:00 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/29 15:06:42 by jrimpila         ###   ########.fr       */
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
        
        
    
};