#include "../HDRS/HexGrid.hpp"
#include <algorithm>
#include <cmath>
#include <string>

static constexpr float PI = 3.14159265358979323846f;

// Axial neighbor offsets — NE E SE SW W NW (pointy-top, r increases southward)
// NE(+1,-1), E(+1,0), SE(0,+1), SW(-1,+1), W(-1,0), NW(0,-1)
static constexpr int DQ[6] = { 1,  1,  0, -1, -1,  0};
static constexpr int DR[6] = {-1,  0,  1,  1,  0, -1};

HexGrid::HexGrid(sf::Font& font, sf::Vector2f origin)
    : _font(font), _origin(origin)
{}

sf::Vector2f HexGrid::hexToPixel(HexCoord c) const {
    static const float sq3 = std::sqrt(3.f);
    float fq = static_cast<float>(c.q);
    float fr = static_cast<float>(c.r);
    return {
        _origin.x + HEX_SIZE * (sq3 * fq + sq3 * 0.5f * fr),
        _origin.y + HEX_SIZE * 1.5f * fr
    };
}

void HexGrid::buildShape(Hex& hex) {
    hex.shape.setPointCount(6);
    sf::Vector2f center = hexToPixel(hex.coord);
    for (size_t i = 0; i < 6; ++i) {
        float angle = (60.f * static_cast<float>(i) - 90.f) * PI / 180.f;
        hex.shape.setPoint(i, sf::Vector2f(
            center.x + HEX_SIZE * std::cos(angle),
            center.y + HEX_SIZE * std::sin(angle)
        ));
    }
    hex.shape.setFillColor(sf::Color(30, 30, 40, 200));
    hex.shape.setOutlineColor(sf::Color(160, 160, 200));
    hex.shape.setOutlineThickness(1.5f);
}

void HexGrid::buildLabel(Hex& hex) {
    hex.label.setFont(_font);
    hex.label.setCharacterSize(10);
    hex.label.setFillColor(sf::Color(180, 180, 200));
    hex.label.setString(std::to_string(hex.coord.q) + "," + std::to_string(hex.coord.r));
    sf::FloatRect b = hex.label.getLocalBounds();
    hex.label.setOrigin(b.left + b.width * 0.5f, b.top + b.height * 0.5f);
    hex.label.setPosition(hexToPixel(hex.coord));
}

HexCoord HexGrid::neighborCoord(HexCoord c, HexDirection d) const {
    int i = static_cast<int>(d);
    return {c.q + DQ[i], c.r + DR[i]};
}

HexDirection HexGrid::opposite(HexDirection d) const {
    return static_cast<HexDirection>((static_cast<int>(d) + 3) % 6);
}

void HexGrid::buildGrid(int radius) {
    int numHexes = 3 * radius * radius + 3 * radius + 1;
    _hexes.reserve(static_cast<size_t>(numHexes) * 2);
    // Upper bound: each hex contributes at most 3 sides (NE/E/SE directions)
    _sides.reserve(static_cast<size_t>(numHexes) * 3);

    // Pass 1: create all hexes
    for (int q = -radius; q <= radius; ++q) {
        int r1 = std::max(-radius, -q - radius);
        int r2 = std::min(radius, -q + radius);
        for (int r = r1; r <= r2; ++r) {
            HexCoord c{q, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
            buildShape(hex);
            buildLabel(hex);
        }
    }

    // Pass 2: link shared HexSides — process NE/E/SE only to create each side once
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

void HexGrid::render(sf::RenderWindow& window) {
    for (auto& [coord, hex] : _hexes) {
        window.draw(hex.shape);
        window.draw(hex.label);
    }
}

Hex* HexGrid::getHex(HexCoord c) {
    auto it = _hexes.find(c);
    return it != _hexes.end() ? &it->second : nullptr;
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
