/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Soldier.cpp                                    :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@student.hive.fi>        +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/31 10:43:48 by jrimpila          #+#    #+#             */
/*   Updated: 2025/08/31 10:43:49 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */




#include "../HDRS/Soldier.hpp"


Soldier::Soldier(int setTeam) noexcept: Human::Human(setTeam)
{
    armour = HEAVYARMOUR;
    attackPWR = 11;
    defence = 12;
} 

Soldier::Soldier() noexcept {
    
    armour = HEAVYARMOUR;
}



void Soldier::special()
{
    return;
}