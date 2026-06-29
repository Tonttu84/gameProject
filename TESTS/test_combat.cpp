#include "catch.hpp"
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/units/Zombie.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/Defines.hpp"

// ── defend() — physical shield vs ArmorPen modes ─────────────────────────────
//
// Zombie stats: defence=5 (6 base − 1 from Claws), armour=0, shield=0, undead.
//   setShield(4) manually for these tests so no weapon adds noise.
//   Undead → testMorale returns immediately, consuming no dice.
//
// Dice sequence (each throwDice() pulls two values: [roll, explosion-check]):
//   defenceroll: push(3,1) → defenceroll=3
//   d1:          push(5,1) → d1=5
//   d2:          push(3,1) → d2=3
//
// Miss check:    defence + defenceroll = 5+3=8 < AttackAttempt(10) → HITS
// Shield check:  defence + shield + defenceroll = 5+4+3=12 >= 10   → shield active
// Base resultDMG before shield: 15 + 5 − 3 = 17

static void pushHitDice()   // hit + d1/d2 producing base resultDMG of 17 for damage=15
{
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // defenceroll = 3
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1); // d1 = 5
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // d2 = 3
}

TEST_CASE("defend: Normal — physical shield reduces damage by SHIELDREDUCTION + shield*2") {
    Zombie z(REDTEAM);
    z.setShield(4);
    Utility::clearDiceRolls();
    pushHitDice();

    // shieldProt = SHIELDREDUCTION(5) + 4*2 = 13 → 17 − 13 = 4
    int dealt = z.defend(10, 15, ArmorPen::Normal);
    REQUIRE(dealt == 4);
    REQUIRE(z.getHp() == 16);   // 20 − 4
    REQUIRE(z.getShield() == 3); // shield took a hit

    Utility::clearDiceRolls();
}

TEST_CASE("defend: Piercing — physical shield protection is halved") {
    Zombie z(REDTEAM);
    z.setShield(4);
    Utility::clearDiceRolls();
    pushHitDice();

    // shieldProt = (SHIELDREDUCTION(5) + 4*2) / 2 = 13/2 = 6 → 17 − 6 = 11
    // Piercing also deducts armour/2 = 0/2 = 0 for Zombie.
    int dealt = z.defend(10, 15, ArmorPen::Piercing);
    REQUIRE(dealt == 11);
    REQUIRE(z.getHp() == 9);
    REQUIRE(z.getShield() == 3);

    Utility::clearDiceRolls();
}

TEST_CASE("defend: Bypass — physical shield is skipped entirely") {
    Zombie z(REDTEAM);
    z.setShield(4);
    Utility::clearDiceRolls();
    pushHitDice();

    // No shield reduction at all → dealt = 17
    int dealt = z.defend(10, 15, ArmorPen::Bypass);
    REQUIRE(dealt == 17);
    REQUIRE(z.getHp() == 3);
    REQUIRE(z.getShield() == 4); // shield untouched

    Utility::clearDiceRolls();
}

// ── defend() — extra shield (force field) vs ArmorPen modes ──────────────────
//
// Same Zombie (armour=0, shield=0, undead), but addShield(6) adds one force field.
// tryBlockExtraShield() calls throwDice() for each force field.
// Dice sequence for each test:
//   defenceroll: push(3,1) → 3   (same hit setup)
//   d1:          push(5,1) → 5
//   d2:          push(3,1) → 3   (resultDMG = 17)
//   force-field: push(3,1) → 3   (3 ≤ 6 → force field blocks, consumed)

static void pushHitAndForceFieldDice()
{
    pushHitDice();
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // force-field roll = 3 (≤ 6 → blocks)
}

TEST_CASE("defend: Bypass — force field fully absorbs the attack") {
    Zombie z(REDTEAM);
    z.addShield(6); // force field with block value 6
    Utility::clearDiceRolls();
    pushHitAndForceFieldDice();

    int dealt = z.defend(10, 15, ArmorPen::Bypass);
    REQUIRE(dealt == 0);
    REQUIRE(z.getHp() == 20); // untouched

    Utility::clearDiceRolls();
}

TEST_CASE("defend: Normal — force field reduces damage by SHIELDREDUCTION") {
    Zombie z(REDTEAM);
    z.addShield(6);
    Utility::clearDiceRolls();
    pushHitAndForceFieldDice();

    // resultDMG = 17 − SHIELDREDUCTION(5) = 12
    int dealt = z.defend(10, 15, ArmorPen::Normal);
    REQUIRE(dealt == 12);
    REQUIRE(z.getHp() == 8); // 20 − 12

    Utility::clearDiceRolls();
}

TEST_CASE("defend: Piercing — force field reduces damage by SHIELDREDUCTION/2") {
    Zombie z(REDTEAM);
    z.addShield(6);
    Utility::clearDiceRolls();
    pushHitAndForceFieldDice();

    // resultDMG = 17 − SHIELDREDUCTION/2(2) = 15
    // Piercing also deducts armour/2 = 0 for Zombie.
    int dealt = z.defend(10, 15, ArmorPen::Piercing);
    REQUIRE(dealt == 15);
    REQUIRE(z.getHp() == 5); // 20 − 15

    Utility::clearDiceRolls();
}

// ── takeDamage() — ArmorPen modes ────────────────────────────────────────────
//
// Soldier: armour = HEAVYARMOUR = 5.
// Normal:   effective armour = 5     → 10 − 5  = 5 dealt
// Piercing: effective armour = 5/2=2 → 10 − 2  = 8 dealt
// Bypass:   effective armour = 0     → 10 − 0  = 10 dealt (soldier dies)

TEST_CASE("takeDamage: Normal — full armour applies") {
    Soldier s(REDTEAM); // armour=5, hp=10
    int dealt = s.takeDamage(10, ArmorPen::Normal);
    REQUIRE(dealt == 5);
    REQUIRE(s.getHp() == 5);
}

TEST_CASE("takeDamage: Piercing — armour is halved (rounded down)") {
    Soldier s(REDTEAM); // armour=5, armour/2=2
    int dealt = s.takeDamage(10, ArmorPen::Piercing);
    REQUIRE(dealt == 8); // 10 − 2
    REQUIRE(s.getHp() == 2);
}

TEST_CASE("takeDamage: Bypass — armour is completely ignored") {
    Soldier s(REDTEAM); // armour=5, ignored
    int dealt = s.takeDamage(10, ArmorPen::Bypass);
    REQUIRE(dealt == 10);
    REQUIRE(s.getAlive() == false);
}

// ── rollTerrainRangedBlock — forest cover vs ArmorPen modes ──────────────────
//
// FOREST_COVER_DEF_BONUS = 1: blocks on dice roll ≤ 1.
// Normal:   blocks when roll ≤ 1 (standard chance).
// Piercing: FOREST_COVER_DEF_BONUS/2 = 0 → early-return false, no dice consumed.
// Bypass:   always false immediately, no dice consumed.

TEST_CASE("rollTerrainRangedBlock: Normal — blocks on roll at or below cover bonus") {
    HexGrid grid;
    grid.buildRect(16, 30);
    Hex* h = grid.getHex({0, 14});
    h->terrain = TerrainType::Forest;

    Zombie z(REDTEAM);
    z.setHex(h);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // roll=1 ≤ FOREST_COVER_DEF_BONUS(1)
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Normal) == true);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1); // roll=2 > 1 → no block
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Normal) == false);

    Utility::clearDiceRolls();
}

TEST_CASE("rollTerrainRangedBlock: Piercing — cover bonus halved to zero, no block") {
    HexGrid grid;
    grid.buildRect(16, 30);
    Hex* h = grid.getHex({0, 14});
    h->terrain = TerrainType::Forest;

    Zombie z(REDTEAM);
    z.setHex(h);

    // No dice should be consumed — Piercing halves FOREST_COVER_DEF_BONUS to 0.
    Utility::clearDiceRolls();
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Piercing) == false);
    Utility::clearDiceRolls();
}

TEST_CASE("rollTerrainRangedBlock: Bypass — always blocked, no dice consumed") {
    HexGrid grid;
    grid.buildRect(16, 30);
    Hex* h = grid.getHex({0, 14});
    h->terrain = TerrainType::Forest;

    Zombie z(REDTEAM);
    z.setHex(h);

    Utility::clearDiceRolls();
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Bypass) == false);
    Utility::clearDiceRolls();
}
