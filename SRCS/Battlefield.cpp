#include "../HDRS/Battlefield.hpp"
#include <algorithm>

Battlefield::Battlefield()
{
    hexGrid.buildRect(width, height);
}

void Battlefield::print()
{
    if (!window) return;
    window->clear();
    hexGrid.render(*window);
    window->display();
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
    Hex* bestHex = nullptr;

    for (const auto& enemy : enemyTeam) {
        if (!enemy || !enemy->getAlive() || !enemy->getHex()) continue;
        int d = HexGrid::distance(myCoord, enemy->getHex()->coord);
        if (d < bestDist) {
            bestDist = d;
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

int Battlefield::moveAUnit(AUnit& unit, HexCoord target)
{
    Hex* tgt = hexGrid.getHex(target);
    if (!hexAcceptsUnit(tgt, unit)) return 1;

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

    // Pick the passable neighbor that reduces distance to target the most
    int bestDist = HexGrid::distance(from, to);
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

    if (bestDir >= 0)
        moveAUnit(unit, hexGrid.neighborCoord(from, static_cast<HexDirection>(bestDir)));
}

void Battlefield::flee(std::unique_ptr<AUnit>& unit)
{
    if (!unit->getAlive()) return;
    if (unit->getFatigue() > 100) { unit->recover(); return; }

    Hex* myHex = unit->getHex();
    if (!myHex) return;
    HexCoord c = myHex->coord;

    if (c.q == 0 || c.q == width - 1 || c.r == 0 || c.r == height - 1) {
        std::cout << "A soldier fled the battlefield and turns to banditry\n";
        unit->setAlive(false);
        return;
    }

    // Red team flees east, blue team flees west
    HexDirection fleeDir = (unit->getTeam() == REDTEAM) ? HexDirection::E : HexDirection::W;
    int base = static_cast<int>(fleeDir);
    for (int delta : {0, 1, -1, 2, -2, 3}) {
        HexDirection d = static_cast<HexDirection>((base + delta + 6) % 6);
        HexCoord nc = hexGrid.neighborCoord(c, d);
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

void Battlefield::moveTeam(std::vector<std::unique_ptr<AUnit>>& team)
{
    for (auto& unit : team) {
        if (!unit || !unit->getAlive()) continue;
        AUnit& u = *unit;

        if (u.getBroken()) {
            flee(unit);
            continue;
        }
        if (u.getFatigue() >= 100 || u.getCast() > 0
            || (u.getFatigue() > 30 && !u.getEngaged(*this))) {
            u.recover();
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

void Battlefield::loadArmies(Army red, Army blue)
{
    teamRED  = std::move(red);
    teamBLUE = std::move(blue);
}

static void assignFighters(const std::vector<AUnit*>& units, HexSide* side) {
    std::vector<AUnit*> normal, brokenOnes;
    for (AUnit* u : units) {
        if (!u || !u->getAlive() || u->getCanFight()) continue;
        if (u->getBroken()) brokenOnes.push_back(u);
        else                normal.push_back(u);
    }

    auto bySize = [](const AUnit* a, const AUnit* b) {
        return a->getSize() > b->getSize();
    };
    std::sort(normal.begin(),    normal.end(),    bySize);
    std::sort(brokenOnes.begin(), brokenOnes.end(), bySize);
    normal.insert(normal.end(), brokenOnes.begin(), brokenOnes.end());

    int total = 0;
    for (AUnit* u : normal) {
        if (total >= HexSide::FRONTAGE) break;
        u->setCanFight(true);
        u->setEngagedSide(side);
        total += static_cast<int>(u->getSize());
    }
}

void Battlefield::resolveEngagements() {
    for (auto& u : teamRED)  if (u) { u->setCanFight(false); u->setEngagedSide(nullptr); }
    for (auto& u : teamBLUE) if (u) { u->setCanFight(false); u->setEngagedSide(nullptr); }

    for (HexSide& side : hexGrid.getSides()) {
        if (!side.hexA || !side.hexB) continue;

        // Only engage sides where both hexes have living units of opposing teams
        int teamA = 0, teamB = 0;
        for (AUnit* u : side.hexA->units) if (u && u->getAlive()) { teamA = u->getTeam(); break; }
        for (AUnit* u : side.hexB->units) if (u && u->getAlive()) { teamB = u->getTeam(); break; }
        if (teamA == 0 || teamB == 0 || teamA == teamB) continue;

        assignFighters(side.hexA->units, &side);
        assignFighters(side.hexB->units, &side);
    }
}

bool Battlefield::tick()
{
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
    for (auto& unit : teamRED)
        if (unit && unit->getFatigue() < 100 && unit->getAlive())
            unit->special();

    for (auto& unit : teamBLUE)
        if (unit && unit->getFatigue() < 100 && unit->getAlive())
            unit->special();
}

size_t Battlefield::getCorpses()      { return corpses; }
void   Battlefield::setCorpses(size_t c) { corpses = c; }
