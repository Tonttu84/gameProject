#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "Utility.hpp"

// ── Corpse economy ───────────────────────────────────────────────────────────
// cleanup() (run at the end of every tick) prunes the dead and tallies the
// corpses the necromancer's raise_dead spends. BOTH teams' non-undead dead
// feed the one shared pool — a corpse is a corpse regardless of its banner;
// only the undead leave nothing to reclaim. (An earlier blue-only tally was
// refactor drift, ruled a bug by the user 2026-07-17.)

TEST_CASE("corpses: a blue Soldier killed in melee leaves exactly one corpse after cleanup") {
    Battlefield bf;
    HexCoord redCoord = {1, 14}; // col 8, r 14 — all 6 neighbours valid
    Hex* redHex = bf.hexGrid.getHex(redCoord);
    Hex* enHex  = bf.hexGrid.getHex(bf.hexGrid.neighbors(redCoord)[1]);
    REQUIRE(redHex != nullptr);
    REQUIRE(enHex != nullptr);

    auto attackerPtr = std::make_unique<Soldier>(REDTEAM);
    auto victimPtr   = std::make_unique<Soldier>(BLUETEAM);
    AUnit* attacker = attackerPtr.get();
    AUnit* victim   = victimPtr.get();
    attackerPtr->setHex(redHex);
    victimPtr->setHex(enHex);

    Army red, blue;
    red.push_back(std::move(attackerPtr));
    blue.push_back(std::move(victimPtr));
    bf.loadArmies(std::move(red), std::move(blue));

    bf.resolveEngagements();
    REQUIRE(attacker->getEngagedSide() != nullptr);

    // One overkill hit. Soldier vs Soldier (equal reach 1) → no repel dice.
    // Attacker hit roll explodes: (6,6)(6,1) → 12 → AttackAttempt = 11 + 12 = 23.
    //   defenceroll (1,1): miss check 12 + 1 = 13 < 23 → hit;
    //   shield check 12 + 4 + 1 = 17 < 23 → the shield can't catch it;
    //   d1 (6,1), d2 (1,1) → resultDMG = 8 + 6 − 1 = 13;
    //   testMorale(13): (1,1)(1,1) → 10 + 1 − 1 = 10 ≤ 13 → breaks, and the
    //   13 damage kills through the victim's 10 hp anyway.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(6); // hit roll explodes...
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1); // ...into 6 + 6 = 12
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1); // d1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // d2
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // morale m1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // morale m2
    attacker->battle(bf);
    Utility::clearDiceRolls();

    REQUIRE(victim->getAlive() == false);
    REQUIRE(bf.getCorpses() == 0); // not counted yet — cleanup does the tally

    bf.cleanup();
    CHECK(bf.getCorpses() == 1);
    CHECK(bf.countTeam(BLUETEAM) == 0); // the dead unit was pruned
    CHECK(bf.countTeam(REDTEAM) == 1);  // the killer still stands
}

TEST_CASE("corpses: cleanup tallies non-undead dead from BOTH teams; undead leave none") {
    Battlefield bf;

    auto redSoldier  = std::make_unique<Soldier>(REDTEAM);
    auto blueSoldier = std::make_unique<Soldier>(BLUETEAM);
    auto blueZombie  = std::make_unique<Zombie>(BLUETEAM);
    AUnit* rs = redSoldier.get();
    AUnit* bs = blueSoldier.get();
    AUnit* bz = blueZombie.get();
    redSoldier->setHex(bf.hexGrid.getHex({1, 5}));
    blueSoldier->setHex(bf.hexGrid.getHex({1, 20}));
    blueZombie->setHex(bf.hexGrid.getHex({2, 20}));

    Army red, blue;
    red.push_back(std::move(redSoldier));
    blue.push_back(std::move(blueSoldier));
    blue.push_back(std::move(blueZombie));
    bf.loadArmies(std::move(red), std::move(blue));

    // Real deaths through the damage pipeline (Bypass ignores armour; lethal
    // damage kills before any morale dice would be rolled — no dice needed).
    Utility::clearDiceRolls();
    rs->takeDamage(9999, ArmorPen::Bypass);
    bs->takeDamage(9999, ArmorPen::Bypass);
    bz->takeDamage(9999, ArmorPen::Bypass);
    REQUIRE(rs->getAlive() == false);
    REQUIRE(bs->getAlive() == false);
    REQUIRE(bz->getAlive() == false);

    bf.cleanup();

    // Three dead, two corpses: the red and blue Soldiers each leave one;
    // the blue Zombie is undead — nothing left to reclaim.
    CHECK(bf.getCorpses() == 2);
    CHECK(bf.countTeam(REDTEAM) == 0);
    CHECK(bf.countTeam(BLUETEAM) == 0);
}
