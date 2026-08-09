#include "Weapon.hpp"



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

