#include "../HDRS/MeleeCombat.hpp"
#include "../HDRS/AUnit.hpp"
#include "../HDRS/Utility.hpp"

void MeleeCombat::engage(AUnit* attacker, AUnit* target, const MeleeAttack& shot)
{
    if (!attacker || !target || !target->getAlive()) return;

    int hitResult = attacker->getAttackPWR() - attacker->getFatigue()
                    + shot.hitBonus + Utility::throwDice();

    bool blocked = false;
    if (shot.onHit) shot.onHit(attacker, target, blocked);
    if (blocked) return;

    int damage = target->defend(hitResult, shot.damage, shot.pen, shot.reach);
    target->incrementAttacksReceived();

    if (damage > 0 && shot.onDamage) shot.onDamage(attacker, target, damage);
}
