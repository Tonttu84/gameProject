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

    HexCoord from = unit.getHex()->coord;
    HexCoord to   = target->coord;
    if (from == to) return;

    int curDist = HexGrid::distance(from, to);

    // Pass 1: pick the passable neighbor that closes distance the most
    int bestDist = curDist;
    int bestDir  = -1;
    for (int i = 0; i < 6; ++i) {
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), unit.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        int d = HexGrid::distance(nc, to);
        if (d < bestDist) {
            bestDist = d;
            bestDir  = i;
        }
    }
    if (bestDir >= 0) {
        auto      dir      = static_cast<HexDirection>(bestDir);
        HexCoord  destCoord = hexGrid.neighborCoord(from, dir);
        moveAUnit(unit, destCoord);
        int cost = terrainMoveCost(hexGrid.getHex(destCoord), hexGrid.getSide(from, dir),
                                   unit.getCategory());
        if (cost > 1) unit.setSpentMove(static_cast<size_t>(cost - 1));
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
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), unit.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;
        if (HexGrid::distance(nc, to) != curDist) continue;

        if (!engaged || (crowded && wouldRemainEngaged(unit, nc, hexGrid))) {
            moveAUnit(unit, nc);
            int cost = terrainMoveCost(hexGrid.getHex(nc), hexGrid.getSide(from, dir),
                                       unit.getCategory());
            if (cost > 1) unit.setSpentMove(static_cast<size_t>(cost - 1));
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
        auto     dir  = dirs[idx];
        HexCoord nc   = hexGrid.neighborCoord(c, dir);
        Hex* next = hexGrid.getHex(nc);
        if (!sidePassable(hexGrid.getSide(c, dir), unit->getCategory())) continue;
        if (hexAcceptsUnit(next, *unit)) {
            moveAUnit(*unit, nc);
            int cost = terrainMoveCost(next, hexGrid.getSide(c, dir), unit->getCategory());
            if (cost > 1) unit->setSpentMove(static_cast<size_t>(cost - 1));
            return;
        }
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

    // Find enemy target and the best forward hex (Pass 1 of moveToward logic).
    Hex* enemyTarget = findTarget(*ref);
    if (!enemyTarget) return;

    HexCoord from = ref->getHex()->coord;
    HexCoord to   = enemyTarget->coord;
    int curDist   = HexGrid::distance(from, to);
    if (curDist == 0) return;

    int bestDist = curDist;
    int bestDir  = -1;
    for (int i = 0; i < 6; ++i) {
        auto dir = static_cast<HexDirection>(i);
        if (!sidePassable(hexGrid.getSide(from, dir), ref->getCategory())) continue;
        HexCoord nc  = hexGrid.neighborCoord(from, dir);
        Hex*     nh  = hexGrid.getHex(nc);
        if (!nh || nh->impassable) continue;
        // Mounted squad cannot enter Forest or Marsh
        if (ref->getCategory() == UnitCategory::Mounted &&
            (nh->terrain == TerrainType::Forest || nh->terrain == TerrainType::Marsh)) continue;
        // No enemies may already occupy the destination.
        bool hasEnemy = false;
        for (AUnit* u : nh->units)
            if (u && u->getAlive() && u->getTeam() != ref->getTeam()) { hasEnemy = true; break; }
        if (hasEnemy) continue;
        int d = HexGrid::distance(nc, to);
        if (d < bestDist) { bestDist = d; bestDir = i; }
    }
    if (bestDir < 0) return; // no forward hex available

    HexCoord nextCoord = hexGrid.neighborCoord(from, static_cast<HexDirection>(bestDir));
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
    HexSide* moveSide = hexGrid.getSide(from, static_cast<HexDirection>(bestDir));
    int      moveCost = terrainMoveCost(nextHex, moveSide, ref->getCategory());
    size_t   debt     = (moveCost > 1) ? static_cast<size_t>(moveCost - 1) : 0;
    for (AUnit* m : squad.getMembers()) {
        if (!m || !m->getAlive() || m->getBroken()) continue;
        if (m->getHex() == nextHex) continue; // already there
        m->addFatigue(m->getFatigueCost() / 2);
        m->setHex(nextHex);
        if (debt > 0) m->setSpentMove(debt);
    }
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
}

void Battlefield::resolveEngagements() {
    _red.resetUnitFlags();
    _blue.resetUnitFlags();
    for (HexSide& side : hexGrid.getSides()) { side.engaged = false; side.combatScore = 0; }

    // Mark sides where both hexes hold opposing living units.
    for (HexSide& side : hexGrid.getSides()) {
        if (!side.hexA || !side.hexB) continue;
        // Blocked sides and cliff faces cannot be engaged across
        if (side.blocked) continue;
        if (std::abs(side.hexA->elevation - side.hexB->elevation) >= 2) continue;
        int teamA = 0, teamB = 0;
        for (AUnit* u : side.hexA->units) if (u && u->getAlive()) { teamA = u->getTeam(); break; }
        for (AUnit* u : side.hexB->units) if (u && u->getAlive()) { teamB = u->getTeam(); break; }
        if (teamA == 0 || teamB == 0 || teamA == teamB) continue;
        side.engaged = true;
    }

    // Group each hex's engaged sides.
    std::unordered_map<Hex*, std::vector<HexSide*>> hexSides;
    for (HexSide& side : hexGrid.getSides()) {
        if (!side.engaged) continue;
        hexSides[side.hexA].push_back(&side);
        hexSides[side.hexB].push_back(&side);
    }

    for (auto& [hex, sides] : hexSides) {
        const size_t numSides = sides.size();
        std::vector<int>    frontage(numSides, 0);
        std::vector<Squad*> sideOwner(numSides, nullptr);  // nullptr = unclaimed by any squad

        // Forest and Rubble break formation dressing — squad cohesion bonus halved.
        auto cohesionTier = [hex](int tier) -> int {
            if (hex->terrain == TerrainType::Forest || hex->terrain == TerrainType::Rubble)
                return tier / 2;
            return tier;
        };

        // Helper: round-robin assignment from a unit pool across a set of side indices.
        auto roundRobin = [&](std::vector<AUnit*>& pool, const std::vector<size_t>& sideIdxs) {
            size_t pi = 0;
            while (pi < pool.size()) {
                bool anyAssigned = false;
                for (size_t fi = 0; fi < sideIdxs.size() && pi < pool.size(); ++fi) {
                    size_t si = sideIdxs[fi];
                    if (frontage[si] >= HexSide::FRONTAGE) continue;
                    AUnit* u = pool[pi++];
                    u->setCanFight(true);
                    u->setEngagedSide(sides[si]);
                    frontage[si] += static_cast<int>(u->getSize());
                    anyAssigned = true;
                }
                if (!anyAssigned) break;
            }
        };

        // Build the list of squads represented by non-broken alive members in this hex.
        std::vector<Squad*> squadsHere;
        for (AUnit* u : hex->units) {
            if (!u || !u->getAlive() || u->getBroken()) continue;
            Squad* sq = u->getSquad();
            if (!sq) continue;
            bool seen = false;
            for (Squad* s : squadsHere) if (s == sq) { seen = true; break; }
            if (!seen) squadsHere.push_back(sq);
        }

        // ── Pre-allocation: distribute sides proportionally between squads/loners ──
        // Sets sideOwner upfront so all fatigue passes (1A-3B) respect the split.
        // Each group gets at least 1 side (when sides ≥ groups); extras go to the
        // largest groups first. When picking a second or third side a group prefers
        // the direction adjacent to its first pick (fluffy, not a hard constraint).
        {
            struct Group {
                Squad*             squad; // nullptr = loner pool
                int                size;  // fatigue-weighted size: fresh×3, tired×2, vtired×1
                std::vector<size_t> owned;
            };
            std::vector<Group> groups;

            // Weight by fatigue: fresh=3, tired=2, very tired=1.
            // Groups with mostly fresh troops earn proportionally more sides.
            auto fatigueWeight = [](int f) -> int {
                if (f < FATIGUE_TIRED)      return 3;
                if (f < FATIGUE_VERY_TIRED) return 2;
                return 1; // very tired but not exhausted
            };

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

            if (!groups.empty()) {
                int G = static_cast<int>(groups.size());
                int N = static_cast<int>(numSides);

                // Sort largest first so the biggest group picks first.
                std::sort(groups.begin(), groups.end(),
                          [](const Group& a, const Group& b){ return a.size > b.size; });

                // Share: min(1, proportional). If groups > sides, smallest lose theirs.
                std::vector<int> share(G, 0);
                if (G <= N) {
                    for (int i = 0; i < G; ++i) share[i] = 1;
                    for (int k = 0; k < N - G; ++k) share[k % G]++;
                } else {
                    for (int k = 0; k < N; ++k) share[k] = 1;
                }

                // Direction of a side as seen from this hex.
                auto dirOf = [&](HexSide* s) -> int {
                    int d = static_cast<int>(s->dirFromA);
                    return (s->hexB == hex) ? (d + 3) % 6 : d;
                };

                std::vector<bool> claimed(numSides, false);

                // Round 1: each group picks its first side (largest group goes first).
                for (int gi = 0; gi < G; ++gi) {
                    if (share[gi] == 0) continue;
                    for (size_t si = 0; si < numSides; ++si) {
                        if (!claimed[si]) {
                            groups[gi].owned.push_back(si);
                            claimed[si] = true;
                            break;
                        }
                    }
                }
                // Round 2+: extra sides, adjacent-preferred.
                bool progress = true;
                while (progress) {
                    progress = false;
                    for (int gi = 0; gi < G; ++gi) {
                        if (static_cast<int>(groups[gi].owned.size()) >= share[gi]) continue;
                        size_t best = numSides; // sentinel = not found
                        // Prefer a side adjacent (direction ±1 mod 6) to any owned side.
                        for (size_t si = 0; si < numSides && best == numSides; ++si) {
                            if (claimed[si]) continue;
                            int dir = dirOf(sides[si]);
                            for (size_t oi : groups[gi].owned) {
                                int od = dirOf(sides[oi]);
                                if ((dir - od + 6) % 6 == 1 || (od - dir + 6) % 6 == 1)
                                    { best = si; break; }
                            }
                        }
                        if (best == numSides) { // no adjacent — take first free
                            for (size_t si = 0; si < numSides; ++si)
                                if (!claimed[si]) { best = si; break; }
                        }
                        if (best == numSides) continue;
                        groups[gi].owned.push_back(best);
                        claimed[best] = true;
                        progress = true;
                    }
                }

                // Commit: squad sides get sideOwner set; loner sides stay nullptr.
                for (const Group& g : groups)
                    if (g.squad)
                        for (size_t si : g.owned)
                            sideOwner[si] = g.squad;
            }
        }

        // ── Pass 1A: fresh squad members ──────────────────────────────────────
        // sideOwner is now pre-allocated so each squad only fills its own sides.
        // Assigned members receive a cohesion bonus tier from their squad.
        for (Squad* sq : squadsHere) {
            const int cohTier = cohesionTier(sq->cohesionLevel());
            std::vector<AUnit*> freshMembers;
            for (AUnit* m : sq->getMembers()) {
                if (m && m->getAlive() && !m->getBroken() && m->getHex() == hex
                        && m->getFatigue() < FATIGUE_TIRED)
                    freshMembers.push_back(m);
            }
            std::sort(freshMembers.begin(), freshMembers.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            size_t mi = 0;
            for (size_t si = 0; si < numSides && mi < freshMembers.size(); ++si) {
                if (sideOwner[si] != sq) continue;
                while (mi < freshMembers.size() && frontage[si] < HexSide::FRONTAGE) {
                    AUnit* u = freshMembers[mi++];
                    u->setCanFight(true);
                    u->setEngagedSide(sides[si]);
                    u->setCohesionBonus(cohTier);
                    frontage[si] += static_cast<int>(u->getSize());
                }
            }
        }

        // ── Pass 2A: fatigued squad members fill their squad's own sides ───────
        // Runs before lone-unit passes so squad sides are maximally filled by
        // squad members before unclaimed sides are touched by anyone else.
        // Lone units must not take unclaimed sides while squad sides still have
        // room that tired squad members could fill.
        for (Squad* sq : squadsHere) {
            const int cohTier = cohesionTier(sq->cohesionLevel());
            std::vector<AUnit*> tiredMembers;
            for (AUnit* m : sq->getMembers()) {
                if (m && m->getAlive() && !m->getBroken() && m->getHex() == hex
                        && m->getFatigue() >= FATIGUE_TIRED
                        && m->getFatigue() < FATIGUE_VERY_TIRED)
                    tiredMembers.push_back(m);
            }
            if (tiredMembers.empty()) continue;
            std::sort(tiredMembers.begin(), tiredMembers.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            size_t mi = 0;
            for (size_t si = 0; si < numSides && mi < tiredMembers.size(); ++si) {
                if (sideOwner[si] != sq) continue;  // only the squad's own sides
                while (mi < tiredMembers.size() && frontage[si] < HexSide::FRONTAGE) {
                    AUnit* u = tiredMembers[mi++];
                    u->setCanFight(true);
                    u->setEngagedSide(sides[si]);
                    u->setCohesionBonus(cohTier);
                    frontage[si] += static_cast<int>(u->getSize());
                }
            }
        }

        // ── Pass 1B: fresh lone units, round-robin across unclaimed sides ──────
        // Runs after squad passes — squad sides are fully stocked before lone
        // units claim any remaining unclaimed borders.
        {
            std::vector<AUnit*> freshLoners;
            for (AUnit* u : hex->units) {
                if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
                if (u->getFatigue() < FATIGUE_TIRED) freshLoners.push_back(u);
            }
            std::sort(freshLoners.begin(), freshLoners.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            std::vector<size_t> freeSides;
            for (size_t si = 0; si < numSides; ++si)
                if (sideOwner[si] == nullptr) freeSides.push_back(si);
            roundRobin(freshLoners, freeSides);
        }

        // ── Pass 2B: fatigued lone units, round-robin across unclaimed sides ───
        {
            std::vector<AUnit*> tiredLoners;
            for (AUnit* u : hex->units) {
                if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
                if (u->getFatigue() >= FATIGUE_TIRED && u->getFatigue() < FATIGUE_VERY_TIRED)
                    tiredLoners.push_back(u);
            }
            std::sort(tiredLoners.begin(), tiredLoners.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            std::vector<size_t> freeSides;
            for (size_t si = 0; si < numSides; ++si)
                if (sideOwner[si] == nullptr) freeSides.push_back(si);
            roundRobin(tiredLoners, freeSides);
        }

        // ── Pass 3A: desperate — very tired squad members ─────────────────────
        // Last resort. Only used when the earlier passes couldn't fill the side.
        // Very tired units fight at severe penalty but holding a side is better
        // than leaving it undefended.
        for (Squad* sq : squadsHere) {
            const int cohTier = cohesionTier(sq->cohesionLevel());
            std::vector<AUnit*> veryTired;
            for (AUnit* m : sq->getMembers()) {
                if (m && m->getAlive() && !m->getBroken() && m->getHex() == hex
                        && m->getFatigue() >= FATIGUE_VERY_TIRED
                        && m->getFatigue() < FATIGUE_MAX)
                    veryTired.push_back(m);
            }
            if (veryTired.empty()) continue;
            std::sort(veryTired.begin(), veryTired.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            size_t mi = 0;
            for (size_t si = 0; si < numSides && mi < veryTired.size(); ++si) {
                if (sideOwner[si] != sq) continue;
                while (mi < veryTired.size() && frontage[si] < HexSide::FRONTAGE) {
                    AUnit* u = veryTired[mi++];
                    u->setCanFight(true);
                    u->setEngagedSide(sides[si]);
                    u->setCohesionBonus(cohTier);
                    frontage[si] += static_cast<int>(u->getSize());
                }
            }
        }

        // ── Pass 3B: desperate — very tired lone units, unclaimed sides ────────
        {
            std::vector<AUnit*> veryTiredLoners;
            for (AUnit* u : hex->units) {
                if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
                if (u->getFatigue() >= FATIGUE_VERY_TIRED && u->getFatigue() < FATIGUE_MAX)
                    veryTiredLoners.push_back(u);
            }
            std::sort(veryTiredLoners.begin(), veryTiredLoners.end(),
                      [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
            std::vector<size_t> freeSides;
            for (size_t si = 0; si < numSides; ++si)
                if (sideOwner[si] == nullptr) freeSides.push_back(si);
            roundRobin(veryTiredLoners, freeSides);
        }

    }

#ifndef TESTING
#endif
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
