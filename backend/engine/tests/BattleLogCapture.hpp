#pragma once
#include "Battlefield.hpp"
#include "BattleLog.hpp"
#include "catch.hpp"

#include <algorithm>
#include <sstream>
#include <string>
#include <vector>

// Reading the battle log from a test (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE
// LOGGING", L-3).
//
// WHY THIS WORKS AT ALL: Battlefield drains its tick log only when something
// asks for it, and only the ReplayRecorder does. The engine tests have no
// recorder, so the log ACCUMULATES across every tick of the battle and is
// cleared only by reset()/loadArmies(). A test therefore has the whole fight
// sitting in the battlefield when its assertions run.

// Does the log carry a line containing `needle`, at any tier?
//
// Was a private copy in test_garrison_sally.cpp and a hand-rolled loop in
// test_battle_length.cpp; both now share this, which is what stops the next
// one being a third variant that searches slightly differently.
inline bool logHas(const std::vector<LogLine>& log, const std::string& needle)
{
    return std::any_of(log.begin(), log.end(),
        [&](const LogLine& l) { return l.text.find(needle) != std::string::npos; });
}

inline bool logHas(const Battlefield& field, const std::string& needle)
{
    return logHas(field.tickLog(), needle);
}

// The log rendered for a human, tier-tagged, one line each.
inline std::string dumpBattleLog(const std::vector<LogLine>& log)
{
    if (log.empty()) return "  (the battle logged nothing)";
    std::ostringstream out;
    for (const LogLine& line : log)
        out << "  [" << logTierName(line.tier) << "] " << line.text << "\n";
    return out.str();
}

inline std::string dumpBattleLog(const Battlefield& field)
{
    return dumpBattleLog(field.tickLog());
}

// Attach the battle log to every assertion that follows it IN THIS SCOPE.
//
// Catch2 prints an INFO message only when an assertion fails, so a passing test
// stays completely silent and a failing one shows the fight that produced it —
// at Trace, so every roll is there.
//
// PLACE IT AFTER THE BATTLE HAS RUN and before the assertions you care about.
// The message is built where the macro sits, so a capture written before the
// ticks would faithfully report an empty log. That ordering is the one thing to
// remember about this helper:
//
//     while (field.tick()) {}
//     CAPTURE_BATTLE_LOG(field);      // <- here
//     REQUIRE(field.getTeam(BLUETEAM).size() == 3);
//
// The cost is paid by every test that uses it, passing or not, since the string
// is built eagerly. That is nothing for the small set-piece battles the unit
// tests fight; think twice before putting it on a full 300-tick scenario.
#define CAPTURE_BATTLE_LOG(field) INFO("battle log:\n" << dumpBattleLog(field))
