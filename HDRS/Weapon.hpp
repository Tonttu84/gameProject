/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   Weapon.hpp                                         :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/31 15:17:03 by jrimpila          #+#    #+#             */
/*   Updated: 2025/09/19 13:22:20 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once
#include <string>

class Weapon
{
    public:
        Weapon() = delete;
        ~Weapon() = default;
        constexpr Weapon(std::string_view setType,  int setDefence, int setDamage, int setAttack, int setStrDiv, int shieldValue)
        :type(setType), defenceBonus(setDefence), attackBonus(setAttack), damageBonus(setDamage), strDivider(setStrDiv), shield(shieldValue)
        {
            
        }
    
        int getDefence() const;
        int getDamage() const;
        int getAttack() const;
        int getShield() const;
        int getStrDivider() const;


    private:
        std::string_view type;

        int defenceBonus;
        int attackBonus;
        int damageBonus;
        int strDivider;
        int shield;

         

    
};