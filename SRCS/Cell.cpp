/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:43:10 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/18 11:08:02 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Cell.hpp"
#include "../HDRS/AUnit.hpp"



void Cell::setUnit(AUnit *unit)
{
   
    if (unit && unit->getCell() != this) {
        unit->setCell(this);
    }
     ptr = unit;
    
}


void Cell::reset()
{
    ptr = nullptr;
}

AUnit* Cell::getUnit() const
{
    return ptr;
}