#include "../HDRS/Battlefield.hpp"
#include "../HDRS/RangedCombat.hpp"
#include <algorithm>
#include <climits>
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
    const auto& t = (team == REDTEAM) ? _red.units : _blue.units;
    for (const auto& u : t)
        if (u && u->getAlive()) ++count;
    return count;
}

Hex* Battlefield::findTarget(const AUnit& searcher) const
{
    if (!searcher.getHex()) return nullptr;
    HexCoord myCoord = searcher.getHex()->coord;

    const auto& enemyTeam = (searcher.getTeam() == REDTEAM) ? _blue.units : _red.units;
    int bestDist = std::numeric_limits<int>::max();
    const AUnit* bestEnemy = nullptr;
    Hex* bestHex = nullptr;

    for (const auto& enemy : enemyTeam) {
        if (!enemy || !enemy->getAlive() || !enemy->getHex()) continue;
        int d = HexGrid::distance(myCoord, enemy->getHex()->coord);
        if (d < bestDist || (d == bestDist && enemy->sortsBefore(bestEnemy))) {
            bestDist  = d;
            bestEnemy = enemy.get();
            bestHex   = enemy->getHex();
        }
    }
    return bestHex;
}

static bool hexAcceptsUnit(const Hex* hex, const AUnit& unit) {
    if (!hex || hex->impassable) return false;
    if (hex->sizeUsed + static_cast<int>(unit.getSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : hex->units)
        if (u && u->getAlive() && u->getTeam() != unit.getTeam()) return false;
    // Mounted cannot enter Forest or Marsh
    UnitCategory cat = unit.getCategory();
    if (cat == UnitCategory::Mounted) {
        if (hex->terrain == TerrainType::Forest || hex->terrain == TerrainType::Marsh)
            return false;
    }
    return true;
}

// True if the unit can cross this hexside (considers blocked flag and elevation cliffs).
static bool sidePassable(const HexSide* side, UnitCategory cat) {
    if (!side || cat == UnitCategory::Flyer) return true;
    if (side->blocked) return false;
    // Auto-cliff: elevation difference >= 2 between adjacent hexes
    if (side->hexA && side->hexB &&
        std::abs(side->hexA->elevation - side->hexB->elevation) >= 2)
        return false;
    return true;
}

// Ticks required to fully enter dest (1 = one tick = no debt).
// Caller must verify the side is passable before calling.
static int terrainMoveCost(const Hex* dest, const HexSide* side, UnitCategory cat) {
    if (!dest) return 1;
    int cost;
    switch (dest->terrain) {
        case TerrainType::Forest: cost = TERRAIN_COST_FOREST; break;
        case TerrainType::Marsh:
            cost = (cat == UnitCategory::Beast || cat == UnitCategory::Skirmisher)
                   ? 2 : TERRAIN_COST_MARSH;
            break;
        case TerrainType::Rubble: cost = TERRAIN_COST_RUBBLE; break;
        default:                  cost = TERRAIN_COST_OPEN;   break;
    }
    // Climbing a slope adds one extra tick
    if (side && side->hexA && side->hexB) {
        const Hex* from = (side->hexA == dest) ? side->hexB : side->hexA;
        if (dest->elevation > from->elevation)
            cost += TERRAIN_COST_SLOPE;
    }
    return cost;
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

    const Hex* fromHex = unit.getHex();
    if (fromHex == target) return;

    bool mounted = (unit.getCategory() == UnitCategory::Mounted);
    bool flyer   = (unit.getCategory() == UnitCategory::Flyer);

    int curDist = flyer ? HexGrid::distance(fromHex->coord, target->coord)
                        : hexGrid.bfsDistance(fromHex, target, mounted);
    if (curDist <= 0 || curDist == HexGrid::UNREACHABLE) return;

    // If the unit took a lateral last turn it must decrease distance this turn.
    bool mustDecrease = unit.getTookLateral();

    HexCoord from = fromHex->coord;

    // Track the best strictly-decreasing candidate and the best lateral candidate
    // separately. Among equal-distance candidates, prefer the cheapest terrain.
    int bestDecrDist = curDist, bestDecrCost = INT_MAX, bestDecrDir = -1;
    int bestLatCost  = INT_MAX, bestLatDir   = -1;

    for (int i = 0; i < 6; ++i) {
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), unit.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;

        int d = flyer ? HexGrid::distance(nc, target->coord)
                      : hexGrid.bfsDistance(nh, target, mounted);
        if (d == HexGrid::UNREACHABLE) continue;

        int cost = terrainMoveCost(nh, hexGrid.getSide(from, dir), unit.getCategory());

        if (d < curDist) {
            if (d < bestDecrDist || (d == bestDecrDist && cost < bestDecrCost)) {
                bestDecrDist = d; bestDecrCost = cost; bestDecrDir = i;
            }
        } else if (d == curDist && cost < bestLatCost) {
            bestLatCost = cost; bestLatDir = i;
        }
    }

    // Prefer a decreasing move — clears the lateral flag.
    if (bestDecrDir >= 0) {
        auto dir = static_cast<HexDirection>(bestDecrDir);
        HexCoord dest = hexGrid.neighborCoord(from, dir);
        moveAUnit(unit, dest);
        int cost = terrainMoveCost(hexGrid.getHex(dest), hexGrid.getSide(from, dir),
                                   unit.getCategory());
        if (cost > 1) unit.setSpentMove(static_cast<size_t>(cost - 1));
        unit.setTookLateral(false);
        return;
    }

    // Lateral: only if not mustDecrease, and respecting engaged/crowded constraints.
    if (!mustDecrease && bestLatDir >= 0) {
        bool engaged = unit.getEngaged(*this);
        bool crowded = unit.getHex()->sizeUsed >= CROWDED_THRESHOLD;
        HexCoord latDest = hexGrid.neighborCoord(from, static_cast<HexDirection>(bestLatDir));
        if (!engaged || (crowded && wouldRemainEngaged(unit, latDest, hexGrid))) {
            auto dir = static_cast<HexDirection>(bestLatDir);
            HexCoord dest = hexGrid.neighborCoord(from, dir);
            moveAUnit(unit, dest);
            int cost = terrainMoveCost(hexGrid.getHex(dest), hexGrid.getSide(from, dir),
                                       unit.getCategory());
            if (cost > 1) unit.setSpentMove(static_cast<size_t>(cost - 1));
            unit.setTookLateral(true);
            return;
        }
    }
}

void Battlefield::flee(std::unique_ptr<AUnit>& unit)
{
    if (!unit->getAlive()) return;
    if (unit->getFatigue() > FATIGUE_MAX) { unit->recover(); return; }

    // A fleeing unit leaves its squad — it's no longer part of the formation.
    unit->leaveSquad();

    Hex* myHex = unit->getHex();
    if (!myHex) return;
    HexCoord c = myHex->coord;

    if (c.q == 0 || c.q == width - 1 || c.r == 0 || c.r == height - 1) {
        std::cout << "A soldier fled the battlefield and turns to banditry\n";
        unit->setAlive(false);
        return;
    }

    bool mounted = (unit->getCategory() == UnitCategory::Mounted);
    bool isRed   = (unit->getTeam() == REDTEAM);
    // Flyers use the ground flee table — direction-finding is the same since
    // impassable hexes are walls in both graphs and flyers can cross any hexside.
    int curFleeDist = hexGrid.fleeDistance(myHex, mounted, isRed);

    bool mustDecrease = unit->getTookLateral();

    int bestDecrFlee = curFleeDist, bestDecrCost = INT_MAX, bestDecrDir = -1;
    int bestLatCost  = INT_MAX,     bestLatDir   = -1;

    for (int i = 0; i < 6; ++i) {
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(c, dir), unit->getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(c, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, *unit)) continue;

        int d    = hexGrid.fleeDistance(nh, mounted, isRed);
        if (d == HexGrid::UNREACHABLE) continue;
        int cost = terrainMoveCost(nh, hexGrid.getSide(c, dir), unit->getCategory());

        if (d < curFleeDist) {
            if (d < bestDecrFlee || (d == bestDecrFlee && cost < bestDecrCost)) {
                bestDecrFlee = d; bestDecrCost = cost; bestDecrDir = i;
            }
        } else if (d == curFleeDist && cost < bestLatCost) {
            bestLatCost = cost; bestLatDir = i;
        }
    }

    if (bestDecrDir >= 0) {
        auto dir = static_cast<HexDirection>(bestDecrDir);
        HexCoord dest = hexGrid.neighborCoord(c, dir);
        moveAUnit(*unit, dest);
        int cost = terrainMoveCost(hexGrid.getHex(dest), hexGrid.getSide(c, dir),
                                   unit->getCategory());
        if (cost > 1) unit->setSpentMove(static_cast<size_t>(cost - 1));
        unit->setTookLateral(false);
        return;
    }

    if (!mustDecrease && bestLatDir >= 0) {
        auto dir = static_cast<HexDirection>(bestLatDir);
        HexCoord dest = hexGrid.neighborCoord(c, dir);
        moveAUnit(*unit, dest);
        int cost = terrainMoveCost(hexGrid.getHex(dest), hexGrid.getSide(c, dir),
                                   unit->getCategory());
        if (cost > 1) unit->setSpentMove(static_cast<size_t>(cost - 1));
        unit->setTookLateral(true);
        return;
    }

    unit->rally();
}

void Battlefield::moveUnits()
{
    // Squad pre-pass: squads claim their target hex before lone units move.
    for (auto& sq : _red.squads)  if (sq) moveSquad(*sq);
    for (auto& sq : _blue.squads) if (sq) moveSquad(*sq);
    moveTeam(_red);
    moveTeam(_blue);
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
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), unit.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        int d = HexGrid::distance(nc, to);
        if (d > bestDist) { bestDist = d; bestDir = i; }
    }
    if (bestDir >= 0) {
        auto     dir      = static_cast<HexDirection>(bestDir);
        HexCoord destCoord = hexGrid.neighborCoord(from, dir);
        moveAUnit(unit, destCoord);
        int cost = terrainMoveCost(hexGrid.getHex(destCoord), hexGrid.getSide(from, dir),
                                   unit.getCategory());
        if (cost > 1) unit.setSpentMove(static_cast<size_t>(cost - 1));
    }
    // If no retreat hex is available the unit holds its position.
}

void Battlefield::moveSquad(Squad& squad)
{
    // Find reference unit for navigation (leader preferred, else first alive member with hex).
    AUnit* ref = squad.hasLeader() ? squad.getLeader() : nullptr;
    if (!ref) {
        for (AUnit* m : squad.getMembers())
            if (m && m->getAlive() && !m->getBroken() && m->getHex()) { ref = m; break; }
    }
    if (!ref || !ref->getHex()) return;

    // Find enemy target and the best forward hex using BFS — same logic as moveToward.
    Hex* enemyTarget = findTarget(*ref);
    if (!enemyTarget) return;

    HexCoord from    = ref->getHex()->coord;
    bool     mounted = (ref->getCategory() == UnitCategory::Mounted);

    int curDist = hexGrid.bfsDistance(ref->getHex(), enemyTarget, mounted);
    if (curDist <= 0 || curDist == HexGrid::UNREACHABLE) return;

    bool mustDecrease  = ref->getTookLateral();
    int  bestDecrDist  = curDist, bestDecrCost = INT_MAX, bestDecrDir = -1;
    int  bestLatCost   = INT_MAX, bestLatDir   = -1;

    for (int i = 0; i < 6; ++i) {
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), ref->getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex*     nh = hexGrid.getHex(nc);
        if (!nh || nh->impassable) continue;
        if (mounted && (nh->terrain == TerrainType::Forest || nh->terrain == TerrainType::Marsh)) continue;
        bool hasEnemy = false;
        for (AUnit* u : nh->units)
            if (u && u->getAlive() && u->getTeam() != ref->getTeam()) { hasEnemy = true; break; }
        if (hasEnemy) continue;

        int d    = hexGrid.bfsDistance(nh, enemyTarget, mounted);
        if (d == HexGrid::UNREACHABLE) continue;
        int cost = terrainMoveCost(nh, hexGrid.getSide(from, dir), ref->getCategory());

        if (d < curDist) {
            if (d < bestDecrDist || (d == bestDecrDist && cost < bestDecrCost)) {
                bestDecrDist = d; bestDecrCost = cost; bestDecrDir = i;
            }
        } else if (d == curDist && cost < bestLatCost) {
            bestLatCost = cost; bestLatDir = i;
        }
    }

    int  chosenDir   = -1;
    bool tookLateral = false;
    if (bestDecrDir >= 0) {
        chosenDir = bestDecrDir;
    } else if (!mustDecrease && bestLatDir >= 0) {
        chosenDir    = bestLatDir;
        tookLateral  = true;
    }
    if (chosenDir < 0) return;

    HexCoord nextCoord = hexGrid.neighborCoord(from, static_cast<HexDirection>(chosenDir));
    Hex*     nextHex   = hexGrid.getHex(nextCoord);
    if (!nextHex) return;

    // Calculate squad's total size for alive non-broken members.
    int squadSize = 0;
    for (AUnit* m : squad.getMembers())
        if (m && m->getAlive() && !m->getBroken())
            squadSize += static_cast<int>(m->getSize());

    // Space already occupied in nextHex by squad members that happen to be there already
    // (they will "leave and re-enter" so we add them back to available space).
    int squadFootprintInNext = 0;
    for (AUnit* m : squad.getMembers())
        if (m && m->getAlive() && !m->getBroken() && m->getHex() == nextHex)
            squadFootprintInNext += static_cast<int>(m->getSize());

    int available = Hex::CAPACITY - nextHex->sizeUsed + squadFootprintInNext;

    // Displacement: only if needed and only lone (squad-less) units.
    if (available < squadSize) {
        int needed      = squadSize - available;
        int maxDisplace = static_cast<int>(squadSize * Squad::DISPLACE_FRACTION);

        // Collect displaceable lone units sorted smallest-first to minimise evictions.
        std::vector<AUnit*> candidates;
        for (AUnit* u : nextHex->units)
            if (u && u->getAlive() && !u->getSquad())
                candidates.push_back(u);
        std::sort(candidates.begin(), candidates.end(),
                  [](AUnit* a, AUnit* b){ return a->getSize() < b->getSize(); });

        Hex* fromHex = hexGrid.getHex(from);
        int  freed   = 0;
        for (AUnit* victim : candidates) {
            if (freed >= needed) break;
            int vs = static_cast<int>(victim->getSize());
            if (freed + vs > maxDisplace) break; // would exceed the displacement cap
            // Only displace if the from-hex can absorb the unit.
            if (fromHex && fromHex->sizeUsed + vs <= Hex::CAPACITY) {
                victim->setHex(fromHex);
                freed += vs;
                available += vs;
            }
        }

        if (available < squadSize) return; // still not enough room — squad holds position
    }

    // Move all alive non-broken members to nextHex. Each member's old hex is vacated
    // via setHex (which calls removeFromHex internally). Fatigue cost mirrors moveAUnit.
    HexSide* moveSide = hexGrid.getSide(from, static_cast<HexDirection>(chosenDir));
    int      moveCost = terrainMoveCost(nextHex, moveSide, ref->getCategory());
    size_t   debt     = (moveCost > 1) ? static_cast<size_t>(moveCost - 1) : 0;
    for (AUnit* m : squad.getMembers()) {
        if (!m || !m->getAlive() || m->getBroken()) continue;
        if (m->getHex() == nextHex) continue; // already there
        m->addFatigue(m->getFatigueCost() / 2);
        m->setHex(nextHex);
        if (debt > 0) m->setSpentMove(debt);
    }
    ref->setTookLateral(tookLateral);
}

void Battlefield::moveTeam(Team& team)
{
    for (auto& unit : team.units) {
        if (!unit || !unit->getAlive()) continue;
        AUnit& u = *unit;

        if (u.getMovementSpeed() == 0) continue; // immobile unit — never moves

        if (u.getBroken()) {
            flee(unit);
            continue;
        }
        // Non-broken squad members already moved in the squad pre-pass.
        if (u.getSquad()) continue;
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
        if (u.getEngaged(*this) && u.getFatigue() > FATIGUE_VERY_TIRED) {
            continue;
        }

        Hex* target = findTarget(u);
        if (!target) continue;
        moveToward(unit, target);
    }
}

void Battlefield::makeBattle()
{
    auto red  = _red.units.begin();
    auto blue = _blue.units.begin();

    while (red != _red.units.end() || blue != _blue.units.end()) {
        if (red != _red.units.end()
            && ((Utility::getRandom(1, 2) == 1) || blue == _blue.units.end())) {
            (*red)->battle(*this);
            ++red;
        } else if (blue != _blue.units.end()) {
            (*blue)->battle(*this);
            ++blue;
        }
    }
}

void Battlefield::cleanup()
{
    auto it = _blue.units.begin();
    while (it != _blue.units.end()) {
        if (!(*it) || !(*it)->getAlive()) {
            if (*it && !(*it)->getUndead()) ++corpses;
            it = _blue.units.erase(it);
        } else {
            ++it;
        }
    }
    _red.pruneDeadUnits();
}

std::vector<std::unique_ptr<AUnit>>& Battlefield::getTeam(int team)
{
    if (team == BLUETEAM) return _blue.units;
    if (team == REDTEAM)  return _red.units;
    throw std::runtime_error("getTeam: invalid team");
}

Team& Battlefield::getTeamData(int team)
{
    if (team == REDTEAM)  return _red;
    if (team == BLUETEAM) return _blue;
    throw std::runtime_error("getTeamData: invalid team");
}

void Battlefield::reset()
{
    // Survivors had restoreForNextBattle() called (which unlinks them from hexes).
    // Dead units' destructors already cleaned their hexes during cleanup().
    // This call handles any residual pointers and resets state.
    hexGrid.clearUnits();
    _red.units.clear();
    _blue.units.clear();
    corpses = 0;
}

void Battlefield::loadArmies(Army red, Army blue)
{
    _red.units  = std::move(red);
    _blue.units = std::move(blue);
    // Red flees south (r = height-1); Blue flees north (r = 0).
    hexGrid.computeDistances(height - 1, 0);
}

void Battlefield::recomputeDistances()
{
    hexGrid.computeDistances(height - 1, 0);
}

// ── resolveEngagements helpers ───────────────────────────────────────────────

static void markEngagedSides(HexGrid& grid)
{
    for (HexSide& side : grid.getSides()) { side.engaged = false; side.combatScore = 0; }
    for (HexSide& side : grid.getSides()) {
        if (!side.hexA || !side.hexB) continue;
        if (side.blocked) continue;
        if (std::abs(side.hexA->elevation - side.hexB->elevation) >= 2) continue;
        int teamA = 0, teamB = 0;
        for (AUnit* u : side.hexA->units) if (u && u->getAlive()) { teamA = u->getTeam(); break; }
        for (AUnit* u : side.hexB->units) if (u && u->getAlive()) { teamB = u->getTeam(); break; }
        if (teamA == 0 || teamB == 0 || teamA == teamB) continue;
        side.engaged = true;
    }
}

static std::unordered_map<Hex*, std::vector<HexSide*>> buildHexSideMap(HexGrid& grid)
{
    std::unordered_map<Hex*, std::vector<HexSide*>> hexSides;
    for (HexSide& side : grid.getSides()) {
        if (!side.engaged) continue;
        hexSides[side.hexA].push_back(&side);
        hexSides[side.hexB].push_back(&side);
    }
    return hexSides;
}

static std::vector<Squad*> collectSquadsInHex(const Hex* hex)
{
    std::vector<Squad*> result;
    for (AUnit* u : hex->units) {
        if (!u || !u->getAlive() || u->getBroken()) continue;
        Squad* sq = u->getSquad();
        if (!sq) continue;
        bool seen = false;
        for (Squad* s : result) if (s == sq) { seen = true; break; }
        if (!seen) result.push_back(sq);
    }
    return result;
}

// Forest and Rubble break formation dressing — cohesion bonus halved.
static int cohesionTierForHex(const Hex* hex, int tier)
{
    if (hex->terrain == TerrainType::Forest || hex->terrain == TerrainType::Rubble)
        return tier / 2;
    return tier;
}

// Distribute sides proportionally between squads and the loner pool, writing into sideOwner.
// Each group gets at least 1 side; extras go to largest groups first.
// Adjacent-preferred picks keep each group's sides contiguous.
static void allocateSidesToGroups(Hex* hex, const std::vector<HexSide*>& sides,
                                   const std::vector<Squad*>& squadsHere,
                                   std::vector<Squad*>& sideOwner)
{
    struct Group {
        Squad*              squad; // nullptr = loner pool
        int                 size;  // fatigue-weighted: fresh×3, tired×2, very tired×1
        std::vector<size_t> owned;
    };

    auto fatigueWeight = [](int f) -> int {
        if (f < FATIGUE_TIRED)      return 3;
        if (f < FATIGUE_VERY_TIRED) return 2;
        return 1;
    };

    std::vector<Group> groups;
    for (Squad* sq : squadsHere) {
        int sz = 0;
        for (AUnit* m : sq->getMembers()) {
            if (!m || !m->getAlive() || m->getBroken() || m->getHex() != hex) continue;
            int f = m->getFatigue();
            if (f >= FATIGUE_MAX) continue;
            sz += static_cast<int>(m->getSize()) * fatigueWeight(f);
        }
        if (sz > 0) groups.push_back({sq, sz, {}});
    }
    {
        int lonerSz = 0;
        for (AUnit* u : hex->units) {
            if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
            int f = u->getFatigue();
            if (f >= FATIGUE_MAX) continue;
            lonerSz += static_cast<int>(u->getSize()) * fatigueWeight(f);
        }
        if (lonerSz > 0) groups.push_back({nullptr, lonerSz, {}});
    }

    if (groups.empty()) return;

    int G = static_cast<int>(groups.size());
    int N = static_cast<int>(sides.size());

    std::sort(groups.begin(), groups.end(),
              [](const Group& a, const Group& b){ return a.size > b.size; });

    std::vector<int> share(G, 0);
    if (G <= N) {
        for (int i = 0; i < G; ++i) share[i] = 1;
        for (int k = 0; k < N - G; ++k) share[k % G]++;
    } else {
        for (int k = 0; k < N; ++k) share[k] = 1;
    }

    auto dirOf = [&](HexSide* s) -> int {
        int d = static_cast<int>(s->dirFromA);
        return (s->hexB == hex) ? (d + 3) % 6 : d;
    };

    std::vector<bool> claimed(sides.size(), false);

    // Round 1: each group claims its first side (largest group goes first).
    for (int gi = 0; gi < G; ++gi) {
        if (share[gi] == 0) continue;
        for (size_t si = 0; si < sides.size(); ++si) {
            if (!claimed[si]) { groups[gi].owned.push_back(si); claimed[si] = true; break; }
        }
    }
    // Round 2+: extra sides, adjacent-preferred.
    bool progress = true;
    while (progress) {
        progress = false;
        for (int gi = 0; gi < G; ++gi) {
            if (static_cast<int>(groups[gi].owned.size()) >= share[gi]) continue;
            size_t best = sides.size();
            for (size_t si = 0; si < sides.size() && best == sides.size(); ++si) {
                if (claimed[si]) continue;
                int dir = dirOf(sides[si]);
                for (size_t oi : groups[gi].owned) {
                    int od = dirOf(sides[oi]);
                    if ((dir - od + 6) % 6 == 1 || (od - dir + 6) % 6 == 1)
                        { best = si; break; }
                }
            }
            if (best == sides.size())
                for (size_t si = 0; si < sides.size(); ++si)
                    if (!claimed[si]) { best = si; break; }
            if (best == sides.size()) continue;
            groups[gi].owned.push_back(best);
            claimed[best] = true;
            progress = true;
        }
    }

    for (const Group& g : groups)
        if (g.squad)
            for (size_t si : g.owned)
                sideOwner[si] = g.squad;
}

// Assign squad members with fatigue in [fatLow, fatHigh) to their squad's pre-allocated sides.
static void fillSquadPass(Squad* sq, Hex* hex, const std::vector<HexSide*>& sides,
                           const std::vector<Squad*>& sideOwner,
                           std::vector<int>& frontage, int fatLow, int fatHigh)
{
    std::vector<AUnit*> members;
    for (AUnit* m : sq->getMembers()) {
        if (!m || !m->getAlive() || m->getBroken() || m->getHex() != hex) continue;
        int f = m->getFatigue();
        if (f < fatLow || f >= fatHigh) continue;
        members.push_back(m);
    }
    if (members.empty()) return;
    std::sort(members.begin(), members.end(), [](AUnit* a, AUnit* b){ return a->biggerThan(b); });

    int cohTier = cohesionTierForHex(hex, sq->cohesionLevel());
    size_t mi = 0;
    for (size_t si = 0; si < sides.size() && mi < members.size(); ++si) {
        if (sideOwner[si] != sq) continue;
        while (mi < members.size() && frontage[si] < effectiveFrontage(*sides[si])) {
            AUnit* u = members[mi++];
            u->setCanFight(true);
            u->setEngagedSide(sides[si]);
            u->setCohesionBonus(cohTier);
            frontage[si] += static_cast<int>(u->getSize());
        }
    }
}

// Assign lone units with fatigue in [fatLow, fatHigh) round-robin to unclaimed sides.
static void fillLonerPass(Hex* hex, const std::vector<HexSide*>& sides,
                           const std::vector<Squad*>& sideOwner,
                           std::vector<int>& frontage, int fatLow, int fatHigh)
{
    std::vector<AUnit*> loners;
    for (AUnit* u : hex->units) {
        if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
        int f = u->getFatigue();
        if (f < fatLow || f >= fatHigh) continue;
        loners.push_back(u);
    }
    if (loners.empty()) return;
    std::sort(loners.begin(), loners.end(), [](AUnit* a, AUnit* b){ return a->biggerThan(b); });

    std::vector<size_t> freeSides;
    for (size_t si = 0; si < sides.size(); ++si)
        if (sideOwner[si] == nullptr) freeSides.push_back(si);

    size_t pi = 0;
    while (pi < loners.size()) {
        bool anyAssigned = false;
        for (size_t fi = 0; fi < freeSides.size() && pi < loners.size(); ++fi) {
            size_t si = freeSides[fi];
            if (frontage[si] >= effectiveFrontage(*sides[si])) continue;
            AUnit* u = loners[pi++];
            u->setCanFight(true);
            u->setEngagedSide(sides[si]);
            frontage[si] += static_cast<int>(u->getSize());
            anyAssigned = true;
        }
        if (!anyAssigned) break;
    }
}

void Battlefield::resolveEngagements()
{
    _red.resetUnitFlags();
    _blue.resetUnitFlags();

    markEngagedSides(hexGrid);
    auto hexSideMap = buildHexSideMap(hexGrid);

    for (auto& [hex, sides] : hexSideMap) {
        const auto squadsHere = collectSquadsInHex(hex);
        std::vector<Squad*> sideOwner(sides.size(), nullptr);
        std::vector<int>    frontage(sides.size(), 0);

        allocateSidesToGroups(hex, sides, squadsHere, sideOwner);

        // Fresh then tired squad members fill squad-owned sides before loners touch anything.
        for (Squad* sq : squadsHere)
            fillSquadPass(sq, hex, sides, sideOwner, frontage, 0,             FATIGUE_TIRED);
        for (Squad* sq : squadsHere)
            fillSquadPass(sq, hex, sides, sideOwner, frontage, FATIGUE_TIRED, FATIGUE_VERY_TIRED);
        fillLonerPass(hex, sides, sideOwner, frontage, 0,             FATIGUE_TIRED);
        fillLonerPass(hex, sides, sideOwner, frontage, FATIGUE_TIRED, FATIGUE_VERY_TIRED);
        // Desperate pass: very tired units only when sides would otherwise be empty.
        for (Squad* sq : squadsHere)
            fillSquadPass(sq, hex, sides, sideOwner, frontage, FATIGUE_VERY_TIRED, FATIGUE_MAX);
        fillLonerPass(hex, sides, sideOwner, frontage, FATIGUE_VERY_TIRED, FATIGUE_MAX);
    }
}

bool Battlefield::tick()
{
    // Passive fatigue recovery — all alive units recover each tick regardless of action
    for (auto& u : _red.units)  if (u && u->getAlive()) u->recover();
    for (auto& u : _blue.units) if (u && u->getAlive()) u->recover();

    // Full cross-reference consistency check — see DebugAsserts.cpp.
    debugAsserts();

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

    for (auto& unit : _red.units)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.redSurvivors.push_back(std::move(unit));

    for (auto& unit : _blue.units)
        if (unit && unit->getAlive() && !unit->getBattleSummon())
            result.blueSurvivors.push_back(std::move(unit));

    _red.units.clear();
    _blue.units.clear();
    return result;
}

void Battlefield::triggerSpecialPhase()
{
    // Reset the ranged-combat slot cache once per phase so every hex's unit
    // list is rebuilt fresh from current occupants.
    RangedCombat::resetCache();

    for (auto& unit : _red.units)
        if (unit && unit->getFatigue() < FATIGUE_MAX && unit->getAlive())
            unit->special();

    for (auto& unit : _blue.units)
        if (unit && unit->getFatigue() < FATIGUE_MAX && unit->getAlive())
            unit->special();
}

size_t Battlefield::getCorpses()      { return corpses; }
void   Battlefield::setCorpses(size_t c) { corpses = c; }
