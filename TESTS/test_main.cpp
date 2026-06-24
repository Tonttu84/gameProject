#define CATCH_CONFIG_MAIN
#include "catch.hpp"

#include "../HDRS/Soldier.hpp"
#include "../HDRS/Zombie.hpp"
#include "../HDRS/Archer.hpp"
#include "../HDRS/Mage.hpp"
#include "../HDRS/Cell.hpp"
#include "../HDRS/Utility.hpp"


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
