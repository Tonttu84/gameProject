#include "RangedCombat.hpp"
#include "AUnit.hpp"
#include "Battlefield.hpp"
#include "Utility.hpp"
#include <algorithm>
#include <string>

std::unordered_map<const Hex*, RangedCombat::SlotCache> RangedCombat::cache;

void RangedCombat::resetCache()
{
    cache.clear();
}

const RangedCombat::SlotCache& RangedCombat::getSlotCache(const Hex* hex)
{
    auto it = cache.find(hex);
    if (it != cache.end()) return it->second;

    SlotCache& sc = cache[hex];
    for (AUnit* u : hex->units)
        if (u) sc.units.push_back(u);
    return sc;
}

AUnit* RangedCombat::pickHexTarget(const Hex* hex)
{
    const SlotCache& sc = getSlotCache(hex);
    if (sc.units.empty()) return nullptr;

    // Roll 1–640 and walk the cumulative size ranges to find who gets hit.
    // A hex with 3 size-10 humans occupies slots 1-30 out of 640;
    // the remaining 610 slots are empty ground — sparse lines are hard to hit.
    int roll       = Utility::getRandom(1, Hex::CAPACITY);
    int cumulative = 0;
    for (AUnit* u : sc.units) {
        cumulative += static_cast<int>(u->getSize());
        if (roll <= cumulative) return u;
    }
    return nullptr; // projectile hit empty ground
}

void RangedCombat::applyHit(AUnit* shooter, AUnit* target, const RangedShot& shot,
                            int baseDamage, int elevDmgBonus)
{
    bool extraBlocked   = target->tryBlockExtraShield();
    bool terrainBlocked = !extraBlocked && target->rollTerrainRangedBlock(shot.pen);
    bool blocked        = extraBlocked || terrainBlocked;

    if (shot.onHit) shot.onHit(shooter, target, blocked);

    // Forest cover (terrain block) is physical concealment: Piercing halves its
    // protection rather than negating it, matching defend()'s shield halving.
    // Extra-shield (force field) blocks aren't physical, so they keep the flat
    // reduction regardless of pen.
    int reduction = 0;
    if (blocked) {
        reduction = (terrainBlocked && shot.pen == ArmorPen::Piercing)
                    ? SHIELDREDUCTION / 2
                    : SHIELDREDUCTION;
    }

    int damage = baseDamage + elevDmgBonus - reduction;
    if (damage <= 0) {
        // TRACE (L-4): a shot that arrived and did nothing. Worth a line of its
        // own — "no line at all" and "hit for zero" look identical in a log, and
        // this is exactly the case S4-8 flagged, where damage SPELLS resolve as
        // a RangedShot and so said nothing whatever about what they did.
        Utility::getBattlefield().logEvent(LogTier::Trace,
            target->logName() + " is grazed for nothing (base " + std::to_string(baseDamage)
            + (blocked ? ", blocked" : "") + ")");
        return;
    }

    Utility::getBattlefield().logEvent(LogTier::Trace,
        target->logName() + " is struck for " + std::to_string(damage)
        + " (base " + std::to_string(baseDamage)
        + (elevDmgBonus ? ", elevation " + std::to_string(elevDmgBonus) : "")
        + (blocked ? ", blocked -" + std::to_string(reduction) : "") + ")");

    target->takeDamage(damage, shot.pen);
    if (shot.onDamage) shot.onDamage(shooter, target, damage);
}

void RangedCombat::fire(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot)
{
    if (!shooter || !shooter->getHex() || !aimUnit || !aimUnit->getHex()) return;

    int dist = Utility::calcDistance(shooter->getHex(), aimUnit->getHex());

    int elevTiers    = std::clamp(shooter->getHex()->elevation - aimUnit->getHex()->elevation,
                                  -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;
    int shotAccuracy = std::clamp(shot.accuracy + elevTiers * ELEV_RANGED_BONUS * 10, 0, 100);

    Hex* landedHex = Utility::Deviate(*shooter->getHex(),
                                      aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r,
                                      shotAccuracy);
    if (!landedHex) return;

    AUnit* target = resolveHit(aimUnit, landedHex, dist, shotAccuracy);
    if (target && target->getAlive())
        applyHit(shooter, target, shot, shot.baseDamage, elevDmgBonus);

    // An area always goes off on the hex regardless of whether the primary shot
    // found someone — same as an inaccurate single shot falling back to
    // pickHexTarget() on the landed hex. No archer carries one, so this is a
    // no-op here; it is on the shared path rather than behind an `if` because
    // there is exactly one way a blast spreads, whoever threw it.
    coverArea(shooter, landedHex, shot, elevDmgBonus, target);
}

// ── Area of effect (T-6, T-7 — slice TG-2) ───────────────────────────────────
//
// The old splash asked the hex N times "who is standing somewhere random", so
// N large enough eventually found every man in it. T-6 replaces that with a
// SHAPE: a number of hex size points, laid down as one contiguous arc of the
// hex's 640 slots from a rolled start, wrapping past 640 back to 1. Whom it
// strikes is then a fact about where the men stand, not about how many times
// the blast rolled — the user's reason for rejecting a per-spot lottery.
//
// The rolls below are COMBAT rolls, made at delivery time exactly as
// pickHexTarget's are, so they go through Utility::getRandom and the suite pins
// them with pushDiceRoll. The scorer never rolls at all (A-1).

// Does the arc [start, start + points) — 1-based slots, wrapping — overlap the
// `size` slots a body occupies from `begin`?
//
// Measured in offsets FROM the arc's start, which makes the wrap disappear: the
// arc is offsets 0..points-1, and the body is `size` consecutive offsets from
// o0. If those wrap past the end they include offset 0, which the arc always
// holds; otherwise the body's lowest offset is o0 and one comparison settles it.
static bool arcCovers(int start, int points, int begin, int size)
{
    int o0 = (begin - start + Hex::CAPACITY) % Hex::CAPACITY;
    if (o0 + size > Hex::CAPACITY) return true;
    return o0 < points;
}

void RangedCombat::coverHex(AUnit* shooter, Hex* hex, int points, const RangedShot& shot,
                            int elevDmgBonus, AUnit* already, std::vector<AUnit*>& struck)
{
    if (!hex || points <= 0) return;

    // The SAME layout pickHexTarget rolls into — the phase's slot cache, in
    // cache order, each body getSize() slots wide from slot 1 — because they
    // are the same 640 slots and two layouts would be two answers to "who is
    // standing here". Empty ground first: nothing to strike and, exactly as
    // pickHexTarget does it, nothing to roll for either.
    const SlotCache& sc = getSlotCache(hex);
    if (sc.units.empty()) return;

    // 640 points or more is the whole hex, deterministically: there is no start
    // that would leave a slot uncovered, so there is nothing to roll.
    const bool full  = points >= Hex::CAPACITY;
    const int  start = full ? 1 : Utility::getRandom(1, Hex::CAPACITY);

    int cumulative = 0;
    for (AUnit* u : sc.units) {
        const int begin = cumulative + 1;
        const int size  = static_cast<int>(u->getSize());
        cumulative += size;   // dead bodies keep their slots, as the cache keeps them

        if (u == already) continue;          // T-6: once per body per cast, and the
                                              // primary already took shot.baseDamage
        if (!u->getAlive()) continue;
        if (std::find(struck.begin(), struck.end(), u) != struck.end()) continue;
        if (!full && !arcCovers(start, points, begin, size)) continue;

        struck.push_back(u);
        // NO team filter, here or anywhere in coverage (T-7): the blast strikes
        // what it covers. onDamage runs per body, so an effect hung on a hit —
        // drain_life's healing, say — would fire once for each body an area
        // struck. No area spell carries one today; a spell that does is
        // authoring N triggers, and should mean to.
        applyHit(shooter, u, shot, shot.areaDamage, elevDmgBonus);
    }
}

std::vector<Hex*> RangedCombat::ringHexes(const Hex* centre, int k)
{
    std::vector<Hex*> ring;
    if (!centre || k < 0) return ring;

    HexGrid& grid = Utility::getBattlefield().hexGrid;
    if (k == 0) {
        if (Hex* self = grid.safeGetHex(centre->coord.q, centre->coord.r)) ring.push_back(self);
        return ring;
    }

    // BFS outward over neighbours, one layer at a time, so ring 1 comes back in
    // neighbour order and every later ring in a discovery order derived from it.
    // Off-map neighbours are simply never queued, which is how a ring at the
    // edge of the map comes back short instead of holding holes.
    std::vector<HexCoord> frontier{ centre->coord };
    std::vector<HexCoord> seen{ centre->coord };
    for (int depth = 1; depth <= k; ++depth) {
        std::vector<HexCoord> next;
        for (const HexCoord& c : frontier)
            for (const HexCoord& n : grid.neighbors(c)) {
                if (!grid.getHex(n)) continue;
                if (std::find(seen.begin(), seen.end(), n) != seen.end()) continue;
                seen.push_back(n);
                next.push_back(n);
            }
        frontier = std::move(next);
        if (frontier.empty()) break;   // the map ran out before the radius did
    }

    for (const HexCoord& c : frontier)
        if (Hex* h = grid.getHex(c)) ring.push_back(h);
    return ring;
}

// The smallest radius whose on-map hexes could hold `points` (640 each), and
// those hexes. Radius 0 is the landed hex alone. Stops growing when a ring adds
// nothing — a small map cannot be asked for more room than it has.
static std::vector<Hex*> ringSetFor(const Hex* centre, int points)
{
    std::vector<Hex*> set = RangedCombat::ringHexes(centre, 0);
    for (int k = 1; static_cast<int>(set.size()) * Hex::CAPACITY < points; ++k) {
        std::vector<Hex*> ring = RangedCombat::ringHexes(centre, k);
        if (ring.empty()) break;
        set.insert(set.end(), ring.begin(), ring.end());
    }
    return set;
}

void RangedCombat::coverArea(AUnit* shooter, Hex* landedHex, const RangedShot& shot,
                             int elevDmgBonus, AUnit* already)
{
    if (!landedHex || shot.areaMode == AreaMode::None || shot.areaPoints <= 0) return;

    std::vector<AUnit*> struck;   // the once-per-body ledger, for the whole cast
    int hexesCovered = 0;

    if (shot.areaMode == AreaMode::Explosion) {
        // The landed hex takes the first 640; when it is full the next ring
        // opens, 640 a hex, and so outward until the points run out. ONE
        // rotation roll for the cast, drawn the first time a ring opens, so no
        // compass direction is favoured — and so an area that never leaves the
        // landed hex costs no roll at all.
        int left = shot.areaPoints;
        int rot  = -1;
        for (int k = 0; left > 0; ++k) {
            std::vector<Hex*> ring = ringHexes(landedHex, k);
            if (k > 0 && ring.empty()) break;   // past the edge of the map
            if (k > 0) {
                if (rot < 0) rot = Utility::getRandom(0, 5);
                // Rotate by rot SIDES rather than by rot hexes: ring k holds up
                // to 6k of them, and turning by a whole side is what "no fixed
                // direction is favoured" means once a ring is longer than six.
                // For ring 1 the two are the same thing.
                const size_t by = (static_cast<size_t>(rot) * static_cast<size_t>(k))
                                  % ring.size();
                std::rotate(ring.begin(), ring.begin() + static_cast<long>(by), ring.end());
            }
            for (Hex* h : ring) {
                if (left <= 0) break;
                const int give = std::min(left, Hex::CAPACITY);
                coverHex(shooter, h, give, shot, elevDmgBonus, already, struck);
                left -= give;
                ++hexesCovered;
            }
        }
    } else {
        // RANDOM: AREA_CHUNK-sized chunks, each dropped on a hex drawn uniformly
        // over the smallest ring set that could hold the whole area, and every
        // hex that received points then covers them as one arc — so the chunks
        // that landed together are ONE stretch of ground, not a scatter of
        // separate blasts.
        std::vector<Hex*> set = ringSetFor(landedHex, shot.areaPoints);
        if (set.empty()) return;
        std::vector<int> share(set.size(), 0);
        for (int left = shot.areaPoints; left > 0; ) {
            // At least one point a chunk, whatever the balance pass does to the
            // grain: a chunk of nothing would never spend the area down.
            const int chunk = std::max(1, std::min(left, AREA_CHUNK));
            const int idx   = Utility::getRandom(1, static_cast<int>(set.size()));
            share[static_cast<size_t>(std::clamp(idx, 1, static_cast<int>(set.size()))) - 1]
                += chunk;
            left -= chunk;
        }
        for (size_t i = 0; i < set.size(); ++i) {
            if (share[i] <= 0) continue;
            coverHex(shooter, set[i], share[i], shot, elevDmgBonus, already, struck);
            ++hexesCovered;
        }
    }

    // L-8's tier discipline: one line for the whole area, at Detail — the
    // per-body hits already write themselves at Trace through applyHit.
    Utility::getBattlefield().logEvent(LogTier::Detail,
        "the blast covers " + std::to_string(hexesCovered) + " hexes and strikes "
        + std::to_string(struck.size()));
}

// ── Spell delivery (T-1, slice TG-1) ─────────────────────────────────────────
//
// The two halves of T-1, sharing everything below the aiming with fire(): the
// elevation DAMAGE bonus, applyHit's block/armour/damage pipeline, and the
// splash loop. What they do NOT share is the archer's aiming — that is the
// whole point of the slice.

// The height difference the two hexes make, clamped to the ranged cap exactly
// as fire() clamps it. Both halves need it, and a precise strike needs it too:
// T-1 exempts a precise spell from the accuracy adjustment, never from the
// DAMAGE one — what a hit does is unchanged.
static int elevationTiers(const AUnit* shooter, const AUnit* target)
{
    return std::clamp(shooter->getHex()->elevation - target->getHex()->elevation,
                      -ELEV_RANGED_CAP, ELEV_RANGED_CAP);
}

void RangedCombat::strike(AUnit* shooter, AUnit* target, const RangedShot& shot)
{
    // Null-safe like fire(): a shot comes FROM somewhere and lands SOMEWHERE.
    if (!shooter || !shooter->getHex() || !target || !target->getHex()) return;

    int elevDmgBonus = elevationTiers(shooter, target) * ELEV_RANGED_BONUS;

    // No Deviate, no resolveHit, no accuracy read anywhere: this is what
    // "precise" means. The man the resolver picked is the man who is hit.
    if (target->getAlive())
        applyHit(shooter, target, shot, shot.baseDamage, elevDmgBonus);

    // Fireball's blast needs a hex to go off on, and it goes off on the one the
    // strike landed on — the struck man excluded from it, having already taken
    // the centre damage (T-6: once per body per cast).
    coverArea(shooter, target->getHex(), shot, elevDmgBonus, target);
}

void RangedCombat::scatter(AUnit* shooter, AUnit* aimUnit, const RangedShot& shot,
                           int accuracy)
{
    if (!shooter || !shooter->getHex() || !aimUnit || !aimUnit->getHex()) return;

    int elevTiers    = elevationTiers(shooter, aimUnit);
    int elevDmgBonus = elevTiers * ELEV_RANGED_BONUS;
    // The height a caster shoots from helps a spell arrive, exactly as it helps
    // an arrow (T-1: "the elevation adjustment an arrow gets applied after").
    int shotAccuracy = std::clamp(accuracy + elevTiers * ELEV_RANGED_BONUS * 10, 0, 100);

    Hex* landedHex = Utility::Deviate(*shooter->getHex(),
                                      aimUnit->getHex()->coord.q,
                                      aimUnit->getHex()->coord.r,
                                      shotAccuracy);
    if (!landedHex) return;

    // Assistant's call 1: scatter is the whole of the miss. Stay on his hex and
    // the aimed man takes it; drift off it and the shot takes whoever stands
    // where it fell — friend included (T-7) — or nobody at all.
    AUnit* struck = (landedHex == aimUnit->getHex()) ? aimUnit
                                                     : pickHexTarget(landedHex);
    if (struck && struck->getAlive())
        applyHit(shooter, struck, shot, shot.baseDamage, elevDmgBonus);

    // And the area goes off where the shot fell, whether or not it found a body
    // there — the stray it did find is the one it does not strike twice.
    coverArea(shooter, landedHex, shot, elevDmgBonus, struck);
}


AUnit* RangedCombat::resolveHit(AUnit* intendedTarget, Hex* landedHex,
                                int distance, int accuracy)
{
    // Aimed individual hit: unit is still in the landed hex, within aimed range
    // (accuracy/10 hexes), and the accuracy roll succeeds.
    if (intendedTarget
        && intendedTarget->getAlive()
        && intendedTarget->getHex() == landedHex
        && distance <= accuracy / 10
        && Utility::getRandom(1, 100) <= accuracy)
    {
        return intendedTarget;
    }

    // Fallback: random weighted hit within the hex.
    return pickHexTarget(landedHex);
}
