/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Zombie.cpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:59:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/20 11:39:38 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "units/Zombie.hpp"
#include "AUnit.hpp"
#include "Utility.hpp"


Zombie::Zombie(int setTeam): AUnit::AUnit(setTeam)
{
    printSymbol = 'Z';
    undead = true;
    morale = 99;
    attackPWR = 8;
    defence = 6;
    maxHP = 20;
    hitpoints = 20;
    unitValue = 5;
    strength = 12;
    addWeapon(MeleeWeapons::Claws);
    fatigueCost = 0; //Undead dont need rest

}



