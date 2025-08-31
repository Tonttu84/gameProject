/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Zombie.cpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 08:59:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 11:54:53 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Zombie.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"


Zombie::Zombie(int setTeam): AUnit::AUnit(setTeam)
{
    this->printSymbol = 'Z';
    this->undead = true;
    morale = 99;
    attackPWR = 7;
    defence = 5;
    maxHP = 20;
    hitpoints = 20;
}



