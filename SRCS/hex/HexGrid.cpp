#include "hex/HexGrid.hpp"
#include <algorithm>
#include <cmath>

// Axial neighbor offsets for NE E SE SW W NW (r increases southward)
static constexpr int DQ[6] = { 1,  1,  0, -1, -1,  0};
static constexpr int DR[6] = {-1,  0,  1,  1,  0, -1};

static constexpr float HEX_ORIGIN_X     = 30.f;
static constexpr float HEX_ORIGIN_Y     = 30.f;
static constexpr float HEX_SIZE_DEFAULT = 60.f;

HexGrid::HexGrid()
    : _origin(HEX_ORIGIN_X, HEX_ORIGIN_Y), _hexSize(HEX_SIZE_DEFAULT)
{}

sf::Vector2f HexGrid::hexToPixel(HexCoord c) const {
    static const float sq3 = std::sqrt(3.f);
    float fq = static_cast<float>(c.q);
    float fr = static_cast<float>(c.r);
    return {
        _origin.x + _hexSize * (sq3 * fq + sq3 * 0.5f * fr),
        _origin.y + _hexSize * 1.5f * fr
    };
}

float HexGrid::getHexSize() const {
    return _hexSize;
}

const std::unordered_map<HexCoord, Hex, HexCoordHash>& HexGrid::getHexes() const {
    return _hexes;
}

HexCoord HexGrid::neighborCoord(HexCoord c, HexDirection d) const {
    int i = static_cast<int>(d);
    return {c.q + DQ[i], c.r + DR[i]};
}

HexDirection HexGrid::opposite(HexDirection d) const {
    return static_cast<HexDirection>((static_cast<int>(d) + 3) % 6);
}

int HexGrid::distance(HexCoord a, HexCoord b) {
    int dq = a.q - b.q;
    int dr = a.r - b.r;
    return (std::abs(dq) + std::abs(dr) + std::abs(dq + dr)) / 2;
}

void HexGrid::linkSides() {
    static const HexDirection fwdDirs[] = {
        HexDirection::NE, HexDirection::E, HexDirection::SE
    };
    for (auto& [coord, hexRef] : _hexes) {
        for (HexDirection d : fwdDirs) {
            if (hexRef.sides[static_cast<size_t>(d)]) continue;
            HexCoord nc = neighborCoord(coord, d);
            Hex* nb = getHex(nc);
            if (!nb) continue;
            _sides.push_back({&hexRef, nb, d, false});
            HexSide* side = &_sides.back();
            hexRef.sides[static_cast<size_t>(d)] = side;
            nb->sides[static_cast<size_t>(opposite(d))] = side;
        }
    }
}

void HexGrid::buildGrid(int radius) {
    int numHexes = 3 * radius * radius + 3 * radius + 1;
    _hexes.reserve(static_cast<size_t>(numHexes) * 2);
    _sides.reserve(static_cast<size_t>(numHexes) * 3);

    for (int q = -radius; q <= radius; ++q) {
        int r1 = std::max(-radius, -q - radius);
        int r2 = std::min(radius, -q + radius);
        for (int r = r1; r <= r2; ++r) {
            HexCoord c{q, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
        }
    }
    linkSides();
}

void HexGrid::buildRect(int cols, int rows) {
    int numHexes = cols * rows;
    _hexes.reserve(static_cast<size_t>(numHexes) * 2);
    _sides.reserve(static_cast<size_t>(numHexes) * 3);

    for (int r = 0; r < rows; ++r) {
        for (int col = 0; col < cols; ++col) {
            // Even-r offset → axial: keeps the visual grid rectangular.
            HexCoord c{col - r / 2, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
        }
    }
    linkSides();

    // Assign stable indices after all hexes exist (unordered_map may rehash during insertion).
    int idx = 0;
    _hexIndex.reserve(_hexes.size() * 2);
    _indexedHexes.resize(_hexes.size());
    for (auto& [coord, hex] : _hexes) {
        _hexIndex[coord] = idx;
        _indexedHexes[static_cast<size_t>(idx)] = &hex;
        ++idx;
    }
}

void HexGrid::clearUnits() {
    for (auto& [coord, hex] : _hexes) {
        hex.units.clear();
        hex.sizeUsed = 0;
    }
}

Hex* HexGrid::getHex(HexCoord c) {
    auto it = _hexes.find(c);
    return it != _hexes.end() ? &it->second : nullptr;
}

const Hex* HexGrid::getHex(HexCoord c) const {
    auto it = _hexes.find(c);
    return it != _hexes.end() ? &it->second : nullptr;
}

Hex* HexGrid::safeGetHex(int q, int r) {
    return getHex({q, r});
}

std::vector<HexSide>& HexGrid::getSides() {
    return _sides;
}

HexSide* HexGrid::getSide(HexCoord c, HexDirection dir) {
    Hex* h = getHex(c);
    return h ? h->sides[static_cast<size_t>(dir)] : nullptr;
}

std::array<HexCoord, 6> HexGrid::neighbors(HexCoord c) const {
    std::array<HexCoord, 6> result;
    for (int i = 0; i < 6; ++i)
        result[static_cast<size_t>(i)] = neighborCoord(c, static_cast<HexDirection>(i));
    return result;
}

// Returns true if a hex is a hard wall for the given movement graph.
// Mounted units cannot enter Forest or Marsh — those hexes are walls in their graph.
static bool isWallForGraph(const Hex* hex, bool mounted) {
    if (!hex || hex->impassable) return true;
    if (mounted && (hex->terrain == TerrainType::Forest ||
                    hex->terrain == TerrainType::Marsh))
        return true;
    return false;
}

// Returns true if the hexside between two hexes is crossable in the given graph.
static bool sidePassableForGraph(const HexSide* side) {
    if (!side) return false;
    if (side->blocked) return false;
    if (side->hexA && side->hexB &&
        std::abs(side->hexA->elevation - side->hexB->elevation) >= 2)
        return false;
    return true;
}

std::vector<int> HexGrid::bfsFromSources(const std::vector<int>& sources,
                                          bool mounted) const
{
    const int N = static_cast<int>(_indexedHexes.size());
    std::vector<int> dist(static_cast<size_t>(N), UNREACHABLE);
    std::queue<int>  q;

    for (int s : sources) {
        if (s < 0 || s >= N) continue;
        if (isWallForGraph(_indexedHexes[static_cast<size_t>(s)], mounted)) continue;
        dist[static_cast<size_t>(s)] = 0;
        q.push(s);
    }

    while (!q.empty()) {
        int cur = q.front(); q.pop();
        const Hex* curHex = _indexedHexes[static_cast<size_t>(cur)];

        for (int i = 0; i < 6; ++i) {
            HexSide* side = curHex->sides[static_cast<size_t>(i)];
            if (!sidePassableForGraph(side)) continue;

            const Hex* nb = (side->hexA == curHex) ? side->hexB : side->hexA;
            if (isWallForGraph(nb, mounted)) continue;

            auto it = _hexIndex.find(nb->coord);
            if (it == _hexIndex.end()) continue;
            int ni = it->second;

            if (dist[static_cast<size_t>(ni)] == UNREACHABLE) {
                dist[static_cast<size_t>(ni)] = dist[static_cast<size_t>(cur)] + 1;
                q.push(ni);
            }
        }
    }
    return dist;
}

void HexGrid::computeDistances(int redFleeRow, int blueFleeRow)
{
    const int N = static_cast<int>(_indexedHexes.size());
    _distGround .assign(static_cast<size_t>(N), std::vector<int>(static_cast<size_t>(N), UNREACHABLE));
    _distMounted.assign(static_cast<size_t>(N), std::vector<int>(static_cast<size_t>(N), UNREACHABLE));

    // One BFS per source hex for unit-to-unit distances.
    for (int src = 0; src < N; ++src) {
        auto dg = bfsFromSources({src}, false);
        auto dm = bfsFromSources({src}, true);
        for (int dst = 0; dst < N; ++dst) {
            _distGround [static_cast<size_t>(src)][static_cast<size_t>(dst)] = dg[static_cast<size_t>(dst)];
            _distMounted[static_cast<size_t>(src)][static_cast<size_t>(dst)] = dm[static_cast<size_t>(dst)];
        }
    }

    // Team-specific flee BFS: sources are all hexes on the team's home-edge row.
    // Red flees toward redFleeRow (typically height-1); Blue toward blueFleeRow (0).
    auto rowSources = [&](int row) {
        std::vector<int> srcs;
        for (auto& [coord, idx] : _hexIndex)
            if (coord.r == row) srcs.push_back(idx);
        return srcs;
    };

    _redFleeGround   = bfsFromSources(rowSources(redFleeRow),  false);
    _redFleeMounted  = bfsFromSources(rowSources(redFleeRow),  true);
    _blueFleeGround  = bfsFromSources(rowSources(blueFleeRow), false);
    _blueFleeMounted = bfsFromSources(rowSources(blueFleeRow), true);
}

int HexGrid::bfsDistance(const Hex* from, const Hex* to, bool mounted) const
{
    if (!from || !to) return UNREACHABLE;
    auto fi = _hexIndex.find(from->coord);
    auto ti = _hexIndex.find(to->coord);
    if (fi == _hexIndex.end() || ti == _hexIndex.end()) return UNREACHABLE;
    const auto& table = mounted ? _distMounted : _distGround;
    if (table.empty()) return UNREACHABLE;
    return table[static_cast<size_t>(fi->second)][static_cast<size_t>(ti->second)];
}

int HexGrid::fleeDistance(const Hex* hex, bool mounted, bool redTeam) const
{
    if (!hex) return UNREACHABLE;
    auto it = _hexIndex.find(hex->coord);
    if (it == _hexIndex.end()) return UNREACHABLE;
    const std::vector<int>& table = redTeam
        ? (mounted ? _redFleeMounted  : _redFleeGround)
        : (mounted ? _blueFleeMounted : _blueFleeGround);
    if (table.empty()) return UNREACHABLE;
    return table[static_cast<size_t>(it->second)];
}
