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
    // Mount survives — object becomes the loose horse in place.
    setCategory(_mount->getCategory());
    size = _mount->getSize();
    _rider.reset();
    setBroken(true); // panics; existing flee()/BFS path carries it off next tick
}
