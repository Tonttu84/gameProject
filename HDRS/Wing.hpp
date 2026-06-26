#pragma once

#include <string>
#include <vector>

class Squad; // forward declare — Wing does not include Squad.hpp

// ─── Wing ────────────────────────────────────────────────────────────────────
// Placeholder skeleton. A Wing groups Squads under a wing commander.
// The pointer chain is: AUnit → Squad → Wing → (Army, future)
//
// Currently only holds squads and a name so the ptr logic is in place.
// Full implementation comes after Squad is working:
//   - Wing commander (AUnit*) with order generation
//   - Wing-level morale state
//   - Wing-scoped orders budget
//
// Ownership: Wing is owned by Battlefield (vector<unique_ptr<Wing>>).
// Squad holds a non-owning Wing* back-pointer (set by Wing::addSquad / removeSquad).
// Protocol mirrors Squad ↔ AUnit: addSquad sets the back-ptr, removeSquad clears it,
// disband() must be called before destroying the Wing.
class Wing {
public:
    explicit Wing(std::string name);

    const std::string& getName() const { return _name; }

    void addSquad(Squad* squad);     // sets squad->setWing(this)
    void removeSquad(Squad* squad);  // clears squad->setWing(nullptr)
    void disband();                  // removeSquad on all; call before destruction

    const std::vector<Squad*>& getSquads() const { return _squads; }

private:
    std::string          _name;
    std::vector<Squad*>  _squads;  // non-owning
};
