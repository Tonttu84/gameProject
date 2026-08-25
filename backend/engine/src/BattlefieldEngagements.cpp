// ─── Battlefield: the ENGAGEMENT phase ───────────────────────────────────────
// One of three translation units that make up Battlefield (the others are
// Battlefield.cpp — the owner/coordinator — and BattlefieldMovement.cpp).
// Split out 2026-08-25, before DESIGN.md's frontage/formation system lands
// here and makes this the biggest phase of the three. Nothing moved between
// the phases and no behaviour changed.
//
// Owns: resolveEngagements() and the whole seating machinery it drives —
// marking which hexsides are contested, mapping sides to hexes, allocating a
// hex's sides to the squads standing in it, and the ranked fill passes that
// seat squads before loners and fresh units before tired ones.
//
// sideIsEngagedNow() lives here rather than with the movement helpers it also
// serves: it is the predicate markEngagedSides() sets HexSide::engaged from,
// so the definition belongs next to the flag it defines. Movement reads it
// live (see its comment) because the flag is a tick stale by the time
// movement runs.
#include "Battlefield.hpp"
#include <algorithm>
#include <cstdlib>
#include <unordered_map>

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
