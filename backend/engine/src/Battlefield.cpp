#include "Battlefield.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "UnitCatalog.hpp"
#include <algorithm>
#include <climits>
#include <cstdlib>
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
    bool mounted = (searcher.getCategory() == UnitCategory::Mounted);
    int bestDist = std::numeric_limits<int>::max();
    const AUnit* bestEnemy = nullptr;
    Hex* bestHex = nullptr;

    for (const auto& enemy : enemyTeam) {
        if (!enemy || !enemy->getAlive() || !enemy->getHex()) continue;
        int d = HexGrid::distance(myCoord, enemy->getHex()->coord);
        // Cavalry prefers open-ground targets over forest-sheltered ones —
        // still goes there if it's the only option, just not the first choice.
        if (mounted && enemy->getHex()->terrain == TerrainType::Forest)
            d += CAVALRY_FOREST_TARGET_PENALTY;
        if (d < bestDist || (d == bestDist && enemy->sortsBefore(bestEnemy))) {
            bestDist  = d;
            bestEnemy = enemy.get();
            bestHex   = enemy->getHex();
        }
    }
    return bestHex;
}

static bool hexAcceptsUnit(const Hex* hex, const AUnit& unit) {
    if (!hex) return false;
    UnitCategory cat = unit.getCategory();
    if (hex->impassable && cat != UnitCategory::Flyer) return false;
    if (hex->sizeUsed + static_cast<int>(unit.getPackingSize()) > Hex::CAPACITY) return false;
    for (AUnit* u : hex->units)
        if (u && u->getAlive() && u->getTeam() != unit.getTeam()) return false;
    // Mounted cannot enter Forest or Marsh
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

// Movement points spent to enter dest (see the TERRAIN_COST_* block in
// Defines.hpp for the banking model). Caller must verify the side is
// passable before calling.
static int terrainMoveCost(const Hex* dest, const HexSide* side, UnitCategory cat) {
    if (!dest) return TERRAIN_COST_OPEN;
    int cost;
    switch (dest->terrain) {
        case TerrainType::Forest: cost = TERRAIN_COST_FOREST; break;
        case TerrainType::Marsh:
            cost = (cat == UnitCategory::Beast || cat == UnitCategory::Skirmisher)
                   ? TERRAIN_COST_MARSH_LOOSE : TERRAIN_COST_MARSH;
            break;
        case TerrainType::Rubble: cost = TERRAIN_COST_RUBBLE; break;
        default:                  cost = TERRAIN_COST_OPEN;   break;
    }
    // Climbing a slope costs extra
    if (side && side->hexA && side->hexB) {
        const Hex* from = (side->hexA == dest) ? side->hexB : side->hexA;
        if (dest->elevation > from->elevation)
            cost += TERRAIN_COST_SLOPE;
    }
    return cost;
}

// True if this specific hexside currently has live, opposing-team units in
// the hexes on either side of it, and isn't blocked/a cliff. Computed live
// (from current Hex::units) rather than read off HexSide::engaged, since
// moveUnits() runs before resolveEngagements() each tick — that flag is
// still last tick's snapshot when movement decisions are made. Also the
// predicate markEngagedSides() uses to set the flag itself, below.
static bool sideIsEngagedNow(const HexSide& side) {
    if (!side.hexA || !side.hexB) return false;
    if (side.blocked) return false;
    if (std::abs(side.hexA->elevation - side.hexB->elevation) >= 2) return false;
    int teamA = 0, teamB = 0;
    for (AUnit* u : side.hexA->units) if (u && u->getAlive()) { teamA = u->getTeam(); break; }
    for (AUnit* u : side.hexB->units) if (u && u->getAlive()) { teamB = u->getTeam(); break; }
    return teamA != 0 && teamB != 0 && teamA != teamB;
}

// Size-points of "reserve" units in a hex: alive, non-broken units with
// _engagedRank == 0 — never seated on any HexSide this tick (either still
// approaching, or overflow evicted with nowhere to fit). Anything seated at
// rank 1/2/3 (frontline/backup/reserve-of-that-side, any depth) is committed
// and does not count here — seating, not fatigue or freshness, is what makes
// a unit "spoken for" now. Squad members are counted too (they can be the
// reserve size-points a neighbor compares against) even though they never
// move via bestReinforceNeighbor themselves — moveTeam() only routes loners
// into moveToward(), so a squad member can never be the mover.
static int hexReserveSize(const Hex* hex) {
    if (!hex) return 0;
    int total = 0;
    for (AUnit* u : hex->units)
        if (u && u->getAlive() && !u->getBroken() && u->getEngagedRank() == 0)
            total += static_cast<int>(u->getPackingSize());
    return total;
}

// Result of scanning fromHex's 6 neighbors for the best reinforcement target.
struct ReinforceChoice {
    HexCoord coord {};
    Hex*     hex   = nullptr;
    int      cost  = 1;
};

// Where should a reserve (rank-0) unit in fromHex go to help the line? Purely
// a reserve-count gradient: the passable, enterable neighbor holding strictly
// fewer reserve size-points than fromHex, ties broken toward whichever is
// fewest (random start direction spreads exact ties fairly). No requirement
// that the destination itself be engaged or enemy-adjacent — a thin flank
// still needs filling before it becomes engaged. Each unit re-reads live
// state, so multiple reserve units in the same hex naturally equalize against
// their neighbors move by move, stopping once a further move would overshoot
// (destination would end up >= source).
static ReinforceChoice bestReinforceNeighbor(HexGrid& hexGrid, const Hex* fromHex, const AUnit& unit)
{
    ReinforceChoice best;
    int fromReserve = hexReserveSize(fromHex);
    int bestReserve  = fromReserve;

    int start = Utility::getRandom(0, 5);
    for (int i = 0; i < 6; ++i) {
        int di = (start + i) % 6;
        auto dir = static_cast<HexDirection>(di);
        if (!sidePassable(hexGrid.getSide(fromHex->coord, dir), unit.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(fromHex->coord, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, unit)) continue;

        int reserve = hexReserveSize(nh);
        if (reserve >= fromReserve) continue;
        if (reserve < bestReserve) {
            bestReserve = reserve;
            best.coord = nc;
            best.hex   = nh;
            best.cost  = terrainMoveCost(nh, hexGrid.getSide(fromHex->coord, dir), unit.getCategory());
        }
    }
    return best;
}

// Whole-squad analogue of bestReinforceNeighbor: the passable, enemy-free
// neighbour holding strictly fewer reserve size-points than fromHex that a
// squad of `squadSize` could still fit into (loose capacity gate here; the
// atomic trySquadEnter below makes the final call). Lets a non-engaged squad
// equalize crowding the same way a loner does — moving toward the emptier
// hex — but as one block. `ref` supplies the squad's movement category/team.
static ReinforceChoice bestSquadSpreadNeighbor(HexGrid& hexGrid, const Hex* fromHex,
                                               const AUnit& ref, int squadSize)
{
    ReinforceChoice best;
    int fromReserve = hexReserveSize(fromHex);
    int bestReserve = fromReserve;

    int start = Utility::getRandom(0, 5);
    for (int i = 0; i < 6; ++i) {
        int di = (start + i) % 6;
        auto dir = static_cast<HexDirection>(di);
        if (!sidePassable(hexGrid.getSide(fromHex->coord, dir), ref.getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(fromHex->coord, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!nh || (nh->impassable && ref.getCategory() != UnitCategory::Flyer)) continue;
        if (ref.getCategory() == UnitCategory::Mounted
            && (nh->terrain == TerrainType::Forest || nh->terrain == TerrainType::Marsh)) continue;
        bool enemyThere = false;
        for (AUnit* u : nh->units)
            if (u && u->getAlive() && u->getTeam() != ref.getTeam()) { enemyThere = true; break; }
        if (enemyThere) continue;

        int reserve = hexReserveSize(nh);
        if (reserve >= fromReserve) continue; // not emptier — never move the jam into a fuller hex
        // Loose fit gate (capacity + best-case 25% loner displacement); the
        // exact atomic check is trySquadEnter.
        if (Hex::CAPACITY - nh->sizeUsed
            + static_cast<int>(squadSize * Squad::DISPLACE_FRACTION) < squadSize) continue;
        if (reserve < bestReserve) {
            bestReserve = reserve;
            best.coord  = nc;
            best.hex    = nh;
            best.cost   = terrainMoveCost(nh, hexGrid.getSide(fromHex->coord, dir), ref.getCategory());
        }
    }
    return best;
}

// Move the whole squad into targetHex atomically, applying the ≤25% loner
// displacement rule. Feasibility (capacity + which loners to displace) is fully
// resolved BEFORE any unit moves, so a failed attempt leaves the board
// untouched — letting moveSquad fall through and try another target. Returns
// true and commits on success. `squadSize` is the alive-non-broken footprint.
static bool trySquadEnter(Squad& squad, Hex* targetHex, Hex* fromHex, int squadSize)
{
    if (!targetHex) return false;

    // Space squad members already occupy in the target counts as available
    // (they "leave and re-enter").
    int squadFootprintInNext = 0;
    for (AUnit* m : squad.getMembers())
        if (m && m->getAlive() && !m->getBroken() && m->getHex() == targetHex)
            squadFootprintInNext += static_cast<int>(m->getPackingSize());

    int available = Hex::CAPACITY - targetHex->sizeUsed + squadFootprintInNext;

    // Plan (but do not yet perform) the loner displacement needed to fit.
    std::vector<AUnit*> toDisplace;
    if (available < squadSize) {
        int needed      = squadSize - available;
        int maxDisplace = static_cast<int>(squadSize * Squad::DISPLACE_FRACTION);

        std::vector<AUnit*> candidates;
        for (AUnit* u : targetHex->units)
            if (u && u->getAlive() && !u->getSquad())
                candidates.push_back(u);
        std::sort(candidates.begin(), candidates.end(),
                  [](AUnit* a, AUnit* b){ return a->getPackingSize() < b->getPackingSize(); });

        int freed    = 0;
        int fromRoom = fromHex ? Hex::CAPACITY - static_cast<int>(fromHex->sizeUsed) : 0;
        for (AUnit* victim : candidates) {
            if (freed >= needed) break;
            int vs = static_cast<int>(victim->getPackingSize());
            if (freed + vs > maxDisplace) break; // sorted ascending — cap reached for all
            if (vs > fromRoom) continue;          // from-hex can't absorb this one
            toDisplace.push_back(victim);
            fromRoom -= vs;
            freed    += vs;
        }
        if (available + freed < squadSize) return false; // still won't fit — leave untouched
    }

    // Commit: displace the planned loners, then bring every member in.
    for (AUnit* victim : toDisplace)
        victim->setHex(fromHex);
    for (AUnit* m : squad.getMembers()) {
        if (!m || !m->getAlive() || m->getBroken()) continue;
        if (m->getHex() == targetHex) continue; // already there
        m->addFatigue(m->getFatigueCost() / 2);
        m->setHex(targetHex);
    }
    return true;
}

// Result of scanning the 6 neighbors of a hex for the best move toward (or
// away from, for flee) a distance target. decrHex/latHex are cached from the
// scan so callers don't need to re-resolve the hex or its move cost.
struct DirChoice {
    int      decrDir   = -1;
    HexCoord decrCoord {};
    Hex*     decrHex   = nullptr;
    int      decrCost  = 0;
    int      latDir    = -1;
    HexCoord latCoord  {};
    Hex*     latHex    = nullptr;
    int      latCost   = 0;
};

// Shared by moveToward/flee/moveSquad: scans the 6 neighbors of `from`,
// tracking the best strictly-decreasing-distance candidate and the best
// equal-distance (lateral) candidate, preferring cheaper terrain on ties.
// distFn(nh, nc) returns the candidate's distance to the goal (UNREACHABLE
// to exclude it); acceptFn(nh, nc) filters candidates the caller can't enter
// (capacity, enemies, mounted-on-forest, impassable-unless-flyer, etc.).
template <typename DistFn, typename AcceptFn>
static DirChoice pickBestDirection(HexGrid& hexGrid, HexCoord from, int curDist,
                                    UnitCategory cat, DistFn distFn, AcceptFn acceptFn)
{
    DirChoice result;
    int bestDecrDist = curDist, bestDecrCost = INT_MAX;
    int bestLatCost  = INT_MAX;

    // Random start direction so equal-cost ties are broken differently each
    // call, preventing all units from always preferring the same flank.
    int start = Utility::getRandom(0, 5);
    for (int i = 0; i < 6; ++i) {
        int di = (start + i) % 6;
        auto dir = static_cast<HexDirection>(di);
        if (!sidePassable(hexGrid.getSide(from, dir), cat)) continue;
        HexCoord nc = hexGrid.neighborCoord(from, dir);
        Hex* nh = hexGrid.getHex(nc);
        if (!acceptFn(nh, nc)) continue;

        int d = distFn(nh, nc);
        if (d == HexGrid::UNREACHABLE) continue;
        int cost = terrainMoveCost(nh, hexGrid.getSide(from, dir), cat);

        if (d < curDist) {
            if (d < bestDecrDist || (d == bestDecrDist && cost < bestDecrCost)) {
                bestDecrDist = d; bestDecrCost = cost;
                result.decrDir = di; result.decrCoord = nc; result.decrHex = nh; result.decrCost = cost;
            }
        } else if (d == curDist && cost < bestLatCost) {
            bestLatCost = cost;
            result.latDir = di; result.latCoord = nc; result.latHex = nh; result.latCost = cost;
        }
    }
    return result;
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
    // Action recovery (archer fire), not terrain debt — terrain costs charge
    // the movement-points bank at the move sites below. One recovery tick is
    // consumed per moveToward call; moveTeam's step loop stops on a
    // stationary step, so this burns at most one per tick.
    if (unit.getSpentMove()) {
        unit.setSpentMove(unit.getSpentMove() - 1);
        return;
    }

    const Hex* fromHex = unit.getHex();
    if (fromHex == target) return;

    bool mounted = (unit.getCategory() == UnitCategory::Mounted);
    bool flyer   = (unit.getCategory() == UnitCategory::Flyer);
    HexCoord from = fromHex->coord;

    int curDist = flyer ? HexGrid::distance(from, target->coord)
                        : hexGrid.bfsDistance(fromHex, target, mounted);
    if (curDist <= 0 || curDist == HexGrid::UNREACHABLE) return;

    // If the unit took a lateral last turn it must decrease distance this turn.
    bool mustDecrease = unit.getTookLateral();

    DirChoice choice = pickBestDirection(hexGrid, from, curDist, unit.getCategory(),
        [&](Hex* nh, HexCoord nc) {
            return flyer ? HexGrid::distance(nc, target->coord)
                         : hexGrid.bfsDistance(nh, target, mounted);
        },
        [&](Hex* nh, HexCoord) { return hexAcceptsUnit(nh, unit); });

    // Prefer a decreasing move — clears the lateral flag.
    if (choice.decrDir >= 0) {
        moveAUnit(unit, choice.decrCoord);
        unit.setMovePoints(unit.getMovePoints() - choice.decrCost);
        unit.setTookLateral(false);
        return;
    }

    // Pre-contact: free to slide laterally, but not two lateral moves in a row.
    bool engaged = unit.getEngaged(*this);
    if (!engaged) {
        if (choice.latDir >= 0 && !mustDecrease) {
            moveAUnit(unit, choice.latCoord);
            unit.setMovePoints(unit.getMovePoints() - choice.latCost);
            unit.setTookLateral(true);
        }
        return;
    }

    // Engaged: a seated unit (rank 1/2/3, any depth) never disengages — hard
    // to disengage and reform, holds regardless of what its neighbors need.
    // Only an unseated reserve (rank 0) redistributes, purely by reserve
    // count against its neighbors — ignores the equidistant-to-target
    // lateral entirely, since reinforcement isn't about distance to this
    // unit's own target.
    if (unit.getEngagedRank() != 0) return;

    ReinforceChoice reinforce = bestReinforceNeighbor(hexGrid, fromHex, unit);
    if (reinforce.hex) {
        moveAUnit(unit, reinforce.coord);
        unit.setMovePoints(unit.getMovePoints() - reinforce.cost);
        unit.setTookLateral(true);
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
        logEvent("A soldier fled the battlefield and turns to banditry");
        unit->setAlive(false);
        return;
    }

    bool mounted = (unit->getCategory() == UnitCategory::Mounted);
    bool flyer   = (unit->getCategory() == UnitCategory::Flyer);
    bool isRed   = (unit->getTeam() == REDTEAM);
    // Flyers ignore impassable terrain entirely, so the precomputed flee BFS
    // table (built as a ground/mounted wall graph) doesn't apply to them —
    // same reasoning as moveToward(). The flee row is a single row, so the
    // closest distance to it is just the row difference (straight flight).
    int fleeRow      = isRed ? (height - 1) : 0;
    int curFleeDist  = flyer ? std::abs(c.r - fleeRow)
                             : hexGrid.fleeDistance(myHex, mounted, isRed);

    auto fleeDist = [&](Hex* nh, HexCoord nc) {
        return flyer ? std::abs(nc.r - fleeRow)
                     : hexGrid.fleeDistance(nh, mounted, isRed);
    };

    // ── Primary: simple diagonal flee ────────────────────────────────────────
    // Try the two "natural" backward diagonals (SE+SW for red, NE+NW for blue).
    // Keep only those that don't increase flee distance, then pick the cheapest.
    // Random tiebreak between equal-cost candidates keeps behaviour unpredictable.
    // This matches the feel of the old dumb flee without locking onto one side.
    const HexDirection diagA = isRed ? HexDirection::SE : HexDirection::NE;
    const HexDirection diagB = isRed ? HexDirection::SW : HexDirection::NW;

    struct Cand { HexCoord coord; int cost; };
    Cand best{}; int bestCost = INT_MAX; bool found = false;

    for (HexDirection d : {diagA, diagB}) {
        if (!sidePassable(hexGrid.getSide(c, d), unit->getCategory())) continue;
        HexCoord nc = hexGrid.neighborCoord(c, d);
        Hex* nh = hexGrid.getHex(nc);
        if (!hexAcceptsUnit(nh, *unit)) continue;
        int dist = fleeDist(nh, nc);
        if (dist == HexGrid::UNREACHABLE || dist > curFleeDist) continue;
        int cost = terrainMoveCost(nh, hexGrid.getSide(c, d), unit->getCategory());
        if (!found || cost < bestCost ||
            (cost == bestCost && Utility::getRandom(0, 1) == 0)) {
            best = {nc, cost}; bestCost = cost; found = true;
        }
    }

    if (found) {
        moveAUnit(*unit, best.coord);
        unit->setMovePoints(unit->getMovePoints() - best.cost);
        unit->setTookLateral(false);
        return;
    }

    // ── Fallback: BFS-guided flee ─────────────────────────────────────────────
    // Both diagonals were blocked or would increase distance (e.g. near map edge
    // or behind impassable terrain). Hand off to pickBestDirection so the unit
    // can route around the obstacle rather than rallying in place needlessly.
    bool mustDecrease = unit->getTookLateral();

    DirChoice choice = pickBestDirection(hexGrid, c, curFleeDist, unit->getCategory(),
        [&](Hex* nh, HexCoord nc) { return fleeDist(nh, nc); },
        [&](Hex* nh, HexCoord)    { return hexAcceptsUnit(nh, *unit); });

    if (choice.decrDir >= 0) {
        moveAUnit(*unit, choice.decrCoord);
        unit->setMovePoints(unit->getMovePoints() - choice.decrCost);
        unit->setTookLateral(false);
        return;
    }

    if (!mustDecrease && choice.latDir >= 0) {
        moveAUnit(*unit, choice.latCoord);
        unit->setMovePoints(unit->getMovePoints() - choice.latCost);
        unit->setTookLateral(true);
        return;
    }

    unit->rally();
}

void Battlefield::moveUnits()
{
    // Squad pre-pass: squads claim their target hex before lone units move.
    //
    // Squads run on pooled movement points (AUnit::getMovePoints()): each
    // member regains its movementSpeed per tick — never banking above that
    // base — and every member pays each entered hex's terrain cost, going
    // negative if it must. A member at zero or below blocks the whole squad.
    // A blocked squad pools help once per tick, before moving: the
    // currently-richest member pays 1 point, re-evaluated after each payment,
    // until 3 points are spent — buying the most-drained straggler +1. That
    // repeats until everyone is positive or nobody has 3 points left — faster
    // members finding the path for a slow one and carrying his gear. Aid
    // never fires again mid-tick after a move: it pays off a straggler's
    // debt, it doesn't let a squad outpace what its slowest member could
    // ever walk.
    constexpr int SQUAD_AID_COST = 3;
    auto advanceSquad = [&](Squad& sq) {
        if (sq.tickHold()) return;

        std::vector<AUnit*> members;
        for (AUnit* m : sq.getMembers())
            if (m && m->getAlive() && !m->getBroken())
                members.push_back(m);
        if (members.empty()) return;

        for (AUnit* m : members) {
            // Fold action recovery (an archer's firing recovery, in ticks)
            // into the bank at the member's own per-tick rate, then regain —
            // capped at base so nothing banks above its normal speed.
            int pts = m->getMovePoints()
                      - static_cast<int>(m->getSpentMove()) * m->getMovementSpeed();
            m->setSpentMove(0);
            m->setMovePoints(std::min(pts + m->getMovementSpeed(),
                                      m->getMovementSpeed()));
        }

        auto byPoints = [](AUnit* a, AUnit* b) {
            return a->getMovePoints() < b->getMovePoints();
        };
        auto poorest = [&]() { return *std::min_element(members.begin(), members.end(), byPoints); };
        auto richest = [&]() { return *std::max_element(members.begin(), members.end(), byPoints); };

        // Aid phase — once per tick, see the block comment above.
        while (poorest()->getMovePoints() <= 0
               && richest()->getMovePoints() >= SQUAD_AID_COST) {
            AUnit* straggler = poorest();
            for (int paid = 0; paid < SQUAD_AID_COST; ++paid) {
                AUnit* donor = richest();
                donor->setMovePoints(donor->getMovePoints() - 1);
            }
            straggler->setMovePoints(straggler->getMovePoints() + 1);
        }

        while (poorest()->getMovePoints() > 0) {
            int cost = moveSquad(sq);
            if (cost <= 0) return;
            for (AUnit* m : members)
                m->setMovePoints(m->getMovePoints() - cost);

            // Fresh contact ends the tick's movement — the squad fights from
            // where it met the enemy instead of sliding along the front.
            AUnit* ref = sq.getFlagBearer();
            if (ref && ref->getEngaged(*this)) return;
        }
    };
    for (auto& sq : _red.squads)  if (sq) advanceSquad(*sq);
    for (auto& sq : _blue.squads) if (sq) advanceSquad(*sq);
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
        unit.setMovePoints(unit.getMovePoints() - cost);
    }
    // If no retreat hex is available the unit holds its position.
}

int Battlefield::moveSquad(Squad& squad)
{
    // Navigate and track the per-tick lateral-move flag via the flag bearer
    // rather than the leader: the bearer auto-transfers to the next eligible
    // member on death (Squad::onFlagBearerDeath), so it stays a single stable
    // identity across the squad's lifetime instead of resetting whenever the
    // leader dies — which is what the lateral-move bookkeeping needs.
    AUnit* ref = squad.getFlagBearer();
    if (!ref || !ref->getAlive() || ref->getBroken())
        ref = squad.onFlagBearerDeath();
    if (!ref || !ref->getHex()) return 0;

    // Find enemy target and the best forward hex using BFS — same logic as moveToward.
    Hex* enemyTarget = findTarget(*ref);
    if (!enemyTarget) return 0;

    HexCoord from    = ref->getHex()->coord;
    bool     mounted = (ref->getCategory() == UnitCategory::Mounted);
    bool     flyer   = (ref->getCategory() == UnitCategory::Flyer);

    int curDist = flyer ? HexGrid::distance(from, enemyTarget->coord)
                        : hexGrid.bfsDistance(ref->getHex(), enemyTarget, mounted);
    if (curDist <= 0 || curDist == HexGrid::UNREACHABLE) return 0;

    bool mustDecrease = ref->getTookLateral();

    DirChoice choice = pickBestDirection(hexGrid, from, curDist, ref->getCategory(),
        [&](Hex* nh, HexCoord nc) {
            return flyer ? HexGrid::distance(nc, enemyTarget->coord)
                         : hexGrid.bfsDistance(nh, enemyTarget, mounted);
        },
        [&](Hex* nh, HexCoord) {
            if (!nh || (nh->impassable && !flyer)) return false;
            if (mounted && (nh->terrain == TerrainType::Forest || nh->terrain == TerrainType::Marsh)) return false;
            for (AUnit* u : nh->units)
                if (u && u->getAlive() && u->getTeam() != ref->getTeam()) return false;
            return true;
        });

    // Squad size for alive non-broken members, used by the capacity/displacement
    // check below — a squad always moves as one atomic block.
    int squadSize = 0;
    for (AUnit* m : squad.getMembers())
        if (m && m->getAlive() && !m->getBroken())
            squadSize += static_cast<int>(m->getPackingSize());

    Hex* fromHex = ref->getHex();
    bool engaged = ref->getEngaged(*this);

    // Each candidate is committed atomically by trySquadEnter (capacity + ≤25%
    // loner displacement); a failed attempt changes nothing, so we fall through
    // to the next.
    //
    // 1. Advance — a distance-decreasing move always takes priority.
    if (choice.decrDir >= 0 && trySquadEnter(squad, choice.decrHex, fromHex, squadSize)) {
        ref->setTookLateral(false);
        return choice.decrCost;
    }
    // 2. Lateral — only when free to (not engaged, not owed a decrease after a
    //    previous lateral step).
    if (!engaged && !mustDecrease && choice.latDir >= 0
        && trySquadEnter(squad, choice.latHex, fromHex, squadSize)) {
        ref->setTookLateral(true);
        return choice.latCost;
    }
    // 3. Spread — a non-engaged squad that cannot advance equalizes crowding,
    //    relocating as one block toward the emptier passable neighbour (the
    //    whole-squad analogue of a loner's reserve-gradient reinforcement).
    //    Skipped while engaged: an engaged squad holds the line and never
    //    abandons contact to redistribute.
    if (!engaged) {
        ReinforceChoice sp = bestSquadSpreadNeighbor(hexGrid, fromHex, *ref, squadSize);
        if (sp.hex && trySquadEnter(squad, sp.hex, fromHex, squadSize)) {
            ref->setTookLateral(false);
            return sp.cost;
        }
    }
    return 0; // nothing legal — squad holds position
}

void Battlefield::moveTeam(Team& team)
{
    for (auto& unit : team.units) {
        if (!unit || !unit->getAlive()) continue;
        AUnit& u = *unit;

        int speed = u.getMovementSpeed();
        if (speed == 0) continue; // immobile unit — never moves

        // Regain this tick's movement points, never banking above base.
        // Debt from earlier hexes recovers here at `speed` per tick.
        auto regain = [&]() {
            u.setMovePoints(std::min(u.getMovePoints() + speed, speed));
        };

        if (u.getBroken()) {
            // Broken units flee on the same points bank — each step re-checks
            // the map-edge escape and rally outcomes inside flee(). Stop when
            // the unit escaped, rallied, or made no progress (blocked or
            // recovering from exhaustion — never more than one recover()).
            regain();
            while (u.getMovePoints() > 0) {
                if (!u.getAlive() || !u.getBroken() || !u.getHex()) break;
                Hex* before = u.getHex();
                flee(unit);
                if (!u.getAlive() || u.getHex() == before) break;
            }
            continue;
        }
        // Non-broken squad members already moved in the squad pre-pass
        // (which also handles their regen — don't bank them twice).
        if (u.getSquad()) continue;
        if (u.tickHold()) continue; // holding position (ticks once per tick, not per hex)

        // Step while the bank is positive, re-evaluating target and
        // engagement between steps so a fast unit can't charge past a
        // contact made mid-tick. A stationary step (blocked, holding at
        // preferred range, engaged shuffle, or burning a tick of action
        // recovery) always ends the tick's movement.
        regain();
        while (u.getMovePoints() > 0) {
            Hex* before = u.getHex();
            bool more = moveUnitStep(unit);
            if (!u.getAlive() || u.getHex() == before) break;
            if (!more) break;
        }
    }
}

bool Battlefield::moveUnitStep(std::unique_ptr<AUnit>& unit)
{
    AUnit& u = *unit;
    if (!u.getAlive() || !u.getHex()) return false;
    if (u.getFatigue() >= 100 || u.getCast() > 0) return false; // exhausted or casting

    Hex*   before     = u.getHex();
    size_t debtBefore = u.getSpentMove();
    // Progress = changed hex or burned a tick of action recovery (archer
    // fire); anything else means this unit is done moving for the tick.
    auto progressed = [&]() {
        return u.getHex() != before || u.getSpentMove() < debtBefore;
    };
    // Fresh contact ends the tick's movement: the unit fights from where it
    // met the enemy instead of sliding along the front it just reached.
    auto stopAtContact = [&]() { return progressed() && !u.getEngaged(*this); };

    // Ranged units (archers, mages, necromancers) maintain a preferred
    // distance. preferredRange > 1 means they back away when enemies
    // close in and hold position once at the right distance, rather than
    // advancing into melee. Falls through to normal melee logic when
    // preferredRange drops to 0 or 1 (e.g. archer out of ammo).
    int pref = u.getPreferredRange();
    if (pref > 1) {
        Hex* enemyHex = findTarget(u);
        if (!enemyHex) return false;
        int dist = HexGrid::distance(u.getHex()->coord, enemyHex->coord);
        if (dist < pref)
            retreatToRange(unit);       // too close — back away
        else if (dist > pref)
            moveToward(unit, enemyHex); // too far — close to preferred range
        else
            return false;               // at preferred range — hold
        return progressed();
    }

    if (u.getEngaged(*this)) {
        // Engaged units never multi-step: seated ranks hold inside
        // moveToward(), a fatigued unit rests as a reserve, and an unseated
        // reserve's reinforcement shuffle is a once-per-tick decision.
        if (u.getFatigue() > FATIGUE_VERY_TIRED) return false;
        Hex* target = findTarget(u);
        if (target) moveToward(unit, target);
        return false;
    }

    Hex* target = findTarget(u);
    if (!target) return false;
    moveToward(unit, target);
    return stopAtContact();
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

// Narrate deaths into the tick log before the dead are pruned, so a replay
// can show what was lost this tick. Uses the catalog symbol→name mapping;
// symbols outside the catalog (e.g. loose-horse 'H') fall back to the symbol.
void Battlefield::logDeaths(const Team& team)
{
    for (const auto& u : team.units) {
        if (!u || u->getAlive()) continue;
        std::string name = unitNameForSymbol(u->getPrintSymbol());
        if (name.empty()) name = std::string(1, u->getPrintSymbol());
        logEvent(name + (team.id == REDTEAM ? " (red)" : " (blue)") + " fell");
    }
}

void Battlefield::cleanup()
{
    logDeaths(_red);
    logDeaths(_blue);

    // Both teams' non-undead dead feed the one shared corpse pool that
    // raise_dead spends — a corpse is a corpse regardless of its banner.
    corpses += _blue.pruneDeadUnits();
    corpses += _red.pruneDeadUnits();
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
    _tickLog.clear();
    _reinforcements.clear();
    _ticksRun = 0;
    _maxTicks = DEFAULT_MAX_BATTLE_TICKS;
}

void Battlefield::loadArmies(Army red, Army blue)
{
    _red.units  = std::move(red);
    _blue.units = std::move(blue);
    // New battle, fresh day: zero every per-battle accumulator so the result
    // reflects THIS battle only. Production always reset()s first, but the
    // engine tests reuse the Utility::getBattlefield() singleton across cases
    // without one, so loadArmies must not inherit the prior battle's corpse
    // count / tick log (that leak surfaced as corpses==1 on empty armies).
    _ticksRun = 0;
    corpses   = 0;
    _tickLog.clear();
    _reinforcements.clear(); // per-battle; scheduled AFTER loadArmies by callers
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
    for (HexSide& side : grid.getSides())
        if (sideIsEngagedNow(side)) side.engaged = true;
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
            sz += static_cast<int>(m->getPackingSize()) * fatigueWeight(f);
        }
        if (sz > 0) groups.push_back({sq, sz, {}});
    }
    {
        int lonerSz = 0;
        for (AUnit* u : hex->units) {
            if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
            int f = u->getFatigue();
            if (f >= FATIGUE_MAX) continue;
            lonerSz += static_cast<int>(u->getPackingSize()) * fatigueWeight(f);
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

// ── Ranked fill helpers ───────────────────────────────────────────────────────
//
// Each engaged HexSide has 3 ranked pools: ri=0 (rank 1 / frontline),
// ri=1 (rank 2 / backup), ri=2 (rank 3 / reserve). Each pool has the same
// size capacity as effectiveFrontage(side).
//
// Only rank-1 units (ri==0) get setEngagedSide + setCanFight(true).
// _engagedRank persists across ticks so loners promote one rank per tick;
// squad members are re-seated top-down from rank 1 each tick.

struct RankSlots {
    int                  frontage = 0;
    std::vector<AUnit*>  units;
};

// Try to place `u` in rank `ri` of side `si`.
// In rank 1 (ri==0) only: evicts the smallest seated unit (pushing it to rank 2
// if capacity allows) when `u` doesn't fit and something smaller is present.
// Returns false if `u` cannot be placed (nothing smaller to evict, or still too
// large after eviction).
//
// Eviction is SUPPRESSED for a hang-back unit (getAvoidsMelee, SLICE 5): it
// reaches rank 1 only in the second seating phase, once the line has already
// been manned with everyone willing to hold it, and a unit that is there
// under protest must never shove a fighter out of the front to take his place.
// It takes leftover frontage or it takes nothing.
static bool tryAssignToRankSlot(AUnit* u, size_t si, int ri,
                                 const std::vector<HexSide*>& sides,
                                 std::vector<std::array<RankSlots, 3>>& ranks)
{
    int cap = effectiveFrontage(*sides[si]);
    RankSlots& slot = ranks[si][ri];

    if (ri == 0 && !u->getAvoidsMelee()) {
        // Eviction within rank 1: push the smallest displaced unit to rank 2 (if space).
        while (slot.frontage + static_cast<int>(u->getPackingSize()) > cap && !slot.units.empty()) {
            size_t smallestIdx = 0;
            for (size_t i = 1; i < slot.units.size(); ++i)
                if (slot.units[i]->getPackingSize() < slot.units[smallestIdx]->getPackingSize())
                    smallestIdx = i;
            AUnit* smallest = slot.units[smallestIdx];
            if (smallest->getPackingSize() >= u->getPackingSize())
                return false; // nothing strictly smaller — unit can't push its way in

            slot.frontage -= static_cast<int>(smallest->getPackingSize());
            slot.units.erase(slot.units.begin() + static_cast<long>(smallestIdx));
            smallest->setCohesionBonus(0); // was set by squad pass; clear since demoted

            // Demote evicted unit to rank 2 if there is room, otherwise unseat it.
            RankSlots& rank2 = ranks[si][1];
            if (rank2.frontage + static_cast<int>(smallest->getPackingSize()) <= cap) {
                rank2.frontage += static_cast<int>(smallest->getPackingSize());
                rank2.units.push_back(smallest);
                smallest->setEngagedRank(2);
            } else {
                smallest->setEngagedRank(0); // fully unseated
            }
        }
    }

    if (slot.frontage + static_cast<int>(u->getPackingSize()) > cap) return false;
    slot.frontage += static_cast<int>(u->getPackingSize());
    slot.units.push_back(u);
    u->setEngagedRank(ri + 1); // convert 0-indexed ri to 1-indexed rank
    // formationSide is applied in the final apply loop after all ranks are filled,
    // so we don't set it here (sides[si] is available there).
    return true;
}

// Seat squad members (fatigue in [fatLow, fatHigh)) into their squad's allocated sides.
// Top-down fill: rank 1 first, then rank 2, then rank 3.
// Round-robin across owned sides within each rank level for even distribution.
//
// `avoiders` selects WHICH seating phase this is: false seats every unit that
// will hold the line, true seats the hang-back ones afterwards (SLICE 5
// decision 5-8). The phase split is the WHOLE of the hang-back rule, and it
// needs no special cascade to go with it: a hang-back unit runs the same
// top-down fill as anyone else, so it takes rank-1 frontage that phase 1 left
// over and otherwise falls to the rear ranks. Leftover frontage at the front
// after every willing body has been seated IS the "unless we run out of troops"
// condition — there is nothing to count.
//
// (Seating avoiders BACK-FIRST instead, rank 2 → 3 → 1, looks equivalent and is
// not: the rear ranks always have room, so the last mage on the field would
// tuck himself into rank 2 and watch the line stand empty.)
static void fillSquadPassRanked(Squad* sq, Hex* hex,
                                 const std::vector<HexSide*>& sides,
                                 const std::vector<Squad*>& sideOwner,
                                 std::vector<std::array<RankSlots, 3>>& ranks,
                                 int fatLow, int fatHigh, bool avoiders)
{
    std::vector<AUnit*> members;
    for (AUnit* m : sq->getMembers()) {
        if (!m || !m->getAlive() || m->getBroken() || m->getHex() != hex) continue;
        if (m->getAvoidsMelee() != avoiders) continue;
        int f = m->getFatigue();
        if (f < fatLow || f >= fatHigh) continue;
        members.push_back(m);
    }
    if (members.empty()) return;
    std::sort(members.begin(), members.end(),
              [](AUnit* a, AUnit* b){ return a->biggerThan(b); });

    std::vector<size_t> ownedSides;
    for (size_t si = 0; si < sides.size(); ++si)
        if (sideOwner[si] == sq) ownedSides.push_back(si);
    if (ownedSides.empty()) return;

    int cohTier = cohesionTierForHex(hex, sq->cohesionLevel());
    size_t startIdx = 0;

    for (AUnit* u : members) {
        bool assigned = false;
        // Top-down: try rank 1 → 2 → 3 across all owned sides.
        for (int ri = 0; ri < 3 && !assigned; ++ri) {
            for (size_t attempt = 0; attempt < ownedSides.size() && !assigned; ++attempt) {
                size_t si = ownedSides[(startIdx + attempt) % ownedSides.size()];
                if (!tryAssignToRankSlot(u, si, ri, sides, ranks)) continue;
                if (ri == 0) u->setCohesionBonus(cohTier); // cohesion only in rank 1
                startIdx = (startIdx + 1) % ownedSides.size();
                assigned = true;
            }
        }
        (void)assigned;
    }
}

// Place lone units (fatigue in [fatLow, fatHigh)):
//   • Existing loners (_engagedRank > 0): promote exactly one rank per tick
//     (or stay at their current rank if the better rank is full).
//     Prefer non-squad sides first, then squad sides as fallback.
//   • New loners (_engagedRank == 0): cascade from rank 1 → 2 → 3.
//     Prefer non-squad sides; only fall back to squad-owned sides when no
//     non-squad side can accommodate them at any rank.
static void fillLonerPassRanked(Hex* hex,
                                 const std::vector<HexSide*>& sides,
                                 const std::vector<Squad*>& sideOwner,
                                 std::vector<std::array<RankSlots, 3>>& ranks,
                                 int fatLow, int fatHigh, bool avoiders)
{
    std::vector<AUnit*> existingLoners, newLoners;
    for (AUnit* u : hex->units) {
        if (!u || !u->getAlive() || u->getBroken() || u->getSquad()) continue;
        if (u->getAvoidsMelee() != avoiders) continue;
        int f = u->getFatigue();
        if (f < fatLow || f >= fatHigh) continue;
        if (u->getEngagedRank() > 0) existingLoners.push_back(u);
        else                          newLoners.push_back(u);
    }

    std::sort(existingLoners.begin(), existingLoners.end(),
              [](AUnit* a, AUnit* b){ return a->biggerThan(b); });
    std::sort(newLoners.begin(), newLoners.end(),
              [](AUnit* a, AUnit* b){ return a->biggerThan(b); });

    // Partition sides into free (unclaimed) and squad-owned.
    std::vector<size_t> freeSides, squadSides;
    for (size_t si = 0; si < sides.size(); ++si)
        (sideOwner[si] == nullptr ? freeSides : squadSides).push_back(si);

    // Helper: try a unit on a list of sides at a specific rank index.
    auto tryOnSides = [&](AUnit* u, int ri, const std::vector<size_t>& siList) -> bool {
        for (size_t si : siList)
            if (tryAssignToRankSlot(u, si, ri, sides, ranks)) return true;
        return false;
    };

    // Existing loners: promote one rank (or stay). Prefer free sides, then squad sides.
    for (AUnit* u : existingLoners) {
        int prevRank = u->getEngagedRank(); // 1-indexed
        int targetRi = std::max(0, prevRank - 2); // 0-indexed rank one better (clamped to ri=0)
        int stayRi   = prevRank - 1;              // 0-indexed current rank

        bool placed = tryOnSides(u, targetRi, freeSides)
                   || tryOnSides(u, targetRi, squadSides);
        if (!placed && stayRi != targetRi)
            placed = tryOnSides(u, stayRi, freeSides)
                  || tryOnSides(u, stayRi, squadSides);
        (void)placed; // if unseated this tick, _engagedRank keeps its old value for next tick
    }

    // New loners: cascade rank 1 → 2 → 3; free sides preferred at each level.
    for (AUnit* u : newLoners) {
        bool placed = false;
        for (int ri = 0; ri < 3 && !placed; ++ri) {
            placed = tryOnSides(u, ri, freeSides)
                  || tryOnSides(u, ri, squadSides);
        }
        (void)placed;
    }
}

void Battlefield::resolveEngagements()
{
    // resetUnitFlags clears canFight / engagedSide / cohesionBonus but intentionally
    // does NOT reset _engagedRank — that field persists across ticks so loners
    // can promote one rank per tick.
    _red.resetUnitFlags();
    _blue.resetUnitFlags();

    markEngagedSides(hexGrid);
    auto hexSideMap = buildHexSideMap(hexGrid);

    for (auto& [hex, sides] : hexSideMap) {
        const auto squadsHere = collectSquadsInHex(hex);
        std::vector<Squad*> sideOwner(sides.size(), nullptr);
        allocateSidesToGroups(hex, sides, squadsHere, sideOwner);

        // Per-side, per-rank slot tracking [sideIdx][ri=0,1,2].
        std::vector<std::array<RankSlots, 3>> ranks(sides.size());

        // The whole seating sequence runs TWICE (SLICE 5 decision 5-8): once for
        // everyone who will hold the line, then once for the hang-back units.
        // Phase 2 sees whatever frontage phase 1 could not fill, which is what
        // makes "hang back unless we run out of troops" exact — including the
        // desperate very-tired pass, so a hang-back mage is still a later
        // resort than a man who can barely stand.
        for (bool avoiders : {false, true}) {
            // Squad pass (top-down): fresh → tired → very tired.
            for (Squad* sq : squadsHere)
                fillSquadPassRanked(sq, hex, sides, sideOwner, ranks, 0,             FATIGUE_TIRED,      avoiders);
            for (Squad* sq : squadsHere)
                fillSquadPassRanked(sq, hex, sides, sideOwner, ranks, FATIGUE_TIRED, FATIGUE_VERY_TIRED, avoiders);
            fillLonerPassRanked(hex, sides, sideOwner, ranks, 0,             FATIGUE_TIRED,      avoiders);
            fillLonerPassRanked(hex, sides, sideOwner, ranks, FATIGUE_TIRED, FATIGUE_VERY_TIRED, avoiders);
            // Desperate pass: very tired units when sides would otherwise sit empty.
            for (Squad* sq : squadsHere)
                fillSquadPassRanked(sq, hex, sides, sideOwner, ranks, FATIGUE_VERY_TIRED, FATIGUE_MAX, avoiders);
            fillLonerPassRanked(hex, sides, sideOwner, ranks, FATIGUE_VERY_TIRED, FATIGUE_MAX, avoiders);
        }

        // Apply results: rank-1 units hold the boundary (engagedSide + canFight).
        // Rank 2/3 units get formationSide so the renderer can draw them in depth.
        for (size_t si = 0; si < sides.size(); ++si) {
            for (int ri = 0; ri < 3; ++ri) {
                for (AUnit* u : ranks[si][ri].units) {
                    u->setFormationSide(sides[si]);
                    if (ri == 0) {
                        u->setEngagedSide(sides[si]);
                        u->setCanFight(true);
                    }
                }
            }
        }
    }
}

void Battlefield::onTurnStart()
{
    for (auto& u : _red.units)  if (u && u->getAlive()) u->recover();
    for (auto& u : _blue.units) if (u && u->getAlive()) u->recover();

    for (auto& u : _red.units)  if (u) { u->resetAttacksReceived(); u->resetRepelMalus(); }
    for (auto& u : _blue.units) if (u) { u->resetAttacksReceived(); u->resetRepelMalus(); }

    RangedCombat::resetCache();

    debugAsserts();
}

void Battlefield::onTurnEnd()
{
    cleanup();
}

void Battlefield::fireScheduledReinforcements()
{
    const int turn = _ticksRun + 1; // tick() has not yet incremented _ticksRun
    for (Reinforcement& r : _reinforcements)
        if (!r.fired && r.tick <= turn) {
            Spells::castGarrisonSally(*this, r);
            r.fired = true; // fires exactly once, even if its turn is overshot
        }
}

bool Battlefield::tick()
{
    // Turn header first, so the events of this tick follow it in the replay
    // log (and in the DB's per-tick log via ReplayRecorder).
    logEvent("Turn " + std::to_string(_ticksRun + 1));
    onTurnStart();
    // Reinforcements land BEFORE the acting phases, so a wave can move, cast
    // and fight on the very tick it arrives. Deliberate (asked and confirmed
    // 2026-08-09): a tick is an abstraction, not a stopwatch, and "it arrived
    // during the turn" is answer enough. Holding a wave for a tick would buy a
    // marginal bit of fiction for a real chunk of machinery — an arrival flag
    // to set, honour and clear across four phases. Don't add it.
    fireScheduledReinforcements();
    triggerSpecialPhase();
    moveUnits();
    resolveEngagements();
    makeBattle();
    onTurnEnd();
    ++_ticksRun;
    if (_ticksRun >= _maxTicks) {
        logEvent("The day is over — the battle ends as it stands");
        return false;
    }
    return countTeam(REDTEAM) > 0 && countTeam(BLUETEAM) > 0;
}

BattleResult Battlefield::extractResult()
{
    BattleResult result;
    result.corpses = corpses;
    // Both sides still standing = draw (battle ended on the turn limit or an
    // aborted run, not by annihilation); otherwise the surviving side wins.
    size_t redLeft  = countTeam(REDTEAM);
    size_t blueLeft = countTeam(BLUETEAM);
    result.winner = (redLeft > 0 && blueLeft > 0) ? 0 :
                    (redLeft > 0)  ? REDTEAM :
                    (blueLeft > 0) ? BLUETEAM : 0;

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
    // Spells first, then the remaining virtual special() hook (only Archer
    // until Stage R1 moves ranged attacks onto weapons). Casters have no
    // special() override and archers no spells, so no unit acts twice —
    // when a unit can eventually do both, priority is decided here.
    //
    // Act on a snapshot of the phase-start roster: summons (raise_dead)
    // push_back into the very vector being walked, which invalidates live
    // iterators — and units raised this phase must not act this phase.
    // Raw pointers stay valid; nothing is destroyed until cleanup().
    auto actPhaseStart = [](std::vector<std::unique_ptr<AUnit>>& units) {
        std::vector<AUnit*> roster;
        roster.reserve(units.size());
        for (auto& unit : units)
            if (unit) roster.push_back(unit.get());
        for (AUnit* unit : roster)
            if (unit->getFatigue() < FATIGUE_MAX && unit->getAlive()) {
                unit->castSpells();
                unit->special();
            }
    };
    actPhaseStart(_red.units);
    actPhaseStart(_blue.units);
}

size_t Battlefield::getCorpses()      { return corpses; }
void   Battlefield::setCorpses(size_t c) { corpses = c; }
