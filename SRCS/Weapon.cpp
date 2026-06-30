/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Weapon.cpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/31 15:22:26 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/19 13:22:13 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#include "../HDRS/Weapon.hpp"



    int Weapon::getDefence() const
    {
        return defenceBonus;
    }
    int Weapon::getDamage() const
    {
        return damageBonus;
    }
    int Weapon::getAttack() const
    {
        return attackBonus;
    }
    int Weapon::getShield() const
    {
        return shield;
    }
    int Weapon::getStrDivider() const
    {
        return strDivider;
    }
    int Weapon::getReach() const
    {
        return reach;
    }
    ArmorPen Weapon::getPen() const
    {
        return pen;
    }
    WeaponEffect Weapon::getEffect() const
    {
        return effect;
    }

