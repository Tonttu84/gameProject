#include "catch.hpp"
#include "BattleLogCapture.hpp"
#include "Battlefield.hpp"
#include "BattleSetup.hpp"
#include "Utility.hpp"
#include "TestDummies.hpp"
#include "units/Soldier.hpp"
#include "units/Priest.hpp"

// The tiered battle log (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE LOGGING").
//
// The rules that matter are about WHICH TIER a line lands on, because the
// browser filters on exactly that and a line filed too deep is a line the
// player will never see. The wire shape is pinned in test_replay_recorder.cpp.

TEST_CASE("log tiers: the untiered overload means Basic") {
    Battlefield& field = Utility::getBattlefield();
    field.reset();
    field.logEvent("something happened");
    REQUIRE(field.tickLog().size() == 1);
    // Basic is the tier the filter cannot reach below, so a caller that says
    // nothing about depth gets the one that is always visible.
    REQUIRE(field.tickLog()[0].tier == LogTier::Basic);
}

TEST_CASE("log tiers: every tier is recorded — nothing is dropped at write time") {
    Battlefield& field = Utility::getBattlefield();
    field.reset();
    field.logEvent(LogTier::Basic,  "a death");
    field.logEvent(LogTier::Detail, "a morale check");
    field.logEvent(LogTier::Trace,  "a roll");
    // L-1: the engine has no verbosity setting. A battle is fought once and
    // watched later, possibly at a depth nobody had chosen while it ran, so
    // discarding detail at write time would throw away the only chance to keep
    // it. All three are here.
    REQUIRE(field.tickLog().size() == 3);
    REQUIRE(field.tickLog()[2].tier == LogTier::Trace);
}

TEST_CASE("log tiers: tickLog does not drain, takeTickLog does") {
    Battlefield& field = Utility::getBattlefield();
    field.reset();
    field.logEvent("a line");
    // The capture reads the log to build a failure message; if that consumed
    // it, a test could not then assert on the log it just printed.
    REQUIRE(field.tickLog().size() == 1);
    REQUIRE(field.tickLog().size() == 1);
    REQUIRE(field.takeTickLog().size() == 1);
    REQUIRE(field.tickLog().empty());
}

TEST_CASE("log tiers: a cast is Basic and its wind-up is Detail") {
    Battlefield& field = Utility::getBattlefield();
    field.reset();
    Army red, blue;
    red.push_back(std::make_unique<ImmobileDummy>(REDTEAM));
    blue.push_back(std::make_unique<Priest>(BLUETEAM));
    // A Priest blesses a BROKEN or WOUNDED ally, so without one he has nothing
    // to cast at and the test would be asserting on an empty log. Distance is
    // irrelevant — bless works from anywhere, unlike the arcane spells.
    blue.push_back(std::make_unique<Soldier>(BLUETEAM));
    field.loadArmies(std::move(red), std::move(blue));

    // Wound him AFTER he is on the field, and wound him HARD ENOUGH. Two traps
    // here, both found by reading the capture this slice added:
    //   - damaging the unique_ptr before loadArmies does not survive into the
    //     battle;
    //   - a Soldier has armour 5 and takeDamage subtracts it, so a 5-point blow
    //     deals NOTHING and leaves him unwounded.
    // Either way the Priest finds no target, never completes a cast, and the
    // log fills with "begins to channel" and nothing else.
    for (auto& u : field.getTeam(BLUETEAM))
        if (u && u->getPrintSymbol() == 'X') { u->takeDamage(9, ArmorPen::Normal); break; }

    for (int i = 0; i < 30; ++i) field.tick();
    CAPTURE_BATTLE_LOG(field);

    const auto& log = field.tickLog();
    auto tierOf = [&](const std::string& needle) {
        for (const LogLine& l : log)
            if (l.text.find(needle) != std::string::npos) return l.tier;
        return LogTier::Trace;   // a tier the assertions below would reject
    };

    REQUIRE(logHas(log, "casts"));
    // THE RULE THE WHOLE LADDER EXISTS TO MAKE STRUCTURAL (L-2): "spells cast
    // should however appear on any level". Casts sit on Basic, so no filter
    // setting can hide them — a property of the ladder, not a special case the
    // filter has to remember.
    REQUIRE(tierOf("casts") == LogTier::Basic);

    // ...while the wind-up is one tier deeper: the "mages preparing to cast"
    // the user asked to see only when going deeper.
    REQUIRE(logHas(log, "begins to channel"));
    REQUIRE(tierOf("begins to channel") == LogTier::Detail);

    field.extractResult();
}

TEST_CASE("log tiers: combat rolls are Trace, both outcomes") {
    // Drives AUnit::defend DIRECTLY rather than staging a fight and hoping one
    // happens. The first draft ran a real melee exchange and was FLAKY: whether
    // defend() is reached at all depends on the dice — a repel counter can kill
    // the attacker before his blow lands, and then nothing is logged. It passed
    // for hours and failed under seed 2491619946 with "the battle logged
    // nothing", which is the exact trap docs/CAMPAIGN_PLAN.md warns about for
    // random-sensitive tests.
    //
    // defend() always logs exactly one line — a turned blow or a landed one —
    // so calling it decides which branch is under test instead of leaving it to
    // chance. Both branches are Trace, which is the property that matters: it
    // is what a failing combat test dumps to explain itself (L-3).
    Battlefield& field = Utility::getBattlefield();
    field.reset();

    SECTION("a blow that is turned") {
        Soldier defender(BLUETEAM);
        // An attack roll of 0 loses to any defence, so this is always the miss.
        REQUIRE(defender.defend(0, 8, ArmorPen::Normal, 1) == 0);

        const auto& log = field.tickLog();
        INFO("battle log:\n" << dumpBattleLog(log));
        REQUIRE(logHas(log, "turns the blow"));
        for (const LogLine& l : log) REQUIRE(l.tier == LogTier::Trace);
    }

    SECTION("a blow that lands") {
        Soldier defender(BLUETEAM);
        // ...and an overwhelming one always beats it, so this is always the hit.
        REQUIRE(defender.defend(1000, 40, ArmorPen::Normal, 1) > 0);

        const auto& log = field.tickLog();
        INFO("battle log:\n" << dumpBattleLog(log));
        REQUIRE(logHas(log, "is hit for"));
        // The line carries what LANDED beside the raw roll, because the gap
        // between them is the armour arithmetic a failing test needs to read.
        REQUIRE(logHas(log, "hp left"));
        for (const LogLine& l : log)
            if (l.text.find("is hit for") != std::string::npos)
                REQUIRE(l.tier == LogTier::Trace);
    }
}
