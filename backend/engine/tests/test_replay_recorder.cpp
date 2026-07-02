#include "catch.hpp"
#include "server/ReplayRecorder.hpp"
#include "server/BattleServer.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "Utility.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <map>
#include <set>

using json = nlohmann::json;

// Shared setup: 3 red Soldiers vs 2 blue Zombies on the global battlefield.
// Caller must end the test with field.extractResult() to reset the singleton
// (same pattern as the BattleSetup tests in test_main.cpp).
static Battlefield& setupSmallBattle()
{
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    appendArmy<Soldier>(red, 3, REDTEAM);
    appendArmy<Zombie>(blue, 2, BLUETEAM);
    randomPlaceArmy(red,  field, {0, 12, 0, 5});
    randomPlaceArmy(blue, field, {0, 12, 10, 15});
    field.loadArmies(std::move(red), std::move(blue));
    return field;
}

TEST_CASE("replay recorder: initial snapshot lists every placed unit") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);

    json replay = recorder.toJson("sample_battle");
    REQUIRE(replay["map"] == "sample_battle");
    REQUIRE(replay["cols"].get<int>() == Battlefield::width);
    REQUIRE(replay["rows"].get<int>() == Battlefield::height);
    REQUIRE(replay["ticks"].size() == 1);

    const json& t0 = replay["ticks"][0];
    REQUIRE(t0["tick"].get<int>() == 0);
    REQUIRE(t0["units"].size() == 5);
    REQUIRE(t0["log"].is_array());

    std::set<int> ids;
    int soldiers = 0, zombies = 0;
    for (const auto& u : t0["units"]) {
        REQUIRE(u["id"].is_number_integer());
        ids.insert(u["id"].get<int>());
        REQUIRE((u["team"] == "red" || u["team"] == "blue"));
        REQUIRE(u["hp"].get<int>() > 0);
        // q/r must resolve to a real hex on the grid
        REQUIRE(field.hexGrid.getHex({u["q"].get<int>(), u["r"].get<int>()}) != nullptr);
        if (u["type"] == "Soldier") { soldiers++; REQUIRE(u["team"] == "red"); }
        if (u["type"] == "Zombie")  { zombies++;  REQUIRE(u["team"] == "blue"); }
    }
    REQUIRE(ids.size() == 5); // ids unique
    REQUIRE(soldiers == 3);
    REQUIRE(zombies == 2);

    field.extractResult();
}

TEST_CASE("replay recorder: unit ids are stable across ticks") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);
    recorder.recordTick(field); // nothing moved — same units, same ids

    json replay = recorder.toJson("sample_battle");
    auto idPos = [](const json& tick) {
        std::map<int, std::pair<int,int>> m;
        for (const auto& u : tick["units"])
            m[u["id"].get<int>()] = {u["q"].get<int>(), u["r"].get<int>()};
        return m;
    };
    REQUIRE(idPos(replay["ticks"][0]) == idPos(replay["ticks"][1]));

    field.extractResult();
}

TEST_CASE("replay recorder: dead units drop out, survivors keep their ids") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);

    // Kill one red soldier and prune, as the engine does at end of tick.
    field.getTeam(REDTEAM)[0]->setAlive(false);
    field.cleanup();
    recorder.recordTick(field);

    json replay = recorder.toJson("sample_battle");
    const json& t0 = replay["ticks"][0];
    const json& t1 = replay["ticks"][1];
    REQUIRE(t1["units"].size() == 4);

    std::set<int> ids0, ids1;
    for (const auto& u : t0["units"]) ids0.insert(u["id"].get<int>());
    for (const auto& u : t1["units"]) ids1.insert(u["id"].get<int>());
    // every id in tick 1 already existed in tick 0 — no id reuse/reshuffle
    for (int id : ids1) REQUIRE(ids0.count(id) == 1);

    field.extractResult();
}

TEST_CASE("replay recorder: cleanup logs a death event into the tick log") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field); // drains any setup log lines

    field.getTeam(REDTEAM)[0]->setAlive(false);
    field.cleanup();
    recorder.recordTick(field);

    json replay = recorder.toJson("sample_battle");
    const auto& log = replay["ticks"][1]["log"];
    bool mentionsSoldier = false;
    for (const auto& line : log)
        if (line.get<std::string>().find("Soldier") != std::string::npos)
            mentionsSoldier = true;
    REQUIRE(mentionsSoldier);

    field.extractResult();
}

TEST_CASE("battlefield log sink: logEvent lines land in the next tick only") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);

    field.logEvent("a soldier fled the battlefield");
    recorder.recordTick(field);
    recorder.recordTick(field);

    json replay = recorder.toJson("sample_battle");
    REQUIRE(replay["ticks"][1]["log"].size() == 1);
    REQUIRE(replay["ticks"][1]["log"][0].get<std::string>()
            == "a soldier fled the battlefield");
    REQUIRE(replay["ticks"][2]["log"].empty());

    field.extractResult();
}

TEST_CASE("replay recorder: a unit appearing mid-battle gets a fresh id") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);

    // Simulate a summon: a new zombie joins blue after the battle started.
    auto z = std::make_unique<Zombie>(BLUETEAM);
    z->setHex(field.hexGrid.getHex({0, 12}));
    z->setPlaced(true);
    field.getTeam(BLUETEAM).push_back(std::move(z));
    recorder.recordTick(field);

    json replay = recorder.toJson("sample_battle");
    std::set<int> ids0;
    for (const auto& u : replay["ticks"][0]["units"])
        ids0.insert(u["id"].get<int>());

    int freshIds = 0;
    for (const auto& u : replay["ticks"][1]["units"])
        if (!ids0.count(u["id"].get<int>())) freshIds++;
    REQUIRE(freshIds == 1);
    REQUIRE(replay["ticks"][1]["units"].size() == 6);

    field.extractResult();
}

// ── Battle length ("day is over") ─────────────────────────────────────────────

TEST_CASE("extractResult: both sides still standing scores as a draw") {
    Battlefield& field = setupSmallBattle();
    BattleResult result = field.extractResult();
    REQUIRE(result.winner == 0); // neither side annihilated → draw
    REQUIRE(result.redSurvivors.size() == 3);
    REQUIRE(result.blueSurvivors.size() == 2);
}

TEST_CASE("extractResult: a side with units left still wins outright") {
    Battlefield& field = setupSmallBattle();
    for (auto& u : field.getTeam(BLUETEAM)) u->setAlive(false);
    field.cleanup();
    BattleResult result = field.extractResult();
    REQUIRE(result.winner == REDTEAM);
}

TEST_CASE("clampMaxTurns: defaults when below 1, caps at the hard limit") {
    REQUIRE(clampMaxTurns(0)      == DEFAULT_MAX_BATTLE_TICKS);
    REQUIRE(clampMaxTurns(-7)     == DEFAULT_MAX_BATTLE_TICKS);
    REQUIRE(clampMaxTurns(1)      == 1);
    REQUIRE(clampMaxTurns(400)    == 400);
    REQUIRE(clampMaxTurns(999999) == MAX_BATTLE_TICKS_CAP);
}

TEST_CASE("replay recorder: records a full battle loop to the end") {
    Battlefield& field = setupSmallBattle();
    ReplayRecorder recorder;
    recorder.recordTick(field);

    int guard = 0;
    while (field.tick() && ++guard < 500)
        recorder.recordTick(field);
    recorder.recordTick(field); // final state after the last tick

    json replay = recorder.toJson("sample_battle");
    REQUIRE(replay["ticks"].size() == recorder.tickCount());
    REQUIRE(replay["ticks"].size() >= 2);
    // tick indices are consecutive from 0
    for (size_t i = 0; i < replay["ticks"].size(); ++i)
        REQUIRE(replay["ticks"][i]["tick"].get<size_t>() == i);
    // one side is gone at the end
    const json& last = replay["ticks"].back();
    bool redLeft = false, blueLeft = false;
    for (const auto& u : last["units"]) {
        if (u["team"] == "red")  redLeft = true;
        if (u["team"] == "blue") blueLeft = true;
    }
    REQUIRE(!(redLeft && blueLeft));

    field.extractResult();
}
