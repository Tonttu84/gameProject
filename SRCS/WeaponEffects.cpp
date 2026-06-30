#include "../HDRS/WeaponEffects.hpp"
#include "../HDRS/AUnit.hpp"

void applyWeaponAttackEffect(WeaponEffect effect, AUnit* attacker, AUnit* target)
{
    (void)attacker;
    if (!hasWeaponEffect(effect, WeaponEffect::MagicalChip)) return;
    if (!target || !target->getAlive()) return;
    target->takeDamage(1, ArmorPen::Bypass);
}

void applyWeaponDamageEffect(WeaponEffect effect, AUnit* attacker, int damage)
{
    if (!hasWeaponEffect(effect, WeaponEffect::Lifedrain)) return;
    if (!attacker || damage <= 0) return;
    attacker->heal(damage);
}
