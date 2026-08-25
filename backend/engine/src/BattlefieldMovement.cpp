// ─── Battlefield: the MOVEMENT phase ─────────────────────────────────────────
// One of three translation units that make up Battlefield (the others are
// Battlefield.cpp — the owner/coordinator — and BattlefieldEngagements.cpp).
// Split out 2026-08-25: Battlefield.cpp was ~1500 lines with three unrelated
// tick phases sharing one file, and DESIGN.md's frontage/formation system is
// due to land in the engagement phase. Nothing moved between the phases and
// no behaviour changed — the file boundaries follow Battlefield::tick()'s own
// phase order.
//
// Owns: everything the movement pre-pass and per-unit movement need — terrain
// costs and passability, the reserve-gradient reinforcement scan, squad entry,
// direction choice, and the Battlefield methods that drive them (moveUnits,
// moveTeam, moveSquad, moveUnitStep, moveToward, flee, retreatToRange).
// The statics here are file-local on purpose: they are movement's own rules,
// and the only one the engagement phase also needed (sideIsEngagedNow) lives
// with the engagement code instead.
#include "Battlefield.hpp"
#include <algorithm>
#include <climits>
#include <cstdlib>


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
            // M-25: a body past the exhaustion line regains NOTHING on its own —
            // it has passed out. The aid loop below is then the only thing that
            // moves it, which is precisely "faster members finding the path for
            // a slow one and carrying his gear". An overcast mage (M-2 can put
            // him here) is carried by his squad rather than stranding it.
            // Loners already get this: moveUnitStep refuses to move them at all.
            int regain = (m->getFatigue() >= FATIGUE_MAX) ? 0 : m->getMovementSpeed();
            m->setMovePoints(std::min(pts + regain, m->getMovementSpeed()));
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
