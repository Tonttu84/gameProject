#define CATCH_CONFIG_MAIN
#include "catch.hpp"

#include "../HDRS/Soldier.hpp"
#include "../HDRS/Zombie.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Cell.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/BattleSetup.hpp"


// ── AUnit::takeDamage ────────────────────────────────────────────────────────

TEST_CASE("takeDamage reduces hp by (damage - armour)") {
    Soldier s(REDTEAM);           // armour = HEAVYARMOUR = 5, hp = maxHP = 10
    int initial = s.getHp();
    s.takeDamage(10);             // 10 - 5 = 5 actual damage
    REQUIRE(s.getHp() == initial - 5);
}

TEST_CASE("takeDamage does nothing when damage does not exceed armour") {
    Soldier s(REDTEAM);           // armour = 5
    int initial = s.getHp();
    int dealt = s.takeDamage(5);  // 5 - 5 = 0
    REQUIRE(dealt == 0);
    REQUIRE(s.getHp() == initial);
    REQUIRE(s.getAlive() == true);
}

TEST_CASE("takeDamage returns the actual damage dealt") {
    Soldier s(REDTEAM);           // armour = 5
    int dealt = s.takeDamage(8);  // 8 - 5 = 3
    REQUIRE(dealt == 3);
}

TEST_CASE("takeDamage sets alive=false when hp reaches 0") {
    Soldier s(REDTEAM);
    s.takeDamage(9999);
    REQUIRE(s.getAlive() == false);
}

TEST_CASE("Zombie takes full damage (no armour)") {
    Zombie z(REDTEAM);            // armour = 0, hp = 20
    int dealt = z.takeDamage(7);
    REQUIRE(dealt == 7);
    REQUIRE(z.getHp() == 13);
}


// ── AUnit::heal ──────────────────────────────────────────────────────────────

TEST_CASE("heal increases hp") {
    Soldier s(REDTEAM);
    s.takeDamage(8);              // deals 3 → hp = 7
    int before = s.getHp();
    s.heal(2);
    REQUIRE(s.getHp() == before + 2);
}

TEST_CASE("heal clamps to maxHP") {
    Soldier s(REDTEAM);
    s.takeDamage(8);              // hp = 7
    s.heal(9999);
    REQUIRE(s.getHp() == s.getmaxHP());
}

TEST_CASE("heal ignores negative values") {
    Soldier s(REDTEAM);
    int before = s.getHp();
    s.heal(-10);
    REQUIRE(s.getHp() == before);
}

TEST_CASE("heal on full-health unit does nothing") {
    Soldier s(REDTEAM);
    int before = s.getHp();
    s.heal(5);
    REQUIRE(s.getHp() == before);
}


// ── AUnit::rally ─────────────────────────────────────────────────────────────

TEST_CASE("rally returns false immediately when unit is not broken") {
    Soldier s(REDTEAM);
    REQUIRE(s.getBroken() == false);
    REQUIRE(s.rally() == false);
    REQUIRE(s.getBroken() == false);  // state must not change
}

TEST_CASE("rally leaves broken=false on success") {
    Soldier s(REDTEAM);
    s.setBroken(true);
    // Run many times; a success must clear the broken flag
    for (int i = 0; i < 200; i++) {
        Soldier t(REDTEAM);
        t.setBroken(true);
        bool rallied = t.rally();
        if (rallied)
            REQUIRE(t.getBroken() == false);
        else
            REQUIRE(t.getBroken() == true);
    }
}


// ── AUnit::testMorale ────────────────────────────────────────────────────────

TEST_CASE("testMorale passes immediately for zero damage") {
    Soldier s(REDTEAM);
    REQUIRE(s.testMorale(0) == true);
    REQUIRE(s.getBroken() == false);
}

TEST_CASE("testMorale passes immediately for negative damage") {
    Soldier s(REDTEAM);
    REQUIRE(s.testMorale(-5) == true);
    REQUIRE(s.getBroken() == false);
}


// ── throwDice (mock) ──────────────────────────────────────────────────────────

TEST_CASE("throwDice returns base roll when no explosion") {
    // push: [roll=4, explosion-check=1] — 1 ≠ 6, no recurse
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(4);
    Utility::pushDiceRoll(1);
    REQUIRE(Utility::throwDice() == 4);
    Utility::clearDiceRolls();
}

TEST_CASE("throwDice adds recursive roll when explosion triggers") {
    // First call: roll=3, check=6 → recurse; inner: roll=2, check=1 → stop
    // Result: 3 + 2 = 5
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(3);
    Utility::pushDiceRoll(6);
    Utility::pushDiceRoll(2);
    Utility::pushDiceRoll(1);
    REQUIRE(Utility::throwDice() == 5);
    Utility::clearDiceRolls();
}


// ── AUnit::rally (mock) ───────────────────────────────────────────────────────
// rally passes when: morale(10) + throwDice() - throwDice() >= 12
// Each throwDice() consumes 2 values: [result, explosion-check].

TEST_CASE("rally succeeds when net roll reaches threshold") {
    // dice1=5 (check=1), dice2=2 (check=1) → 10+5-2=13 >= 12
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    Soldier s(REDTEAM);
    s.setBroken(true);
    REQUIRE(s.rally() == true);
    REQUIRE(s.getBroken() == false);
    Utility::clearDiceRolls();
}

TEST_CASE("rally fails when net roll falls short of threshold") {
    // dice1=1 (check=1), dice2=5 (check=1) → 10+1-5=6 < 12
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);
    Soldier s(REDTEAM);
    s.setBroken(true);
    REQUIRE(s.rally() == false);
    REQUIRE(s.getBroken() == true);
    Utility::clearDiceRolls();
}


// ── AUnit::testMorale (mock) ──────────────────────────────────────────────────
// passes when: morale(10) + throwDice() - throwDice() > damage

TEST_CASE("testMorale passes when roll exceeds damage") {
    // dice1=4 (check=1), dice2=1 (check=1) → 10+4-1=13 > 5
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(4); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Soldier s(REDTEAM);
    REQUIRE(s.testMorale(5) == true);
    REQUIRE(s.getBroken() == false);
    Utility::clearDiceRolls();
}

TEST_CASE("testMorale fails and breaks unit when roll falls short") {
    // dice1=1 (check=1), dice2=2 (check=1) → 10+1-2=9, 9 > 10 is false
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    Soldier s(REDTEAM);
    REQUIRE(s.testMorale(10) == false);
    REQUIRE(s.getBroken() == true);
    Utility::clearDiceRolls();
}


// ── Fatigue ──────────────────────────────────────────────────────────────────

TEST_CASE("fatigue starts at 0") {
    Soldier s(REDTEAM);
    REQUIRE(s.getFatigue() == 0);
}

TEST_CASE("increaseFatigue raises fatigue each call") {
    Soldier s(REDTEAM);           // fatigueCost = 5 (4 base + 1 heavy armour)
    s.increaseFatigue();
    REQUIRE(s.getFatigue() == 5);
    s.increaseFatigue();
    REQUIRE(s.getFatigue() == 10);
}

TEST_CASE("recover reduces fatigue by FATIGUERECOVERY") {
    Soldier s(REDTEAM);
    s.increaseFatigue();          // +5
    s.increaseFatigue();          // +5 → 10
    s.recover();                  // -4 → 6
    REQUIRE(s.getFatigue() == 6);
}

TEST_CASE("recover does not let fatigue go below 0") {
    Soldier s(REDTEAM);           // fatigue = 0
    s.recover();
    REQUIRE(s.getFatigue() == 0);
}

TEST_CASE("Zombie has 0 fatigueCost so fatigue never increases") {
    Zombie z(REDTEAM);
    z.increaseFatigue();
    z.increaseFatigue();
    REQUIRE(z.getFatigue() == 0);
}


// ── addWeapon ────────────────────────────────────────────────────────────────

TEST_CASE("addWeapon accumulates shield value") {
    Soldier s(REDTEAM);           // SwordAndShield has shieldValue=4
    REQUIRE(s.getShield() == 4);
}


// ── Cell::getRange ───────────────────────────────────────────────────────────

TEST_CASE("getRange returns 0 for identical position") {
    Cell a;
    a.wLoc = 5; a.hLoc = 3;
    REQUIRE(a.getRange(a) == 0);
}

TEST_CASE("getRange uses Chebyshev (max of axis deltas)") {
    Cell a, b;
    a.wLoc = 0; a.hLoc = 0;
    b.wLoc = 3; b.hLoc = 5;
    REQUIRE(a.getRange(b) == 5);   // max(3, 5)
}

TEST_CASE("getRange is symmetric") {
    Cell a, b;
    a.wLoc = 2; a.hLoc = 7;
    b.wLoc = 9; b.hLoc = 1;
    REQUIRE(a.getRange(b) == b.getRange(a));
}

TEST_CASE("getRange handles negative deltas correctly") {
    Cell a, b;
    a.wLoc = 10; a.hLoc = 10;
    b.wLoc = 7;  b.hLoc = 3;
    REQUIRE(a.getRange(b) == 7);   // max(3, 7)
}


// ── Utility::calcDistance ────────────────────────────────────────────────────

TEST_CASE("calcDistance returns -1 for null source") {
    Cell c; c.wLoc = 0; c.hLoc = 0;
    REQUIRE(Utility::calcDistance(&c, nullptr) == -1);
}

TEST_CASE("calcDistance returns -1 for null target") {
    Cell c; c.wLoc = 0; c.hLoc = 0;
    REQUIRE(Utility::calcDistance(nullptr, &c) == -1);
}

TEST_CASE("calcDistance returns -1 for two nulls") {
    REQUIRE(Utility::calcDistance(nullptr, nullptr) == -1);
}

TEST_CASE("calcDistance returns Chebyshev distance") {
    Cell a, b;
    a.wLoc = 0; a.hLoc = 0;
    b.wLoc = 4; b.hLoc = 2;
    REQUIRE(Utility::calcDistance(&a, &b) == 4);   // max(4, 2)
}

TEST_CASE("calcDistance returns 0 for same cell") {
    Cell a;
    a.wLoc = 3; a.hLoc = 7;
    REQUIRE(Utility::calcDistance(&a, &a) == 0);
}


// ── Unit flags ───────────────────────────────────────────────────────────────

TEST_CASE("Zombie is undead") {
    Zombie z(REDTEAM);
    REQUIRE(z.getUndead() == true);
}

TEST_CASE("Soldier is not undead") {
    Soldier s(REDTEAM);
    REQUIRE(s.getUndead() == false);
}

TEST_CASE("Mage is a spellcaster") {
    Mage m(REDTEAM);
    REQUIRE(m.getSpellCaster() == true);
}

TEST_CASE("Soldier is not a spellcaster") {
    Soldier s(REDTEAM);
    REQUIRE(s.getSpellCaster() == false);
}

TEST_CASE("unit starts alive and not broken") {
    Soldier s(REDTEAM);
    REQUIRE(s.getAlive() == true);
    REQUIRE(s.getBroken() == false);
}

TEST_CASE("setAlive and getAlive round-trip") {
    Soldier s(REDTEAM);
    s.setAlive(false);
    REQUIRE(s.getAlive() == false);
}

TEST_CASE("setBroken and getBroken round-trip") {
    Soldier s(REDTEAM);
    s.setBroken(true);
    REQUIRE(s.getBroken() == true);
    s.setBroken(false);
    REQUIRE(s.getBroken() == false);
}


// ── battleSummon flag ─────────────────────────────────────────────────────────

TEST_CASE("battleSummon defaults to false") {
    Soldier s(REDTEAM);
    REQUIRE(s.getBattleSummon() == false);
}

TEST_CASE("setBattleSummon round-trip") {
    Zombie z(REDTEAM);
    z.setBattleSummon(true);
    REQUIRE(z.getBattleSummon() == true);
    z.setBattleSummon(false);
    REQUIRE(z.getBattleSummon() == false);
}


// ── BattleSetup / Battlefield integration ────────────────────────────────────
// These tests use the global battlefield singleton. Each test cleans up:
//   - tests that only call randomPlaceArmy: army goes out of scope → cells reset
//   - tests that call loadArmies: end with extractResult() → teams/cells cleared

TEST_CASE("randomPlaceArmy places all units within zone bounds") {
    Battlefield& field = Utility::getBattlefield();
    PlacementZone zone = {20, 30, 5, 15};

    Army army;
    appendArmy<Soldier>(army, 5, REDTEAM);
    randomPlaceArmy(army, field, zone);

    for (const auto& unit : army) {
        REQUIRE(unit->getCell() != nullptr);
        REQUIRE(unit->getCell()->wLoc >= (int)zone.wStart);
        REQUIRE(unit->getCell()->wLoc <= (int)zone.wEnd);
        REQUIRE(unit->getCell()->hLoc >= (int)zone.hStart);
        REQUIRE(unit->getCell()->hLoc <= (int)zone.hEnd);
    }
    // army leaves scope → units destroyed → cells reset
}

TEST_CASE("randomPlaceArmy sets placed flag on every unit") {
    Battlefield& field = Utility::getBattlefield();

    Army army;
    appendArmy<Soldier>(army, 4, REDTEAM);
    randomPlaceArmy(army, field, {35, 45, 20, 30});

    for (const auto& unit : army)
        REQUIRE(unit->getPlaced() == true);
}

TEST_CASE("countTeam matches placed army sizes after loadArmies") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Soldier>(red, 3, REDTEAM);
    appendArmy<Zombie>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {60, 70, 20, 30});
    randomPlaceArmy(blue, field, {80, 90, 20, 30});
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(field.countTeam(REDTEAM) == 3);
    REQUIRE(field.countTeam(BLUETEAM) == 2);

    field.extractResult(); // temporary → destroyed immediately → cells reset
}

TEST_CASE("tick returns true while both sides still have living units") {
    Battlefield& field = Utility::getBattlefield();

    // Place teams at opposite ends — too far apart to engage in one tick
    Army red, blue;
    appendArmy<Soldier>(red, 2, REDTEAM);
    appendArmy<Soldier>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {130, 140, 5, 10});
    randomPlaceArmy(blue, field, {0,   10,  5, 10});
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(field.tick() == true);

    field.extractResult();
}

TEST_CASE("extractResult winner is BLUETEAM when only blue survives") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Zombie>(red, 1, REDTEAM);
    appendArmy<Soldier>(blue, 50, BLUETEAM);
    randomPlaceArmy(red,  field, {0,                   field.width / 2 - 1, 0, field.height - 1});
    randomPlaceArmy(blue, field, {field.width / 2,     field.width - 1,     0, field.height - 1});
    field.loadArmies(std::move(red), std::move(blue));

    int guard = 10000;
    while (field.tick() && --guard > 0) {}
    REQUIRE(guard > 0);

    BattleResult result = field.extractResult();

    REQUIRE(result.winner == BLUETEAM);
    REQUIRE(result.redSurvivors.empty());
    REQUIRE(result.blueSurvivors.size() > 0);
    for (const auto& unit : result.blueSurvivors)
        REQUIRE(unit->getBattleSummon() == false);
}

TEST_CASE("extractResult clears internal state so a second call returns empty") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Soldier>(red, 2, REDTEAM);
    appendArmy<Soldier>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {60, 70, 35, 45});
    randomPlaceArmy(blue, field, {80, 90, 35, 45});
    field.loadArmies(std::move(red), std::move(blue));

    field.extractResult(); // first call — clears teams

    BattleResult second = field.extractResult();
    REQUIRE(second.redSurvivors.empty());
    REQUIRE(second.blueSurvivors.empty());
}


// ── BattleResult: survivors vs battleSummon ───────────────────────────────────
// 50 real Soldiers + 50 battleSummon Zombies on RED vs 1 Zombie on BLUE.
// RED wins easily. extractResult must return the 50 real Soldiers and exclude
// the battleSummon Zombies.

TEST_CASE("extractResult excludes battleSummon units and includes real survivors") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    appendArmy<Soldier>(red, 50, REDTEAM);
    for (int i = 0; i < 50; ++i) {
        auto z = std::make_unique<Zombie>(REDTEAM);
        z->setBattleSummon(true);
        red.push_back(std::move(z));
    }

    Army blue;
    appendArmy<Zombie>(blue, 1, BLUETEAM);

    randomPlaceArmy(red,  field, {0,                 field.width / 2 - 1, 0, field.height - 1});
    randomPlaceArmy(blue, field, {field.width / 2,   field.width - 1,     0, field.height - 1});

    field.loadArmies(std::move(red), std::move(blue));

    int guard = 10000;
    while (field.tick() && --guard > 0) {}
    REQUIRE(guard > 0);  // battle must have ended, not timed out

    BattleResult result = field.extractResult();

    REQUIRE(result.winner == REDTEAM);
    REQUIRE(result.blueSurvivors.empty());
    REQUIRE(result.redSurvivors.size() > 0);

    for (const auto& unit : result.redSurvivors)
        REQUIRE(unit->getBattleSummon() == false);
}
