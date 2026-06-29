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
#include "Weapon.hpp"
#include "WeaponList.hpp"
#include <vector>
#include "Defines.hpp"
#include "Battlefield.hpp"
#include "Utility.hpp"

class Squad; // forward declare — Squad.hpp includes AUnit.hpp so we can't include it here

// Movement and terrain-restriction category for a unit.
// All existing human units are Foot. New unit classes set their category;
// terrain rules in Battlefield use this automatically.
enum class UnitCategory {
    Foot,       // standard infantry; affected by all terrain
    Mounted,    // cavalry; cannot enter Forest or Marsh; no charge through Rubble
    Flyer,      // ignores ground terrain; can cross blocked hexsides (cliffs, walls)
    Beast,      // large creature; no formation bonus; Forest/Rubble +1; Marsh +2
    Skirmisher  // light troops; Forest normal cost; Marsh +1; Rubble normal cost
};

class AUnit : public std::enable_shared_from_this<AUnit> {
public:
    AUnit() = default;
    virtual ~AUnit();
    AUnit(const int newTeam);

    void setHex(Hex* hex);
    void attack(AUnit &target, const Weapon &attackWeapon, int bonus = 0);

    Hex* getHex() const;
    void reset();
    int getTeam() const;
    int takeDamage(int amount);
    int defend(int AttackAttempt, int damage);
    void battle(Battlefield &myBattlefield);
    AUnit *find_target(Battlefield &myBattlefield);
    bool getAlive() const;
    bool getBroken() const;
    void setAlive(bool);
    bool rally();
    int getHp() const;
    int getmaxHP() const;
    void setBroken(bool value);
    void heal(int value);
    virtual void special() {};
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
     int getArmour() const;
     
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


     int getValue() const;
     size_t getSize() const;
     bool getUndead() const;
    void addWeapon(Weapon newWeapon);
    int getFatigue() const;
    int getFatigueCost() const;
    bool getEngaged(Battlefield &myBattlefield) const;

    void increaseFatigue();

    void recover();

    void addFatigue(int amount);
    void setSpentMove(size_t setMove);
    size_t getSpentMove();
    char getPrintSymbol();

    void     setCanFight(bool v)    { canFightThisTurn = v; }
    bool     getCanFight()   const  { return canFightThisTurn; }
    void     setEngagedSide(HexSide* s) { engagedSide = s; }
    HexSide* getEngagedSide() const { return engagedSide; }

    // Squad back-pointer — non-owning. Set/cleared by Squad::addMember/removeMember.
    // nullptr means this unit is a lone individual (mob, summon, overflow).
    void   setSquad(Squad* s) { _squad = s; }
    Squad* getSquad()   const { return _squad; }
    // Remove this unit from its squad immediately. No-op if not in a squad.
    // Call before setting alive=false or triggering any state that severs the unit from formation.
    void   leaveSquad();

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

    int  getPreferredRange()  const  { return preferredRange; }
    void setPreferredRange(int r)    { preferredRange = r; }
    int  getMovementSpeed()  const  { return movementSpeed; }
    int  getAmmunition()     const  { return ammunition; }
    int  getSortKey()        const  { return sortKey; }
    bool biggerThan(const AUnit* other) const;   // size descending; sortKey tiebreaker baked in
    bool sortsBefore(const AUnit* other) const;  // sortKey tiebreaker only — use when size is irrelevant

    UnitCategory getCategory()           const { return _category; }
    void         setCategory(UnitCategory c)   { _category = c; }


protected:
    int team = 0;
    Hex* currentHex = nullptr;
    int hitpoints = 10;
    int attackPWR = 10;
    int defence = 10;
    int morale = 10;
    int strength = 10;
    int maxHP = 10;
    int cast = 0;
    int armour = 0;
    int accuracy = 10;
    int ammunition = 0;
    int shield = 0;               // physical shield from weapons; degrades under hits
    std::vector<int> _extraShields; // stacked temporary shields (force fields etc.)

    int fatigue = 0;
    int fatiguelvl = 0;
    int fatigueCost = 4;
    int fatigueRecovery = FATIGUERECOVERY;
    int preferredRange  = 0; // 0/1 = advance to melee; >1 = try to hold this hex distance
    int movementSpeed   = 1; // hexes moved per tick; 0 = immobile (never moves)
    
    int resistance = 10;
    int unitValue = 10; // relative priority: mages weigh this to avoid wasting spells on low-value chaff
    size_t size = 10;
    char printSymbol = '?';

    bool alive = true;
    bool broken = false;
    bool canFightThisTurn = false;
    HexSide* engagedSide = nullptr;
    bool spellcaster = false;
    bool placed = false;
    bool undead = false;
    bool battleSummon = false;
    size_t spentMove = 0;

    Squad* _squad = nullptr;  // non-owning; nullptr = lone unit
    int sortKey = 0; // random tiebreaker set at construction, used for render ordering
    int _cohesion      = 50; // base formation cohesion score; set by subclass or setup
    int _cohesionBonus = 0;  // per-tick tier (0-3), set by resolveEngagements, reset each tick
    UnitCategory _category = UnitCategory::Foot;
    std::vector<Weapon> _attacks;

};


