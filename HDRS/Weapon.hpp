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
#include "Defines.hpp"

class Weapon
{
    public:
        Weapon() = delete;
        ~Weapon() = default;
        constexpr Weapon(std::string_view setType,  int setDefence, int setDamage, int setAttack, int setStrDiv, int shieldValue, int setReach = 0, ArmorPen setPen = ArmorPen::Normal, WeaponEffect setEffect = WeaponEffect::None)
        :type(setType), defenceBonus(setDefence), attackBonus(setAttack), damageBonus(setDamage), strDivider(setStrDiv), shield(shieldValue), reach(setReach), pen(setPen), effect(setEffect)
        {

        }

        int getDefence() const;
        int getDamage() const;
        int getAttack() const;
        int getShield() const;
        int getStrDivider() const;
        int getReach() const;
        ArmorPen getPen() const;
        WeaponEffect getEffect() const;


    private:
        std::string_view type;

        int defenceBonus;
        int attackBonus;
        int damageBonus;
        int strDivider;
        int shield;
        int reach; // melee reach — shifts the mount/rider hit-roll boundary
                   // toward the rider for MountedUnit targets (see MountedUnit)
        ArmorPen pen; // this weapon's own armour-penetration type — carried into
                      // both normal attacks and a repel counter-hit, so e.g. a
                      // Bypass ("magical") weapon can still harm an attacker that
                      // only Bypass damage gets through. Defaults to Normal for
                      // every existing weapon — no behaviour change unless set.
        WeaponEffect effect; // see Defines.hpp — dispatched via WeaponEffects.hpp/.cpp,
                             // not implemented here so weapon definitions stay constexpr.

         

    
};