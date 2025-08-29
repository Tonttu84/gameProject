/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Cell.cpp                                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:43:10 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/27 19:21:55 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Cell.hpp"
#include "../HDRS/AUnit.hpp"
#include <cmath>


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



int Cell::getRange(const Cell &target) //simplified range calculator that gets the highest of x and y difference 
{

    int hDelta = std::abs(target.hLoc - hLoc);
    int wDelta = std::abs(target.wLoc - wLoc);

    if (hDelta > wDelta)
        return hDelta;
    return wDelta;
    
}