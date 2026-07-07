#include "catch.hpp"
#include "FormationLayout.hpp"
#include "hex/HexGrid.hpp"
#include "Squad.hpp"
#include "units/Soldier.hpp"
#include "units/Cavalry.hpp"

#include <cmath>
#include <memory>
#include <set>
#include <vector>

// layoutHexFormation is the single source of the cosmetic in-hex unit layout:
// ReplayRecorder persists its offsets into replay ticks, and the React
// ReplayView (the only renderer) just draws center + offset * size.
// These tests pin the geometry contract the replay relies on.
//
// Offsets are in hex-radius units in the engine's flat pixel space
// (x = axial q direction, y grows toward high r rows / red's home edge).

namespace {

// A hex with `n` units of type T on `team`, no engagement state.
template <typename T>
std::vector<std::unique_ptr<AUnit>> fillHex(Hex& hex, int n, int team) {
    std::vector<std::unique_ptr<AUnit>> owned;
    for (int i = 0; i < n; ++i) {
        auto u = std::make_unique<T>(team);
        hex.units.push_back(u.get());
        owned.push_back(std::move(u));
    }
    return owned;
}

const UnitPlacement* findPlacement(const std::vector<UnitPlacement>& ps, const AUnit* u) {
    for (const auto& p : ps)
        if (p.unit == u) return &p;
    return nullptr;
}

} // namespace

TEST_CASE("formation layout: empty hex yields no placements", "[formation_layout]") {
    Hex hex;
    REQUIRE(layoutHexFormation(hex).empty());
}

TEST_CASE("formation layout: every alive unit gets exactly one placement, dead get none",
          "[formation_layout]") {
    Hex hex;
    auto owned = fillHex<Soldier>(hex, 5, REDTEAM);
    owned[2]->setAlive(false);

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 4);
    std::set<const AUnit*> seen;
    for (const auto& p : ps) {
        REQUIRE(p.unit != nullptr);
        REQUIRE(p.unit->getAlive());
        seen.insert(p.unit);
    }
    REQUIRE(seen.size() == 4);              // no unit placed twice
    REQUIRE(seen.count(owned[2].get()) == 0);
}

TEST_CASE("formation layout: offsets stay within the hex", "[formation_layout]") {
    Hex hex;
    auto owned = fillHex<Soldier>(hex, 12, REDTEAM);
    for (const auto& p : layoutHexFormation(hex)) {
        REQUIRE(std::abs(p.ox) <= 1.0f);
        REQUIRE(std::abs(p.oy) <= 1.0f);
        REQUIRE(p.scale > 0.f);
        REQUIRE(p.scale <= 1.5f);
    }
}

TEST_CASE("formation layout: march front rank faces the enemy", "[formation_layout]") {
    // Red (team 1) homes at high r (high y) and attacks toward low y: its
    // front row sits at negative oy. Blue mirrors.
    Hex redHex;
    auto red = fillHex<Soldier>(redHex, 3, REDTEAM);
    for (const auto& p : layoutHexFormation(redHex))
        REQUIRE(p.oy < 0.f);

    Hex blueHex;
    auto blue = fillHex<Soldier>(blueHex, 3, BLUETEAM);
    for (const auto& p : layoutHexFormation(blueHex))
        REQUIRE(p.oy > 0.f);
}

TEST_CASE("formation layout: march rows fill toward home as the hex crowds",
          "[formation_layout]") {
    Hex hex;
    auto owned = fillHex<Soldier>(hex, 20, REDTEAM);
    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 20);
    float minY = 1.f, maxY = -1.f;
    for (const auto& p : ps) {
        minY = std::min(minY, p.oy);
        maxY = std::max(maxY, p.oy);
    }
    // Red front row at -0.75; later rows step back toward red's home (+y).
    REQUIRE(minY == Approx(-0.75f));
    REQUIRE(maxY > minY);
}

TEST_CASE("formation layout: engaged rank-1 file sits at its side's edge",
          "[formation_layout]") {
    // Side E (dir 1) points along +x: edge midpoint at ox = 0.78, oy = 0.
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;

    auto owned = fillHex<Soldier>(hex, 1, REDTEAM);
    owned[0]->setFormationSide(&side);
    owned[0]->setEngagedRank(1);

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 1);
    REQUIRE(ps[0].ox == Approx(0.78f));
    REQUIRE(ps[0].oy == Approx(0.f).margin(1e-5));
}

TEST_CASE("formation layout: deeper ranks step inward at the same size", "[formation_layout]") {
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;   // E: +x

    auto owned = fillHex<Soldier>(hex, 3, REDTEAM);
    for (int ri = 0; ri < 3; ++ri) {
        owned[ri]->setFormationSide(&side);
        owned[ri]->setEngagedRank(ri + 1);
    }

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 3);
    const UnitPlacement* r1 = findPlacement(ps, owned[0].get());
    const UnitPlacement* r2 = findPlacement(ps, owned[1].get());
    const UnitPlacement* r3 = findPlacement(ps, owned[2].get());
    REQUIRE(r1); REQUIRE(r2); REQUIRE(r3);
    // Inward from the E edge = decreasing ox, all still on the engaged half.
    REQUIRE(r1->ox > r2->ox);
    REQUIRE(r2->ox > r3->ox);
    REQUIRE(r3->ox > 0.f);
    // A soldier is a soldier: the same troops must not shrink for standing
    // in the second line (user, 2026-07-06). Depth reads from position (and
    // the renderer's alpha), not from size.
    REQUIRE(r1->scale == Approx(r2->scale));
    REQUIRE(r2->scale == Approx(r3->scale));
}

TEST_CASE("formation layout: a rank-1 file spreads symmetrically along its edge",
          "[formation_layout]") {
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;   // E: file spreads along the perpendicular (y)

    auto owned = fillHex<Soldier>(hex, 2, REDTEAM);
    for (auto& u : owned) {
        u->setFormationSide(&side);
        u->setEngagedRank(1);
    }

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 2);
    REQUIRE(ps[0].ox == Approx(ps[1].ox));
    REQUIRE(ps[0].oy == Approx(-ps[1].oy));  // symmetric about the edge midpoint
    REQUIRE(ps[0].oy != Approx(ps[1].oy));   // ...and actually spread
}

TEST_CASE("formation layout: opposite sides mirror", "[formation_layout]") {
    auto placeOn = [](int dir) {
        Hex hex;
        HexSide side;
        side.engaged = true;
        hex.sides[dir] = &side;
        auto owned = fillHex<Soldier>(hex, 1, REDTEAM);
        owned[0]->setFormationSide(&side);
        owned[0]->setEngagedRank(1);
        auto ps = layoutHexFormation(hex);
        REQUIRE(ps.size() == 1);
        return std::pair<float, float>(ps[0].ox, ps[0].oy);
    };
    auto [ex, ey] = placeOn(1);  // E
    auto [wx, wy] = placeOn(4);  // W
    REQUIRE(ex == Approx(-wx));
    REQUIRE(ey == Approx(-wy).margin(1e-5));

    auto [sex, sey] = placeOn(2); // SE: +x +y quadrant
    REQUIRE(sex > 0.f);
    REQUIRE(sey > 0.f);
    auto [nwx, nwy] = placeOn(5); // NW mirrors SE
    REQUIRE(nwx == Approx(-sex));
    REQUIRE(nwy == Approx(-sey));
}

TEST_CASE("formation layout: unseated units pool at the hex centre, same size as the line",
          "[formation_layout]") {
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;

    auto owned = fillHex<Soldier>(hex, 3, REDTEAM);
    owned[0]->setFormationSide(&side);
    owned[0]->setEngagedRank(1);
    // owned[1], owned[2] stay rank 0 → support pool.

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 3);
    const UnitPlacement* front = findPlacement(ps, owned[0].get());
    REQUIRE(front);
    for (int i = 1; i <= 2; ++i) {
        const UnitPlacement* sup = findPlacement(ps, owned[i].get());
        REQUIRE(sup);
        // Support huddles near the centre, well inside the frontline's edge.
        REQUIRE(std::abs(sup->ox) < 0.5f);
        REQUIRE(std::abs(sup->oy) < 0.5f);
        // A soldier in reserve draws the same size as one on the border
        // (user, 2026-07-06) — depth reads from position + alpha, not size.
        REQUIRE(sup->scale == Approx(front->scale));
    }
}

TEST_CASE("formation layout: consecutive ranks are separated by at least a glyph height",
          "[formation_layout]") {
    // The regression that made "only one rank" show: the inward rank step was
    // smaller than a glyph, so ranks 1/2/3 drew on top of one another. Each
    // rank must now clear a full glyph height from the next.
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;   // E: ranks step inward along -x

    auto owned = fillHex<Soldier>(hex, 3, REDTEAM);
    for (int ri = 0; ri < 3; ++ri) {
        owned[ri]->setFormationSide(&side);
        owned[ri]->setEngagedRank(ri + 1);
    }

    auto ps = layoutHexFormation(hex);
    const UnitPlacement* r1 = findPlacement(ps, owned[0].get());
    const UnitPlacement* r2 = findPlacement(ps, owned[1].get());
    const UnitPlacement* r3 = findPlacement(ps, owned[2].get());
    REQUIRE(r1); REQUIRE(r2); REQUIRE(r3);
    // Inward gap (along x for side E) clears a full glyph so ranks read apart.
    REQUIRE((r1->ox - r2->ox) >= r1->scale);
    REQUIRE((r2->ox - r3->ox) >= r2->scale);
}

TEST_CASE("formation layout: units order squad-first, then loners by type",
          "[formation_layout]") {
    // Unengaged hex → single march pool whose output order is the pack order:
    // squad members first (grouped by squad name), then lone units grouped by
    // unit type (printSymbol). (user, 2026-07-06: "ordered by squads, then
    // unsquadded in unit type order".)
    Hex hex;
    Squad beta("Beta", false);
    Squad alpha("Alpha", false);

    // Deliberately interleave construction order so only orderlyLess can sort.
    auto lonerC = std::make_unique<Cavalry>(REDTEAM); // symbol 'C'
    auto memB   = std::make_unique<Soldier>(REDTEAM);
    auto lonerX = std::make_unique<Soldier>(REDTEAM); // symbol 'X'
    auto memA   = std::make_unique<Soldier>(REDTEAM);
    beta.addMember(memB.get());
    alpha.addMember(memA.get());
    for (AUnit* u : { (AUnit*)lonerC.get(), (AUnit*)memB.get(),
                      (AUnit*)lonerX.get(), (AUnit*)memA.get() })
        hex.units.push_back(u);

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 4);
    // Expected order: Alpha member, Beta member, then loners by symbol 'C' < 'X'.
    REQUIRE(ps[0].unit == memA.get());
    REQUIRE(ps[1].unit == memB.get());
    REQUIRE(ps[2].unit == lonerC.get());
    REQUIRE(ps[3].unit == lonerX.get());
}

TEST_CASE("formation layout: support draws before the frontline (back-to-front order)",
          "[formation_layout]") {
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[1] = &side;

    auto owned = fillHex<Soldier>(hex, 2, REDTEAM);
    owned[0]->setFormationSide(&side);
    owned[0]->setEngagedRank(1);

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 2);
    REQUIRE(ps.front().unit == owned[1].get());  // support first
    REQUIRE(ps.back().unit  == owned[0].get());  // frontline last (drawn on top)
}

TEST_CASE("formation layout: a ranked unit on a non-engaged side is not dropped",
          "[formation_layout]") {
    // Defensive: resolveEngagements resets this state each tick, but the
    // layout must place every alive unit no matter what it is handed.
    Hex hex;
    HexSide stale;               // NOT in hex.sides, not engaged
    auto owned = fillHex<Soldier>(hex, 1, REDTEAM);
    owned[0]->setFormationSide(&stale);
    owned[0]->setEngagedRank(2);

    HexSide engagedSide;
    engagedSide.engaged = true;
    hex.sides[3] = &engagedSide; // hex counts as engaged → support-pool path

    auto ps = layoutHexFormation(hex);
    REQUIRE(ps.size() == 1);
}

TEST_CASE("formation layout: bigger creatures draw bigger", "[formation_layout]") {
    Hex hex;
    auto foot  = fillHex<Soldier>(hex, 1, REDTEAM);
    auto horse = fillHex<Cavalry>(hex, 1, REDTEAM);
    auto ps = layoutHexFormation(hex);
    const UnitPlacement* s = findPlacement(ps, foot[0].get());
    const UnitPlacement* c = findPlacement(ps, horse[0].get());
    REQUIRE(s); REQUIRE(c);
    REQUIRE(c->scale > s->scale);
}

TEST_CASE("formation layout: deterministic for identical input", "[formation_layout]") {
    Hex hex;
    HexSide side;
    side.engaged = true;
    hex.sides[2] = &side;
    auto owned = fillHex<Soldier>(hex, 6, REDTEAM);
    for (int i = 0; i < 3; ++i) {
        owned[i]->setFormationSide(&side);
        owned[i]->setEngagedRank(i + 1);
    }

    auto a = layoutHexFormation(hex);
    auto b = layoutHexFormation(hex);
    REQUIRE(a.size() == b.size());
    for (size_t i = 0; i < a.size(); ++i) {
        REQUIRE(a[i].unit == b[i].unit);
        REQUIRE(a[i].ox == b[i].ox);
        REQUIRE(a[i].oy == b[i].oy);
        REQUIRE(a[i].scale == b[i].scale);
    }
}
