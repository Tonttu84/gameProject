#define CATCH_CONFIG_MAIN
#include "catch.hpp"

#include "Utility.hpp"

// The suite runs on a RANDOM seed every time, on purpose: a fixed one would be
// green and blind, and both flakes chased on 2026-08-09 were rare-draw bugs a
// pinned seed would have hidden for months. The cost of that is a failure you
// cannot re-run — so the seed is printed.
//
// Up front, because ASan/UBSan abort the process and a listener at the END
// would never fire; and again after a failing run, so it sits next to the
// failure instead of scrolled off the top of a CI log. Both go to stderr, so
// nothing is added to the stdout Catch2 reporters parse.
namespace {
struct SeedReporter : Catch::TestEventListenerBase {
    using TestEventListenerBase::TestEventListenerBase;

    void testRunStarting(Catch::TestRunInfo const&) override {
        std::cerr << "[rng] seed=" << Utility::rngSeed() << '\n';
    }

    void testRunEnded(Catch::TestRunStats const& stats) override {
        if (stats.totals.assertions.failed > 0)
            std::cerr << "[rng] FAILED with seed=" << Utility::rngSeed()
                      << " — replay with: GAME_RNG_SEED=" << Utility::rngSeed()
                      << " ./run_tests\n";
    }
};
} // namespace
CATCH_REGISTER_LISTENER(SeedReporter)

#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "hex/HexGrid.hpp"
#include "Utility.hpp"
#include "BattleSetup.hpp"
#include "scenarios/SampleBattle.hpp"
#include "TestDummies.hpp"


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
    // Construct unit first so sortKey's getRandom() doesn't consume mock values.
    Soldier s(REDTEAM);
    s.setBroken(true);
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    REQUIRE(s.rally() == true);
    REQUIRE(s.getBroken() == false);
    Utility::clearDiceRolls();
}

TEST_CASE("rally fails when net roll falls short of threshold") {
    // dice1=1 (check=1), dice2=5 (check=1) → 10+1-5=6 < 12
    Soldier s(REDTEAM);
    s.setBroken(true);
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);
    REQUIRE(s.rally() == false);
    REQUIRE(s.getBroken() == true);
    Utility::clearDiceRolls();
}


// ── AUnit::testMorale (mock) ──────────────────────────────────────────────────
// passes when: morale(10) + throwDice() - throwDice() > damage

TEST_CASE("testMorale passes when roll exceeds damage") {
    // dice1=4 (check=1), dice2=1 (check=1) → 10+4-1=13 > 5
    // Construct unit first so sortKey's getRandom() doesn't consume mock values.
    Soldier s(REDTEAM);
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(4); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    REQUIRE(s.testMorale(5) == true);
    REQUIRE(s.getBroken() == false);
    Utility::clearDiceRolls();
}

TEST_CASE("testMorale fails and breaks unit when roll falls short") {
    // dice1=1 (check=1), dice2=2 (check=1) → 10+1-2=9, 9 > 10 is false
    Soldier s(REDTEAM);
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(2); Utility::pushDiceRoll(1);
    REQUIRE(s.testMorale(10) == false);
    REQUIRE(s.getBroken() == true);
    Utility::clearDiceRolls();
}


// ── Fatigue ──────────────────────────────────────────────────────────────────

TEST_CASE("increaseFatigue raises fatigue each call") {
    Soldier s(REDTEAM);           // fatigueCost = 5 (4 base + 1 heavy armor)
    s.increaseFatigue();
    REQUIRE(s.getFatigue() == 5);
    s.increaseFatigue();
    REQUIRE(s.getFatigue() == 10);
}

TEST_CASE("recover reduces fatigue by fatigueRecovery") {
    Soldier s(REDTEAM);
    s.increaseFatigue();          // +5 → 5
    s.increaseFatigue();          // +5 → 10
    s.recover();                  // -4 → 6
    REQUIRE(s.getFatigue() == 6);
}

TEST_CASE("recover does not let fatigue go below 0") {
    Soldier s(REDTEAM);           // fatigue = 0
    s.recover();
    REQUIRE(s.getFatigue() == 0);
}

TEST_CASE("Zombie has 0 fatigueCost so combat never tires it") {
    Zombie z(REDTEAM);
    z.increaseFatigue();   // 0 fatigueCost → no change
    z.increaseFatigue();
    REQUIRE(z.getFatigue() == 0);
}


// ── addWeapon ────────────────────────────────────────────────────────────────

TEST_CASE("addWeapon accumulates shield and defence values across weapons") {
    Soldier s(REDTEAM);           // ctor's SwordAndShield: shieldValue=4; defence ends at 12
    REQUIRE(s.getShield() == 4);
    REQUIRE(s.getDefence() == 12);
    s.addWeapon(MeleeWeapons::MaceAndShield); // shieldValue=4, defence+1
    REQUIRE(s.getShield() == 4 + 4);          // shield sums across both weapons
    REQUIRE(s.getDefence() == 12 + 1);        // defence bonus stacks too
}


// ── HexGrid::distance ────────────────────────────────────────────────────────

TEST_CASE("HexGrid::distance returns 0 for identical coord") {
    REQUIRE(HexGrid::distance({5, 3}, {5, 3}) == 0);
}

TEST_CASE("HexGrid::distance computes hex distance correctly") {
    // dq=3, dr=5, dq+dr=8 → (3+5+8)/2 = 8
    REQUIRE(HexGrid::distance({0, 0}, {3, 5}) == 8);
}

TEST_CASE("HexGrid::distance is symmetric") {
    REQUIRE(HexGrid::distance({2, 7}, {9, 1}) == HexGrid::distance({9, 1}, {2, 7}));
}

TEST_CASE("HexGrid::distance handles negative deltas") {
    // dq=-3, dr=-7, dq+dr=-10 → (3+7+10)/2 = 10
    REQUIRE(HexGrid::distance({10, 10}, {7, 3}) == 10);
}


// ── Utility::calcDistance ────────────────────────────────────────────────────

TEST_CASE("calcDistance returns -1 for null source") {
    HexGrid g;
    g.buildRect(20, 20);
    Hex* c = g.getHex({0, 0});
    REQUIRE(Utility::calcDistance(c, nullptr) == -1);
}

TEST_CASE("calcDistance returns -1 for null target") {
    HexGrid g;
    g.buildRect(20, 20);
    Hex* c = g.getHex({0, 0});
    REQUIRE(Utility::calcDistance(nullptr, c) == -1);
}

TEST_CASE("calcDistance returns -1 for two nulls") {
    REQUIRE(Utility::calcDistance(nullptr, nullptr) == -1);
}

TEST_CASE("calcDistance returns hex distance") {
    HexGrid g;
    g.buildRect(20, 20);
    Hex* a = g.getHex({0, 0});
    Hex* b = g.getHex({4, 2});
    // dq=4, dr=2, dq+dr=6 → (4+2+6)/2 = 6
    REQUIRE(Utility::calcDistance(a, b) == 6);
}

TEST_CASE("calcDistance returns 0 for same hex") {
    HexGrid g;
    g.buildRect(20, 20);
    Hex* a = g.getHex({3, 7});
    REQUIRE(Utility::calcDistance(a, a) == 0);
}


// ── Unit flags ───────────────────────────────────────────────────────────────

TEST_CASE("Zombie is undead") {
    Zombie z(REDTEAM);
    REQUIRE(z.hasAbility(UnitAbility::Undead) == true);
}

TEST_CASE("Soldier is not undead") {
    Soldier s(REDTEAM);
    REQUIRE(s.hasAbility(UnitAbility::Undead) == false);
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

// ── BattleSetup / Battlefield integration ────────────────────────────────────
// These tests use the global battlefield singleton. Each test cleans up:
//   - tests that only call randomPlaceArmy: army goes out of scope → hexes reset
//   - tests that call loadArmies: end with extractResult() → teams/hexes cleared

TEST_CASE("randomPlaceArmy places all units within zone bounds") {
    Battlefield& field = Utility::getBattlefield();
    PlacementZone zone = {3, 12, 5, 14};

    Army army;
    appendArmy<Soldier>(army, 5, REDTEAM);
    randomPlaceArmy(army, field, zone);

    for (const auto& unit : army) {
        REQUIRE(unit->getHex() != nullptr);
        // Zone stores offset (col, row); axial q = col - r/2, so convert back.
        int col = unit->getHex()->coord.q + unit->getHex()->coord.r / 2;
        REQUIRE(col >= (int)zone.wStart);
        REQUIRE(col <= (int)zone.wEnd);
        REQUIRE(unit->getHex()->coord.r >= (int)zone.hStart);
        REQUIRE(unit->getHex()->coord.r <= (int)zone.hEnd);
    }
    // army leaves scope → units destroyed → hexes reset
}

TEST_CASE("randomPlaceArmy sets placed flag on every unit") {
    Battlefield& field = Utility::getBattlefield();

    Army army;
    appendArmy<Soldier>(army, 4, REDTEAM);
    randomPlaceArmy(army, field, {3, 10, 5, 10});

    for (const auto& unit : army)
        REQUIRE(unit->getPlaced() == true);
}

// SECURITY_NOTES.md #6: a zone too small for the army must fail gracefully
// (return false) instead of calling exit() and killing the process.
TEST_CASE("randomPlaceArmy returns false without terminating when zone is too full") {
    Battlefield& field = Utility::getBattlefield();

    // Single-hex zone: w=3..3, h=5..5 → one hex, capacity 640. 70 Soldiers of
    // size 10 = 700 > 640, so the zone cannot hold the whole army.
    PlacementZone zone = {3, 3, 5, 5};
    Army army;
    appendArmy<Soldier>(army, 70, REDTEAM);

    bool ok = randomPlaceArmy(army, field, zone);
    REQUIRE(ok == false);

    bool anyUnplaced = false;
    for (const auto& unit : army)
        if (!unit->getPlaced()) anyUnplaced = true;
    REQUIRE(anyUnplaced == true);
    // Reaching this line at all proves the process didn't exit() — the real
    // regression this test guards against.
}

// The two scans together must cover the zone EXACTLY ONCE, from any start. The
// forward pass begins mid-zone at (wIter, hIter) and runs to the end; the wrap
// pass has to pick up everything before it — including the columns left of
// wIter on row hIter itself, the one band that is neither "after the start" nor
// "on an earlier row". That band was missed, so the function reported a full
// zone with a hex still free (and BattleServer turns that into a rejected
// battle request).
//
// Swept, not sampled. Mocking the rolls is what makes the branch reachable at
// all, but pinning ONE (hIter, wIter) would prove only that this pass works
// from one lucky corner while the claim being made is universal — a rigged test
// quietly narrowing a general property. So it enumerates the whole space
// instead: every free-hex position × every possible random start. The old
// single-sample version is in there as one of the 64 cases.
TEST_CASE("randomPlaceArmy finds the one free hex from EVERY random start") {
    Battlefield& field = Utility::getBattlefield();
    const int wStart = 3, wEnd = 6, hStart = 5, hEnd = 6; // 8 hexes

    for (int freeH = hStart; freeH <= hEnd; ++freeH)
    for (int freeW = wStart; freeW <= wEnd; ++freeW)
    for (int startH = hStart; startH <= hEnd; ++startH)
    for (int startW = wStart; startW <= wEnd; ++startW) {
        Utility::clearDiceRolls();

        // Build the armies BEFORE queueing rolls, so unit construction cannot
        // eat the mocked values.
        Army blockers, army;
        appendArmy<Soldier>(blockers, 7, BLUETEAM); // 8 hexes, one left free
        appendArmy<Soldier>(army, 1, REDTEAM);

        // Park an enemy unit on every hex but one — canPlace() rejects a hex
        // holding another team — so exactly one landing spot exists.
        int i = 0;
        for (int h = hStart; h <= hEnd; ++h)
            for (int w = wStart; w <= wEnd; ++w) {
                if (h == freeH && w == freeW) continue;
                Hex* hex = field.hexGrid.getHex({w - h / 2, h});
                REQUIRE(hex != nullptr);
                blockers[i]->setHex(hex);
                blockers[i]->setPlaced(true);
                ++i;
            }

        Utility::pushDiceRoll(startH); // hIter
        Utility::pushDiceRoll(startW); // wIter

        INFO("free=(" << freeW << "," << freeH << ") start=(" << startW << "," << startH << ")");
        REQUIRE(randomPlaceArmy(army, field, {wStart, wEnd, hStart, hEnd}) == true);

        const Hex* got = army[0]->getHex();
        REQUIRE(got != nullptr);
        CHECK(got->coord.q + got->coord.r / 2 == freeW);
        CHECK(got->coord.r == freeH);
        // Armies leave scope here → units destroyed → hexes reset for the next
        // combination.
    }

    Utility::clearDiceRolls();
}

TEST_CASE("countTeam matches placed army sizes after loadArmies") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Soldier>(red, 3, REDTEAM);
    appendArmy<Zombie>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {0, 12, 0, 7});
    randomPlaceArmy(blue, field, {0, 12, 8, 15});
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(field.countTeam(REDTEAM) == 3);
    REQUIRE(field.countTeam(BLUETEAM) == 2);

    field.extractResult(); // temporary → destroyed immediately → hexes reset
}

TEST_CASE("tick returns true while both sides still have living units") {
    Battlefield& field = Utility::getBattlefield();

    // Place teams at opposite ends — too far apart to engage in one tick
    Army red, blue;
    appendArmy<Soldier>(red, 2, REDTEAM);
    appendArmy<Soldier>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {10, 14, 5, 10});
    randomPlaceArmy(blue, field, {0,   4, 5, 10});
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

TEST_CASE("tick/extractResult with both armies empty: no crash, draw, nothing to survive") {
    Battlefield& field = Utility::getBattlefield();

    field.loadArmies({}, {});

    REQUIRE(field.tick() == false); // neither team has anyone alive — battle is already over
    BattleResult result = field.extractResult();

    REQUIRE(result.winner == 0); // draw — no team constant matches "nobody"
    REQUIRE(result.redSurvivors.empty());
    REQUIRE(result.blueSurvivors.empty());
    REQUIRE(result.corpses == 0);
}

TEST_CASE("extractResult clears internal state so a second call returns empty") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Soldier>(red, 2, REDTEAM);
    appendArmy<Soldier>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {3, 10, 0, 7});
    randomPlaceArmy(blue, field, {3, 10, 8, 15});
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

// ── Archer ammo depletion ─────────────────────────────────────────────────────
// The shared HighArmorDummy (TestDummies.hpp) — unkillable by bow fire and
// immobile — gives the archer a permanent target. After enough ticks all 30
// arrows are spent and the archer switches to melee.

TEST_CASE("archer exhausts ammo against unkillable target and switches to melee range") {
    Battlefield& field = Utility::getBattlefield();

    // Archer at axial {11,8}, dummy at axial {3,8} — distance 8 (= BOWMAXRANGE).
    // For the 16-col grid (buildRect(16,30)), r=8 gives valid axial q in -4..11.
    // Archer advances to preferredRange=3 then shoots; dummy never moves.
    auto archerUnit = std::make_unique<Archer>(REDTEAM);
    archerUnit->setHex(field.hexGrid.getHex({11, 8}));

    auto dummyUnit = std::make_unique<HighArmorDummy>(BLUETEAM);
    dummyUnit->setHex(field.hexGrid.getHex({3, 8}));

    Army red, blue;
    red.push_back(std::move(archerUnit));
    blue.push_back(std::move(dummyUnit));
    field.loadArmies(std::move(red), std::move(blue));

    // 30 shots × 4 ticks each + some travel time = well under 200 ticks
    for (int i = 0; i < 200; ++i)
        field.tick();

    auto& redTeam = field.getTeam(REDTEAM);
    REQUIRE_FALSE(redTeam.empty());
    AUnit* archer = redTeam[0].get();
    REQUIRE(archer->getAmmunition() == 0);
    REQUIRE(archer->getPreferredRange() == 1);

    field.extractResult();
}

// ── Sample battle smoke test ─────────────────────────────────────────────────
// Full campaign setup (incl. scattered cavalry and a Warhorse-mounted cavalry
// squad) run for several ticks under ASan/UBSan — catches crashes/asserts
// from forest-avoidance targeting, mount-attacks-alongside-rider, and the
// mount/rider death transitions at full unit-count scale, not just the
// isolated unit tests above.

// setupSampleBattle() paints terrain/elevation/impassable onto the SHARED
// battlefield grid. Without restoring it, every test that runs after this one
// plays on the sample map's leftovers — the rocky-outcrop impassable hexes at
// rows 9-10 silently blocked later row-10 movement tests for real.
static void resetSharedGridTerrain(Battlefield& field) {
    for (int r = 0; r < field.height; ++r)
        for (int col = 0; col < field.width; ++col) {
            Hex* h = field.hexGrid.getHex({col - r / 2, r});
            if (!h) continue;
            h->terrain    = TerrainType::Open;
            h->elevation  = 0;
            h->impassable = false;
        }
    field.recomputeDistances();
}

TEST_CASE("setupSampleBattle: runs several ticks without crashing, including cavalry") {
    Battlefield& field = Utility::getBattlefield();
    setupSampleBattle(field);

    int guard = 30;
    while (field.tick() && --guard > 0) {}

    field.extractResult();
    resetSharedGridTerrain(field);
    REQUIRE(true);
}

// ── Debug visualization — run with: ./run_tests "[debug]" ─────────────────────
// Prints a compact ASCII map each tick so we can watch movement without SFML.
// Excluded from normal test runs by the [.] hidden tag.
TEST_CASE("battle map debug", "[.][debug]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    appendArmy<Soldier>(red,  50, REDTEAM);
    appendArmy<Soldier>(blue, 50, BLUETEAM);
    randomPlaceArmy(red,  field, {field.width * 3/4, field.width - 1, 0, field.height - 1});
    randomPlaceArmy(blue, field, {0, field.width / 4, 0, field.height - 1});
    field.loadArmies(std::move(red), std::move(blue));

    for (int turn = 1; turn <= 60; ++turn) {
        field.printText(turn);
        if (!field.tick()) break;
    }
    field.extractResult();
}
