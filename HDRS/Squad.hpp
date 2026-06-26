#pragma once

#include <string>
#include <vector>
#include <cstddef>
#include "Defines.hpp"

// Forward declarations — Squad does not include AUnit.hpp, Wing.hpp, or Battlefield.hpp
// to avoid circular dependencies.
class AUnit;
class Wing;
struct Hex;

// ─── Morale state ────────────────────────────────────────────────────────────
// Shared enum used by both Squad (collective) and eventually AUnit (individual).
// Currently AUnit uses bool broken; the plan is to replace that with this enum.
// Adding here first so Squad can use it immediately.
//
// Degrades one step at a time — a unit/squad cannot jump from Confident to Broken
// in a single blow unless multiple tests are failed in the same tick.
enum class MoraleState {
    Confident,  // above expectations; grants a reroll on failed individual morale checks
    Normal,     // baseline — no modifier
    Scared,     // fighting but rattled; -modifier to individual morale checks
    Broken      // fleeing; removed from squad automatically
};

// ─── Squad ───────────────────────────────────────────────────────────────────
// An optional organisational layer over individual AUnit objects.
// Units without a squad work exactly as before — Squad is additive, not replacing.
//
// Ownership model (bidirectional pointers, no smart pointers needed):
//   - AUnit is owned by Battlefield's teamRED / teamBLUE (unique_ptr).
//   - Squad is owned by Battlefield's _squads (unique_ptr<Squad>).
//   - Squad holds non-owning AUnit* to its members.
//   - AUnit holds a non-owning Squad* back-pointer to its squad (nullptr if none).
//
// Safety protocol — raw pointers are safe as long as this is followed:
//   - addMember(u)    sets u->setSquad(this)
//   - removeMember(u) clears u->setSquad(nullptr)
//   - disband()       calls removeMember on every member before the Squad is destroyed;
//                     Battlefield must call disband() before erasing from _squads.
//
// If that discipline becomes hard to maintain, upgrade AUnit's back-pointer to
// weak_ptr<Squad> and change Battlefield to own squads via shared_ptr<Squad>.
//
// Typical lifecycle:
//   1. Created in BattleSetup alongside army placement.
//   2. Battlefield calls pruneDeadMembers() and updateMoraleState() each tick.
//   3. Battlefield queries moraleModifier() when resolving individual morale checks.
//   4. If the leader is alive, Battlefield calls attemptRally() during the rally phase.
//   5. At battle end, Battlefield calls disband() before destroying each Squad.
class Squad {
public:
    Squad(std::string name, bool hasBanner);

    // ── Identity & prestige ───────────────────────────────────────────────────
    const std::string& getName()     const { return _name; }

    // Prestige accumulates across battles (roguelite carry-over via banner).
    // Currently a placeholder — future uses: unlock abilities, stat bonuses,
    // narrative history, morale bonus from reputation.
    int  getPrestige()               const { return _prestige; }
    void addPrestige(int amount)           { _prestige += amount; }

    // ── Membership ───────────────────────────────────────────────────────────
    // Sets unit->setSquad(this) on the unit as part of the call.
    void addMember(AUnit* unit);

    // Clears unit->setSquad(nullptr) on the unit as part of the call.
    // Does not delete the unit — ownership stays with Battlefield.
    void removeMember(AUnit* unit);

    // Calls removeMember on every member, clearing all back-pointers.
    // Battlefield MUST call this before erasing the Squad from _squads.
    void disband();

    bool hasMember(const AUnit* unit) const;
    const std::vector<AUnit*>& getMembers() const { return _members; }

    size_t aliveCount() const;   // members currently alive
    size_t totalCount() const    { return _members.size(); } // all including dead still tracked

    // Remove dead and broken-and-fled members from the roster each tick.
    // Calls removeMember internally so back-pointers are always cleared.
    // Call this before updateMoraleState so thresholds reflect current reality.
    void pruneDeadMembers();

    // ── Wing back-pointer ─────────────────────────────────────────────────────
    // Non-owning. Set/cleared by Wing::addSquad / Wing::removeSquad.
    // nullptr means this squad is not assigned to any wing.
    void  setWing(Wing* wing) { _wing = wing; }
    Wing* getWing()     const { return _wing; }

    // ── Leadership ───────────────────────────────────────────────────────────
    // Leader must already be a member of this squad.
    void setLeader(AUnit* unit);
    AUnit* getLeader() const { return _leader; }
    bool   hasLeader() const; // defined in Squad.cpp — AUnit is incomplete here

    // ── Banner ───────────────────────────────────────────────────────────────
    // The banner is the persistent identity of the squad (carries prestige in roguelite).
    // A squad without a banner loses morale bonuses but still functions as a formation.
    bool   hasBanner()     const { return _hasBanner; }

    // Flag bearer: the specific unit carrying the banner.
    // If nullptr, no one is currently assigned (happens briefly between bearer death
    // and reassignment).
    void   setFlagBearer(AUnit* unit);
    AUnit* getFlagBearer() const { return _flagBearer; }

    // Call when the flag bearer is killed. Automatically assigns the lowest-sortKey
    // alive non-broken member as the new bearer. Flag bearers are expected to be
    // unbreakable (Battlefield enforces this externally).
    // Returns the new bearer, or nullptr if no eligible member exists.
    AUnit* onFlagBearerDeath();

    // ── Collective morale ─────────────────────────────────────────────────────
    MoraleState getMoraleState() const { return _moraleState; }

    // Call each tick after pruneDeadMembers(). Checks casualty and broken thresholds;
    // triggers a collective morale test if either is exceeded since the last test.
    // Degrades _moraleState by one step on a failed test.
    void updateMoraleState();

    // Force a one-step degradation (used by external events: e.g. commander killed,
    // banner captured). Does nothing if already Broken.
    void degradeMorale();

    // Upgrade one step (used by rally, blessing, etc.). Does nothing if Confident.
    void improveMorale();

    // The modifier this squad's morale state applies to members' individual checks.
    // Battlefield reads this when a member unit fails a morale check:
    //   Confident → unit may reroll (return value: +1 means "grant reroll")
    //   Normal    → no change      (return value:  0)
    //   Scared    → flat penalty   (return value: -2, applied to morale roll)
    //   Broken    → n/a (squad is dissolved; members flee individually)
    // Using int here keeps the call site simple; Battlefield interprets the sign/magnitude.
    int moraleModifier() const;

    // Leader rally attempt: each tick the leader can try to pull Scared members back
    // toward Normal. Only called if hasLeader() is true.
    // Returns the number of units whose individual morale state improved.
    // (Does not affect squad collective state — that recovers through improveMorale().)
    int attemptRally();

    // ── Movement ──────────────────────────────────────────────────────────────
    // Movement order: squads move before lone units each tick so that squads
    // claim their hex first. Lone units fill gaps afterwards and won't block
    // squads as easily.
    //
    // A squad will NOT enter a hex unless ALL members can fit simultaneously.
    // Battlefield checks this by comparing totalSizePoints() against hex capacity.
    //
    // Displacement: a squad may push lone units (units belonging to no squad) out
    // of a target hex if the lone units' combined size is ≤ DISPLACE_FRACTION of
    // the squad's own size. Displaced units are moved to any adjacent friendly hex.
    // This prevents small stragglers from permanently blocking a squad's path while
    // still making large lone units impassable obstacles.
    static constexpr float DISPLACE_FRACTION = 0.25f; // displace if loners ≤ 25% of squad size

    // Sum of getSize() across all alive members — used for hex capacity checks.
    size_t totalSizePoints() const;

    // True if all alive members can fit in the given hex simultaneously
    // (i.e. hex.sizeUsed + totalSizePoints() <= Hex::CAPACITY after clearing current positions).
    // Battlefield calls this before committing squad movement.
    bool canFitInHex(const Hex* hex) const;

private:
    std::string         _name;
    int                 _prestige    = 0;
    std::vector<AUnit*> _members;    // non-owning; includes dead until pruned
    AUnit*              _leader     = nullptr;
    AUnit*              _flagBearer = nullptr;
    Wing*               _wing       = nullptr;  // non-owning; nullptr = wingless squad
    bool                _hasBanner;
    bool                _shakenTested = false;  // true after shaken threshold fired; reset when % drops below
    MoraleState         _moraleState = MoraleState::Normal;

    // Starting member count recorded when the first battle tick begins.
    // Used to compute casualty percentage for threshold tests.
    size_t _peakCount      = 0;

    // Tracks how many members were alive at the last morale test so we don't
    // re-trigger a test every tick once a threshold is crossed.
    size_t _lastTestedAlive = 0;

    // Thresholds that trigger a collective morale test.
    // 25% dead since peak → first test; 50% dead → second test, etc.
    static constexpr float CASUALTY_THRESHOLD = 0.25f;
    // Percentage of remaining members that are Scared or Broken before a test fires.
    static constexpr float SHAKEN_THRESHOLD   = 0.40f;
};
