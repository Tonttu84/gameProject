#include "../HDRS/Battlefield.hpp"
#include "../HDRS/RangedCombat.hpp"
#include <algorithm>
#include <unordered_map>

Battlefield::Battlefield()
{
    hexGrid.buildRect(width, height);
}

void Battlefield::printText(int turn) const
{
    if (turn >= 0) std::cout << "--- turn " << turn << " ---\n";
    for (int r = 0; r < height; ++r) {
        if (r % 2 == 1) std::cout << "  ";
        for (int q = 0; q < width; ++q) {
            const Hex* h = hexGrid.getHex({q, r});
            int aliveR = 0, aliveB = 0;
            if (h) {
                for (const AUnit* u : h->units)
                    if (u && u->getAlive())
                        (u->getTeam() == REDTEAM ? aliveR : aliveB)++;
            }
            int total = aliveR + aliveB;
            if (total == 0) {
                std::cout << ".. ";
            } else {
                char t = (aliveR > 0) ? 'R' : 'B';
                if (total < 10) std::cout << t << ' ' << total << ' ';
                else            std::cout << t << total << ' ';
            }
        }
        std::cout << '\n';
    }
    std::cout << '\n';
}

size_t Battlefield::countTeam(const int team) const
{
    size_t count = 0;
    const auto& t = (team == REDTEAM) ? teamRED : teamBLUE;
    for (const auto& u : t)
        if (u && u->getAlive()) ++count;
    return count;
}

Hex* Battlefield::findTarget(const AUnit& searcher) const
{
    if (!searcher.getHex()) return nullptr;
    HexCoord myCoord = searcher.getHex()->coord;

    const auto& enemyTeam = (searcher.getTeam() == REDTEAM) ? teamBLUE : teamRED;
    int bestDist = std::numeric_limits<int>::max();
    int bestKey  = std::numeric_limits<int>::max();
    Hex* bestHex = nullptr;

    for (const auto& enemy : enemyTeam) {
        if (!enemy || !enemy->getAlive() || !enemy->getHex()) continue;
        int d = HexGrid::distance(myCoord, enemy->getHex()->coord);
        if (d < bestDist || (d == bestDist && enemy->getSortKey() < bestKey)) {
            bestDist = d;
            bestKey  = enemy->getSortKey();
            bestHex  = enemy->getHex();
        }
    }
    return bestHex;
}

static bool hexAcceptsUnit(const Hex* hex, const AUnit& unit) {
    if (!hex) return false;
    if (hex->sizeUsed + static_cast<int>(unit.getSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : hex->units)
        if (u && u->getAlive() && u->getTeam() != unit.getTeam()) return false;
    return true;
}

// Returns true if moving to nc would keep the unit adjacent to at least one live enemy.
static bool wouldRemainEngaged(const AUnit& unit, HexCoord nc, HexGrid& hexGrid) {
    for (const HexCoord& nc2 : hexGrid.neighbors(nc)) {
        Hex* nh = hexGrid.getHex(nc2);
        if (!nh) continue;
        for (AUnit* u2 : nh->units)
            if (u2 && u2->getAlive() && u2->getTeam() != unit.getTeam())
                return true;
    }
    return false;
}

int Battlefield::moveAUnit(AUnit& unit, HexCoord target)
{
    Hex* tgt = hexGrid.getHex(target);
    if (!hexAcceptsUnit(tgt, unit)) return 1;

    unit.addFatigue(unit.getFatigueCost() / 2);
    unit.reset();
    unit.setHex(tgt);
    return 0;
}

void Battlefield::moveToward(std::unique_ptr<AUnit>& unitPtr, const Hex* target)
{
    AUnit& unit = *unitPtr;
    if (!target || !unit.getHex()) return;
    if (unit.getSpentMove()) {
        unit.setSpentMove(unit.getSpentMove() - 1);
        return;
    }

    HexCoord from = unit.getHex()->coord;
    HexCoord to   = target->coord;
    if (from == to) return;

    int curDist = HexGrid::distance(from, to);

    // Pass 1: pick the passable neighbor that closes distance the most
    int bestDist = curDist;
    int bestDir  = -1;
    for (int i = 0; i < 6; ++i) {
        HexCoord nc = hexGrid.neighborCoord(from, static_cast<HexDirection>(i));
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        int d = HexGrid::distance(nc, to);
        if (d < bestDist) {
            bestDist = d;
            bestDir  = i;
        }
    }
    if (bestDir >= 0) {
        moveAUnit(unit, hexGrid.neighborCoord(from, static_cast<HexDirection>(bestDir)));
        return;
    }

    // Pass 2: forward is blocked — try a lateral move (same distance to target).
    // Non-engaged units maneuver around the jam.
    // Engaged + crowded units may expand frontage if they'd stay in contact.
    bool engaged = unit.getEngaged(*this);
    // Expand frontage if the hex has 40+ size-points. Stops naturally when
    // sizeUsed drops below 400, keeping ~39 units on the line.
    bool crowded = unit.getHex()->sizeUsed >= CROWDED_THRESHOLD;

    for (int i = 0; i < 6; ++i) {
        HexCoord nc = hexGrid.neighborCoord(from, static_cast<HexDirection>(i));
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        if (HexGrid::distance(nc, to) != curDist) continue;

        if (!engaged || (crowded && wouldRemainEngaged(unit, nc, hexGrid))) {
            moveAUnit(unit, nc);
            return;
        }
    }
}

void Battlefield::flee(std::unique_ptr<AUnit>& unit)
{
    if (!unit->getAlive()) return;
    if (unit->getFatigue() > FATIGUE_MAX) { unit->recover(); return; }

    Hex* myHex = unit->getHex();
    if (!myHex) return;
    HexCoord c = myHex->coord;

    if (c.q == 0 || c.q == width - 1 || c.r == 0 || c.r == height - 1) {
        std::cout << "A soldier fled the battlefield and turns to banditry\n";
        unit->setAlive(false);
        return;
    }

    // SE and SW both reduce distance to Red's back edge equally (dr=+1 each); pick randomly
    // so the path zigzags instead of going straight. Same logic for Blue (NW/NE).
    // If the random path drifts to a flank edge the boundary check above removes the unit.
    static const HexDirection RED_FLEE[6]  = { HexDirection::SE, HexDirection::SW,
                                               HexDirection::E,  HexDirection::W,
                                               HexDirection::NE, HexDirection::NW };
    static const HexDirection BLUE_FLEE[6] = { HexDirection::NW, HexDirection::NE,
                                               HexDirection::W,  HexDirection::E,
                                               HexDirection::SW, HexDirection::SE };
    const HexDirection* dirs = (unit->getTeam() == REDTEAM) ? RED_FLEE : BLUE_FLEE;
    bool swap = Utility::getRandom(0, 1) == 0;
    for (int i = 0; i < 6; ++i) {
        int idx = (i < 2 && swap) ? (1 - i) : i;
        HexCoord nc = hexGrid.neighborCoord(c, dirs[idx]);
        Hex* next = hexGrid.getHex(nc);
        if (hexAcceptsUnit(next, *unit)) {
            moveAUnit(*unit, nc);
            return;
        }
    }
    unit->rally();
}

void Battlefield::moveUnits()
{
    moveTeam(teamRED);
    moveTeam(teamBLUE);
}

void Battlefield::swapOut(std::unique_ptr<AUnit>& unitPtr)
{
    AUnit& unit = *unitPtr;
    if (!unit.getHex()) return;

    Hex* target = findTarget(unit);
    if (!target) return;

    HexCoord from = unit.getHex()->coord;
    HexCoord to   = target->coord;
    int curDist   = HexGrid::distance(from, to);

    for (int i = 0; i < 6; ++i) {
        HexCoord nc = hexGrid.neighborCoord(from, static_cast<HexDirection>(i));
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        if (HexGrid::distance(nc, to) > curDist) {
            moveAUnit(unit, nc);
            return;
        }
    }
}

// Move one hex away from the nearest enemy. hexAcceptsUnit returning false
// for off-map hexes means the unit naturally can't retreat beyond the edge.
void Battlefield::retreatToRange(std::unique_ptr<AUnit>& unitPtr)
{
    AUnit& unit = *unitPtr;
    if (!unit.getHex()) return;

    Hex* enemyHex = findTarget(unit);
    if (!enemyHex) return;

    HexCoord from   = unit.getHex()->coord;
    HexCoord to     = enemyHex->coord;
    int      curDist = HexGrid::distance(from, to);

    int bestDist = curDist;
    int bestDir  = -1;
    for (int i = 0; i < 6; ++i) {
        HexCoord nc = hexGrid.neighborCoord(from, static_cast<HexDirection>(i));
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        int d = HexGrid::distance(nc, to);
        if (d > bestDist) { bestDist = d; bestDir = i; }
    }
    if (bestDir >= 0)
        moveAUnit(unit, hexGrid.neighborCoord(from, static_cast<HexDirection>(bestDir)));
    // If no retreat hex is available the unit holds its position.
}

void Battlefield::moveTeam(std::vector<std::unique_ptr<AUnit>>& team)
{
    for (auto& unit : team) {
        if (!unit || !unit->getAlive()) continue;
        AUnit& u = *unit;

        if (u.getMovementSpeed() == 0) continue; // immobile unit — never moves

        if (u.getBroken()) {
            flee(unit);
            continue;
        }
        if (u.getFatigue() >= 100 || u.getCast() > 0) continue; // exhausted or casting

        // Ranged units (archers, mages, necromancers) maintain a preferred
        // distance. preferredRange > 1 means they back away when enemies
        // close in and hold position once at the right distance, rather than
        // advancing into melee. Falls through to normal melee logic when
        // preferredRange drops to 0 or 1 (e.g. archer out of ammo).
        int pref = u.getPreferredRange();
        if (pref > 1) {
            Hex* enemyHex = findTarget(u);
            if (enemyHex) {
                int dist = HexGrid::distance(u.getHex()->coord, enemyHex->coord);
                if (dist < pref)
                    retreatToRange(unit);   // too close — back away
                else if (dist > pref)
                    moveToward(unit, enemyHex); // too far — close to preferred range
                // dist == pref: hold position
            }
            continue;
        }

        // Fatigued units adjacent to enemies hold position as reserves — assignment
        // handles rotation within the hex each tick (fresh units fight, fatigued ones
        // step back to support without leaving the hex).
        if (u.getEngaged(*this) && u.getFatigue() > SWAPFATIGUE) {
            continue;
        }

        Hex* target = findTarget(u);
        if (!target) continue;
        moveToward(unit, target);
    }
}

void Battlefield::makeBattle()
{
    auto red  = teamRED.begin();
    auto blue = teamBLUE.begin();

    while (red != teamRED.end() || blue != teamBLUE.end()) {
        if (red != teamRED.end()
            && ((Utility::getRandom(1, 2) == 1) || blue == teamBLUE.end())) {
            (*red)->battle(*this);
            ++red;
        } else if (blue != teamBLUE.end()) {
            (*blue)->battle(*this);
            ++blue;
        }
    }
}

void Battlefield::cleanup()
{
    auto it = teamBLUE.begin();
    while (it != teamBLUE.end()) {
        if (!(*it) || !(*it)->getAlive()) {
            if (*it && !(*it)->getUndead()) ++corpses;
            it = teamBLUE.erase(it);
        } else {
            ++it;
        }
    }
    auto ir = teamRED.begin();
    while (ir != teamRED.end()) {
        if (!(*ir) || !(*ir)->getAlive())
            ir = teamRED.erase(ir);
        else
            ++ir;
    }
}

std::vector<std::unique_ptr<AUnit>>& Battlefield::getTeam(int team)
{
    if (team == BLUETEAM) return teamBLUE;
    if (team == REDTEAM)  return teamRED;
    throw std::runtime_error("getTeam: invalid team");
}

void Battlefield::reset()
{
    // Survivors had restoreForNextBattle() called (which unlinks them from hexes).
    // Dead units' destructors already cleaned their hexes during cleanup().
    // This call handles any residual pointers and resets state.
    hexGrid.clearUnits();
    teamRED.clear();
    teamBLUE.clear();
    corpses = 0;
}

void Battlefield::loadArmies(Army red, Army blue)
{
    teamRED  = std::move(red);
    teamBLUE = std::move(blue);
}

void Battlefield::resolveEngagements() {
    for (auto& u : teamRED)  if (u) { u->setCanFight(false); u->setEngagedSide(nullptr); }
    for (auto& u : teamBLUE) if (u) { u->setCanFight(false); u->setEngagedSide(nullptr); }
    for (HexSide& side : hexGrid.getSides()) side.engaged = false;

    // Mark sides where both hexes hold opposing living units
    for (HexSide& side : hexGrid.getSides()) {
        if (!side.hexA || !side.hexB) continue;
        int teamA = 0, teamB = 0;
        for (AUnit* u : side.hexA->units) if (u && u->getAlive()) { teamA = u->getTeam(); break; }
        for (AUnit* u : side.hexB->units) if (u && u->getAlive()) { teamB = u->getTeam(); break; }
        if (teamA == 0 || teamB == 0 || teamA == teamB) continue;
        side.engaged = true;
    }

    // Group each hex's engaged sides together for round-robin assignment
    std::unordered_map<Hex*, std::vector<HexSide*>> hexSides;
    for (HexSide& side : hexGrid.getSides()) {
        if (!side.engaged) continue;
        hexSides[side.hexA].push_back(&side);
        hexSides[side.hexB].push_back(&side);
    }

    // Per hex: assign fighters round-robin so each side gets one unit before any
    // side gets a second. Fresh units (fatigue < SWAPFATIGUE) go first; fatigued
    // units extend the same pool so the round-robin cursor never resets between
    // the two tiers. This guarantees e.g. 3 units across 4 sides → 1,1,1,0 not 2,1,0,0.
    auto bySize = [](const AUnit* a, const AUnit* b) {
        if (a->getBroken() != b->getBroken()) return !a->getBroken();
        if (a->getSize() != b->getSize()) return a->getSize() > b->getSize();
        return a->getSortKey() < b->getSortKey();
    };

    for (auto& [hex, sides] : hexSides) {
        // Build pool: fresh (normal→broken, size desc) then tired (same order).
        std::vector<AUnit*> fresh, tired;
        for (AUnit* u : hex->units) {
            if (!u || !u->getAlive()) continue;
            (u->getFatigue() < SWAPFATIGUE ? fresh : tired).push_back(u);
        }
        std::sort(fresh.begin(), fresh.end(), bySize);
        std::sort(tired.begin(), tired.end(), bySize);
        fresh.insert(fresh.end(), tired.begin(), tired.end());  // one continuous pool

        std::vector<int> frontage(sides.size(), 0);
        size_t ui = 0;
        while (ui < fresh.size()) {
            bool anyAssigned = false;
            for (size_t si = 0; si < sides.size() && ui < fresh.size(); ++si) {
                if (frontage[si] >= HexSide::FRONTAGE) continue;
                AUnit* u = fresh[ui++];
                u->setCanFight(true);
                u->setEngagedSide(sides[si]);
                frontage[si] += static_cast<int>(u->getSize());
                anyAssigned = true;
            }
            if (!anyAssigned) break;
        }
    }
}

bool Battlefield::tick()
{
    // Passive fatigue recovery — all alive units recover each tick regardless of action
    for (auto& u : teamRED)  if (u && u->getAlive()) u->recover();
    for (auto& u : teamBLUE) if (u && u->getAlive()) u->recover();

    triggerSpecialPhase();
    moveUnits();
    resolveEngagements();
    makeBattle();
    cleanup();
    return countTeam(REDTEAM) > 0 && countTeam(BLUETEAM) > 0;
}

BattleResult Battlefield::extractResult()
{
    BattleResult result;
    result.corpses = corpses;
    result.winner  = (countTeam(REDTEAM) > 0) ? REDTEAM :
                     (countTeam(BLUETEAM) > 0) ? BLUETEAM : 0;

    for (auto& unit : teamRED)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.redSurvivors.push_back(std::move(unit));

    for (auto& unit : teamBLUE)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.blueSurvivors.push_back(std::move(unit));

    teamRED.clear();
    teamBLUE.clear();
    return result;
}

void Battlefield::triggerSpecialPhase()
{
    // Reset the ranged-combat slot cache once per phase so every hex's unit
    // list is rebuilt fresh from current occupants.
    RangedCombat::resetCache();

    for (auto& unit : teamRED)
        if (unit && unit->getFatigue() < FATIGUE_MAX && unit->getAlive())
            unit->special();

    for (auto& unit : teamBLUE)
        if (unit && unit->getFatigue() < FATIGUE_MAX && unit->getAlive())
            unit->special();
}

size_t Battlefield::getCorpses()      { return corpses; }
void   Battlefield::setCorpses(size_t c) { corpses = c; }
