#pragma once

#include <algorithm>
#include <memory>
#include <assert.h>
#include <climits>
#include <string>
#include "Weapon.hpp"
#include "WeaponList.hpp"
#include <vector>
#include "Defines.hpp"
#include "Abilities.hpp"
#include "Spell.hpp"   // SpellPath/SpellForm are stored by value/pointer below
#include <array>
#include "Anatomy.hpp"
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

    // How this unit is NAMED in the battle log: "Mage (blue)". Extracted
    // because three log sites were each rebuilding it from printSymbol, and a
    // fourth (the Trace combat lines) would have been a fourth copy.
    std::string logName() const;
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

    // ── Spellcasting ("THE MAGIC SYSTEM", docs/CAMPAIGN_PLAN.md) ─────────────
    // Non-virtual: called by triggerSpecialPhase for every unit; a unit with no
    // path levels at all returns immediately. Handles the common gating
    // (channel ticking, alive/broken, paying fatigue on completion) so spell
    // effect bodies in SpellList.cpp only target and apply.
    void castSpells();

    // What this caster WOULD cast right now, deterministically — the scorer's
    // max with no lottery and no cursor advance (AI-2). It was M-22's priority
    // walk until the scorer replaced the walk; what remains is the PROBE: the
    // pending script line that clears the floor, else the best of the
    // shortlist/roster pool. Tests and the lab read it; castSpells() does not.
    //
    // NOTE there is deliberately no affordability test: under M-2 nothing is
    // unaffordable, so fatigue never blocks selection (the floor is about
    // WORTH, never about what the caster can pay). A caster may cast himself
    // into the overflow and bleed for it.
    const SpellForm* chooseSpellToCast(const Spell** outSpell) const;
    // The opening sequence as set (A-6) — the ids in order, for tests and views.
    const std::vector<const Spell*>& getScript() const { return _spells; }

    // ── Spell paths (M-3, M-5) ───────────────────────────────────────────────
    // Rolled at hire and then fixed; they ride the placement entry for BOTH
    // sides, exactly as squad_mods does, because there is one magic system and
    // the engine never learns who is the player (M-17).
    int  getPathLevel(SpellPath p) const;
    void setPathLevel(SpellPath p, int level);

    // The player's CHOSEN SPELLS (slice 4, S4-1) — the ids this caster reaches
    // for first, in order. They are moved to the front of `_spells`; everything
    // else keeps its roster order behind them, so a chosen list is a PREFERENCE
    // and never a restriction. An empty list therefore restores exactly the
    // default walk, which is what makes the whole feature additive.
    //
    // A line names a SPELL, not a form (S4-2): the engine still takes the
    // strongest form the caster qualifies for within it (M-13), and M-26's
    // cast-time fall-through is untouched.
    //
    // Never-throw, like every other field arriving from the JSON boundary: an
    // id the roster does not know is skipped, and a repeat of one already
    // chosen is ignored rather than duplicating the entry.
    void setChosenSpells(const std::vector<std::string>& spellIds);

    // ── The casting AI (A-2..A-7, slice AI-2) ─────────────────────────────────
    // The SHORTLIST: what the post-script lottery may draw from (A-7). Empty
    // means the whole castable roster; so does "every entry is worth nothing"
    // — one mechanic for both, and idle if even the roster clears nothing.
    void setShortlist(const std::vector<std::string>& spellIds);
    const std::vector<const Spell*>& getShortlist() const { return _shortlist; }
    // A-5: the wire's `value`, clamped — a character's worth to the scorer,
    // computed where items live and read here as a number.
    void setValue(int value);
    // How far the opening sequence has run (A-6): the next line to try.
    size_t scriptCursor() const { return _scriptCursor; }
    // The target chosen when the current channel began, for tests and the lab.
    const AUnit* channelTarget() const { return _channelTarget; }
    bool hasAnyPath() const;

    // M-10's formula, reading the PRIMARY path (M-20) and halved for a
    // Low-primary spell (M-21). Public so tests can price a form directly.
    int  spellFatigueCost(const SpellForm& form) const;

    // ── The standing-effect registry (A-8's refresh rule, T-5's duration) ────
    //
    // AI-1 kept a SET OF IDS here and called it the buff registry: it answered
    // "is this man carrying Stoneskin" and nothing else, which was all the
    // refresh rule needed. T-5 needs two more answers — when does it stop, and
    // what exactly has to be put back — so the set became a record of WHAT WAS
    // DONE. `applied` is the change that actually landed rather than the one
    // that was asked for (applyStatMod floors each stat and clamps every delta
    // to ±MAX_STAT_MOD, so the two differ), because the revert has to undo
    // exactly what the apply did and nothing more.
    //
    // Ids are roster string literals (static storage), so a view is safe to
    // keep. `stat` is a real string: it is handed straight back to
    // applyStatMod, whose vocabulary is std::string.
    struct StandingEffect {
        std::string_view spellId;   // the ROSTER id of the spell that laid it
        std::string      stat;      // the modded stat, or empty for an effect
                                    // that changed no number (Ward's shield)
        int              applied;   // the change that actually landed, signed
        int              ticksLeft; // 0 = stands for the whole battle (T-5)
    };

    // Apply a standing effect and record it. Returns false — recording nothing
    // — for a stat applyStatMod does not know, so an effect that could not be
    // applied is never one the registry claims is standing. An empty `stat` is
    // the deliberate exception: it records presence for a body that changed no
    // number, which is what a Ward is (its shield layer is consumable and is
    // cleared with the rest of the stack at battle end, not reverted here).
    bool applyEffect(std::string_view spellId, const std::string& stat,
                     int delta, int duration);

    // Is this body carrying that spell right now? The name AI-1 gave it, kept:
    // Spells::candidates() asks exactly this, and since T-5 the answer is
    // "while the effect is ACTIVE" by construction rather than by a mark that
    // outlived what it marked.
    bool hasBuff(std::string_view id) const;

    // T-5: count every timed effect down one tick and undo the ones that reach
    // zero. Battlefield::onTurnStart() calls it on every living body.
    void tickEffects();

    // T-5: undo every standing effect, timed or not, and forget them. Called at
    // battle end (restoreForNextBattle) — before this, a Stoneskin cast in a
    // raid followed its bearer into the next battle and the one after that,
    // for the life of the process.
    void revertEffects();

    // ── Channelling (M-23) ───────────────────────────────────────────────────
    bool isChannelling() const { return _channelForm != nullptr; }
    // Being struck mid-cast forces a throw rather than automatically losing the
    // spell. Returns true if the channel held. No-op (true) when not casting.
    bool testConcentration(int damage);

    // Fire the channelled spell and settle its price: M-23's fatigue on
    // completion, M-11's draw from the army-wide banner pool, M-24's second
    // effect for Low. One place, so the two completion paths cannot drift.
    void completeCast();
    // Start channelling a chosen option, logging what was weighed (A-2's one line).
    void beginChannel(const CastOption& chosen, const std::vector<CastOption>& weighed);

    int getCast() const;
    void setCast(int setCast);
    bool testMorale(int damage);

    void setSpellcaster(bool value);
    bool getSpellCaster() const;

    void setPlaced(bool value);
    bool getPlaced() const;

    // Heal to full and reset battle state for campaign carry-over. Since T-5 it
    // also UNDOES every standing spell effect and empties the temporary shield
    // stack — both were battle-scoped in intent and permanent in fact.
    virtual void restoreForNextBattle();

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

    // TWO SIZES, and picking the wrong one is a silent balance bug. The rule
    // (user, 2026-08-18): does the caller measure ROOM ON THE GROUND, or THE
    // MAN?
    //   getSize()        — the REAL body. Food upkeep (size²), raid capacity
    //                      cost, the drawn glyph radius, stray-shot target
    //                      weight, and the size the unit catalog exports.
    //   getPackingSize() — the ROOM it occupies: hex capacity, fighting
    //                      frontage, rank-1 eviction, a squad's footprint
    //                      moving into a hex, the fatigue-weighted side
    //                      allocation, and the cramped-terrain penalty.
    // A tighter formation does not make a man eat less or need less armour.
    //
    // getSize() stays the REAL one so that a spatial call site nobody converted
    // keeps today's behaviour instead of quietly mis-pricing a body.
     size_t getSize() const;
    // real size - formationFighter, floored at 1. The floor exists because a
    // packing size of 0 is not "very tight" but UNLIMITED — every capacity and
    // frontage gate is `used + size > cap`, which a zero always passes. Floored
    // at 1 rather than at something proportional deliberately (user,
    // 2026-08-18): no real unit wants more than half, but a hard rule at half
    // would fence off a modder doing something crazy. MAX_STAT_MOD is what
    // bounds the value a squad can send over the wire.
     size_t getPackingSize() const;
     int getFormationFighter() const;
     // ─── Abilities (slice 6) ────────────────────────────────────────────────
     // Several sets, deliberately, and what separates them is SCOPE.
     // _innateAbilities is what the TYPE is. _grantedAbilities is what the
     // campaign layer handed this body from OUTSIDE it for this battle (a
     // squad's banner, arriving as `squad_abilities` on the placement entry).
     // _carriedAbilities is what the body's own GEAR gives it
     // (`carried_abilities`). Keeping them apart is what lets a grant be revoked
     // without touching what the creature is in itself — strip a banner's
     // Fearless from a skeleton and it must still be fearless.
     //
     // Only the GRANTED set is SCOPED TO SQUAD MEMBERSHIP (6-6): it holds only
     // while the unit is actually in the formation the banner flies over. Battlefield::flee() already calls leaveSquad(), so a man who breaks
     // loses the banner's gift by leaving; rallying clears `broken` but does NOT
     // put him back in the squad, so he fights on as a lone trooper without it,
     // and _squadId still regroups him into the charter after the battle. Every
     // one of those behaviours falls out of this one expression — there is no
     // strip step anywhere, and deliberately so: a strip in setBroken() would
     // need rally to restore it, and would be order-dependent on when the grant
     // landed.
     //
     // Closure is applied on READ (see Abilities.hpp) so that innate and granted
     // flags imply through each other rather than only within their own set.
     UnitAbility abilities() const;
     bool hasAbility(UnitAbility flag) const { return hasAbilityFlag(abilities(), flag); }

     // ─── Anatomy (5-4 / 5-6) ────────────────────────────────────────────────
     // Where this creature can wear things. PURE VIRTUAL and deliberately so:
     // the user's rule is that an undeclared body plan is an ERROR, never a
     // humanoid by omission, and a pure virtual makes that a COMPILE error
     // rather than something a test has to notice. See Anatomy.hpp.
     //
     // The engine declares the plan and nothing more — it never learns what an
     // item is, which slot one fills, or that gear exists at all. Only
     // unitCatalogJson() reads this, to export the layout for the campaign
     // layer's UnitType sync.
     virtual const Anatomy& anatomy() const = 0;

     // Declared abilities of the type. Constructors use this; it is closed on
     // read, so a constructor declares only what the creature IS.
     void setInnateAbilities(UnitAbility set)  { _innateAbilities = set; }
     UnitAbility getInnateAbilities() const    { return _innateAbilities; }

     // Granted by the campaign layer for this battle. Set once at construction
     // from the placement entry; not additive by design, so a re-grant replaces
     // rather than accumulating.
     void setGrantedAbilities(UnitAbility set) { _grantedAbilities = set; }
     UnitAbility getGrantedAbilities() const   { return _grantedAbilities; }

     // ─── Carried (the scoping 9a recorded and 9b left standing) ─────────────
     // What this body's own GEAR gives it. The twin of _grantedAbilities and
     // the counterpart of _suppressedAbilities below, and it is a set of its
     // own for one reason: the two gifts are scoped differently, so they cannot
     // share one.
     //
     // A banner is flown over a formation and covers only its members. Gear is
     // worn on the body and goes where the body goes — onto a LOOSE unit that
     // is in no squad at all, and away with a man who breaks and runs. Gear
     // already took away unscoped; this is it giving unscoped too.
     //
     // Until this existed the campaign layer folded both gifts onto
     // `squad_abilities`, and a gear-granted ability on a loose character was
     // therefore dropped in silence — a character posted to no charter is in no
     // squad. `services/characters.js` recorded that bug rather than working
     // around it client-side, because the fix belonged here.
     void setCarriedAbilities(UnitAbility set) { _carriedAbilities = set; }
     UnitAbility getCarriedAbilities() const   { return _carriedAbilities; }

     // ─── Suppression (slice 9a, decision 9-4) ───────────────────────────────
     // What this body's GEAR takes away. Items are fully general (9-3): a row
     // may move any stat and may both add and remove abilities.
     //
     // Two things about it are load-bearing, and both live in abilities():
     //
     //   1. Suppression is applied FIRST and abilityClosure() runs AFTER it, so
     //      a row that denies an IMPLIED flag is representable but INERT — the
     //      closure simply puts it back. That is the user's own design
     //      (2026-08-24): "You might be able to technically remove something but
     //      it wont actually work". 6-3's invariant — an undead that leaves a
     //      corpse is unwritable — therefore survives any future edit to the
     //      implication table, and a NEW implication row turns an old item inert
     //      rather than dangerous. The eligibility rule is an authoring
     //      convention; this ORDER is the enforcement.
     //
     //   2. It is NOT scoped to squad membership, unlike a grant. A banner is
     //      flown over a formation and stops covering a man who leaves it (6-6);
     //      gear is worn on the body and goes where the body goes.
     void setSuppressedAbilities(UnitAbility set) { _suppressedAbilities = set; }
     UnitAbility getSuppressedAbilities() const   { return _suppressedAbilities; }
    void addWeapon(Weapon newWeapon);
    int getFatigue() const;
    int getFatigueCost() const;
    // A body that tires at all — fatigueCost above zero, which today is every
    // unit except the Skeleton, the Zombie and the Golem. E-6 reads Leaden
    // Air's "living" off THIS plus the Undead flag rather than off a list
    // of unit names: bone and animated stone have nothing for a weight in the
    // air to work on, and a new unliving type is exempt the day it is written.
    bool tires() const { return fatigueCost > 0; }
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

    // Persistent CHARACTER identity (campaign characters, docs/CAMPAIGN_PLAN.md
    // "SLICE 5 — CHARACTERS"). Same idea as the squad tag above and set the same
    // way — from the placement JSON — but it names ONE individual rather than a
    // formation. The campaign layer needs it because survivors are reported as
    // counts by type, which can say that a Mage died but never WHICH Mage; a
    // character's death is permanent, so the wrong answer is unrecoverable.
    // 0 = an ordinary body, belonging to no character.
    int  getCharacterId() const         { return _characterId; }
    void setCharacterId(int id)         { _characterId = id; }

    // "Hang back unless we run out of troops" (SLICE 5 decision 5-8). A unit
    // flagged here is passed over while the line is being manned and is seated
    // at rank 1 only once nobody else can fill it — see resolveEngagements().
    // It is a TAG, not a stat: it changes who gets seated where, never a number.
    bool getAvoidsMelee() const         { return _avoidsMelee; }
    void setAvoidsMelee(bool avoid)     { _avoidsMelee = avoid; }

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

    // Campaign squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE
    // CATALOG", 4b) and character gear (slice 9a): apply one FLAT modifier to a
    // named stat, by the same names the unit catalog exports — "maxHP",
    // "attack", "defence", "armour", "speed", "ballisticSkill",
    // "preferredRange", "formationFighter", "resistance", "penetration".
    // Returns false for a name it does not handle, so an unknown stat is INERT
    // rather than silently mis-applied — the same contract the campaign layer's
    // effect readers use.
    //
    // Since T-5 it is also the door a SPELL's standing effect goes through, via
    // applyEffect() above: one place that knows how to move a stat, whether the
    // mover is a helm or a hex.
    //
    // The vocabulary is the CHARACTER SHEET (9-5): what a player sees as a
    // number. Two deliberate absences —
    //   • `hitpoints`, because HP is generated FROM maxHP (see the branch), so
    //     gear can never start its bearer wounded;
    //   • `reconTag`, which is not a sheet number but a signed fudge term in a
    //     campaign scouting formula. Making it an ability instead is its own
    //     future change to how recon value is computed, not a gear one.
    // Anything trickier than a number is an ABILITY, not a stat.
    //
    // Bounded deliberately: placement JSON is attacker-controlled at the
    // trust boundary (SECURITY_NOTES.md), so the delta is clamped to
    // MAX_STAT_MOD either way and the result is floored, rather than trusting
    // the caller to have been reasonable. A +1 upgrade is nowhere near these
    // bounds; they exist for the request that is not a +1 upgrade.
    static constexpr int MAX_STAT_MOD = 10;
    bool applyStatMod(const std::string& stat, int delta);
    // The current value of the stat applyStatMod writes under that name — the
    // before/after pair applyEffect needs to record what actually landed. NOT
    // virtual and not the public getters: see the comment on the definition.
    int  statValue(const std::string& stat) const;
    int  getMovementSpeed()  const  { return movementSpeed; }
    int  getBallisticSkill() const  { return ballisticSkill; }
    int  getReconTag()       const  { return reconTag; }
    int  getAccuracy()       const  { return accuracy; }

    // ── The two sides of the resistance contest (T-4, slice TG-3) ────────────
    // `resistance` is what a body brings against a spell tagged as resistible;
    // `penetration` is what a caster brings to push one through. Both are
    // ordinary stats — applyStatMod knows their names, so an item may carry
    // either the day one is authored (none does today). Plain accessors and
    // NOT virtual, deliberately: a mounted composite resists as itself, being
    // one body with one will, rather than delegating to the rider the way the
    // combat stats do.
    int  getResistance()  const  { return resistance; }
    void setResistance(int v)    { resistance = std::max(0, v); }
    int  getPenetration() const  { return penetration; }
    void setPenetration(int v)   { penetration = std::max(0, v); }

    // ── Movement points ───────────────────────────────────────────────────────
    // Signed bank every unit moves on: each tick it regains movementSpeed,
    // never banking above that base, then steps while the bank is positive,
    // paying each entered hex's terrain cost (TERRAIN_COST_*) and going into
    // debt on the step that empties it. Loners regen/spend in moveTeam();
    // squads pool theirs in moveUnits() — any member at zero or below blocks
    // the whole squad, and richer members can aid the straggler at 3:1.
    // The bank travels unchanged when a unit joins or leaves a squad.
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
    int movementSpeed   = 10; // movement points banked per tick (cap = this base);
                              // 0 = immobile (never moves). 10 = normal human vs
                              // TERRAIN_COST_OPEN 12 — one hex most ticks, every
                              // 6th skipped. See getMovePoints().
    // Signed scouting adjustment, unused by the battle engine itself: the
    // campaign layer's reconValue = speed² + ⌊ballisticSkill/2⌋ + reconTag.
    // Set only where a unit's scouting worth diverges from what speed and
    // ballistics already imply (LightCavalry +, Warhorse −); exported via
    // unitCatalogJson() like every other stat.
    int reconTag        = 0;
    
    // T-4: what this body brings against a resistible spell. RESIST_HUMAN is
    // the default on purpose — a type that says nothing about magic is a man,
    // which is right for every human unit and honest for a new type whose
    // author has not thought about it yet. The per-type table is in Defines.hpp
    // and each type sets its own in its constructor.
    int resistance = RESIST_HUMAN;
    // T-4: what a CASTER brings to push a spell through one. Zero on every unit
    // type today — the stat exists so the contest has the term the user's
    // "+ spell penetration" named, and so an item can carry it tomorrow.
    int penetration = 0;
    int unitValue = 10; // relative priority: mages weigh this to avoid wasting spells on low-value chaff
    size_t size = 10;   // the REAL size — the body itself. See getPackingSize().
    // How much less room this unit takes than its real size when packed
    // (docs/CAMPAIGN_PLAN.md "SLICE 4", 4c). 0 for everything today; the
    // campaign's Formation Fighters upgrade sets it per squad, and a unit type
    // may declare its own (a giant drilled to fight shoulder to shoulder wants
    // a bigger number than a goblin). SIGNED on purpose: a negative value is a
    // unit that packs LOOSER than it is — the long-weapon case — so never
    // assume the packing size is the smaller of the two.
    int formationFighter = 0;
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
    UnitAbility _innateAbilities  = UnitAbility::None;
    UnitAbility _grantedAbilities = UnitAbility::None;
    UnitAbility _carriedAbilities = UnitAbility::None;
    UnitAbility _suppressedAbilities = UnitAbility::None;
    bool battleSummon = false;
    size_t spentMove = 0; // action recovery in ticks (archer fire), NOT terrain debt:
                          // blocks fireBow and one moveToward call per tick; special()
                          // wipes it on any tick the unit can't fire
    int _movePoints = 0;  // movement-points bank — see getMovePoints()

    int _attacksReceivedThisTurn = 0;
    int repelMalus = 0;
    Squad* _squad = nullptr;  // non-owning; nullptr = lone unit
    int  _squadId = 0;        // persistent campaign squad tag — see getSquadId()
    std::string _squadName;   // display name for the tag, e.g. for buildSquadsFromArmy
    int  _characterId = 0;    // persistent campaign character tag — see getCharacterId()
    bool _avoidsMelee = false; // hang back unless the line needs him — see getAvoidsMelee()
    int sortKey = 0; // random tiebreaker set at construction, used for render ordering
    int _cohesion      = 50; // base formation cohesion score; set by subclass or setup
    int _cohesionBonus = 0;  // per-tick tier (0-3), set by resolveEngagements, reset each tick
    UnitCategory _category = UnitCategory::Foot;
    std::vector<Weapon> _attacks;
    // The caster's ordered DEFAULT LIST — the implicit script M-22 describes.
    // Holds every roster entry; what this unit may actually cast is decided at
    // cast time against its paths and the army's school level, not here, because
    // research (M-6) and the encounter (M-19) can both move that line mid-campaign.
    std::vector<const Spell*> _spells;
    // A-7: the post-script pool, or empty for "the whole roster".
    std::vector<const Spell*> _shortlist;
    // A-6: the opening sequence's cursor — each scripted line gets ONE turn,
    // whether it fires, is skipped as worthless, or is dropped mid-channel.
    size_t _scriptCursor = 0;
    // The target the scorer chose when this channel began (A-1): re-validated
    // at completion and re-resolved if it is gone, never dereferenced blind.
    AUnit* _channelTarget = nullptr;

    // Path levels, indexed by SpellPath. Zero everywhere = not a caster.
    std::array<int, SPELL_PATH_COUNT> _pathLevels{};

    // What this unit is currently channelling, and how many ticks remain
    // (the remaining count lives in `cast`, which Battlefield already reads as
    // "is casting" and ReplayRecorder already exports).
    const Spell*     _channelSpell = nullptr;
    const SpellForm* _channelForm  = nullptr;

    // Standing spell effects this body carries (A-8, T-5). Per BATTLE, not per
    // campaign: restoreForNextBattle() REVERTS them rather than merely dropping
    // them, which is the bug T-5 closed — applyStatMod mutates the stat
    // outright, so before this a Stoneskin was permanent for the process.
    std::vector<StandingEffect> _standingEffects;
    int _holdTurns = 0;
    int _replayId = -1;

};


