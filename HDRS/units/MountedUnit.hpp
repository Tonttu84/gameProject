#pragma once

#include "AUnit.hpp"
#include <memory>

// Abstract base for any unit composed of a rider and a mount: two genuinely
// separate, independently-statted AUnits (constructed from real unit types,
// e.g. a Soldier and a Horse — never hand-typed/duplicated stats) where
// either part can die out from under the other.
//
// Every incoming attack first rolls which part is hit (see
// pickMountTarget()), then runs a completely ordinary, unmodified
// defend()/takeDamage() against whichever part was picked — own defence,
// own armour, own shield checks, own morale test. Nothing is pre-resolved
// then split.
//
// This object is itself placed in Hex::units (one slot for the whole
// composite); _rider/_mount are never independently placed in the grid.
// Stat getters and heal() delegate to effectTarget() (the rider, by
// default) so any existing or future single-target effect that calls
// unit->getHp()/heal()/etc. works correctly on a MountedUnit without needing
// its own special case. getCategory()/getSize()/getAlive() stay at this
// level (they describe the composite's battlefield presence, not an
// individual part) and are updated explicitly by onMountDeath()/
// onRiderDeath() when a part dies.
class MountedUnit : public AUnit
{
public:
    MountedUnit(int setTeam, std::unique_ptr<AUnit> rider, std::unique_ptr<AUnit> mount);
    ~MountedUnit() override = default;

    bool hasRider() const { return _rider && _rider->getAlive(); }
    bool hasMount() const { return _mount && _mount->getAlive(); }

    AUnit*       effectTarget() override;
    const AUnit* effectTarget() const override;

    int  getHp() const override;
    int  getmaxHP() const override;
    int  getArmour() const override;
    int  getDefence() const override;
    int  getAttackPWR() const override;
    void heal(int value) override;

    // Whether the *composite* is broken (and so should flee) is the rider's
    // call by default — a scared rider turns the mount around regardless of
    // the mount's own temperament. Once the rider is gone, this naturally
    // falls through to the mount instead (effectTarget()). What happens when
    // only the *mount* panics while the rider is still in control is a
    // separate, not-yet-decided question — see [[design_mounted_units]].
    bool getBroken() const override;
    void setBroken(bool value) override;

    int defend(int AttackAttempt, int damage, ArmorPen pen = ArmorPen::Normal,
               int attackerReach = 0) override;
    int takeDamage(int amount, ArmorPen pen = ArmorPen::Normal) override;

    // Rider attacks normally, then — if the mount carries its own weapon
    // (e.g. a Warhorse's hoof, unlike a plain unarmed Horse) — the mount
    // attacks too, both via this object's own engagement context (neither
    // sub-unit has a hex/engagedSide of its own while stowed).
    void battle(Battlefield& myBattlefield) override;

    // Team::resetUnitFlags()/the per-tick reset loop only ever reaches units
    // in Team::units; _rider/_mount are stowed inside this object and
    // invisible to that loop, so their MULTI_ATTACK_DEFENCE_PENALTY counters
    // must be forwarded here or they'd never reset.
    void resetAttacksReceived() override;

protected:
    // Mount died, rider survives. Subclass decides what a riderless rider
    // becomes (e.g. dismounts to plain infantry in place).
    virtual void onMountDeath() = 0;

    // Rider died, mount survives. Subclass decides what a riderless mount
    // does (e.g. panics and flees; a different mount type might keep
    // fighting instead).
    virtual void onRiderDeath() = 0;

    std::unique_ptr<AUnit> _rider;
    std::unique_ptr<AUnit> _mount;

private:
    // True = mount is the target of this hit. `shift` moves the hit-roll
    // boundary toward the rider (positive) or mount (negative); 0 reproduces
    // pure size-weighting. Shared by defend()/takeDamage() so the roll logic
    // lives in exactly one place.
    bool pickMountTarget(int shift) const;

    // Copies this tick's tactical context (engagement side, cohesion tier)
    // from self onto `sub` before delegating a hit/attack to it — neither
    // sub-unit is itself in Hex::units/Team::units, so resolveEngagements()
    // never sets these on them directly.
    void syncTacticalState(AUnit& sub);
};
