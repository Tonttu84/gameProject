#include "hex/HexGrid.hpp"
#include <algorithm>
#include <cmath>

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

using json = nlohmann::json;

// ── JSON helpers ──────────────────────────────────────────────────────────────

static const char* dirName(HexDirection d) {
    switch (d) {
        case HexDirection::NE: return "NE";
        case HexDirection::E:  return "E";
        case HexDirection::SE: return "SE";
        case HexDirection::SW: return "SW";
        case HexDirection::W:  return "W";
        case HexDirection::NW: return "NW";
    }
    return "NE";
}

static HexDirection dirFromName(const std::string& s) {
    if (s == "E")  return HexDirection::E;
    if (s == "SE") return HexDirection::SE;
    if (s == "SW") return HexDirection::SW;
    if (s == "W")  return HexDirection::W;
    if (s == "NW") return HexDirection::NW;
    return HexDirection::NE;
}

static TerrainType terrainFromName(const std::string& s) {
    if (s == "Forest") return TerrainType::Forest;
    if (s == "Marsh")  return TerrainType::Marsh;
    if (s == "Rubble") return TerrainType::Rubble;
    return TerrainType::Open;
}

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

// ── JSON serialization ────────────────────────────────────────────────────────

std::vector<HexCoord> HexGrid::playerZone() const
{
    std::vector<HexCoord> result;
    if (_playerZoneMinRow < 0) return result;
    for (const auto& [coord, hex] : _hexes)
        if (coord.r >= _playerZoneMinRow && coord.r <= _playerZoneMaxRow)
            result.push_back(coord);
    return result;
}

std::vector<HexCoord> HexGrid::enemyZone() const
{
    std::vector<HexCoord> result;
    if (_enemyZoneMinRow < 0) return result;
    for (const auto& [coord, hex] : _hexes)
        if (coord.r >= _enemyZoneMinRow && coord.r <= _enemyZoneMaxRow)
            result.push_back(coord);
    return result;
}

std::string HexGrid::toJson(int cols, int rows, const std::string& name) const
{
    json j;
    j["version"] = 1;
    j["name"]    = name;
    j["cols"]    = cols;
    j["rows"]    = rows;

    json hexes = json::array();
    for (const auto& [coord, hex] : _hexes) {
        json blockedSides    = json::array();
        json fortifiedSides  = json::array();

        for (int i = 0; i < 6; ++i) {
            HexSide* side = hex.sides[static_cast<size_t>(i)];
            if (!side) continue;
            auto dir = static_cast<HexDirection>(i);
            // Store blocked sides where this hex is hexA (owner of NE/E/SE).
            if (side->blocked && side->hexA == &hex)
                blockedSides.push_back(dirName(dir));
            // Store fortified sides where this hex is the fortifiedDefender.
            if (side->fortified && side->fortifiedDefender == &hex)
                fortifiedSides.push_back(dirName(dir));
        }

        bool nonDefault = (hex.terrain   != TerrainType::Open)
                       || (hex.elevation != 0)
                       || hex.impassable
                       || !blockedSides.empty()
                       || !fortifiedSides.empty();
        if (!nonDefault) continue;

        json entry;
        entry["q"] = coord.q;
        entry["r"] = coord.r;
        if (hex.terrain != TerrainType::Open)
            entry["terrain"] = terrainMeta(hex.terrain).name;
        if (hex.elevation != 0)
            entry["elevation"] = hex.elevation;
        if (hex.impassable)
            entry["impassable"] = true;
        if (!blockedSides.empty())
            entry["blocked_sides"] = blockedSides;
        if (!fortifiedSides.empty())
            entry["fortified_sides"] = fortifiedSides;
        hexes.push_back(std::move(entry));
    }
    j["hexes"] = std::move(hexes);
    if (_playerZoneMinRow >= 0)
        j["player_zone_rows"] = json::array({_playerZoneMinRow, _playerZoneMaxRow});
    if (_enemyZoneMinRow >= 0)
        j["enemy_zone_rows"]  = json::array({_enemyZoneMinRow,  _enemyZoneMaxRow});
    return j.dump(2);
}

void HexGrid::fromJson(const std::string& jsonStr)
{
    auto j = json::parse(jsonStr);

    if (_hexes.empty())
        buildRect(j["cols"].get<int>(), j["rows"].get<int>());

    if (j.contains("player_zone_rows")) {
        _playerZoneMinRow = j["player_zone_rows"][0].get<int>();
        _playerZoneMaxRow = j["player_zone_rows"][1].get<int>();
    }
    if (j.contains("enemy_zone_rows")) {
        _enemyZoneMinRow = j["enemy_zone_rows"][0].get<int>();
        _enemyZoneMaxRow = j["enemy_zone_rows"][1].get<int>();
    }

    if (!j.contains("hexes")) return;
    for (const auto& entry : j["hexes"]) {
        int q = entry["q"].get<int>();
        int r = entry["r"].get<int>();
        Hex* h = getHex({q, r});
        if (!h) continue;

        if (entry.contains("terrain"))
            h->terrain = terrainFromName(entry["terrain"].get<std::string>());
        if (entry.contains("elevation"))
            h->elevation = entry["elevation"].get<int>();
        if (entry.contains("impassable"))
            h->impassable = entry["impassable"].get<bool>();

        if (entry.contains("blocked_sides")) {
            for (const auto& ds : entry["blocked_sides"]) {
                HexSide* hs = getSide({q, r}, dirFromName(ds.get<std::string>()));
                if (hs) hs->blocked = true;
            }
        }
        if (entry.contains("fortified_sides")) {
            for (const auto& ds : entry["fortified_sides"]) {
                HexSide* hs = getSide({q, r}, dirFromName(ds.get<std::string>()));
                if (hs) { hs->fortified = true; hs->fortifiedDefender = h; }
            }
        }
    }
}
