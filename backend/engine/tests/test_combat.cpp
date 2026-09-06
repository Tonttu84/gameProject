#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Zombie.hpp"
#include "units/Soldier.hpp"
#include "units/Cavalry.hpp"
#include "units/Horse.hpp"
#include "units/Warhorse.hpp"
#include "units/Priest.hpp"
#include "Squad.hpp"
#include "TestDummies.hpp"
#include "Utility.hpp"
#include "Defines.hpp"

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
    REQUIRE(c.getCategory() == UnitCategory::Beast); // reverted from Mounted — no rider to enforce it
    REQUIRE(c.getPrintSymbol() == 'H'); // stand-in for a riderless-horse sprite
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
    REQUIRE(c.getCategory() == UnitCategory::Beast); // rider died -> reverts to the loose mount's category
    REQUIRE(c.getBroken() == true);
    REQUIRE(c.getPrintSymbol() == 'H');
}

TEST_CASE("Cavalry takeDamage(): ranged hits use a flat rider bias instead of reach") {
    Cavalry c(REDTEAM);

    // Ranged boundary = clamp(20-RANGED_RIDER_BIAS(2),1,29) = 18.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(19); // 19 > 18 -> rider is the target
    int dealt = c.takeDamage(9999, ArmorPen::Normal);
    Utility::clearDiceRolls();

    REQUIRE(dealt > 0);
    REQUIRE(c.getCategory() == UnitCategory::Beast); // rider died -> reverts to the loose mount's category
    REQUIRE(c.getPrintSymbol() == 'H');
}

// Regression test for a real production crash: ASan stack-overflow in
// MountedUnit::getBroken(), recursing through itself forever. Root cause:
// effectTarget() falls back to `this` once both rider and mount are gone,
// and every effectTarget()-delegating method (getHp/getmaxHP/getArmour/
// getDefence/getAttackPWR/heal/getBroken/setBroken) called
// effectTarget()->sameMethod() unconditionally — calling that same overridden
// virtual method on `this` again instead of ever reaching AUnit's own plain
// storage. See [[design_mounted_units]].
TEST_CASE("MountedUnit: once both rider and mount are dead, stat delegates resolve via "
          "AUnit's own storage instead of recursing through effectTarget()") {
    Cavalry c(REDTEAM); // Soldier rider + Horse mount

    Utility::clearDiceRolls();
    // Kill the mount first (boundary=20 for Horse(20)+Soldier(10); roll<=20 hits mount).
    Utility::pushDiceRoll(1);
    for (int i = 0; i < 6; ++i) { Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); }
    c.defend(999, 999, ArmorPen::Bypass, /*attackerReach*/0);
    Utility::clearDiceRolls();
    REQUIRE(c.hasMount() == false);
    REQUIRE(c.hasRider() == true);

    // Kill the rider too. hasMount() is already false, so MountedUnit::defend()'s
    // first branch short-circuits without ever rolling pickMountTarget() — only
    // _rider->defend()'s own dice are needed.
    for (int i = 0; i < 6; ++i) { Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); }
    c.defend(999, 999, ArmorPen::Bypass, /*attackerReach*/0);
    Utility::clearDiceRolls();
    REQUIRE(c.hasRider() == false);
    REQUIRE(c.hasMount() == false);
    REQUIRE(c.getAlive() == false); // composite fully dead — both parts gone

    // The actual crash this guards against: none of these should hang/abort,
    // and should resolve to AUnit's own untouched defaults (the composite's
    // own hitpoints/maxHP/armour/defence/attackPWR were never written to by
    // anything — only the rider's/mount's sub-objects ever took damage).
    CHECK(c.getBroken() == false); // AUnit's own default
    c.setBroken(true);
    CHECK(c.getBroken() == true);  // round-trips through AUnit's own bool, not a dead sub-unit
    CHECK(c.getHp() == 10);
    CHECK(c.getmaxHP() == 10);
    CHECK(c.getArmour() == 0);
    CHECK(c.getDefence() == 10);
    CHECK(c.getAttackPWR() == 10);
    c.heal(5);
    CHECK(c.getHp() == 10); // clamped to maxHP, same as any other unit's heal()
}

TEST_CASE("Cavalry: dismounted rider leaves a Cavalry-typed squad automatically") {
    Squad sq("Lancers");
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

    REQUIRE(c.getCategory() == UnitCategory::Beast); // confirms the mount took over (and reverted)
    REQUIRE(c.getHp() == c.getmaxHP());              // fresh Horse stats, not stale rider numbers
}

TEST_CASE("MountedUnit::heal() restores the rider while mounted, even if the mount is also hurt") {
    Cavalry c(REDTEAM); // Soldier rider: hitpoints=10/maxHP=10; Horse mount: hitpoints=15/maxHP=15

    // Hit the rider for exactly 4 damage: target-select roll picks the rider
    // (25 > boundary 20), AttackAttempt=999 guarantees the hit regardless of
    // defenceroll, damage=9 with d1=1,d2=1 -> resultDMG = 9+1-1 = 9, minus the
    // rider's plate (HEAVYARMOUR 5, subtracted from a melee blow since P-11) = 4.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(25);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d2
    int dealt = c.defend(999, 4 + HEAVYARMOUR, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(dealt == 4);
    REQUIRE(c.getHp() == 6);          // rider: 10 - 4
    REQUIRE(c.hasMount() == true);    // mount untouched by the rider taking a hit

    // Hit the mount too (10 <= boundary 20 -> mount). The horse wears nothing
    // (armour 0), so its blow needs no plate added to land the same 4.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(10);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d2
    c.defend(999, 4, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();
    REQUIRE(c.hasMount() == true);    // mount survived (15 - 4 = 11), still mounted

    // heal() goes through effectTarget() -> the rider, capped at the
    // rider's own maxHP. The mount's own (separately damaged) hitpoints are
    // not touched by this at all — matches the desired "heal checks the
    // rider" behavior; the mount being hurt is not this call's concern.
    c.heal(100);
    REQUIRE(c.getHp() == 10); // rider healed to full
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

// ── Priest::castBless vs. Cavalry — heal/rally target through the rider ─────
// Priest::castBless() finds a target via Utility::findTarget(team, isBroken,
// isWounded, team) — isBroken is the priority filter (any broken ally wins
// immediately), isWounded the fallback ("unit.getHp() < unit.getmaxHP()").
// Both predicates call straight through to getHp()/getmaxHP()/getBroken(),
// which now delegate to effectTarget() (the rider) on a MountedUnit — so
// these exercise the real Priest pathway, not just the underlying getters.

TEST_CASE("Priest::castBless does not heal a cavalry whose mount is hurt but rider is not") {
    Battlefield& field = Utility::getBattlefield();

    auto priestPtr = std::make_unique<Priest>(REDTEAM);
    auto cavPtr    = std::make_unique<Cavalry>(REDTEAM);
    Cavalry* cav   = cavPtr.get();

    // Placed like the two cases below it (T-2), so what declines the cast here
    // is the RIDER being whole and not the pair standing nowhere.
    priestPtr->setHex(field.hexGrid.getHex({5, 8}));
    cavPtr->setHex(field.hexGrid.getHex({4, 8}));

    Army red;
    red.push_back(std::move(priestPtr));
    red.push_back(std::move(cavPtr));
    field.loadArmies(std::move(red), {});

    // Damage only the mount (10 <= boundary 20 -> mount); rider untouched.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(10);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d2
    cav->defend(999, 4, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    REQUIRE(cav->hasMount() == true);
    REQUIRE(cav->getHp() == cav->getmaxHP()); // rider still full -> not "wounded" from the outside

    AUnit* priest = field.getTeam(REDTEAM)[0].get();
    priest->castSpells(); // bless: finds no eligible target, does nothing

    REQUIRE(cav->getHp() == cav->getmaxHP()); // unchanged — never healed

    field.extractResult();
}

TEST_CASE("Priest::castBless detects and heals a cavalry whose rider is hurt") {
    Battlefield& field = Utility::getBattlefield();

    auto priestPtr = std::make_unique<Priest>(REDTEAM);
    auto cavPtr    = std::make_unique<Cavalry>(REDTEAM);
    Cavalry* cav   = cavPtr.get();

    // T-2: a boon is range-checked now, so both bodies have to STAND somewhere
    // — an unplaced ally is nobody's candidate. Adjacent hexes, well inside a
    // blessing's reach; the rule under test is the healing, not the distance.
    priestPtr->setHex(field.hexGrid.getHex({5, 8}));
    cavPtr->setHex(field.hexGrid.getHex({4, 8}));

    Army red;
    red.push_back(std::move(priestPtr));
    red.push_back(std::move(cavPtr));
    field.loadArmies(std::move(red), {});

    // Damage only the rider (25 > boundary 20 -> rider); mount untouched. The
    // blow carries the rider's plate on top of the wound (P-11: a melee blow
    // subtracts protection), so 4 of it lands.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(25);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d2
    cav->defend(999, 4 + HEAVYARMOUR, ArmorPen::Normal, 0);
    Utility::clearDiceRolls();

    int hpAfterHit = cav->getHp();
    REQUIRE(hpAfterHit < cav->getmaxHP());

    AUnit* priest = field.getTeam(REDTEAM)[0].get();
    priest->castSpells(); // bless: finds the wounded rider, heals it

    REQUIRE(cav->getHp() > hpAfterHit);
    REQUIRE(cav->hasMount() == true); // mount untouched throughout

    field.extractResult();
}

TEST_CASE("Priest::castBless detects and rallies a cavalry whose rider is broken") {
    Battlefield& field = Utility::getBattlefield();

    auto priestPtr = std::make_unique<Priest>(REDTEAM);
    auto cavPtr    = std::make_unique<Cavalry>(REDTEAM);
    Cavalry* cav   = cavPtr.get();
    cav->setBroken(true); // sets the rider's own broken flag via effectTarget()

    // Placed, for T-2's reason: a boon reaches a man who is standing somewhere.
    priestPtr->setHex(field.hexGrid.getHex({5, 8}));
    cavPtr->setHex(field.hexGrid.getHex({4, 8}));

    Army red;
    red.push_back(std::move(priestPtr));
    red.push_back(std::move(cavPtr));
    field.loadArmies(std::move(red), {});

    REQUIRE(cav->getBroken() == true);

    AUnit* priest = field.getTeam(REDTEAM)[0].get();
    priest->castSpells(); // bless: isBroken is the priority filter — rallies immediately

    REQUIRE(cav->getBroken() == false);

    field.extractResult();
}

// ── defend(): a shield and PROTECTION on the same body (TC-1 item 3, audit A7)
//
// Every shield case above uses a Zombie — armour 0, natural protection 0 — so
// until TC-1 nothing exercised the two arithmetics on ONE body, nor the `else
// if` at AUnit.cpp ~213 that makes an extra shield SUPPRESS the physical one.
// Both are pinned here on a Soldier (HEAVYARMOUR under a shield), which is the
// body the roster actually fights with.
//
// AttackAttempt is derived from the man's own defence rather than written out,
// so the case says what it means: `defence + shield` is the bar the shield
// check clears and `defence + defenceroll` is the one the blow beats.
//   miss check:   defence + defenceroll = 12+3 = 15 < 16 → HITS
//   shield check: defence + shield + defenceroll = 12+4+3 = 19 >= 16 → active
// The blow is 25 raw, which with d1=5/d2=3 is 27 — big enough that the reader
// can see the two subtractions separately instead of watching a clamp swallow
// them both.

namespace {
constexpr int SHIELD_POINTS = 4;
constexpr int BIG_BLOW      = 25;   // 25 + d1(5) − d2(3) = 27 before any armour

// Two flat morale dice for a LIVING body — a Zombie is undead and rolls none,
// a Soldier is not. Pushed as 1/1 so the throw is flat either way.
void pushMoraleDice()
{
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
}
}  // namespace

TEST_CASE("defend: a physical shield and the man's protection BOTH come off one melee blow") {
    Soldier s(REDTEAM);            // armour HEAVYARMOUR, defence 12, no natural skin
    s.setShield(SHIELD_POINTS);
    REQUIRE(s.getProtection() == HEAVYARMOUR);

    Utility::clearDiceRolls();
    pushHitDice();
    pushMoraleDice();

    const int attempt = s.getDefence() + SHIELD_POINTS;
    const int dealt   = s.defend(attempt, BIG_BLOW, ArmorPen::Normal);
    Utility::clearDiceRolls();

    // 27 − (SHIELDREDUCTION + 4*2) − HEAVYARMOUR = 27 − 13 − 5 = 9. The shield
    // is subtracted first and the protection after it, and BOTH are subtracted.
    CHECK(dealt == 27 - (SHIELDREDUCTION + SHIELD_POINTS * 2) - HEAVYARMOUR);
    CHECK(dealt == 9);
    CHECK(s.getShield() == SHIELD_POINTS - 1);   // the shield took the strain
}

TEST_CASE("defend: an extra shield SUPPRESSES the physical one, and protection still comes off after") {
    // The `else if` at AUnit.cpp ~213: a force field that blocks is the whole
    // of the shield arithmetic for this blow — the physical shield's
    // SHIELDREDUCTION + shield*2 never runs, and the shield point is not spent.
    // The protection subtraction below it is NOT part of that branch and runs
    // all the same, which is the half a reader could easily get wrong.
    Soldier s(REDTEAM);
    s.setShield(SHIELD_POINTS);
    s.addShield(6);                // force field, blocks on a roll <= 6

    Utility::clearDiceRolls();
    pushHitAndForceFieldDice();    // ...and the force-field roll is 3: it blocks
    pushMoraleDice();

    const int attempt = s.getDefence() + SHIELD_POINTS;
    const int dealt   = s.defend(attempt, BIG_BLOW, ArmorPen::Normal);
    Utility::clearDiceRolls();

    // Only SHIELDREDUCTION, NOT SHIELDREDUCTION + shield*2 — then the plate.
    CHECK(dealt == 27 - SHIELDREDUCTION - HEAVYARMOUR);
    CHECK(dealt == 17);
    CHECK(s.getShield() == SHIELD_POINTS);   // never engaged, never damaged
}

// ── A live mount answers with its rider's ARMOUR (TC-1 item 9, audit A9) ─────
// The twin of test_protection.cpp's "a mount's natural protection follows its
// rider": only the both-dead fallback (getArmour() == 0, above) was pinned, so
// the live forwarding at MountedUnit.cpp:54 rode on its sibling alone.

TEST_CASE("MountedUnit: a live mount answers with its rider's armour, moved or not") {
    Cavalry cav(REDTEAM);
    REQUIRE(cav.effectTarget() != &cav);          // the rider is up
    const int riderBase = cav.effectTarget()->getArmour();
    REQUIRE(riderBase == HEAVYARMOUR);            // the rider is a Soldier in plate
    CHECK(cav.getArmour() == riderBase);

    REQUIRE(cav.effectTarget()->applyStatMod("armour", 3) == true);
    CHECK(cav.getArmour() == riderBase + 3);
    // ...and what the damage sites read moves with it (P-3).
    CHECK(cav.getProtection() == combinedProtection(cav.getNaturalProtection(), riderBase + 3));
}

// ── The three untested melee dials (TC-1 items 10-12, audit (d)) ─────────────
//
// CRAMPED_COMBAT_PENALTY, MULTI_ATTACK_DEFENCE_PENALTY and fatiguelvl's ×2
// defence penalty are live balance dials that no test named before TC-1. These
// PIN WHAT THE CODE DOES TODAY — none of them is an opinion about what the
// number should be.
//
// The body is a Zombie throughout: defence 5, armour 0, shield 0, undead (so
// testMorale returns without drawing a die) — which makes the defence total in
// AUnit.cpp:187 exactly `5 − fatiguelvl*2 + defenceroll − cramped − swarm`,
// with nothing else in it. defenceroll is seeded to 3 by pushDefenceRoll(),
// so the bar the attack has to beat is 8 on an unencumbered body: an
// AttackAttempt of 8 is turned (the total is `>=`) and 9 lands.

namespace {
constexpr int ZOMBIE_DEFENCE = 5;
constexpr int DEFENCE_ROLL   = 3;

void pushDefenceRoll()      // just the one draw defend() makes before deciding
{
    Utility::pushDiceRoll(DEFENCE_ROLL); Utility::pushDiceRoll(1);
}

void pushDamageDice()       // d1 = d2 = 1, so a landed blow deals exactly `damage`
{
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
}

// One blow at `attempt`, with the dice for both outcomes queued. Returns what
// landed; 0 means the defence turned it.
int blowAt(AUnit& u, int attempt, int damage = 4)
{
    Utility::clearDiceRolls();
    pushDefenceRoll();
    pushDamageDice();
    const int dealt = u.defend(attempt, damage, ArmorPen::Normal);
    Utility::clearDiceRolls();
    return dealt;
}
}  // namespace

TEST_CASE("defend: CRAMPED_COMBAT_PENALTY costs one point of defence per tier of overhang") {
    // The tier is computed off the ENGAGED SIDE's effective frontage: forest
    // halves it to 20, and the threshold is two thirds of that (13). A body
    // whose PACKING size overhangs 13 pays one penalty per 13 points of
    // overhang — so packing 14 is one tier and packing 27 is two.
    HexGrid grid;
    grid.buildRect(16, 30);
    Hex* mine  = grid.getHex({3, 8});
    Hex* yours = grid.getHex({4, 8});
    REQUIRE(mine != nullptr);
    REQUIRE(yours != nullptr);
    mine->terrain = TerrainType::Forest;

    HexSide side;
    side.hexA = mine;
    side.hexB = yours;
    REQUIRE(effectiveFrontage(side) == HexSide::FRONTAGE / 2);
    const int threshold = effectiveFrontage(side) * 2 / 3;
    REQUIRE(threshold == 13);

    SECTION("a body that fits its frontage pays nothing, and the boundary is exact") {
        Zombie z(REDTEAM);
        z.setEngagedSide(&side);
        REQUIRE(z.getPackingSize() == 10);   // 10 <= 13: room enough
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) == 0);        // 8 vs 8: turned
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL + 1) > 0);     // 9: lands
    }

    SECTION("one tier of overhang turns the SAME throw from a parry into a hit") {
        Zombie z(REDTEAM);
        z.setEngagedSide(&side);
        REQUIRE(z.applyStatMod("formationFighter", -4) == true);
        REQUIRE(z.getPackingSize() == 14);   // 14 > 13: one tier over

        // The blow the unencumbered body above turned now lands...
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) > 0);
        // ...and exactly one point lower is still turned. That gap IS the dial.
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - CRAMPED_COMBAT_PENALTY) == 0);
    }

    SECTION("the penalty is per tier, not per cramped body") {
        Zombie z(REDTEAM);
        z.setEngagedSide(&side);
        // Two calls: applyStatMod bounds each DELTA at MAX_STAT_MOD (10) and the
        // packing row accumulates, so -17 has to arrive as -10 then -7.
        REQUIRE(z.applyStatMod("formationFighter", -10) == true);
        REQUIRE(z.applyStatMod("formationFighter", -7) == true);
        REQUIRE(z.getPackingSize() == 27);   // 27 > 13, and 14 > 13 again: two tiers

        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - CRAMPED_COMBAT_PENALTY) > 0);
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 2 * CRAMPED_COMBAT_PENALTY) == 0);
    }

    SECTION("the attacker pays the same penalty, on the same tiers") {
        // The twin at AUnit.cpp:327. computeMeleeAttackBonus() is the whole of
        // what a cramped attacker loses, so it is asked directly rather than
        // through a second exchange: nobody is holding the far side here, so
        // the bonus is UNDEFENDED_SIDE_BONUS minus the tiers.
        Zombie roomy(REDTEAM), tight(REDTEAM), tighter(REDTEAM);
        for (Zombie* z : { &roomy, &tight, &tighter }) {
            z->setHex(mine);
            z->setEngagedSide(&side);
        }
        REQUIRE(tight.applyStatMod("formationFighter", -4) == true);
        REQUIRE(tighter.applyStatMod("formationFighter", -10) == true);
        REQUIRE(tighter.applyStatMod("formationFighter", -7) == true);
        REQUIRE(tighter.getPackingSize() == 27);

        CHECK(roomy.computeMeleeAttackBonus()   == UNDEFENDED_SIDE_BONUS);
        CHECK(tight.computeMeleeAttackBonus()   == UNDEFENDED_SIDE_BONUS - CRAMPED_COMBAT_PENALTY);
        CHECK(tighter.computeMeleeAttackBonus() == UNDEFENDED_SIDE_BONUS - 2 * CRAMPED_COMBAT_PENALTY);
    }
}

TEST_CASE("defend: MULTI_ATTACK_DEFENCE_PENALTY makes a swarmed body easier to hit, until the turn resets") {
    Zombie z(REDTEAM);
    REQUIRE(z.getAttacksReceivedThisTurn() == 0);

    // The first blow of the turn is turned...
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) == 0);

    // ...and the second, after one attack has landed on him this turn, is not.
    z.incrementAttacksReceived();
    CHECK(z.getAttacksReceivedThisTurn() == 1);
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) > 0);
    // One point, no more: the same blow one lower is still turned.
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - MULTI_ATTACK_DEFENCE_PENALTY) == 0);

    // And it stacks per attacker.
    z.incrementAttacksReceived();
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - MULTI_ATTACK_DEFENCE_PENALTY) > 0);
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 2 * MULTI_ATTACK_DEFENCE_PENALTY) == 0);

    // resetAttacksReceived() puts the man back on his feet.
    z.resetAttacksReceived();
    CHECK(z.getAttacksReceivedThisTurn() == 0);
    CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) == 0);
}

TEST_CASE("the turn itself clears the multi-attack counter, at the start of the next tick") {
    // Where resetAttacksReceived() is actually called from (Battlefield.cpp,
    // onTurnStart) — so the penalty is a WITHIN-TURN effect and not a running
    // total over a battle. Pinned through a real tick rather than by reading
    // the call site.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    auto redPtr  = std::make_unique<ImmobileDummy>(REDTEAM);
    auto bluePtr = std::make_unique<ImmobileDummy>(BLUETEAM);
    ImmobileDummy* mine = redPtr.get();
    mine->setHex(field.hexGrid.getHex({2, 4}));
    bluePtr->setHex(field.hexGrid.getHex({12, 25}));   // nowhere near: no melee
    red.push_back(std::move(redPtr));
    blue.push_back(std::move(bluePtr));
    field.loadArmies(std::move(red), std::move(blue));

    mine->incrementAttacksReceived();
    mine->incrementAttacksReceived();
    REQUIRE(mine->getAttacksReceivedThisTurn() == 2);

    field.tick();
    CHECK(mine->getAttacksReceivedThisTurn() == 0);

    field.extractResult();
}

TEST_CASE("defend: every level of fatigue costs TWO points of defence") {
    // fatiguelvl is fatigue / FATIGUE_LEVEL_DIV, and defend() subtracts twice
    // it. Nothing named the number before TC-1 — only fatigue accumulation and
    // recovery were covered.
    SECTION("one level: the bar drops by exactly 2") {
        Zombie z(REDTEAM);
        z.addFatigue(FATIGUE_LEVEL_DIV);
        REQUIRE(z.getFatigue() == FATIGUE_LEVEL_DIV);

        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL) > 0);       // 8 lands now
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 2) == 0);  // 6 is still turned
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 1) > 0);   // and 7 lands: the flip
    }
    SECTION("two levels: twice as much, so the dial is per level and not a flag") {
        Zombie z(REDTEAM);
        z.addFatigue(FATIGUE_LEVEL_DIV * 2);

        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 3) > 0);
        CHECK(blowAt(z, ZOMBIE_DEFENCE + DEFENCE_ROLL - 4) == 0);
    }
}

// ── The two defence totals inside one defend() (TC-1 item 13, audit (e)3) ────
//
// AUnit.cpp:187 decides whether the blow lands with
//     defence − fatiguelvl*2 + defenceroll + cohesionStatBonus()
//              − crampedPenalty − attacksReceived*MULTI_ATTACK_DEFENCE_PENALTY
// and the physical-shield activation check twelve lines below it (AUnit.cpp:214)
// re-derives its own total as
//     defence + shield − fatiguelvl*2 + defenceroll
// — WITHOUT cohesion, without the cramped penalty and without the multi-attack
// penalty. So a swarmed man's guard is beaten while his shield is not, and a
// man in a tight formation gets no shield help from his cohesion.
//
// This test PINS WHAT THE CODE DOES TODAY and resolves nothing. The question
// for the balance pass, unanswered on purpose: deliberate — a shield is a
// SKILL check, not a formation one — or an accident? Either reading moves real
// numbers, which is exactly why it is written down rather than "fixed" here.

TEST_CASE("defend: the shield's own defence total ignores the swarm penalty the main one pays") {
    Soldier s(REDTEAM);            // defence 12, HEAVYARMOUR, shield below
    s.setShield(SHIELD_POINTS);

    // Two men already at him this turn: the main total is 12 + 3 − 2 = 13, and
    // the shield's is 12 + 4 + 3 = 19. An attempt of 14 sits BETWEEN them.
    s.incrementAttacksReceived();
    s.incrementAttacksReceived();
    const int attempt = s.getDefence() + DEFENCE_ROLL
                      - 2 * MULTI_ATTACK_DEFENCE_PENALTY + 1;
    REQUIRE(attempt == 14);
    REQUIRE(s.getDefence() + SHIELD_POINTS + DEFENCE_ROLL >= attempt);

    Utility::clearDiceRolls();
    pushHitDice();
    pushMoraleDice();
    const int dealt = s.defend(attempt, BIG_BLOW, ArmorPen::Normal);
    Utility::clearDiceRolls();

    // The blow got through the guard — and the shield still stopped its share.
    CHECK(dealt == 27 - (SHIELDREDUCTION + SHIELD_POINTS * 2) - HEAVYARMOUR);
    CHECK(s.getShield() == SHIELD_POINTS - 1);

    // The comparison that makes the disagreement visible: the SAME attempt
    // against the SAME man, unswarmed, never reaches the damage at all.
    Soldier fresh(REDTEAM);
    fresh.setShield(SHIELD_POINTS);
    Utility::clearDiceRolls();
    pushHitDice();
    pushMoraleDice();
    CHECK(fresh.defend(attempt, BIG_BLOW, ArmorPen::Normal) == 0);
    Utility::clearDiceRolls();
}
