#include "FormationLayout.hpp"
#include "AUnit.hpp"
#include "Squad.hpp"
#include "hex/HexGrid.hpp"

#include <algorithm>
#include <cmath>
#include <unordered_set>

namespace {

constexpr float PI = 3.14159265358979323846f;

// Edge midpoint angles (flat space, degrees) for HexDirection: NE=0, E=1,
// SE=2, SW=3, W=4, NW=5.
constexpr float EDGE_ANGLE[6] = { -60.f, 0.f, 60.f, 120.f, 180.f, -120.f };

// Glyph sizes in hex-radius units. The floor mirrors the SFML renderer's old
// 4px minimum at the default hex size (HexGrid's HEX_SIZE_DEFAULT = 60).
constexpr float MIN_SCALE = 4.f / 60.f;
constexpr float MAX_SCALE = 1.5f;

// All battle-line ranks draw at the same enlarged size — the same troops
// must not shrink for standing in the second line (user, 2026-07-06); depth
// reads from position and the renderer's alpha. Index 0 unused (support
// pool uses the 0.7 factor below).
constexpr float RANK_SIZE_MUL[4] = { 0.f, 1.3f, 1.3f, 1.3f };
constexpr float SUPPORT_SIZE_MUL = 0.7f;

float clampScale(float s) {
    return std::max(MIN_SCALE, std::min(s, MAX_SCALE));
}

// Symbol size proportional to the unit's physical size — larger creatures
// appear larger.
float baseSym(const AUnit* u) {
    return 1.6f * std::sqrt(static_cast<float>(u->getSize())
                            / static_cast<float>(Hex::CAPACITY));
}

} // namespace

std::vector<UnitPlacement> layoutHexFormation(const Hex& hex)
{
    std::vector<AUnit*> alive;
    for (AUnit* u : hex.units)
        if (u && u->getAlive()) alive.push_back(u);
    if (alive.empty()) return {};
    std::sort(alive.begin(), alive.end(),
              [](AUnit* a, AUnit* b) { return a->getSortKey() < b->getSortKey(); });

    float avgSym = 0.f;
    for (AUnit* u : alive) avgSym += baseSym(u);
    avgSym = clampScale(avgSym / static_cast<float>(alive.size()));

    std::vector<int> engagedDirs;
    for (int d = 0; d < 6; ++d)
        if (hex.sides[d] && hex.sides[d]->engaged)
            engagedDirs.push_back(d);

    int N = static_cast<int>(alive.size());
    std::vector<UnitPlacement> out;
    out.reserve(alive.size());

    if (engagedDirs.empty()) {
        // Unengaged: march formation, front rank toward the attack direction.
        // Red (team 1) homes at high y and attacks toward low y; Blue mirrors.
        int   team   = alive[0]->getTeam();
        float step   = avgSym * 0.80f;
        int   perRow = std::max(1, static_cast<int>(1.7f / step));
        float frontY = (team == 1 ? -0.75f : 0.75f);
        float yDir   = (team == 1 ? 1.f : -1.f);
        for (int row = 0, idx = 0; idx < N; ++row) {
            int   rowCnt = std::min(perRow, N - idx);
            float rowY   = frontY + yDir * static_cast<float>(row) * step;
            float rowX0  = -(rowCnt - 1) * step * 0.5f;
            for (int i = 0; i < rowCnt; ++i, ++idx)
                out.push_back({ alive[idx], rowX0 + static_cast<float>(i) * step,
                                rowY, clampScale(baseSym(alive[idx])) });
        }
        return out;
    }

    // Engaged: ranked units file along their side, everyone else pools at the
    // centre. Rank 1 at the edge, ranks 2/3 stepping inward.
    float fStep     = avgSym * 0.85f;
    int   edgeWidth = std::max(1, static_cast<int>(1.5f / fStep));

    struct Ranked { AUnit* unit; float ox, oy, scale; int rank; };
    std::vector<Ranked> formation;
    std::unordered_set<const AUnit*> seated;

    for (int d : engagedDirs) {
        HexSide* side = hex.sides[d];
        float angle = EDGE_ANGLE[d] * PI / 180.f;
        float ex = std::cos(angle), ey = std::sin(angle);
        // File spreads along the edge (perpendicular), ranks step inward.
        float midX = ex * 0.78f, midY = ey * 0.78f;

        for (int ri = 1; ri <= 3; ++ri) {
            std::vector<AUnit*> rankUnits;
            for (AUnit* u : alive)
                if (u->getFormationSide() == side && u->getEngagedRank() == ri)
                    rankUnits.push_back(u);
            if (rankUnits.empty()) continue;

            // A file wider than the edge wraps into a continuation row one
            // step further inward (the old renderer dropped the overflow).
            int total = static_cast<int>(rankUnits.size());
            for (int start = 0, wrap = 0; start < total; start += edgeWidth, ++wrap) {
                int   cnt     = std::min(edgeWidth, total - start);
                float rankOff = static_cast<float>(ri - 1 + wrap) * fStep;
                float t0      = -(cnt - 1) * fStep * 0.5f;
                for (int i = 0; i < cnt; ++i) {
                    AUnit* u = rankUnits[start + i];
                    float  t = t0 + static_cast<float>(i) * fStep;
                    formation.push_back({ u,
                        midX - ey * t - ex * rankOff,
                        midY + ex * t - ey * rankOff,
                        clampScale(baseSym(u) * RANK_SIZE_MUL[ri]), ri });
                    seated.insert(u);
                }
            }
        }
    }

    // Support pool: rank-0 units, plus any ranked unit whose side wasn't
    // engaged (stale state) — every alive unit must get a placement.
    std::vector<AUnit*> support;
    for (AUnit* u : alive)
        if (!seated.count(u)) support.push_back(u);

    // Group support by squad so same-squad members draw together; loners
    // last. Squads order by name so the layout is process-independent.
    std::sort(support.begin(), support.end(), [](AUnit* a, AUnit* b) {
        Squad* sa = a->getSquad();
        Squad* sb = b->getSquad();
        if (sa != sb) {
            if (!sa) return false;
            if (!sb) return true;
            if (sa->getName() != sb->getName())
                return sa->getName() < sb->getName();
        }
        return a->getSortKey() < b->getSortKey();
    });

    if (!support.empty()) {
        float sStep   = avgSym * 0.70f;
        int   sPerRow = std::max(1, static_cast<int>(1.3f / sStep));
        int   numS    = static_cast<int>(support.size());
        int   numRows = (numS + sPerRow - 1) / sPerRow;
        for (int row = 0, si = 0; si < numS; ++row) {
            int   rowCnt = std::min(sPerRow, numS - si);
            float rowX   = (static_cast<float>(row)
                            - static_cast<float>(numRows - 1) * 0.5f) * sStep;
            float rowY0  = -(rowCnt - 1) * sStep * 0.5f;
            for (int i = 0; i < rowCnt; ++i, ++si)
                out.push_back({ support[si], rowX,
                                rowY0 + static_cast<float>(i) * sStep,
                                clampScale(baseSym(support[si]) * SUPPORT_SIZE_MUL) });
        }
    }

    // Formation back-to-front: deepest rank first so rank 1 draws on top.
    std::stable_sort(formation.begin(), formation.end(),
                     [](const Ranked& a, const Ranked& b) { return a.rank > b.rank; });
    for (const auto& f : formation)
        out.push_back({ f.unit, f.ox, f.oy, f.scale });

    return out;
}
