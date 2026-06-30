#include "units/MountedUnit.hpp"
#include "Utility.hpp"
#include <algorithm>

MountedUnit::MountedUnit(int setTeam, std::unique_ptr<AUnit> rider, std::unique_ptr<AUnit> mount)
: AUnit(setTeam), _rider(std::move(rider)), _mount(std::move(mount))
{
    setCategory(UnitCategory::Mounted);
    // Hex capacity/frontage/random-target-weight all use getSize() directly —
    // a mounted rider doesn't take more ground space than the horse alone,
    // so only the mount's size counts here. The mount-vs-rider split for
    // *which part* actually takes a confirmed hit (pickMountTarget()) still
    // weighs both _rider->getSize() and _mount->getSize() independently —
    // that's a separate, more detailed roll, not affected by this.
    size = _mount->getSize();
}

AUnit* MountedUnit::effectTarget()
{
    if (hasRider()) return _rider.get();
    if (hasMount()) return _mount.get();
    return this;
}

const AUnit* MountedUnit::effectTarget() const
{
    if (hasRider()) return _rider.get();
    if (hasMount()) return _mount.get();
    return this;
}

int  MountedUnit::getHp() const        { return effectTarget()->getHp(); }
int  MountedUnit::getmaxHP() const     { return effectTarget()->getmaxHP(); }
int  MountedUnit::getArmour() const    { return effectTarget()->getArmour(); }
int  MountedUnit::getDefence() const   { return effectTarget()->getDefence(); }
int  MountedUnit::getAttackPWR() const { return effectTarget()->getAttackPWR(); }
void MountedUnit::heal(int value)      { effectTarget()->heal(value); }
bool MountedUnit::getBroken() const    { return effectTarget()->getBroken(); }
void MountedUnit::setBroken(bool value){ effectTarget()->setBroken(value); }

bool MountedUnit::pickMountTarget(int shift) const
{
    int mountSize = static_cast<int>(_mount->getSize());
    int riderSize = static_cast<int>(_rider->getSize());
    int boundary  = std::clamp(mountSize - shift, 1, mountSize + riderSize - 1);
    int roll      = Utility::getRandom(1, mountSize + riderSize);
    return roll <= boundary;
}

void MountedUnit::syncTacticalState(AUnit& sub)
{
    sub.setEngagedSide(engagedSide);
    sub.setCohesionBonus(_cohesionBonus);
    sub.syncCurrentHex(currentHex);
}

int MountedUnit::defend(int AttackAttempt, int damage, ArmorPen pen, int attackerReach, bool repelCounter)
{
    if (hasMount() && hasRider() && pickMountTarget(attackerReach)) {
        syncTacticalState(*_mount);
        int dealt = _mount->defend(AttackAttempt, damage, pen, 0, repelCounter);
        if (!_mount->getAlive()) onMountDeath();
        return dealt;
    }
    if (hasRider()) {
        syncTacticalState(*_rider);
        int dealt = _rider->defend(AttackAttempt, damage, pen, attackerReach, repelCounter);
        if (!_rider->getAlive()) {
            if (hasMount()) onRiderDeath();
            else            setAlive(false); // no mount left either — composite is fully dead
        }
        return dealt;
    }
    if (hasMount()) {
        syncTacticalState(*_mount);
        int dealt = _mount->defend(AttackAttempt, damage, pen, 0, repelCounter);
        if (!_mount->getAlive()) setAlive(false); // rider already gone — composite is fully dead
        return dealt;
    }
    return 0;
}

std::vector<AUnit*> MountedUnit::repelParts()
{
    std::vector<AUnit*> parts;
    if (hasRider()) { syncTacticalState(*_rider); parts.push_back(_rider.get()); }
    if (hasMount()) { syncTacticalState(*_mount); parts.push_back(_mount.get()); }
    return parts;
}

int MountedUnit::takeDamage(int amount, ArmorPen pen)
{
    if (hasMount() && hasRider() && pickMountTarget(RANGED_RIDER_BIAS)) {
        syncTacticalState(*_mount);
        int dealt = _mount->takeDamage(amount, pen);
        if (!_mount->getAlive()) onMountDeath();
        return dealt;
    }
    if (hasRider()) {
        syncTacticalState(*_rider);
        int dealt = _rider->takeDamage(amount, pen);
        if (!_rider->getAlive()) {
            if (hasMount()) onRiderDeath();
            else            setAlive(false);
        }
        return dealt;
    }
    if (hasMount()) {
        syncTacticalState(*_mount);
        int dealt = _mount->takeDamage(amount, pen);
        if (!_mount->getAlive()) setAlive(false);
        return dealt;
    }
    return 0;
}

void MountedUnit::battle(Battlefield& myBattlefield)
{
    if (!getCanFight() || !getHex()) return;
    if (getFatigue() > FATIGUE_MAX) { recover(); return; }

    int  attackBonus  = computeMeleeAttackBonus();
    bool riderAttacked = false;

    if (hasRider() && _rider->hasAttacks()) {
        AUnit* target = find_target(myBattlefield);
        if (target) { _rider->attackWithWeapons(target, attackBonus); riderAttacked = true; }
    }
    if (hasMount() && _mount->hasAttacks()) {
        AUnit* target = find_target(myBattlefield);
        if (target) _mount->attackWithWeapons(target, attackBonus);
    }
    if (riderAttacked) increaseFatigue();
}

void MountedUnit::resetAttacksReceived()
{
    AUnit::resetAttacksReceived();
    if (_rider) _rider->resetAttacksReceived();
    if (_mount) _mount->resetAttacksReceived();
}

void MountedUnit::resetRepelMalus()
{
    AUnit::resetRepelMalus();
    if (_rider) _rider->resetRepelMalus();
    if (_mount) _mount->resetRepelMalus();
}
