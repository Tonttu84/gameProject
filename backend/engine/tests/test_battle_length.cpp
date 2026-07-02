#include "catch.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "Utility.hpp"

// ── Battle length ("the day is over") ─────────────────────────────────────────
// Battlefield::tick() returns false once setMaxTicks() turns have run, and
// extractResult() scores both-sides-alive as a draw. Tested with immobile
// dummies (movementSpeed = 0, same pattern as test_main's HighArmorDummy) so
// the two sides can never engage — without the limit these battles would tick
// forever.

namespace {
class ImmobileDummy : public AUnit {
public:
    explicit ImmobileDummy(int t) : AUnit(t) {
        movementSpeed = 0;   // never moves — can never reach the enemy
        morale        = 99;  // never breaks/flees
        printSymbol   = 'D';
    }
};
} // namespace

// Two dummies at opposite ends of the field, out of everything's reach.
static Battlefield& setupStandoff()
{
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    auto r = std::make_unique<ImmobileDummy>(REDTEAM);
    r->setHex(field.hexGrid.getHex({5, 2}));
    r->setPlaced(true);
    red.push_back(std::move(r));
    auto b = std::make_unique<ImmobileDummy>(BLUETEAM);
    b->setHex(field.hexGrid.getHex({-8, 27})); // axial: col 5, bottom rows
    b->setPlaced(true);
    blue.push_back(std::move(b));
    field.loadArmies(std::move(red), std::move(blue));
    return field;
}

TEST_CASE("battle length: tick() ends the battle exactly at the turn limit") {
    Battlefield& field = setupStandoff();
    field.setMaxTicks(5);

    int ticks = 0;
    while (field.tick() && ticks < 100) ++ticks;
    ++ticks; // the tick that returned false still ran

    REQUIRE(ticks == 5);
    REQUIRE(field.getTicksRun() == 5);

    field.extractResult();
    field.reset(); // restore the shared singleton's default maxTicks
}

TEST_CASE("battle length: timed-out battle with both sides alive is a draw") {
    Battlefield& field = setupStandoff();
    field.setMaxTicks(3);

    while (field.tick()) {}
    BattleResult result = field.extractResult();

    REQUIRE(result.winner == 0); // draw — nobody was wiped out
    REQUIRE(result.redSurvivors.size() == 1);
    REQUIRE(result.blueSurvivors.size() == 1);
    field.reset();
}

TEST_CASE("battle length: hitting the limit logs a day-over event") {
    Battlefield& field = setupStandoff();
    field.setMaxTicks(2);

    while (field.tick()) {}
    auto log = field.takeTickLog();
    bool dayOver = false;
    for (const auto& line : log)
        if (line.find("day is over") != std::string::npos) dayOver = true;
    REQUIRE(dayOver);

    field.extractResult();
    field.reset();
}

TEST_CASE("battle length: default limit is DEFAULT_MAX_BATTLE_TICKS and reset() restores it") {
    Battlefield& field = Utility::getBattlefield();
    field.setMaxTicks(7);
    REQUIRE(field.getMaxTicks() == 7);
    field.reset();
    REQUIRE(field.getMaxTicks() == DEFAULT_MAX_BATTLE_TICKS);
    REQUIRE(field.getTicksRun() == 0);
}

TEST_CASE("battle length: loadArmies starts a fresh tick count") {
    Battlefield& field = setupStandoff();
    field.setMaxTicks(2);
    while (field.tick()) {}
    REQUIRE(field.getTicksRun() == 2);
    field.extractResult();

    // Second battle on the same field: the day restarts.
    Battlefield& again = setupStandoff();
    REQUIRE(again.getTicksRun() == 0);
    again.setMaxTicks(2);
    REQUIRE(again.tick() == true); // tick 1 of 2 — not immediately over
    while (again.tick()) {}
    again.extractResult();
    again.reset();
}

TEST_CASE("battle length: annihilation before the limit still ends the battle normally") {
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    auto r = std::make_unique<ImmobileDummy>(REDTEAM);
    r->setHex(field.hexGrid.getHex({5, 2}));
    r->setPlaced(true);
    red.push_back(std::move(r));
    auto b = std::make_unique<ImmobileDummy>(BLUETEAM);
    b->setHex(field.hexGrid.getHex({-8, 27}));
    b->setPlaced(true);
    blue.push_back(std::move(b));
    field.loadArmies(std::move(red), std::move(blue));
    field.setMaxTicks(50);

    // Kill blue and prune, as the engine does at end of tick (debugAsserts
    // forbids dead units still sitting in hex lists at tick start).
    field.getTeam(BLUETEAM)[0]->setAlive(false);
    field.cleanup();
    REQUIRE(field.tick() == false); // blue is gone — over well before the limit
    REQUIRE(field.getTicksRun() == 1);

    BattleResult result = field.extractResult();
    REQUIRE(result.winner == REDTEAM);
    field.reset();
}
