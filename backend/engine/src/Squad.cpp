#include "Squad.hpp"
#include "AUnit.hpp"
#include "hex/HexGrid.hpp"
#include "Utility.hpp"
#include <algorithm>
#include <cassert>

Squad::Squad(std::string name, bool hasBanner)
    : _name(std::move(name)), _hasBanner(hasBanner) {}

// ── Membership ────────────────────────────────────────────────────────────────

void Squad::addMember(AUnit* unit) {
    if (!unit) return;
    _members.push_back(unit);
    unit->setSquad(this);
}

void Squad::removeMember(AUnit* unit) {
    if (!unit) return;
    auto it = std::find(_members.begin(), _members.end(), unit);
    if (it != _members.end()) {
        _members.erase(it);
        unit->setSquad(nullptr);
    }
    if (_leader     == unit) _leader     = nullptr;
    if (_flagBearer == unit) _flagBearer = nullptr;
}

void Squad::disband() {
    for (AUnit* m : _members)
        if (m) m->setSquad(nullptr);
    _members.clear();
    _leader     = nullptr;
    _flagBearer = nullptr;
}

bool Squad::hasMember(const AUnit* unit) const {
    return std::find(_members.begin(), _members.end(), unit) != _members.end();
}

size_t Squad::aliveCount() const {
    size_t count = 0;
    for (AUnit* m : _members)
        if (m && m->getAlive()) ++count;
    return count;
}

void Squad::pruneDeadMembers() {
    auto it = _members.begin();
    while (it != _members.end()) {
        AUnit* m = *it;
        if (!m || !m->getAlive()) {
            if (m) {
                m->setSquad(nullptr);
                if (m == _leader)     _leader     = nullptr;
                if (m == _flagBearer) { _flagBearer = nullptr; onFlagBearerDeath(); }
            }
            it = _members.erase(it);
        } else {
            ++it;
        }
    }
}

// ── Leadership ────────────────────────────────────────────────────────────────

void Squad::setLeader(AUnit* unit) {
    assert(!unit || hasMember(unit));
    _leader = unit;
}

bool Squad::hasLeader() const {
    return _leader && _leader->getAlive();
}

// ── Banner ────────────────────────────────────────────────────────────────────

void Squad::setFlagBearer(AUnit* unit) {
    assert(!unit || hasMember(unit));
    _flagBearer = unit;
}

AUnit* Squad::onFlagBearerDeath() {
    _flagBearer = nullptr;
    AUnit* best = nullptr;
    for (AUnit* m : _members) {
        if (!m || !m->getAlive() || m->getBroken()) continue;
        if (!best || m->sortsBefore(best)) best = m;
    }
    _flagBearer = best;
    return best;
}

// ── Collective morale ─────────────────────────────────────────────────────────

void Squad::updateMoraleState() {
    if (_moraleState == MoraleState::Broken) return;

    size_t alive = aliveCount();

    // Initialise peak on first tick
    if (_peakCount == 0) {
        _peakCount        = alive;
        _lastTestedAlive  = alive;
        return;
    }
    if (alive > _peakCount) _peakCount = alive; // allow for reinforcements

    bool doTest = false;

    // Casualty threshold: fire whenever alive drops by 25% of peak since last test
    if (alive < _lastTestedAlive && _peakCount > 0) {
        float dropped = static_cast<float>(_lastTestedAlive - alive)
                      / static_cast<float>(_peakCount);
        if (dropped >= CASUALTY_THRESHOLD) doTest = true;
    }

    // Shaken threshold: fire once when 40%+ of alive are broken, reset when it drops below
    if (!doTest && alive > 0) {
        size_t brokenCount = 0;
        for (AUnit* m : _members)
            if (m && m->getAlive() && m->getBroken()) ++brokenCount;

        bool shakenNow = static_cast<float>(brokenCount) / static_cast<float>(alive)
                         >= SHAKEN_THRESHOLD;
        if (shakenNow && !_shakenTested) doTest = true;
        _shakenTested = shakenNow;
    }

    if (doTest) {
        _lastTestedAlive = alive;
        if (Utility::throwDice() < Utility::throwDice()) degradeMorale();
    }
}

void Squad::degradeMorale() {
    if (_moraleState == MoraleState::Broken) return;
    _moraleState = static_cast<MoraleState>(static_cast<int>(_moraleState) + 1);
}

void Squad::improveMorale() {
    if (_moraleState == MoraleState::Confident) return;
    _moraleState = static_cast<MoraleState>(static_cast<int>(_moraleState) - 1);
}

int Squad::moraleModifier() const {
    switch (_moraleState) {
        case MoraleState::Confident: return  1;  // caller interprets as "grant reroll"
        case MoraleState::Normal:    return  0;
        case MoraleState::Scared:    return -2;
        case MoraleState::Broken:    return  0;  // squad dissolved — not applied
    }
    return 0;
}

int Squad::attemptRally() {
    // Individual-unit MoraleState not yet implemented (AUnit uses bool broken).
    // Full rally logic comes after the AUnit morale refactor (step 6 in design_squads).
    return 0;
}

// ── Movement ──────────────────────────────────────────────────────────────────

size_t Squad::totalSizePoints() const {
    size_t total = 0;
    for (AUnit* m : _members)
        if (m && m->getAlive()) total += m->getSize();
    return total;
}

bool Squad::canFitInHex(const Hex* hex) const {
    if (!hex) return false;
    // Only count the extra size members NOT already in this hex would add.
    int extra = 0;
    for (AUnit* m : _members) {
        if (!m || !m->getAlive()) continue;
        if (m->getHex() != hex)
            extra += static_cast<int>(m->getSize());
    }
    return hex->sizeUsed + extra <= Hex::CAPACITY;
}

int Squad::cohesionLevel() const {
    int total = 0, count = 0;
    for (AUnit* m : _members) {
        if (m && m->getAlive() && !m->getBroken()) {
            total += m->getCohesion();
            ++count;
        }
    }
    if (count == 0) return 0;
    int avg = total / count;
    if (avg >= COHESION_SUPER)  return 3;
    if (avg >= COHESION_HIGH)   return 2;
    if (avg >= COHESION_NORMAL) return 1;
    return 0;
}
