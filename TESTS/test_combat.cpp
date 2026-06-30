#include "catch.hpp"
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/units/Zombie.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Cavalry.hpp"
#include "../HDRS/units/Horse.hpp"
#include "../HDRS/units/Warhorse.hpp"
#include "../HDRS/Squad.hpp"
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
// Piercing: same trigger chance as Normal — the protection magnitude is
//           halved afterward in RangedCombat::applyHit, not the chance here.
// Bypass:   ignores forest cover entirely, no dice consumed.

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

TEST_CASE("rollTerrainRangedBlock: Piercing — same trigger chance as Normal") {
    HexGrid grid;
    grid.buildRect(16, 30);
    Hex* h = grid.getHex({0, 14});
    h->terrain = TerrainType::Forest;

    Zombie z(REDTEAM);
    z.setHex(h);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // roll=1 ≤ FOREST_COVER_DEF_BONUS(1)
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Piercing) == true);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1); // roll=2 > 1 → no block
    REQUIRE(z.rollTerrainRangedBlock(ArmorPen::Piercing) == false);

    Utility::clearDiceRolls();
}

TEST_CASE("rollTerrainRangedBlock: Bypass — ignores forest cover entirely, no dice consumed") {
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

// ── Cavalry — MountedUnit damage routing and death transitions ──────────────
//
// Cavalry: rider size=10, mount (Horse) size=20, combined size=30.
// pickMountTarget(shift): boundary = clamp(mountSize - shift, 1, 29).
//   Melee, reach=0:               boundary=20 -> roll 1..20 mount, 21..30 rider.
//   Ranged (RANGED_RIDER_BIAS=2): boundary=18 -> roll 1..18 mount, 19..30 rider.
//
// Only the mount/rider selection roll is mocked; AttackAttempt/damage are set
// to 9999 so the hit-or-miss roll and lethal-damage roll can't go the other
// way regardless of real RNG for the rest of defend()'s internal dice —
// avoids needing to script every exploding-dice draw by hand.

TEST_CASE("Cavalry defend(): low roll routes the hit to the mount, killing it dismounts the rider") {
    Cavalry c(REDTEAM);
    REQUIRE(c.hasMount());

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(10); // 10 <= boundary(20) -> mount is the target
    int dealt = c.defend(9999, 9999, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(dealt > 0);
    REQUIRE(c.hasMount() == false);
    REQUIRE(c.getAlive() == true);   // rider survives
    REQUIRE(c.getCategory() == UnitCategory::Foot);
}

TEST_CASE("Cavalry defend(): high roll routes the hit to the rider, killing it leaves a loose mount") {
    Cavalry c(REDTEAM);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(25); // 25 > boundary(20) -> rider is the target
    int dealt = c.defend(9999, 9999, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(dealt > 0);
    REQUIRE(c.getAlive() == true);   // resurrected as the loose mount, not actually dead
    REQUIRE(c.getBroken() == true);
    REQUIRE(c.getCategory() == UnitCategory::Mounted);
}

TEST_CASE("Cavalry defend(): weapon reach shifts the boundary toward the rider") {
    Cavalry c(REDTEAM);

    // reach=5: boundary = clamp(20-5,1,29) = 15. Roll 18 hits the rider here,
    // even though the same roll would have hit the mount with reach=0 (boundary 20).
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(18);
    int dealt = c.defend(9999, 9999, ArmorPen::Normal, 5);
    Utility::clearDiceRolls();

    REQUIRE(dealt > 0);
    REQUIRE(c.getCategory() == UnitCategory::Mounted); // rider died -> object becomes the mount
    REQUIRE(c.getBroken() == true);
}

TEST_CASE("Cavalry takeDamage(): ranged hits use a flat rider bias instead of reach") {
    Cavalry c(REDTEAM);

    // Ranged boundary = clamp(20-RANGED_RIDER_BIAS(2),1,29) = 18.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(19); // 19 > 18 -> rider is the target
    int dealt = c.takeDamage(9999, ArmorPen::Normal);
    Utility::clearDiceRolls();

    REQUIRE(dealt > 0);
    REQUIRE(c.getCategory() == UnitCategory::Mounted); // rider died -> object becomes the mount
}

TEST_CASE("Cavalry: dismounted rider leaves a Cavalry-typed squad automatically") {
    Squad sq("Lancers", false);
    sq.setType(SquadType::Cavalry);
    Cavalry c(REDTEAM);
    sq.addMember(&c);
    REQUIRE(c.getSquad() == &sq);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(10); // mount is the target
    c.defend(9999, 9999, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(c.hasMount() == false);
    REQUIRE(c.getSquad() == nullptr);
}

// ── Warhorse — mount with its own attack ─────────────────────────────────────

TEST_CASE("Warhorse has a hoof attack and light armor; a plain Horse has neither") {
    Horse h(REDTEAM);
    REQUIRE(h.hasAttacks() == false);
    REQUIRE(h.getArmour() == 0);

    Warhorse w(REDTEAM);
    REQUIRE(w.hasAttacks() == true);
    REQUIRE(w.getArmour() == LIGHTARMOUR);
}

TEST_CASE("MountedUnit::getHp()/getmaxHP() delegate to the rider while mounted, "
          "and to the mount once the rider is gone") {
    Cavalry c(REDTEAM); // Soldier rider: hitpoints=10, maxHP=10 (AUnit defaults)
    REQUIRE(c.getHp() == 10);
    REQUIRE(c.getmaxHP() == 10);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(25); // 25 > boundary(20) -> rider is the target
    c.defend(9999, 9999, ArmorPen::Normal, 0); // kills the rider; mount survives
    Utility::clearDiceRolls();

    REQUIRE(c.getCategory() == UnitCategory::Mounted); // confirms the mount took over
    REQUIRE(c.getHp() == c.getmaxHP());                // fresh Horse stats, not stale rider numbers
}

// ── Cavalry footprint — only the mount counts for hex capacity ──────────────
// A mounted rider doesn't take more ground space than the horse alone, so
// getSize() (hex capacity, frontage, RangedCombat::pickHexTarget's weighting)
// should reflect only the mount's size while mounted. The separate, more
// detailed mount-vs-rider hit roll (pickMountTarget) still weighs both sizes
// independently — that's unaffected by this.

TEST_CASE("Cavalry::getSize() reflects only the mount while mounted") {
    Cavalry c(REDTEAM); // Soldier rider (size=10 default) on a Horse (size=20)
    REQUIRE(c.getSize() == 20);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(10); // mount is the target -> dismounts the rider
    c.defend(9999, 9999, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(c.getCategory() == UnitCategory::Foot);
    REQUIRE(c.getSize() == 10); // shrinks to the rider-only footprint after dismounting
}

// ── Cavalry battle() — mount fights independently alongside the rider ───────
//
// Rider (Soldier, SwordAndShield): damage = getDamage()(5) + strength(10)/strDiv(3)
//   = 5+3 = 8. With d1=6,d2=1: resultDMG = 8+6-1 = 13.
// Mount (Warhorse, Hoof): damage = getDamage()(4) + strength(10)/strDiv(3) = 4+3 = 7.
//   With d1=6,d2=1: resultDMG = 7+6-1 = 12.
// Target: Zombie, defence=6, armour=0, shield=0, hitpoints=20, undead (no morale
// dice). Pushing hit-roll=6 and defenceroll=1 for both attacks guarantees both
// land regardless of the (small, here ~0) engagement attackBonus.
// Expected final hitpoints: 20 - 13 - 12 = -5 (getHp() returns the raw value,
// unclamped) — only explainable if BOTH the rider's and the mount's own
// weapon independently landed.

TEST_CASE("Cavalry battle(): a mount with its own weapon attacks independently alongside the rider") {
    Battlefield bf;
    HexCoord redCoord = {1, 14};
    Hex* redHex = bf.hexGrid.getHex(redCoord);
    REQUIRE(redHex != nullptr);
    auto nb = bf.hexGrid.neighbors(redCoord);
    Hex* enemyHex = bf.hexGrid.getHex(nb[1]); // E neighbor
    REQUIRE(enemyHex != nullptr);

    Cavalry cav(REDTEAM, std::make_unique<Soldier>(REDTEAM), std::make_unique<Warhorse>(REDTEAM));
    cav.setHex(redHex);

    Zombie target(BLUETEAM);
    target.setHex(enemyHex);

    bf.resolveEngagements();
    REQUIRE(cav.getEngagedSide() != nullptr);

    Utility::clearDiceRolls();
    // Rider's attack: attacker-hit-roll(6,1) defenceroll(1,1) d1(6,1) d2(1,1)
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // Mount's attack: same shape
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    cav.battle(bf);
    Utility::clearDiceRolls();

    REQUIRE(target.getAlive() == false);
    REQUIRE(target.getHp() == -5);
}
