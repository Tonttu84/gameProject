/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   AUnit.hpp                                          :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: jrimpila <jrimpila@hive.fi>                +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2025/08/16 11:27:43 by jrimpila          #+#    #+#             */
/*   Updated: 2025/10/06 10:57:50 by jrimpila         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

#pragma once

#include <memory>
#include <assert.h>
#include <climits>
#include <string>
#include "Weapon.hpp"
#include "WeaponList.hpp"
#include <vector>
#include "Defines.hpp"
#include "Battlefield.hpp"
#include "Utility.hpp"

class Squad; // forward declare — Squad.hpp includes AUnit.hpp so we can't include it here
struct Spell; // see Spell.hpp/SpellList.hpp — only pointers stored here

// Movement and terrain-restriction category for a unit.
// All existing human units are Foot. New unit classes set their category;
// terrain rules in Battlefield use this automatically.
enum class UnitCategory {
    Foot,       // standard infantry; affected by all terrain
    Mounted,    // cavalry; cannot enter Forest or Marsh; no charge through Rubble
    Flyer,      // ignores ground terrain; can cross blocked hexsides (cliffs, walls)
                // and enter impassable hexes (deep water, sheer rock)
    Beast,      // large creature; no formation bonus; Forest/Rubble +1; Marsh +2
    Skirmisher  // light troops; Forest normal cost; Marsh +1; Rubble normal cost
};

// Single source of truth for terrain a unit category cannot enter.
// Mounted → Forest + Marsh; all others → unrestricted.
// Used by the placement API and (eventually) BFS terrain filtering.
inline std::vector<TerrainType> forbiddenTerrainForCategory(UnitCategory cat) {
    if (cat == UnitCategory::Mounted)
        return {TerrainType::Forest, TerrainType::Marsh};
    return {};
}

class AUnit : public std::enable_shared_from_this<AUnit> {
public:
    AUnit() = default;
    virtual ~AUnit();
    AUnit(const int newTeam);

    void setHex(Hex* hex);

    Hex* getHex() const;
    void reset();
    int getTeam() const;
    virtual int takeDamage(int amount, ArmorPen pen = ArmorPen::Normal);
    // attackerReach: melee weapon reach of the attacker. Ignored by the base
    // implementation — only MountedUnit targets use it, to shift the
    // mount/rider hit-roll boundary toward the rider for longer weapons.
    // repelCounter: true for a repel's capped counter-hit — goes through the
    // normal shield/armour reduction but the final damage is capped at 1 and
    // never triggers testMorale() (a morale check already happened for the
    // attack this is countering). See [[design_repel]].
    virtual int defend(int AttackAttempt, int damage, ArmorPen pen = ArmorPen::Normal,
                        int attackerReach = 0, bool repelCounter = false);
    virtual void battle(Battlefield &myBattlefield);
    AUnit *find_target(Battlefield &myBattlefield);

    // Attack-bonus computation (engagement side, cohesion, elevation, cramped
    // penalty) extracted out of battle() so MountedUnit can reuse the rider's
    // own engagement context for the mount's attack.
    int computeMeleeAttackBonus() const;

    // Runs this unit's own weapon list against `target` using a pre-resolved
    // attack bonus. Used directly by battle() for the normal case, and by
    // MountedUnit to let a stowed mount attack via the rider's engagement
    // context without the mount needing its own hex/engagedSide. No fatigue
    // tracking — kept simple; a mount doesn't tire from kicking.
    void attackWithWeapons(AUnit* target, int attackBonus);
    bool hasAttacks() const { return !_attacks.empty(); }

    // Repel: if `originalTarget` (or, failing that, another eligible enemy
    // sharing its engaged hexside) has a strictly longer weapon than this
    // attack's reach, it gets an opposed roll to interrupt the attack before
    // damage lands. See [[design_repel]] for the full algorithm; this is
    // called from the MeleeAttack::onAttack hook set up in attackWithWeapons()
    // and battle(), so it never needs calling directly.
    void resolveRepel(AUnit* originalTarget, bool& blocked, int attackerHitBonus, int attackerReach);

    // The unit that single-target, non-combat effects (heal, buffs, curses,
    // ...) should actually apply to. Default: self. Composite units like
    // MountedUnit override this to redirect to whichever sub-unit such
    // effects naturally belong to (the rider, by default). Effect-casting
    // code should resolve through this once rather than each effect type
    // needing its own MountedUnit-aware special case — most callers don't
    // even need to call it explicitly, since heal() etc. are themselves
    // virtual and already route through it.
    virtual AUnit* effectTarget() { return this; }
    virtual const AUnit* effectTarget() const { return this; }

    // The independent sub-units that may each attempt a repel when this unit
    // is targeted for melee. Default: just itself. MountedUnit overrides this
    // to return both rider and mount — either may have the longer weapon
    // (e.g. a Scorpion mount's Stinger), and each gets its own single repel
    // attempt, not the composite as a whole. See [[design_repel]].
    virtual std::vector<AUnit*> repelParts() { return {this}; }

    bool getAlive() const;
    virtual bool getBroken() const;
    void setAlive(bool);
    bool rally();
    virtual int getHp() const;
    virtual int getmaxHP() const;
    virtual void setBroken(bool value);
    virtual void heal(int value);
    virtual void special() {};

    // ── Spellcasting (Stage R0, docs/UNITS_AS_DATA_PLAN.md) ──────────────────
    // Non-virtual: called by triggerSpecialPhase for every unit; a unit whose
    // roster query matched no spells returns immediately. Handles the common
    // gating (cooldown tick, alive/broken/hex, mana spend, setCast) so spell
    // effect bodies in SpellList.cpp only target and apply.
    void castSpells();
    // Cast-selection policy, kept separate from castSpells() so the policy can
    // grow without touching the gating. Today every spellcaster type knows
    // exactly ONE spell (tripwire-tested), so "first affordable spell" is
    // trivially correct. When spell paths (Stage R4) give casters real spell
    // arrays, THIS is where a real algorithm — priority, mana budgeting,
    // situational scoring — replaces pick-first. Requirements are already
    // resolved at assignment time: _spells only holds spells this unit may cast.
    const Spell* chooseSpellToCast() const;
    int  getMana() const { return mana; }
    void setMana(int m)  { mana = m; }

    int getCast() const;
    void setCast(int setCast);
    bool testMorale(int damage);

    void setSpellcaster(bool value);
    bool getSpellCaster() const;

    void setPlaced(bool value);
    bool getPlaced() const;

    virtual void restoreForNextBattle(); // heal to full and reset battle state for campaign carry-over

    void setBattleSummon(bool value);
    bool getBattleSummon() const;
     virtual int getArmour() const;
     virtual int getDefence() const { return defence; }

    int  getShield() const;
    void setShield(int newVal);

    // Stack a temporary shield layer (force fields, spell barriers, etc.).
    // Temporary shields block independently of skill — flat throwDice() <= value roll.
    // They are checked before the physical shield and do not depend on the defender's
    // defence stat. Forest cover is handled separately (ranged-only path in Archer).
    void addShield(int v);
    void popShield();            // remove the most recently added temporary shield
    bool tryBlockExtraShield();  // rolls against each temporary shield back-to-front;
                                 // returns true and consumes the blocking one if any hit

    // Returns true if the unit's current hex terrain deflects this ranged attack.
    // Call this (before shield checks) for any projectile or spell that terrain can absorb.
    // Trees stop heat as well as arrows — use for physical AND fire attacks.
    // Bypass attacks are never stopped by terrain; Piercing halves the cover bonus.
    bool rollTerrainRangedBlock(ArmorPen pen = ArmorPen::Normal) const;


     int getValue() const;
     size_t getSize() const;
     bool getUndead() const;
    void addWeapon(Weapon newWeapon);
    int getFatigue() const;
    int getFatigueCost() const;
    virtual int getAttackPWR() const { return attackPWR; }

    // Per-turn attack counter: incremented by MeleeCombat::engage() after each
    // defend() call, reset at the start of Battlefield::makeBattle().
    // defend() applies MULTI_ATTACK_DEFENCE_PENALTY per count — units get easier
    // to hit the more times they've already been attacked this turn.
    virtual void resetAttacksReceived() { _attacksReceivedThisTurn = 0; }
    void incrementAttacksReceived() { ++_attacksReceivedThisTurn; }
    int  getAttacksReceivedThisTurn() const { return _attacksReceivedThisTurn; }
    bool getEngaged(Battlefield &myBattlefield) const;

    // Repel malus: -1 to a unit's repel roll for every repel it has already
    // attempted this turn (win or lose) — stacks across multiple attempts,
    // reset at the start of the next turn. See resolveRepel()/[[design_repel]].
    int  getRepelMalus() const { return repelMalus; }
    virtual void resetRepelMalus() { repelMalus = 0; }

    void increaseFatigue();

    void recover();

    void addFatigue(int amount);
    void setSpentMove(size_t setMove);
    size_t getSpentMove();
    char getPrintSymbol();

    void     setCanFight(bool v)    { canFightThisTurn = v; }
    bool     getCanFight()   const  { return canFightThisTurn; }

    // Set when the unit took a lateral (same-distance) move last tick.
    // The next move MUST decrease distance (toward target or toward map edge for flee).
    bool     getTookLateral()       const { return _tookLateralLastMove; }
    void     setTookLateral(bool v)       { _tookLateralLastMove = v; }
    void     setEngagedSide(HexSide* s) { engagedSide = s; }
    HexSide* getEngagedSide() const { return engagedSide; }

    // Combat rank (1=frontline, 2=backup, 3=reserve, 0=unseated).
    // Persists across ticks so non-squad units promote one rank per tick.
    // Reset to 0 by setHex() (unit moved) and restoreForNextBattle().
    // NOT reset by Team::resetUnitFlags() — that is intentional.
    int  getEngagedRank() const { return _engagedRank; }
    void setEngagedRank(int r)  { _engagedRank = r; }

    // The HexSide this unit is positioned behind regardless of rank.
    // Set for ALL ranked units (rank 1–3); nullptr for unseated.
    // Rank-1 units: formationSide == engagedSide.
    // Rank 2/3 units: formationSide set but engagedSide is nullptr (can't fight).
    // Reset to nullptr by resetUnitFlags() each tick.
    HexSide* getFormationSide() const { return _formationSide; }
    void     setFormationSide(HexSide* s) { _formationSide = s; }

    // Sets currentHex directly, without touching hex->units (unlike setHex()).
    // For syncing tactical context onto a sub-unit that is never independently
    // placed in the grid — e.g. MountedUnit's rider/mount, the same way
    // syncTacticalState() already copies engagedSide/cohesionBonus onto them.
    void     syncCurrentHex(Hex* h) { currentHex = h; }

    // Squad back-pointer — non-owning. Set/cleared by Squad::addMember/removeMember.
    // nullptr means this unit is a lone individual (mob, summon, overflow).
    void   setSquad(Squad* s) { _squad = s; }
    Squad* getSquad()   const { return _squad; }
    // Remove this unit from its squad immediately. No-op if not in a squad.
    // Call before setting alive=false or triggering any state that severs the unit from formation.
    void   leaveSquad();

    // Persistent squad identity — separate from the live _squad pointer above.
    // leaveSquad()/Squad::removeMember() only ever clear _squad; they never
    // touch this tag, so a unit that breaks and flees (which does call
    // leaveSquad(), see Battlefield::moveUnits) keeps its squadId. This is
    // what lets a campaign layer regroup survivors — including stragglers who
    // broke but lived — into the same persistent squad after the battle.
    // 0 = unassigned/loose (not part of any campaign squad).
    int  getSquadId()   const           { return _squadId; }
    void setSquadId(int id)             { _squadId = id; }
    const std::string& getSquadName() const { return _squadName; }
    void setSquadName(std::string name) { _squadName = std::move(name); }

    // ── Formation cohesion ────────────────────────────────────────────────────
    // Per-unit base score (0-100+). Subclasses or setup code set this; the
    // default of 50 puts a regular soldier at tier-1 bonus territory.
    int getCohesion()    const { return _cohesion; }
    void setCohesion(int c)    { _cohesion = c; }

    // Per-tick bonus tier set by resolveEngagements when this unit is assigned
    // to a side while its squad owns that side. Reset to 0 each tick.
    //   0 = no bonus  (lone unit or squad with low cohesion)
    //   1 = normal    +1 attack / defence / morale
    //   2 = high      +1 attack / defence / morale, +1 damage
    //   3 = super     +2 attack / defence / morale, +2 damage
    int  getCohesionBonus() const { return _cohesionBonus; }
    void setCohesionBonus(int tier) { _cohesionBonus = tier; }

    // Convenience — attack/defence/morale bonus from current tier (+1 or +2).
    int cohesionStatBonus() const { return _cohesionBonus >= 3 ? 2 : _cohesionBonus >= 1 ? 1 : 0; }
    // Damage bonus kicks in one tier later.
    int cohesionDmgBonus()  const { return _cohesionBonus >= 3 ? 2 : _cohesionBonus >= 2 ? 1 : 0; }

    // Hold order: unit skips movement for _holdTurns ticks.
    // 0 = move normally; N = hold for N more ticks then advance; INT_MAX = hold forever.
    // tickHold() decrements (if < INT_MAX) and returns true while the unit is holding.
    // Broken units always flee regardless of hold.
    int  getHoldTurns()  const     { return _holdTurns; }
    void setHoldTurns(int t)       { _holdTurns = t; }
    bool tickHold() {
        if (_holdTurns <= 0) return false;
        if (_holdTurns < INT_MAX) --_holdTurns;
        return true;
    }

    int  getPreferredRange()  const  { return preferredRange; }
    void setPreferredRange(int r)    { preferredRange = r; }
    int  getMovementSpeed()  const  { return movementSpeed; }
    int  getBallisticSkill() const  { return ballisticSkill; }
    int  getReconTag()       const  { return reconTag; }
    int  getAccuracy()       const  { return accuracy; }

    // ── Squad movement points ─────────────────────────────────────────────────
    // Signed bank used only by squad movement (Battlefield::moveUnits): each
    // tick a member regains movementSpeed, never banking above that base;
    // every member pays each hex's terrain cost; zero-or-negative blocks the
    // whole squad (richer members can aid — see moveUnits). Lone units use
    // spentMove debt instead; Squad::removeMember/disband convert a negative
    // bank back into spentMove so a straggler can't shed debt by losing its
    // squad.
    int  getMovePoints() const { return _movePoints; }
    void setMovePoints(int p)  { _movePoints = p; }
    int  getAmmunition()     const  { return ammunition; }
    int  getSortKey()        const  { return sortKey; }
    bool biggerThan(const AUnit* other) const;   // size descending; sortKey tiebreaker baked in
    bool sortsBefore(const AUnit* other) const;  // sortKey tiebreaker only — use when size is irrelevant

    UnitCategory getCategory()           const { return _category; }
    void         setCategory(UnitCategory c)   { _category = c; }

    // Stable per-battle identity for replay recording. -1 = not yet assigned;
    // ReplayRecorder assigns serials on first sight. Kept on the unit itself
    // (not in a pointer-keyed map) so a freed unit's address being reused by a
    // mid-battle summon can never resurrect a dead unit's id in the replay.
    int  getReplayId() const   { return _replayId; }
    void setReplayId(int id)   { _replayId = id; }


    // The category a creature reports once it's on its own — e.g. a mount
    // that's just lost its rider — as opposed to whatever category it
    // imposes on the composite while harnessed (always Mounted; see
    // MountedUnit's constructor). Distinct from getCategory()/_category so a
    // mount's "while ridden" and "once loose" identities can differ without
    // overloading the same field: a controlled cavalry charge can't push a
    // horse through dense forest, but a riderless horse bolting from battle
    // might wade into a swamp anyway. Default Beast — penalized but not
    // flatly forbidden on rough terrain, no formation bonus — fits most
    // loose mounts; override per unit type for ones that should behave
    // differently once free (e.g. a combat-trained mount that keeps fighting
    // rather than fleeing might want to keep stricter terrain rules instead).
    virtual UnitCategory looseCategory() const { return UnitCategory::Beast; }


protected:
    // Ranged competence on the same scale as melee attackPWR: 10 = average
    // trained human (an Archer), 2 = untrained. The legacy 0-100 `accuracy`
    // percentage the ranged pipeline consumes is DERIVED as ballisticSkill*5
    // — this setter is the single seam; when accuracy semantics get reworked,
    // only this derivation changes. Ctors set ballistic skill through here,
    // never `accuracy` directly.
    void setBallisticSkill(int bs) { ballisticSkill = bs; accuracy = bs * 5; }

    // Query the spell roster with this unit's catalog type name. Called by
    // caster constructors; Stage R3 will move the call to the generic
    // spec-built Unit constructor.
    void assignSpells(std::string_view unitTypeName);

    int team = 0;
    Hex* currentHex = nullptr;
    int hitpoints = 10;
    int attackPWR = 10;
    int defence = 10;
    int morale = 10;
    int strength = 10;
    int maxHP = 10;
    int cast = 0;
    int mana = 0; // only meaningful for units whose roster query matched spells
    int armour = 0;
    int ballisticSkill = 2; // see setBallisticSkill(); default matches accuracy = 10
    int accuracy = 10;      // derived: ballisticSkill * 5; do not set directly
    int ammunition = 0;
    int shield = 0;               // physical shield from weapons; degrades under hits
    std::vector<int> _extraShields; // stacked temporary shields (force fields etc.)

    int fatigue = 0;
    int fatiguelvl = 0;
    int fatigueCost = 4;
    int fatigueRecovery = FATIGUERECOVERY;
    int preferredRange  = 0; // 0/1 = advance to melee; >1 = try to hold this hex distance
    int movementSpeed   = 1; // hexes moved per tick; 0 = immobile (never moves)
    // Signed scouting adjustment, unused by the battle engine itself: the
    // campaign layer's reconValue = speed² + ⌊ballisticSkill/2⌋ + reconTag.
    // Set only where a unit's scouting worth diverges from what speed and
    // ballistics already imply (LightCavalry +, Warhorse −); exported via
    // unitCatalogJson() like every other stat.
    int reconTag        = 0;
    
    int resistance = 10;
    int unitValue = 10; // relative priority: mages weigh this to avoid wasting spells on low-value chaff
    size_t size = 10;
    char printSymbol = '?';

    bool alive = true;
    bool broken = false;
    bool _tookLateralLastMove = false;
    bool canFightThisTurn = false;
    HexSide* engagedSide    = nullptr;
    HexSide* _formationSide = nullptr;
    int  _engagedRank       = 0;
    bool spellcaster = false;
    bool placed = false;
    bool undead = false;
    bool battleSummon = false;
    size_t spentMove = 0;
    int _movePoints = 0; // squad movement bank — see getMovePoints()

    int _attacksReceivedThisTurn = 0;
    int repelMalus = 0;
    Squad* _squad = nullptr;  // non-owning; nullptr = lone unit
    int  _squadId = 0;        // persistent campaign squad tag — see getSquadId()
    std::string _squadName;   // display name for the tag, e.g. for buildSquadsFromArmy
    int sortKey = 0; // random tiebreaker set at construction, used for render ordering
    int _cohesion      = 50; // base formation cohesion score; set by subclass or setup
    int _cohesionBonus = 0;  // per-tick tier (0-3), set by resolveEngagements, reset each tick
    UnitCategory _category = UnitCategory::Foot;
    std::vector<Weapon> _attacks;
    std::vector<const Spell*> _spells; // roster entries this unit may cast; see assignSpells()
    int _holdTurns = 0;
    int _replayId = -1;

};


