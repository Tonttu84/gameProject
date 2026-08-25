#pragma once
#include "Spell.hpp"   // SpellSchool, for the per-side school levels below
#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include "AUnit.hpp"
#include "Squad.hpp"
#include "Wing.hpp"
#include <array>
#include <unistd.h>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#include <climits>
#include "Utility.hpp"

// Army: units as purchased/carried by the campaign layer. Passed into loadArmies()
// and returned in BattleResult survivors. Does not carry squads or wings —
// those are assembled inside Battlefield for the duration of the battle.
using Army = std::vector<std::unique_ptr<AUnit>>;

struct BattleResult
{
    int winner;
    Army redSurvivors;
    Army blueSurvivors;
    size_t corpses;
};

// A scheduled mid-battle reinforcement wave — e.g. Karrowgate's garrison
// sallying to the player's aid. Casterless (a garrison throwing its gates has
// no mage on the field): fired by Battlefield::tick() at its turn, not by an
// on-field caster via AUnit::castSpells. The effect body lives in SpellList
// (Spells::castGarrisonSally), modelled on raise_dead. The campaign layer (S7)
// fills these from the garrison's support level; the `message` is replay
// fiction supplied by that layer (a generic line is logged when it is empty,
// keeping the engine free of campaign-specific prose).
struct Reinforcement
{
    int         tick     = 1;         // fires at the start of this 1-based turn
    int         team     = BLUETEAM;  // team the summoned units join
    int         count    = 0;         // how many units to summon
    std::string unitType = "Soldier"; // UnitCatalog type name
    std::string message;              // replay log line; generic fallback if empty
    bool        fired    = false;     // set once it has fired (fires exactly once)
};

// ─── Team ────────────────────────────────────────────────────────────────────
// Owns all data belonging to one side of a battle: units, squads, wings.
// Centralises operations that currently scatter across Battlefield (prune dead,
// count alive, reset per-tick state) so Battlefield can call team.method()
// instead of duplicating the loop for red and blue.
//
// Grows naturally as the command structure is implemented:
//   - commanders (AUnit* with order budget) live here
//   - per-tick order generation lives here
//   - wing management lives here
//
// Not copyable — owns unique_ptrs.
class Team {
public:
    explicit Team(int teamId) : id(teamId) {}
    Team(const Team&)            = delete;
    Team& operator=(const Team&) = delete;

    const int id; // REDTEAM or BLUETEAM

    // ── Squad storage ─────────────────────────────────────────────────────────
    // Declared before units so squads outlive units during destruction:
    // AUnit::~AUnit() calls leaveSquad() → Squad::removeMember(), so the Squad
    // must still be alive when the unit vector is destroyed.
    std::vector<std::unique_ptr<Squad>> squads;

    // Disband and erase squads that have no alive members.
    void pruneEmptySquads();

    // ── Wing storage ──────────────────────────────────────────────────────────
    // Placeholder — populated once wing assignment is implemented.
    std::vector<std::unique_ptr<Wing>> wings;

    // Disband and erase wings that have no remaining squads.
    void pruneEmptyWings();

    // ── Unit storage ─────────────────────────────────────────────────────────
    // Declared after squads/wings so units are destroyed first (reverse order).
    std::vector<std::unique_ptr<AUnit>> units;

    // Erase dead and fully-fled units from the vector each tick, returning
    // how many of them were non-undead — the corpses they leave behind
    // (Battlefield::cleanup adds both teams' into the shared corpse pool).
    size_t pruneDeadUnits();

    // Count alive units (mirrors Battlefield::countTeam).
    size_t countAlive() const;

    // Reset per-battle-tick flags on all units (canFight, engagedSide).
    void resetUnitFlags();
};

class Battlefield
{
    public:
        HexGrid hexGrid;

        Battlefield();
        ~Battlefield() = default;
        Battlefield(const Battlefield&)            = delete;
        Battlefield& operator=(const Battlefield&) = delete;

        void printText(int turn = -1) const;
        static constexpr int height = BATTLEFIELD_WIDTH;   // 30 rows
        static constexpr int width  = BATTLEFIELD_HEIGHT;  // 16 cols

        size_t countTeam(const int team) const;
        void moveUnits(void);
        void makeBattle(void);

        // ENGINE ENTRY POINT: takes ownership of both armies and precomputes flee-distance
        // BFS tables. Assumes every unit already has a valid hex (set by randomPlaceArmy /
        // buildArmyFromPlacement upstream) — not re-validated here. See API.md #4.
        void loadArmies(Army red, Army blue);
        // Call whenever impassable/terrain/blocked flags change mid-battle (e.g. a spell).
        void recomputeDistances();
        void reset(); // clear hex occupancy and corpse count between battles
        // ENGINE ENTRY POINT: advances one turn. No external input — operates purely on
        // state already loaded via loadArmies(). See API.md #4.
        // Returns false when the battle is over: one side annihilated OR the
        // day's turn limit (setMaxTicks) has been reached — extractResult()
        // then scores as it stands (both sides alive = draw).
        bool tick();

        // Battle length: the day is over after this many ticks. Defaults to
        // DEFAULT_MAX_BATTLE_TICKS; BattleInput's "max_turns" overrides it per
        // battle. Reset to the default by reset(); the tick counter restarts
        // on reset() and loadArmies().
        void setMaxTicks(int n) { _maxTicks = n; }
        int  getMaxTicks() const { return _maxTicks; }
        int  getTicksRun() const { return _ticksRun; }
        // ENGINE ENTRY POINT: the only way surviving units cross back out of the engine.
        // Filters out battleSummon units. See API.md #4.
        BattleResult extractResult();

        // Cross-reference consistency checks. Called at the top of each tick.
        // Uses assert() so violations abort under both make and make test.
        // With ASan/UBSan enabled, dereferencing a stale pointer inside an assert
        // condition produces a clean sanitizer fault rather than a silent corruption.
        // [[gnu::noinline]]: keeps this as a discrete call site in the binary so the
        // compiler cannot inline-then-DCE it under aggressive optimisation.
        [[gnu::noinline]] void debugAsserts() const;
        // Total individual assertion evaluations since program start.
        // Non-zero proves debugAsserts() was not DCE'd.
        static size_t debugAssertCount();

        // Returns the unit vector from the matching Team — keeps existing callsites
        // compiling while the Team refactor is in progress.
        std::vector<std::unique_ptr<AUnit>>& getTeam(int team);
        Team& getTeamData(int team); // full Team object when you need squads/wings too

        Hex* findTarget(const AUnit &searcher) const;

        int  moveAUnit(AUnit &unit, HexCoord target);
        void moveToward(std::unique_ptr<AUnit> &unit, const Hex* target);
        void moveTeam(Team& team);
        // One one-hex step of the squad's advance. Hold ticking, the per-tick
        // points loop, and the pooled movement-points bookkeeping all live in
        // moveUnits(). Returns the terrain cost of the hex entered in
        // movement points (>= TERRAIN_COST_OPEN), or 0 if the squad did not
        // move (blocked, engaged-with-no-advance, no target).
        int moveSquad(Squad& squad);
        // One one-hex movement step for a lone unit; moveTeam() drives it
        // while the unit's points bank is positive. Returns false to end the
        // tick's movement — steps stop at enemy contact so a fast unit can't
        // slide along a front it only just reached mid-tick.
        bool moveUnitStep(std::unique_ptr<AUnit> &unit);
        void flee(std::unique_ptr<AUnit> &unit);
        void retreatToRange(std::unique_ptr<AUnit> &unit);
        void cleanup();
        void triggerSpecialPhase();
        void resolveEngagements();

        size_t getCorpses();
        void   setCorpses(size_t setCorpses);

        // ── Per-side magic state ("THE MAGIC SYSTEM", docs/CAMPAIGN_PLAN.md) ──
        // Both sides pass the IDENTICAL two gates; only the source of each
        // number differs (M-19). The player's school level is campaign state
        // grown by research; the enemy's is written on the encounter. The engine
        // never learns the word "research" — it just reads a number per side,
        // which is what keeps one magic system rather than two (M-17).
        int  getSchoolLevel(int team, SpellSchool school) const;
        void setSchoolLevel(int team, SpellSchool school, int level);

        // M-11: banners are the allowance. A tier's channels feed an ARMY-WIDE
        // pool any caster on that side may draw on to push past their own
        // fatigue — Dominions' burn-a-gem-for-fatigue delivered through the
        // vessel decision 10 already named. There is deliberately no per-path
        // gem currency. Drawing returns how much fatigue relief was actually
        // granted, which is 0 once the pool is dry.
        int  getChannels(int team) const;
        void setChannels(int team, int channels);
        int  drawChannels(int team, int wanted);

        // ── Tick event log ────────────────────────────────────────────────────
        // Lightweight narrative sink for replay recording: engine code appends
        // human-readable lines (deaths, flees, summons); ReplayRecorder drains
        // them once per tick via takeTickLog(). Not required to be exhaustive —
        // it exists so a replay can show roughly what happened, not to be a
        // combat audit trail.
        // ── Scheduled reinforcements (garrison sally) ──────────────────────────
        // Queue a casterless reinforcement wave, fired by tick() when its turn
        // arrives. Filled by the campaign layer (S7) from BattleInput's
        // "reinforcements" spec. Cleared by reset()/loadArmies() like the other
        // per-battle accumulators.
        void scheduleReinforcement(Reinforcement r) { _reinforcements.push_back(std::move(r)); }

        void logEvent(std::string line) { _tickLog.push_back(std::move(line)); }
        std::vector<std::string> takeTickLog() {
            std::vector<std::string> out;
            out.swap(_tickLog);
            return out;
        }

    private:
        void onTurnStart();
        void onTurnEnd();
        void logDeaths(const Team& team);
        // Summon any reinforcement wave whose turn has arrived. Called once at
        // the top of each tick(), before the special/movement phases so fresh
        // arrivals act this turn.
        void fireScheduledReinforcements();

        Team   _red{REDTEAM};
        Team   _blue{BLUETEAM};
        size_t corpses = 0;
        // Indexed [team-1][school] and [team-1]; REDTEAM/BLUETEAM are 1/2.
        // Defaults are DELIBERATELY OPEN: absent a `magic` block on the battle
        // input, every school sits at the top of the scale so slice 1 never
        // removes magic from a battle that already has it. Slice 2 starts
        // sending real (and lower) numbers.
        std::array<std::array<int, SPELL_SCHOOL_COUNT>, 2> _schoolLevels
            { spellSchoolsOpen(), spellSchoolsOpen() };
        std::array<int, 2> _channels{};
        std::vector<std::string> _tickLog;
        std::vector<Reinforcement> _reinforcements;
        int    _maxTicks = DEFAULT_MAX_BATTLE_TICKS;
        int    _ticksRun = 0;
};
