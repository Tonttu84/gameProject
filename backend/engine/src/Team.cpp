#include "Battlefield.hpp"

size_t Team::pruneDeadUnits() {
    size_t corpsesLeft = 0;
    auto it = units.begin();
    while (it != units.end()) {
        if (!(*it) || !(*it)->getAlive()) {
            if (*it && !(*it)->getUndead()) ++corpsesLeft;
            it = units.erase(it);
        } else {
            ++it;
        }
    }
    return corpsesLeft;
}

size_t Team::countAlive() const {
    size_t count = 0;
    for (const auto& u : units)
        if (u && u->getAlive()) ++count;
    return count;
}

void Team::resetUnitFlags() {
    for (auto& u : units)
        if (u) { u->setCanFight(false); u->setEngagedSide(nullptr); u->setFormationSide(nullptr); u->setCohesionBonus(0); }
}

void Team::pruneEmptySquads() {
    auto it = squads.begin();
    while (it != squads.end()) {
        if (!(*it) || (*it)->aliveCount() == 0) {
            if (*it) (*it)->disband();
            it = squads.erase(it);
        } else {
            ++it;
        }
    }
}

void Team::pruneEmptyWings() {
    auto it = wings.begin();
    while (it != wings.end()) {
        if (!(*it) || (*it)->getSquads().empty()) {
            if (*it) (*it)->disband();
            it = wings.erase(it);
        } else {
            ++it;
        }
    }
}
