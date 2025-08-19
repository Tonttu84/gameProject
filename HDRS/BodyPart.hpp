/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   BodyPart.hpp                                       :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 09:16:39 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/16 15:27:01 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include "unistd.h"
#include <memory>

class Armor;

class BodyPart
{
    public:
    BodyPart();
    ~BodyPart() = default;


    private:
        size_t maxDamage;
        std::shared_ptr<Armor> armor;
        
    
};