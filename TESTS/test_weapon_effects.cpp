#include "catch.hpp"
#include "../HDRS/units/Human.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Zombie.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/Defines.hpp"

// ── WeaponEffect — Lifedrain and MagicalChip ─────────────────────────────────
//
// Both effects are dispatched from AUnit::attackWithWeapons()/battle() via
// WeaponEffects.hpp/.cpp, composed alongside (but independent of) repel — see
// [[design_repel]]. These tests call attackWithWeapons() directly (no
// Battlefield seating needed) since neither effect depends on engagement context.

TEST_CASE("Lifedrinker: attacker heals for the damage its attack dealt") {
    Human attacker(REDTEAM, MeleeWeapons::Lifedrinker);
    Zombie target(BLUETEAM); // undead -> testMorale is dice-free, simplifies the sequence

    Utility::clearDiceRolls();
    // Bring the attacker below max hp first so the heal is visible (not clamped away).
    // testMorale(3) on the attacker: 10+0+6-1=15 > 3 -> passes, stays unbroken.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    attacker.takeDamage(3, ArmorPen::Bypass);
    REQUIRE(attacker.getHp() == 7);

    // hitResult = 10+0+0+6 = 16. Zombie's reach(0) <= attacker's reach(1) -> no repel.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // defend(): defenceroll=1 (5+1=6 < 16, hits), d1=6,d2=1 ->
    // resultDMG = damage(4+10/3+0=7) + 6 - 1 = 12. No shield, no armour (pen Normal,
    // armour 0 anyway). Zombie is undead -> testMorale(12) is free (no dice).
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    attacker.attackWithWeapons(&target, /*attackBonus*/0);
    Utility::clearDiceRolls();

    CHECK(target.getHp() == 8); // 20 - 12
    CHECK(attacker.getHp() == 10); // 7 + 12 lifedrain, clamped to maxHP like any heal()
}

TEST_CASE("Spectral Blade: MagicalChip always lands 1 Bypass point even through a shield that fully absorbs the swing") {
    Human attacker(REDTEAM, MeleeWeapons::SpectralBlade);
    Soldier target(BLUETEAM);
    target.setShield(20); // large enough to fully absorb the weapon's own (Normal-pen) swing

    Utility::clearDiceRolls();
    // hitResult = 10+0+0+6 = 16. target's SwordAndShield reach(1) ties the attacker's
    // reach(1) -> not strictly longer, so no repel triggers here either.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // MagicalChip fires unconditionally from onAttack, before the swing's own defend()
    // even runs: takeDamage(1, Bypass) -> testMorale(1) on target: 10+0+6-1=15 > 1 -> passes.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // The weapon's own swing: defenceroll=1 (12+1=13 < 16, hits), d1=6,d2=1 ->
    // resultDMG = damage(2+10/3+0=5) + 6 - 1 = 10, fully absorbed by the shield
    // (shieldProt = 5+20*2 = 45 -> resultDMG goes deeply negative -> 0 damage, shield
    // never even degrades since resultDMG didn't stay positive after the subtraction).
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    attacker.attackWithWeapons(&target, /*attackBonus*/0);
    Utility::clearDiceRolls();

    CHECK(target.getHp() == 9);   // only the magical chip's 1 point landed
    CHECK(target.getShield() == 20); // the absorbed swing never touched the shield
    CHECK(target.getAlive() == true);
}
