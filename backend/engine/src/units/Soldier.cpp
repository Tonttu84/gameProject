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


#include "units/Soldier.hpp"


Soldier::Soldier(int setTeam) noexcept: Human::Human(setTeam, MeleeWeapons::SwordAndShield)
{
    printSymbol = 'X';
    armour = HEAVYARMOUR;
    attackPWR = 11;
    defence = 12;
    fatigueCost++; // Ekstra +1 fatigue from heavy armor
    size = SIZE;
} 




void Soldier::special()
{
}