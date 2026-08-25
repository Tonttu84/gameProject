#include "catch.hpp"
#include "BattleLogCapture.hpp"
#include "Battlefield.hpp"
#include "SpellList.hpp"
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
// The lone enemy sits at the far edge (row height-1). maxHP is 10 and a single
// Soldier does only a few points a round, so no summon is pruned within the 1-2
// rounds these cases run.
//
// WHERE THE WAVE LANDS is asserted by casting the spell DIRECTLY, never after a
// tick. tick() runs fireScheduledReinforcements() and then moveUnits() in the
// SAME turn, so a summon is placed and then immediately moves: asserting its row
// after a tick measures movement, not placement. This file used to claim "any
// movement they make is TOWARD that edge — never back out of the band", which is
// false about 7.5% of runs (CI, 2026-08-09: a summon observed at row 26 with the
// band starting at 27), making the suite flaky. The tick-driven case below now
// covers only what a tick is for — that the wave fires on its turn, logs, and
// joins the team.

static Hex* placeOne(Army& army, Battlefield& bf, HexCoord c, int team) {
    Hex* hex = bf.hexGrid.getHex(c);
    REQUIRE(hex != nullptr);
    auto u = std::make_unique<Soldier>(team);
    u->setHex(hex);
    army.push_back(std::move(u));
    return hex;
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
            // Placed somewhere — but NOT where, since moveUnits() has already
            // run this tick. The landing band is asserted in the direct-cast
            // case below, where no movement can have happened yet.
            REQUIRE(u->getHex() != nullptr);
        }
    }
    // NOT an exact headcount. Combat runs in this same tick, and the wave lands
    // in Red's rear band with Red standing in it, so whether all three summons
    // are still breathing at the end of the tick is a dice roll. The exact count
    // is asserted in the direct-cast case below, where nothing has fought yet.
    // What a tick can honestly claim is that the wave arrived, joined, and did
    // not over-summon — and that the team and the summon count agree.
    CHECK(summoned >= 1);
    CHECK(summoned <= 3);
    CHECK(bf.getTeam(BLUETEAM).size() == 1u + static_cast<size_t>(summoned));
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

    // Present on the field — but NOT an exact headcount. The wave lands in
    // Red's rear band with Red standing in it and combat runs in this same
    // tick, so whether all three are still breathing at the end is a dice
    // roll. This read 3 == 4 under seed 446545517 (found 2026-08-10 by a
    // seeded hunt); the summon was placed and then killed, not lost to
    // placement — the suite prints exactly one "zone is full" either way, from
    // the deliberate overfill case.
    size_t summons = 0;
    for (auto& u : bf.getTeam(BLUETEAM))
        if (u && u->getBattleSummon()) ++summons;
    CHECK(summons >= 1);                                        // the wave arrived
    CHECK(bf.getTeam(BLUETEAM).size() == 1u + summons);         // and nothing else did

    BattleResult res = bf.extractResult();
    // The case's actual claim, and it stays EXACT: however many summons stood
    // on the field, none of them cross back. The original sits at PLAYER_HEX,
    // far from Red and unreachable in one tick, so precisely it survives.
    CHECK(res.blueSurvivors.size() == 1);
}

TEST_CASE("garrison sally: a wave fires exactly once") {
    Battlefield bf;
    Army blue, red;
    placeOne(blue, bf, PLAYER_HEX, BLUETEAM);
    placeOne(red,  bf, ENEMY_HEX,  REDTEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    Reinforcement r;
    r.tick = 1; r.team = BLUETEAM; r.count = 2; r.unitType = "Soldier";
    r.message = "SALLY_ONCE_TEST";
    bf.scheduleReinforcement(r);

    // "Exactly once" is asserted on the LOG, never on a headcount. This used to
    // check getTeam(BLUETEAM).size() == 3 after each tick, which measures
    // whether the summons SURVIVED: they land in Red's rear band, Red is
    // standing in it, and combat runs in the same tick. CI caught it on main
    // (2026-08-09) reading 2 == 3 on BOTH checks — one summon was already dead
    // by the end of the first tick, and the wave had fired correctly. The log
    // line comes from fireScheduledReinforcements and no dice can touch it.
    bf.tick();
    CHECK(logHas(bf.takeTickLog(), "SALLY_ONCE_TEST")); // fired on its turn...

    bf.tick();
    CHECK_FALSE(logHas(bf.takeTickLog(), "SALLY_ONCE_TEST")); // ...and never again
}

// The landing band itself, with no tick and therefore no movement in the way:
// this is the invariant the tick-driven case above cannot safely assert.
TEST_CASE("garrison sally: the wave lands inside the enemy's rear band") {
    Battlefield bf;
    Army blue, red;
    placeOne(blue, bf, PLAYER_HEX, BLUETEAM);
    placeOne(red,  bf, ENEMY_HEX,  REDTEAM);
    bf.loadArmies(std::move(red), std::move(blue));

    Reinforcement r;
    r.tick = 1; r.team = BLUETEAM; r.count = 3; r.unitType = "Soldier";
    r.message = "GARRISON_SALLY_TEST";

    const int placed = Spells::castGarrisonSally(bf, r);
    CHECK(placed == 3);

    int summoned = 0;
    for (auto& u : bf.getTeam(BLUETEAM)) {
        if (u && u->getBattleSummon()) {
            ++summoned;
            REQUIRE(u->getHex() != nullptr);
            // Straight out of the spell, before anything can move it.
            CHECK(u->getHex()->coord.r >= REAR_MIN_ROW);
        }
    }
    CHECK(summoned == 3);
}
