#include "../HDRS/HexGrid.hpp"
#include "../HDRS/AUnit.hpp"
#include <algorithm>
#include <cmath>
#include <string>
#include <map>
#include <limits>
#include <SFML/Window/Keyboard.hpp>

static constexpr float PI = 3.14159265358979323846f;

// Axial neighbor offsets — NE E SE SW W NW (pointy-top, r increases southward)
static constexpr int DQ[6] = { 1,  1,  0, -1, -1,  0};
static constexpr int DR[6] = {-1,  0,  1,  1,  0, -1};

// Rendering layout — adjust these to reposition or rescale the entire grid.
// HEX_SIZE controls the radius of each hex in pixels; origin is the top-left pixel offset.
// Scale constants control text size relative to hex size (fraction of HEX_SIZE).
static constexpr float        HEX_ORIGIN_X          = 30.f;
static constexpr float        HEX_ORIGIN_Y          = 30.f;
static constexpr float        HEX_SIZE_DEFAULT      = 35.f;
static constexpr unsigned int HEX_LABEL_FONT_SIZE   = 10u;   // coord label size (pixels), shown on empty hexes
static constexpr float        HEX_SINGLE_TYPE_SCALE = 0.65f; // unit symbol font = this * HEX_SIZE, single type
static constexpr float        HEX_MULTI_TYPE_SCALE  = 0.45f; // reduced size when multiple unit types share a hex

// Camera pan speed as fraction of view width per frame (tuned for ~60fps feel).
static constexpr float PAN_SPEED_FRACTION = 0.008f;

// Hex fill/outline colors — RGBA. Alpha 200/220 keeps the grid slightly transparent.
// Tweak RED/BLUE tints here to change team territory appearance.
static const sf::Color HEX_FILL_EMPTY   (30,  30,  40,  200); // empty hex, dark neutral
static const sf::Color HEX_OUTLINE_COLOR(160, 160, 200);       // pale blue-grey grid lines
static const sf::Color HEX_FILL_RED     (60,  15,  15,  220); // dark red tint for red-team hexes
static const sf::Color HEX_FILL_BLUE    (15,  15,  60,  220); // dark blue tint for blue-team hexes
static const sf::Color HEX_COORD_COLOR  (100, 100, 130);       // muted label for q,r coords

HexGrid::HexGrid()
    : _font(nullptr), _origin(HEX_ORIGIN_X, HEX_ORIGIN_Y), _hexSize(HEX_SIZE_DEFAULT)
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

sf::Vector2f HexGrid::toIso(sf::Vector2f flat) {
    return { flat.x, flat.y * 0.5f };
}

sf::Vector2f HexGrid::pixelCenter(HexCoord c) const {
    return toIso(hexToPixel(c));
}

void HexGrid::buildShape(Hex& hex) {
    hex.shape.setPointCount(6);
    sf::Vector2f flatCenter = hexToPixel(hex.coord);
    for (size_t i = 0; i < 6; ++i) {
        float angle = (60.f * static_cast<float>(i) - 90.f) * PI / 180.f;
        sf::Vector2f flatCorner = {
            flatCenter.x + _hexSize * std::cos(angle),
            flatCenter.y + _hexSize * std::sin(angle)
        };
        hex.shape.setPoint(i, toIso(flatCorner));
    }
    hex.shape.setFillColor(HEX_FILL_EMPTY);
    hex.shape.setOutlineColor(HEX_OUTLINE_COLOR);
    hex.shape.setOutlineThickness(1.5f);
}

void HexGrid::buildLabel(Hex& hex) {
    if (!_font) return;
    hex.label.setFont(*_font);
    hex.label.setCharacterSize(HEX_LABEL_FONT_SIZE);
    hex.label.setFillColor(HEX_COORD_COLOR);
    hex.label.setString(std::to_string(hex.coord.q) + "," + std::to_string(hex.coord.r));
    sf::FloatRect b = hex.label.getLocalBounds();
    hex.label.setOrigin(b.left + b.width * 0.5f, b.top + b.height * 0.5f);
    hex.label.setPosition(toIso(hexToPixel(hex.coord)));
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
        for (int col = 0; col < cols; ++col) {
            // Even-r offset → axial: keeps the visual grid rectangular so armies
            // face each other left-vs-right rather than along a diagonal.
            HexCoord c{col - r / 2, r};
            Hex& hex = _hexes[c];
            hex.coord = c;
            buildShape(hex);
            buildLabel(hex);
        }
    }
    linkSides();
}

void HexGrid::render(sf::RenderWindow& window) {
    // Keyboard panning — speed scales with current view width so it feels consistent at all zoom levels.
    float panSpeed = _view.getSize().x * PAN_SPEED_FRACTION;
    sf::Vector2f moveDir(0.f, 0.f);
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Left)  || sf::Keyboard::isKeyPressed(sf::Keyboard::A))
        moveDir.x -= panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Right) || sf::Keyboard::isKeyPressed(sf::Keyboard::D))
        moveDir.x += panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Up)    || sf::Keyboard::isKeyPressed(sf::Keyboard::W))
        moveDir.y -= panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Down)  || sf::Keyboard::isKeyPressed(sf::Keyboard::S))
        moveDir.y += panSpeed;
    _view.move(moveDir);

    window.setView(_view);

    for (auto& [coord, hex] : _hexes) {
        // Find first alive unit for tint/symbol
        AUnit* first = nullptr;
        for (AUnit* u : hex.units) {
            if (u && u->getAlive()) { first = u; break; }
        }

        hex.shape.setFillColor(first
            ? (first->getTeam() == 1 ? HEX_FILL_RED : HEX_FILL_BLUE)
            : HEX_FILL_EMPTY);
        window.draw(hex.shape);

        if (_font && first) {
            std::map<char, int> groups;
            for (AUnit* u : hex.units)
                if (u && u->getAlive())
                    groups[u->getPrintSymbol()]++;

            std::string labelStr;
            for (auto& [ch, cnt] : groups) {
                if (!labelStr.empty()) labelStr += '\n';
                labelStr += std::to_string(cnt) + ch;
            }

            float scale = (groups.size() > 1) ? HEX_MULTI_TYPE_SCALE : HEX_SINGLE_TYPE_SCALE;
            sf::Text sym;
            sym.setFont(*_font);
            sym.setCharacterSize(static_cast<unsigned int>(_hexSize * scale));
            sym.setString(labelStr);
            sf::Color col = (first->getTeam() == 1) ? sf::Color::Red : sf::Color::Cyan;
            if (first->getCast() != 0) col = sf::Color::Yellow;
            if (first->getBroken())    col = sf::Color(255, 140, 0);
            sym.setFillColor(col);
            sf::FloatRect sb = sym.getLocalBounds();
            sym.setOrigin(sb.left + sb.width * 0.5f, sb.top + sb.height * 0.5f);
            sym.setPosition(toIso(hexToPixel(coord)));
            window.draw(sym);
        } else if (_font) {
            window.draw(hex.label);
        }
    }

    window.setView(window.getDefaultView());
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

void HexGrid::handleEvent(const sf::Event& e) {
    if (e.type == sf::Event::MouseWheelScrolled) {
        float factor = (e.mouseWheelScroll.delta > 0) ? 0.85f : 1.15f;
        _view.zoom(factor);
    }
    if (e.type == sf::Event::KeyPressed && e.key.code == sf::Keyboard::R)
        initView(_lastWindowSize);
}

void HexGrid::initView(sf::Vector2u windowSize) {
    _lastWindowSize = windowSize;

    float minX =  std::numeric_limits<float>::max();
    float maxX = -std::numeric_limits<float>::max();
    float minY =  std::numeric_limits<float>::max();
    float maxY = -std::numeric_limits<float>::max();

    for (auto& [c, hex] : _hexes) {
        sf::Vector2f p = toIso(hexToPixel(c));
        minX = std::min(minX, p.x);
        maxX = std::max(maxX, p.x);
        minY = std::min(minY, p.y);
        maxY = std::max(maxY, p.y);
    }

    float pad = _hexSize * 2.f;
    float w = (maxX - minX) + 2.f * pad;
    float h = (maxY - minY) + 2.f * pad;
    float cx = (minX + maxX) * 0.5f;
    float cy = (minY + maxY) * 0.5f;

    // Expand the smaller dimension to match the window aspect ratio.
    float winAspect = static_cast<float>(windowSize.x) / static_cast<float>(windowSize.y);
    if (w / h < winAspect)
        w = h * winAspect;
    else
        h = w / winAspect;

    _view.setSize(w, h);
    _view.setCenter(cx, cy);
}
