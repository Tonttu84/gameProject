#pragma once
#include <string>
#include <string_view>

// The battle log's three tiers (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE LOGGING").
//
// The user's design: "Basic info, units dying, spells being cast are on by
// default but then we can go deeper where we see every roll, mages preparing to
// cast and spells going off."
//
// EVERY TIER IS RECORDED AND PERSISTED (L-1); the browser filters, cumulatively,
// opening on Basic. There is deliberately no verbosity setting in the engine:
// a battle is fought once and watched later, possibly at a depth nobody chose
// while it was running, so throwing detail away at write time would throw away
// the only chance to keep it.
//
// The ladder is CUMULATIVE in the reader, not in the tag: a line carries the
// SHALLOWEST tier at which it should appear, and a reader at Trace shows
// everything at or above Basic.
enum class LogTier : int {
    // Turn markers, deaths, casts, routs, the end of the battle. What an
    // ordinary watch shows, and what the replay has always shown.
    //
    // CASTS LIVE HERE so that "spells appear on any level" is a property of the
    // ladder rather than a rule the filter has to remember (L-2).
    Basic = 0,
    // The shape of the fight: engagements forming, morale checks, a caster
    // beginning to channel, a spell that failed to find its target.
    Detail,
    // Every roll — to-hit against defence, damage, what the armour stopped.
    // This is the tier a failing test dumps (L-3).
    Trace,
};

constexpr int LOG_TIER_COUNT = 3;

// One logged line and the depth it belongs to. A struct rather than a prefixed
// string because the tag is READ by two different consumers — the browser's
// filter and the test harness — and neither should be parsing prose to find it.
struct LogLine {
    LogTier     tier;
    std::string text;
};

// The wire/render name. An unknown tier degrades to "basic" rather than
// throwing: the same never-throw discipline the rest of the JSON boundary uses,
// and a line whose tag went wrong should still be READABLE, not swallowed.
constexpr std::string_view logTierName(LogTier tier)
{
    switch (tier) {
        case LogTier::Basic:  return "basic";
        case LogTier::Detail: return "detail";
        case LogTier::Trace:  return "trace";
    }
    return "basic";
}
