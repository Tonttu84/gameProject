#include "../HDRS/HexGrid.hpp"
#include "../HDRS/AUnit.hpp"
#include <algorithm>
#include <cmath>
#include <string>

static constexpr float PI = 3.14159265358979323846f;

// Axial neighbor offsets — NE E SE SW W NW (pointy-top, r increases southward)
static constexpr int DQ[6] = { 1,  1,  0, -1, -1,  0};
static constexpr int DR[6] = {-1,  0,  1,  1,  0, -1};

HexGrid::HexGrid()
    : _font(nullptr), _origin(20.f, 25.f), _hexSize(20.f)
{}

void HexGrid::setFont(sf::Font* font) {
    _font = font;
    for (auto& [coord, hex] : _hexes)
        buildLabel(hex);
}

sf::Vector2f HexGrid::hexToPixel(HexCoord c) const {
    static const float sq3 = std::sqrt(3.f);
    float fq = static_cast<float>(c.q);
    float fr = static_cast<float>(c.r);
    return {
        _origin.x + _hexSize * (sq3 * fq + sq3 * 0.5f * fr),
        _origin.y + _hexSize * 1.5f * fr
    };
}

sf::Vector2f HexGrid::pixelCenter(HexCoord c) const {
    return hexToPixel(c);
}

void HexGrid::buildShape(Hex& hex) {
    hex.shape.setPointCount(6);
    sf::Vector2f center = hexToPixel(hex.coord);
    for (size_t i = 0; i < 6; ++i) {
        float angle = (60.f * static_cast<float>(i) - 90.f) * PI / 180.f;
        hex.shape.setPoint(i, sf::Vector2f(
            center.x + _hexSize * std::cos(angle),
            center.y + _hexSize * std::sin(angle)
        ));
    }
    hex.shape.setFillColor(sf::Color(30, 30, 40, 200));
    hex.shape.setOutlineColor(sf::Color(160, 160, 200));
    hex.shape.setOutlineThickness(1.5f);
}

void HexGrid::buildLabel(Hex& hex) {
    if (!_font) return;
    hex.label.setFont(*_font);
    hex.label.setCharacterSize(8);
    hex.label.setFillColor(sf::Color(120, 120, 150));
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
            buildShape(hex);
            buildLabel(hex);
        }
    }
    linkSides();
}

void HexGrid::buildRect(int cols, int rows) {
    int numHexes = cols * rows;
    _hexes.reserve(static_cast<size_t>(numHexes) * 2);
    _sides.reserve(static_cast<size_t>(numHexes) * 3);

    for (int r = 0; r < rows; ++r) {
        for (int q = 0; q < cols; ++q) {
            HexCoord c{q, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
            buildShape(hex);
            buildLabel(hex);
        }
    }
    linkSides();
}

void HexGrid::render(sf::RenderWindow& window) {
    for (auto& [coord, hex] : _hexes) {
        // Find first alive unit for tint/symbol
        AUnit* first = nullptr;
        int aliveCount = 0;
        for (AUnit* u : hex.units) {
            if (u && u->getAlive()) {
                if (!first) first = u;
                ++aliveCount;
            }
        }

        if (first) {
            hex.shape.setFillColor(first->getTeam() == 1
                ? sf::Color(60, 15, 15, 220)
                : sf::Color(15, 15, 60, 220));
        } else {
            hex.shape.setFillColor(sf::Color(30, 30, 40, 200));
        }
        window.draw(hex.shape);
        if (_font) window.draw(hex.label);

        if (_font && first) {
            sf::Text sym;
            sym.setFont(*_font);
            sym.setCharacterSize(static_cast<unsigned int>(_hexSize * 0.7f));
            sym.setString(aliveCount > 1
                ? std::to_string(aliveCount)
                : std::string(1, first->getPrintSymbol()));
            sf::Color col = (first->getTeam() == 1) ? sf::Color::Red : sf::Color::Cyan;
            if (first->getCast() != 0) col = sf::Color::Yellow;
            if (first->getBroken())    col = sf::Color(255, 140, 0);
            sym.setFillColor(col);
            sf::FloatRect sb = sym.getLocalBounds();
            sym.setOrigin(sb.left + sb.width * 0.5f, sb.top + sb.height * 0.5f);
            sym.setPosition(hexToPixel(coord));
            window.draw(sym);
        }
    }
}

Hex* HexGrid::getHex(HexCoord c) {
    auto it = _hexes.find(c);
    return it != _hexes.end() ? &it->second : nullptr;
}

Hex* HexGrid::safeGetHex(int q, int r) {
    return getHex({q, r});
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
