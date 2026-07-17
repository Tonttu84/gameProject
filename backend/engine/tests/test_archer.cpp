#include "catch.hpp"
#include "Battlefield.hpp"
#include "RangedCombat.hpp"
#include "units/Archer.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "Utility.hpp"
#include "Defines.hpp"

// ── Archer firing internals ──────────────────────────────────────────────────
// Target scoring (calcUnitValue/calcShot), the forest aimed-accuracy penalty,
// and the physical-shield arrow block in fireBow's onHit. The full-pipeline
// tests drive triggerSpecialPhase on the SHARED battlefield because the
// ranged pipeline resolves the landed hex through Utility::getBattlefield().

// ── Target scoring: friendly splash must LOWER a target's score ──────────────
// calcUnitValue negates the value of own-team units, and calcShot adds the
// values of everyone adjacent to a candidate target. A wrong sign on either
// would make archers PREFER dropping arrows next to their own melee line.
//
// NOTE (production finding): this scoring only drives target choice when no
// enemy passes accurateShot's priority filter (distance < accuracy = 50
// hexes). On the 16×30 grid every enemy passes, so findArcherTarget currently
// returns the first alive enemy and never consults these scores — pinned here
// at the calcShot/calcUnitValue level.

TEST_CASE("archer scoring: calcUnitValue is negative for own-team units") {
    Archer archer(REDTEAM);
    Soldier soldier(REDTEAM);

    Utility::clearDiceRolls(); // calcUnitValue rolls nothing
    CHECK(archer.calcUnitValue(soldier, REDTEAM) < 0);  // my own man near the target: penalty
    CHECK(archer.calcUnitValue(soldier, BLUETEAM) > 0); // the same unit as an enemy: value
}

TEST_CASE("archer scoring: a friendly unit adjacent to the target lowers calcShot") {
    Battlefield& field = Utility::getBattlefield();
    Archer archer(REDTEAM);
    archer.setHex(field.hexGrid.getHex({5, 8}));

    // Two identical zombies, both 5 hexes out; one has a red Soldier adjacent.
    Zombie clean(BLUETEAM);
    clean.setHex(field.hexGrid.getHex({10, 8}));
    Zombie crowded(BLUETEAM);
    crowded.setHex(field.hexGrid.getHex({0, 8}));
    Soldier friendly(REDTEAM);
    friendly.setHex(field.hexGrid.getHex({-1, 8})); // W neighbour of the crowded zombie

    // calcShot rolls one throwDice tiebreaker per scored target — push the
    // same value for both calls so the comparison is dice-neutral.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    int cleanScore = archer.calcShot(clean, REDTEAM);
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    int crowdedScore = archer.calcShot(crowded, REDTEAM);
    Utility::clearDiceRolls();

    CHECK(cleanScore > 0);
    CHECK(crowdedScore > 0);
    CHECK(crowdedScore < cleanScore); // friendly-splash penalty pulled the score down
}

// ── Forest aimed-accuracy penalty (full fireBow pipeline) ────────────────────
// fireBow: baseAccuracy = accuracy − FOREST_RANGED_PENALTY × 10 when the aim
// unit stands in Forest → 40 vs 50 in the open. Aimed roll 45: open 45 ≤ 50 →
// aimed hit for 5 damage; forest 45 > 40 → the shot falls back to
// pickHexTarget where the pushed 640 finds only empty ground.

TEST_CASE("archer fire: forest around the target degrades aimed accuracy") {
    Battlefield& field = Utility::getBattlefield();

    auto zombieHpAfterShot = [&](TerrainType targetTerrain) {
        auto archerPtr = std::make_unique<Archer>(REDTEAM);
        auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
        Zombie* zombie = zombiePtr.get();
        archerPtr->setHex(field.hexGrid.getHex({5, 8}));
        Hex* targetHex = field.hexGrid.getHex({2, 8}); // distance 3
        targetHex->terrain = targetTerrain;
        zombiePtr->setHex(targetHex);

        Army red, blue;
        red.push_back(std::move(archerPtr));
        blue.push_back(std::move(zombiePtr));
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        // Deviation dist/accuracy = 0 → no rolls; undead target → no morale
        // dice; open-scenario applyHit rolls no terrain block (target in Open).
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // bow damage d1 → base 5
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // bow damage d2
        Utility::pushDiceRoll(45);                           // aimed-hit roll
        Utility::pushDiceRoll(640);                          // hex fallback (forest miss only)
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();

        int hp = zombie->getHp();
        field.extractResult();
        targetHex->terrain = TerrainType::Open; // restore the shared grid
        return hp;
    };

    CHECK(zombieHpAfterShot(TerrainType::Open) == 15);   // aimed hit: 5 damage vs armour 0
    CHECK(zombieHpAfterShot(TerrainType::Forest) == 20); // aimed miss: arrow lost in the canopy
}

// ── Physical shield arrow block (fireBow's onHit) ────────────────────────────
// onHit: throwDice ≤ target's shield → blocked, shield −1, and applyHit takes
// SHIELDREDUCTION off the damage. Target blue Soldier: shield 4, armour 5,
// hp 10. Damage dice (6,1)(1,1) → base = 5 + 6 − 1 = 10.
//   Blocked   (onHit roll 3 ≤ 4): 10 − SHIELDREDUCTION(5) = 5 → takeDamage(5)
//             vs armour 5 → nothing gets through; shield 4 → 3; no morale dice.
//   Unblocked (onHit roll 5 > 4): takeDamage(10) → 5 through armour → hp 5;
//             morale dice (6,1)(1,1): 10 + 6 − 1 = 15 > 5 → holds.

TEST_CASE("archer fire: a shield can block the arrow outright at the cost of one shield point") {
    Battlefield& field = Utility::getBattlefield();

    struct Outcome { int shield; int hp; bool broken; };
    auto shoot = [&](int blockDie) {
        auto archerPtr  = std::make_unique<Archer>(REDTEAM);
        auto soldierPtr = std::make_unique<Soldier>(BLUETEAM);
        AUnit* soldier  = soldierPtr.get();
        archerPtr->setHex(field.hexGrid.getHex({5, 8}));
        soldierPtr->setHex(field.hexGrid.getHex({2, 8})); // distance 3

        Army red, blue;
        red.push_back(std::move(archerPtr));
        blue.push_back(std::move(soldierPtr));
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);        // damage d1 → base 10
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);        // damage d2
        Utility::pushDiceRoll(1);                                   // aimed-hit roll (≤ 50)
        Utility::pushDiceRoll(blockDie); Utility::pushDiceRoll(1); // onHit shield roll
        Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);        // morale m1 (unblocked path only)
        Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);        // morale m2 (unblocked path only)
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();

        Outcome o{soldier->getShield(), soldier->getHp(), soldier->getBroken()};
        field.extractResult();
        return o;
    };

    Outcome blocked = shoot(3); // 3 ≤ shield(4) → arrow caught
    CHECK(blocked.shield == 3); // the block cost one shield point
    CHECK(blocked.hp == 10);    // 10 − SHIELDREDUCTION = 5, fully absorbed by armour

    Outcome through = shoot(5); // 5 > shield(4) → no block
    CHECK(through.shield == 4);
    CHECK(through.hp == 5);     // 10 − armour(5)
    CHECK(through.broken == false); // morale held
}
