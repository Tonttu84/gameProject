/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Zombie.hpp                                          :+:      :+:    :+:   */
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

class Zombie : public AUnit
{

    public:
        size_t takeHit(TODO source, TODO type);
        void attacks(); //  cycles through all attacks
        ~Zombie() noexcept = default;
        Zombie(const Zombie &target) = default;
        
        Zombie(int team);

    protected:

        
    
};