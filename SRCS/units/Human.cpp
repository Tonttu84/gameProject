/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Human.cpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:59:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/19 13:08:11 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "units/Human.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"


Human::Human(int setTeam, Weapon setWeapon): AUnit::AUnit(setTeam)
{
    this->printSymbol = 'X';
    addWeapon(setWeapon);
}



