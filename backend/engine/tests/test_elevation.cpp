#include "catch.hpp"
#include "Battlefield.hpp"
#include "RangedCombat.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "Utility.hpp"
#include "Defines.hpp"

// ── Elevation effects ────────────────────────────────────────────────────────
// Auto-cliff: a hexside whose two hexes differ by ≥ 2 elevation tiers is
// impassable (sidePassable + the BFS graphs built by computeDistances). A
// 1-tier slope is passable but costs TERRAIN_COST_SLOPE extra to climb.
// Melee: ±1 attack per tier of height difference (capped at ±1). Ranged and
// spells: height extends effective range and adds ELEV_RANGED_BONUS to
// accuracy/damage per tier, capped at ELEV_RANGED_CAP tiers.

// ── Movement: cliffs and slopes ──────────────────────────────────────────────
// Axial layout used here (r=5, valid q −2..13): red at {0,5}, goal {2,5}, the
// straight path's middle hex is {1,5}.

TEST_CASE("elevation: a 2-tier difference is an auto-cliff that movement routes around") {
    Battlefield bf;
    bf.hexGrid.getHex({1, 5})->elevation = 2; // every side into {1,5} becomes a cliff

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setHex(bf.hexGrid.getHex({0, 5}));
    Army red;
    red.push_back(std::move(redPtr));
    bf.loadArmies(std::move(red), {}); // builds the BFS tables with the cliff in them

    Hex* goal = bf.hexGrid.getHex({2, 5});
    REQUIRE(goal != nullptr);

    // Two hexes apart as the crow flies, three hops around the raised hex —
    // {1,5} is the only shared neighbour, so the cliff forces the detour.
    REQUIRE(HexGrid::distance({0, 5}, {2, 5}) == 2);
    REQUIRE(bf.hexGrid.bfsDistance(bf.hexGrid.getHex({0, 5}), goal, false) == 3);

    bf.moveToward(bf.getTeam(REDTEAM)[0], goal);

    AUnit* unit = bf.getTeam(REDTEAM)[0].get();
    REQUIRE(unit->getHex() != nullptr);
    CHECK(unit->getHex() != bf.hexGrid.getHex({1, 5}));             // never steps onto the cliff hex
    CHECK(bf.hexGrid.bfsDistance(unit->getHex(), goal, false) == 2); // real progress around it
    CHECK(unit->getMovePoints() == -TERRAIN_COST_OPEN);              // detour step is flat — no surcharge
}

TEST_CASE("elevation: climbing a 1-tier slope is allowed but costs TERRAIN_COST_SLOPE extra") {
    Battlefield bf;
    bf.hexGrid.getHex({1, 5})->elevation = 1; // slope, not cliff

    auto redPtr = std::make_unique<Soldier>(REDTEAM);
    redPtr->setHex(bf.hexGrid.getHex({0, 5}));
    Army red;
    red.push_back(std::move(redPtr));
    bf.loadArmies(std::move(red), {});

    Hex* goal = bf.hexGrid.getHex({2, 5});
    REQUIRE(goal != nullptr);
    // The slope is in the movement graph: straight through in 2 hops.
    REQUIRE(bf.hexGrid.bfsDistance(bf.hexGrid.getHex({0, 5}), goal, false) == 2);

    bf.moveToward(bf.getTeam(REDTEAM)[0], goal);

    AUnit* unit = bf.getTeam(REDTEAM)[0].get();
    // E onto {1,5} is the only distance-decreasing step, so the move is deterministic.
    REQUIRE(unit->getHex() == bf.hexGrid.getHex({1, 5}));
    CHECK(unit->getMovePoints() == -(TERRAIN_COST_OPEN + TERRAIN_COST_SLOPE)); // uphill surcharge
}

// ── Melee: high ground +1, low ground −1 ─────────────────────────────────────
// Same dice arithmetic as test_cohesion's outcome-flip test; the bonus source
// is elevation instead of a squad. Attacker Soldier addFatigue(6): hit roll =
// 11 − 6 + elevBonus + die; defender Zombie (defence 5, undead — no morale
// dice) misses the attack when 5 + defenceroll(3) = 8 ≥ AttackAttempt.
// On a hit: resultDMG = 8 + d1(5) − d2(3) = 10 → hp 20 → 10.
static int zombieHpAfterElevAttack(int attackerElev, int defenderElev, int hitDie) {
    Battlefield bf;
    HexCoord redCoord = {1, 14};
    Hex* redHex = bf.hexGrid.getHex(redCoord);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(redCoord)[1]);
    REQUIRE(enHex != nullptr);
    redHex->elevation = attackerElev; // 1-tier difference stays engageable (< 2 = no cliff)
    enHex->elevation  = defenderElev;

    Soldier attacker(REDTEAM);
    attacker.addFatigue(6);
    attacker.setHex(redHex);

    Zombie target(BLUETEAM);
    target.setHex(enHex);

    bf.resolveEngagements();
    REQUIRE(attacker.getEngagedSide() != nullptr);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(hitDie); Utility::pushDiceRoll(1); // attacker hit roll
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1);      // defenceroll
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);      // d1 (hit path only)
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1);      // d2 (hit path only)
    attacker.battle(bf);
    Utility::clearDiceRolls();

    return target.getHp();
}

TEST_CASE("elevation: +1 melee attack from high ground turns the same dice from miss to hit") {
    CHECK(zombieHpAfterElevAttack(0, 0, 3) == 20); // flat: AttackAttempt 8 vs miss-at-8
    CHECK(zombieHpAfterElevAttack(1, 0, 3) == 10); // uphill attacker: 9 → 10-damage hit
}

TEST_CASE("elevation: -1 melee attack from low ground turns the same dice from hit to miss") {
    CHECK(zombieHpAfterElevAttack(0, 0, 4) == 10); // flat: AttackAttempt 9 → hit
    CHECK(zombieHpAfterElevAttack(0, 1, 4) == 20); // attacker below: 8 vs miss-at-8
}

// ── Ranged/spells: the pipeline resolves the landed hex on the SHARED
// battlefield (Utility::Deviate → getBattlefield().hexGrid), so these tests
// must run on the singleton. Every hex change is reverted before the test
// ends, and the flee/BFS tables are recomputed so no cliff leaks into later
// movement tests.

TEST_CASE("elevation: shooting downhill adds ELEV_RANGED_BONUS damage per tier") {
    Battlefield& field = Utility::getBattlefield();

    auto zombieHpAfterShot = [&](int archerElev) {
        auto archerPtr = std::make_unique<Archer>(REDTEAM);
        auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
        Zombie* zombie = zombiePtr.get();
        Hex* archerHex = field.hexGrid.getHex({5, 8});
        archerHex->elevation = archerElev;
        archerPtr->setHex(archerHex);
        zombiePtr->setHex(field.hexGrid.getHex({2, 8})); // distance 3

        Army red, blue;
        red.push_back(std::move(archerPtr));
        blue.push_back(std::move(zombiePtr));
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache(); // tick() normally does this before the phase
        Utility::clearDiceRolls();
        // fireBow dice: baseDamage = BOWDAMAGE + throwDice(1) − throwDice(1) = 5;
        // deviation dist/accuracy = 0 → no rolls; aimed-hit getRandom(1,100) = 1
        // (≤ accuracy at either elevation); open ground + target shield 0 →
        // no terrain/onHit rolls; undead target → no morale dice.
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
        Utility::pushDiceRoll(1);
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();

        int hp = zombie->getHp();
        field.extractResult();
        archerHex->elevation = 0; // restore the shared grid
        field.recomputeDistances();
        return hp;
    };

    CHECK(zombieHpAfterShot(0) == 20 - BOWDAMAGE);                      // flat: 5 damage vs armour 0
    CHECK(zombieHpAfterShot(ELEV_RANGED_CAP)
          == 20 - (BOWDAMAGE + ELEV_RANGED_CAP * ELEV_RANGED_BONUS));   // +1 damage per tier
}

TEST_CASE("elevation: height extends aimed accuracy; the same aimed roll only lands from above") {
    Battlefield& field = Utility::getBattlefield();

    // shotAccuracy = accuracy + elevTiers × ELEV_RANGED_BONUS × 10:
    // 50 flat, 70 from 2 tiers up. Aimed roll 60: succeeds only from height;
    // flat it falls back to pickHexTarget, where the pushed 640 finds only
    // empty ground — the arrow is wasted.
    auto zombieHpAfterShot = [&](int archerElev) {
        auto archerPtr = std::make_unique<Archer>(REDTEAM);
        auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
        Zombie* zombie = zombiePtr.get();
        Hex* archerHex = field.hexGrid.getHex({5, 8});
        archerHex->elevation = archerElev;
        archerPtr->setHex(archerHex);
        zombiePtr->setHex(field.hexGrid.getHex({2, 8})); // distance 3

        Army red, blue;
        red.push_back(std::move(archerPtr));
        blue.push_back(std::move(zombiePtr));
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // bow damage d1 → base 5
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // bow damage d2
        Utility::pushDiceRoll(60);                           // aimed-hit roll
        Utility::pushDiceRoll(640);                          // hex fallback (flat miss only)
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();

        int hp = zombie->getHp();
        field.extractResult();
        archerHex->elevation = 0;
        field.recomputeDistances();
        return hp;
    };

    CHECK(zombieHpAfterShot(0) == 20);                 // 60 > 50 — aimed miss, arrow lost
    CHECK(zombieHpAfterShot(ELEV_RANGED_CAP) == 13);   // 60 ≤ 70 — hit for 5 + 2 elevation damage
}

TEST_CASE("elevation: caster height extends fireball range by one hex per tier") {
    Battlefield& field = Utility::getBattlefield();

    // Distance 11 > SPELLRANGE(10): a flat cast finds no target at all; from
    // one tier up the range check becomes 11 − 1 ≤ 10 and the fireball flies.
    auto castFrom = [&](int mageElev) {
        auto magePtr   = std::make_unique<Mage>(REDTEAM);
        auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
        Zombie* zombie = zombiePtr.get();
        AUnit* mage    = magePtr.get();
        Hex* mageHex = field.hexGrid.getHex({7, 8});
        mageHex->elevation = mageElev;
        magePtr->setHex(mageHex);
        zombiePtr->setHex(field.hexGrid.getHex({-4, 8})); // distance 11

        Army red, blue;
        red.push_back(std::move(magePtr));
        blue.push_back(std::move(zombiePtr));
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        // In-range cast: deviation 11/70 = 0 → no rolls; the aimed path is
        // skipped WITHOUT dice (distance 11 > aimed range 6, short-circuit),
        // so the primary resolves via pickHexTarget: getRandom(1,640) = 1
        // lands in the zombie's size-10 slot range. Splash: FIREBALL_SECONDARY
        // × 640 → empty ground. Out of range: no dice at all.
        Utility::pushDiceRoll(1);
        for (int i = 0; i < FIREBALL_SECONDARY; ++i)
            Utility::pushDiceRoll(640);
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();

        struct Result { int hp; int mana; };
        Result r{zombie->getHp(), mage->getMana()};
        field.extractResult();
        mageHex->elevation = 0;
        field.recomputeDistances();
        return r;
    };

    auto flat = castFrom(0);
    CHECK(flat.hp == 20);   // out of range — nothing happens
    CHECK(flat.mana == 99); // and no mana is spent

    auto raised = castFrom(1);
    CHECK(raised.hp == 20 - (FIREBALL_CENTRE + ELEV_RANGED_BONUS)); // 11 dealt vs armour 0
    CHECK(raised.mana == 98);                                       // one cast, one mana
}

TEST_CASE("elevation: height extends the archer's max bow range in calcShot") {
    // calcShot refuses targets where distance − elevTiers > BOWMAXRANGE.
    //
    // NOTE (production finding, pinned here at the calcShot level): through the
    // full fireBow() pipeline this gate is currently unreachable for targets
    // closer than `accuracy` (50) hexes — findArcherTarget's accurateShot()
    // treats any enemy within 50 hexes as a priority target and returns it
    // before calcShot's range check ever runs, and on the 16×30 grid that is
    // every enemy.
    Battlefield& field = Utility::getBattlefield();
    Hex* archerHex = field.hexGrid.getHex({7, 8});
    REQUIRE(archerHex != nullptr);

    Archer archer(REDTEAM);
    archer.setHex(archerHex);
    Zombie target(BLUETEAM);
    target.setHex(field.hexGrid.getHex({-3, 8})); // distance 10 = BOWMAXRANGE + 2

    Utility::clearDiceRolls();
    CHECK(archer.calcShot(target, REDTEAM) == -1); // flat: out of range — no dice consumed

    archerHex->elevation = ELEV_RANGED_CAP; // 2 tiers up: 10 − 2 = 8 ≤ BOWMAXRANGE
    // In range now — the shot is scored; scoring rolls one throwDice tiebreaker.
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    CHECK(archer.calcShot(target, REDTEAM) > 0);
    Utility::clearDiceRolls();

    archerHex->elevation = 0; // restore the shared grid
}
