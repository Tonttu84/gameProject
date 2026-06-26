#include "../HDRS/HexGrid.hpp"
#include <algorithm>
#include <cmath>

// Axial neighbor offsets — NE E SE SW W NW (pointy-top, r increases southward)
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
            // Even-r offset → axial: keeps the visual grid rectangular so armies
            // face each other left-vs-right rather than along a diagonal.
            HexCoord c{col - r / 2, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
        }
    }
    linkSides();
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
