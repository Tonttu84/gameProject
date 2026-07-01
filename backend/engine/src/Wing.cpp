#include "Wing.hpp"
#include "Squad.hpp"
#include <algorithm>

Wing::Wing(std::string name) : _name(std::move(name)) {}

void Wing::addSquad(Squad* squad) {
    if (!squad) return;
    _squads.push_back(squad);
    squad->setWing(this);
}

void Wing::removeSquad(Squad* squad) {
    if (!squad) return;
    auto it = std::find(_squads.begin(), _squads.end(), squad);
    if (it != _squads.end()) {
        _squads.erase(it);
        squad->setWing(nullptr);
    }
}

void Wing::disband() {
    for (Squad* s : _squads)
        if (s) s->setWing(nullptr);
    _squads.clear();
}
