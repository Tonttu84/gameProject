#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Soldier.hpp"
#include <algorithm>

// ── Garrison sally — casterless scheduled reinforcements ─────────────────────
//
// Distinct from test_reinforce.cpp (reserve redistribution between hexes): this
// covers Battlefield's scheduled reinforcement waves — allied units summoned
// mid-battle at the enemy's rear edge, modelled as the casterless
// Spells::castGarrisonSally spell fired by tick() on its turn (S6 of the
// garrison-support epic; see docs/CAMPAIGN_PLAN.md).
//
// The lone enemy sits at the far edge (row height-1): Blue flees toward row 0,
// so its reinforcements land at Red's rear (rows >= height-3) and any movement
// they make is TOWARD that edge — never back out of the band. maxHP is 10 and a
// single Soldier does only a few points a round, so no summon is pruned within
// the 1-2 rounds these cases run.

static Hex* placeOne(Army& army, Battlefield& bf, HexCoord c, int team) {
    Hex* hex = bf.hexGrid.getHex(c);
    REQUIRE(hex != nullptr);
    auto u = std::make_unique<Soldier>(team);
    u->setHex(hex);
    army.push_back(std::move(u));
    return hex;
}

static bool logHas(const std::vector<std::string>& log, const std::string& needle) {
    return std::any_of(log.begin(), log.end(),
        [&](const std::string& l) { return l.find(needle) != std::string::npos; });
}

static constexpr HexCoord PLAYER_HEX = {7, 2};    // Blue, low rows
static constexpr HexCoord ENEMY_HEX  = {-6, 29};  // Red, the far edge (col 8, row 29)
static constexpr int REAR_MIN_ROW    = Battlefield::height - 3;

TEST_CASE("garrison sally: wave summons allies at the enemy's rear on its turn") {
    Battlefield bf;
    Army blue, red;
    placeOne(blue, bf, PLAYER_HEX, BLUETEAM);
    placeOne(red,  bf, ENEMY_HEX,  REDTEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    Reinforcement r;
    r.tick = 2; r.team = BLUETEAM; r.count = 3; r.unitType = "Soldier";
    r.message = "GARRISON_SALLY_TEST";
    bf.scheduleReinforcement(r);

    // Turn 1: not yet due — no arrivals, no log line.
    REQUIRE(bf.tick());
    auto log1 = bf.takeTickLog();
    CHECK(bf.getTeam(BLUETEAM).size() == 1);
    CHECK_FALSE(logHas(log1, "GARRISON_SALLY_TEST"));

    // Turn 2: the wave lands (return value ignored — the lone Red may fall to it).
    bf.tick();
    auto log2 = bf.takeTickLog();
    CHECK(logHas(log2, "GARRISON_SALLY_TEST"));

    int summoned = 0;
    for (auto& u : bf.getTeam(BLUETEAM)) {
        if (u && u->getBattleSummon()) {
            ++summoned;
            REQUIRE(u->getHex() != nullptr);
            CHECK(u->getHex()->coord.r >= REAR_MIN_ROW); // enemy's rear edge
        }
    }
    CHECK(summoned == 3);
    CHECK(bf.getTeam(BLUETEAM).size() == 4); // 1 original + 3 summoned
}

TEST_CASE("garrison sally: reinforcements do not cross back as survivors") {
    Battlefield bf;
    Army blue, red;
    placeOne(blue, bf, PLAYER_HEX, BLUETEAM);
    placeOne(red,  bf, ENEMY_HEX,  REDTEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    Reinforcement r;
    r.tick = 1; r.team = BLUETEAM; r.count = 3; r.unitType = "Soldier";
    bf.scheduleReinforcement(r);
    bf.setMaxTicks(1);

    bf.tick(); // fires the wave, then the day ends
    CHECK(bf.getTeam(BLUETEAM).size() == 4); // present on the field...

    BattleResult res = bf.extractResult();
    CHECK(res.blueSurvivors.size() == 1);    // ...but battleSummon units are filtered out
}

TEST_CASE("garrison sally: a wave fires exactly once") {
    Battlefield bf;
    Army blue, red;
    placeOne(blue, bf, PLAYER_HEX, BLUETEAM);
    placeOne(red,  bf, ENEMY_HEX,  REDTEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    Reinforcement r;
    r.tick = 1; r.team = BLUETEAM; r.count = 2; r.unitType = "Soldier";
    bf.scheduleReinforcement(r);

    bf.tick(); // fires: 1 original + 2 = 3
    CHECK(bf.getTeam(BLUETEAM).size() == 3);
    bf.tick(); // must NOT fire again
    CHECK(bf.getTeam(BLUETEAM).size() == 3);
}
