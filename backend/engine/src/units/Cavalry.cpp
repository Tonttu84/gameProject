#include "units/Cavalry.hpp"
#include "units/Horse.hpp"
#include "units/Soldier.hpp"
#include "Squad.hpp"

Cavalry::Cavalry(int setTeam)
: Cavalry(setTeam, std::make_unique<Soldier>(setTeam), std::make_unique<Horse>(setTeam))
{
}

Cavalry::Cavalry(int setTeam, std::unique_ptr<AUnit> rider, std::unique_ptr<AUnit> mount)
: MountedUnit(setTeam, std::move(rider), std::move(mount))
{
    printSymbol = 'C';
}

void Cavalry::onMountDeath()
{
    // Rider survives, dismounts in place — shrink to the rider-only footprint.
    setCategory(_rider->getCategory());
    size = _rider->getSize();
    _mount.reset();
    if (Squad* sq = getSquad(); sq && sq->getType() == SquadType::Cavalry)
        leaveSquad();
}

void Cavalry::onRiderDeath()
{
    // Mount survives — object becomes the loose horse in place. printSymbol
    // stands in for real graphics for now — 'H' (vs. mounted 'C') is the only
    // visible sign this transition happened until actual sprites exist.
    // looseCategory(), not getCategory() — the mount reverts to whatever it
    // is on its own (Beast by default) rather than keeping the strict
    // Mounted terrain ban that only applied while it carried a rider.
    setCategory(_mount->looseCategory());
    size = _mount->getSize();
    printSymbol = 'H';
    _rider.reset();
    setBroken(true); // panics; existing flee()/BFS path carries it off next tick
}
