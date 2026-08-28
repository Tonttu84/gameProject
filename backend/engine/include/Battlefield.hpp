#pragma once
#include "Spell.hpp"   // SpellSchool, for the per-side school levels below
#include "BattleLog.hpp" // LogTier/LogLine, the tiered battle log below
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
#include <utility>
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

        // ── Battlefield-wide enchantments (E-4) ──────────────────────────────
        // A sustained spell instance: the form's standing effect, the caster
        // holding it up and the side that paid for it. It stands until the
        // battle ends or its sustainer stops being alive — fleeing off the
        // field already clears `alive`, so liveness is the WHOLE of the check
        // and there is no second "has he left" test to keep in step.
        struct ActiveEnchantment {
            const Spell*     spell;
            const SpellForm* form;
            const AUnit*     caster;
            int              team;   // the side that called it, and paid for it
        };

        // The cast body's entry point: resolves the spell by roster id, charges
        // nothing (completeCast() draws the pool once this reports true), and
        // returns false where the calling cannot happen — which costs the
        // caster nothing at all, per M-23.
        bool beginEnchantment(AUnit& caster, std::string_view spellId);

        // Once per side PER BATTLE, keyed on the SPELL. Deliberately outlives
        // the instance (E-4): a side that let its sustainer die has spent its
        // call, which is what makes killing a sustainer a FINAL dispel.
        bool enchantmentCastAlready(int team, const Spell& s) const;

        // The instances standing right now. Read-only, and exposed for the
        // tests — the engine itself only ever reaches them through the two
        // per-turn hooks below.
        const std::vector<ActiveEnchantment>& activeEnchantments() const
        { return _enchantments; }

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

        // ── The battle log, in three tiers (docs/CAMPAIGN_PLAN.md, "TIERED
        // BATTLE LOGGING") ──────────────────────────────────────────────────
        //
        // EVERY tier is recorded and persisted; the browser filters (L-1). So
        // there is no verbosity dial down here and nothing to configure per
        // battle — the engine says everything it knows, once, and the reader
        // decides how much of it to look at.
        //
        // CASTS ARE ON Basic ON PURPOSE (L-2). The user's rule is that spells
        // appear at any depth, and the way to make that true is structural: the
        // filter cannot reach below Basic, so a cast line cannot be hidden by
        // any setting the player picks. It is not a special case in the filter.
        void logEvent(LogTier tier, std::string line) {
            _tickLog.push_back({tier, std::move(line)});
        }
        // Untiered overload = Basic. Kept so a call site that has nothing to say
        // about depth reads as it always did, and so the tier is a thing you opt
        // INTO rather than a parameter every caller has to think about.
        void logEvent(std::string line) { logEvent(LogTier::Basic, std::move(line)); }

        // A non-draining look at the log. The recorder DRAINS each tick; nothing
        // drains it in the engine tests, so there it accumulates the whole
        // battle — which is exactly what the test capture reads
        // (tests/BattleLogCapture.hpp). Kept separate from takeTickLog() so
        // reading the log for a failure message cannot consume the log a test
        // was about to assert on.
        const std::vector<LogLine>& tickLog() const { return _tickLog; }

        std::vector<LogLine> takeTickLog() {
            std::vector<LogLine> out;
            out.swap(_tickLog);
            return out;
        }

    private:
        void onTurnStart();
        void onTurnEnd();
        // Run every standing enchantment's per-tick effect, once each turn.
        void applyEnchantments();
        // Drop the instances whose sustainer is gone, logging each fade.
        void sweepEnchantments();
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
        // The instances standing, and — separately — the register of what each
        // side has ever called. The register is NOT pruned when an instance
        // ends: once per side per battle means exactly that.
        std::vector<ActiveEnchantment> _enchantments;
        std::vector<std::pair<int, const Spell*>> _enchantmentsCast;
        std::vector<LogLine> _tickLog;
        std::vector<Reinforcement> _reinforcements;
        int    _maxTicks = DEFAULT_MAX_BATTLE_TICKS;
        int    _ticksRun = 0;
};
