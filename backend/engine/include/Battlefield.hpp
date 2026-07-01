#pragma once
#include "Defines.hpp"
#include "hex/HexGrid.hpp"
#include "AUnit.hpp"
#include "Squad.hpp"
#include "Wing.hpp"
#include <array>
#include <unistd.h>
#include <iostream>
#include <memory>
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

    // Erase dead and fully-fled units from the vector each tick.
    // Mirrors the erase loops currently inlined in Battlefield::makeBattle.
    void pruneDeadUnits();

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

        void loadArmies(Army red, Army blue);
        // Call whenever impassable/terrain/blocked flags change mid-battle (e.g. a spell).
        void recomputeDistances();
        void reset(); // clear hex occupancy and corpse count between battles
        bool tick();
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
        void moveSquad(Squad& squad);
        void flee(std::unique_ptr<AUnit> &unit);
        void retreatToRange(std::unique_ptr<AUnit> &unit);
        void cleanup();
        void triggerSpecialPhase();
        void resolveEngagements();

        size_t getCorpses();
        void   setCorpses(size_t setCorpses);

    private:
        void onTurnStart();
        void onTurnEnd();

        Team   _red{REDTEAM};
        Team   _blue{BLUETEAM};
        size_t corpses = 0;
};
