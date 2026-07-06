#include "render/BattleRenderer.hpp"
#include "AUnit.hpp"
#include "FormationLayout.hpp"
#include "Squad.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <string>
#include <vector>
#include <SFML/Window/Keyboard.hpp>

static constexpr float PI = 3.14159265358979323846f;

static constexpr unsigned int HEX_LABEL_FONT_SIZE = 10u;
static constexpr float        PAN_SPEED_FRACTION  = 0.008f;

static const sf::Color HEX_FILL_EMPTY   ( 30,  30,  40, 200);
static const sf::Color HEX_OUTLINE_COLOR(160, 160, 200);
static const sf::Color HEX_FILL_RED     ( 60,  15,  15, 220);  // dark; used for coord labels area
static const sf::Color HEX_FILL_BLUE    ( 15,  15,  60, 220);
static const sf::Color HEX_COORD_COLOR  (100, 100, 130);

// Brighter team tints used when blending with terrain colour.
// Distinct enough to read team identity even after the blend.
static const sf::Color TEAM_TINT_RED    (150,  30,  30, 220);
static const sf::Color TEAM_TINT_BLUE   ( 30,  30, 150, 220);

// Terrain base colours — bright enough to show through the team tint blend.
// RGB values come from TerrainMeta in HexGrid.hpp (single source of truth).
static const sf::Color TERRAIN_IMPASSABLE( 85,  75,  95, 255); // dark rock/cliff

// Linear interpolation between two colours. t=0 → a, t=1 → b.
static sf::Color blendColors(sf::Color a, sf::Color b, float t) {
    auto lerp = [](sf::Uint8 x, sf::Uint8 y, float f) -> sf::Uint8 {
        return static_cast<sf::Uint8>(static_cast<float>(x) * (1.f - f)
                                    + static_cast<float>(y) * f);
    };
    return sf::Color(lerp(a.r, b.r, t), lerp(a.g, b.g, t),
                     lerp(a.b, b.b, t), lerp(a.a, b.a, t));
}

// Hexside markers
static const sf::Color SIDE_BLOCKED   (220,  40,  40, 255);  // red for cliffs/walls
static const sf::Color SIDE_FORTIFIED (220, 180,  40, 255);  // gold for ramparts

// Returns the pixel position of corner i of a pointy-top hex at center.
// Corner i is at angle (60*i - 90) degrees; matches buildHexShape() order.
static sf::Vector2f hexCorner(sf::Vector2f center, float size, int i) {
    float angle = (60.f * static_cast<float>(i) - 90.f) * PI / 180.f;
    return { center.x + size * std::cos(angle),
             center.y + size * std::sin(angle) };
}

// Hex fill colour from terrain type + elevation (darker = higher ground).
static sf::Color terrainColor(const Hex* hex) {
    if (!hex) return HEX_FILL_EMPTY;
    if (hex->impassable) return TERRAIN_IMPASSABLE;
    const TerrainMeta& m = terrainMeta(hex->terrain);
    constexpr sf::Uint8 ALPHA = 220;
    sf::Color base(m.r, m.g, m.b, ALPHA);
    float f = 1.f - static_cast<float>(hex->elevation) * 0.15f;
    if (f < 0.4f) f = 0.4f;
    return sf::Color(
        static_cast<sf::Uint8>(static_cast<float>(base.r) * f),
        static_cast<sf::Uint8>(static_cast<float>(base.g) * f),
        static_cast<sf::Uint8>(static_cast<float>(base.b) * f),
        base.a
    );
}

// Debug palette: one distinct colour per squad, indexed by hashing the squad
// NAME with the same function as ReplayView.jsx's squadColor() — a squad
// wears one colour in the SFML window, the web replay, and across runs.
// (Team identity reads from the hex tint; squad colours override unit team
// colour on purpose, for visual debugging until sprites land.)
static const sf::Color SQUAD_PALETTE[] = {
    sf::Color(255, 215,   0),  // gold
    sf::Color(  0, 255, 180),  // mint
    sf::Color(255,  80, 220),  // pink
    sf::Color(  0, 200, 255),  // sky-blue
    sf::Color(180, 255,   0),  // lime
    sf::Color(255, 120,   0),  // orange
    sf::Color(200,  80, 255),  // violet
    sf::Color( 80, 255, 120),  // green
    sf::Color(255, 255, 120),  // yellow
    sf::Color(120, 200, 255),  // cornflower
};
static constexpr size_t SQUAD_PALETTE_SIZE =
    sizeof(SQUAD_PALETTE) / sizeof(SQUAD_PALETTE[0]);

BattleRenderer::BattleRenderer(sf::Font& font, sf::RenderWindow& window)
    : _font(font), _window(window)
{}

sf::RenderWindow& BattleRenderer::getWindow() {
    return _window;
}

sf::Vector2f BattleRenderer::toIso(sf::Vector2f flat) {
    return flat;
}

void BattleRenderer::buildHexShape(HexCoord c, sf::Vector2f flatCenter) {
    sf::ConvexShape& shape = _shapes[c];
    shape.setPointCount(6);
    for (size_t i = 0; i < 6; ++i) {
        float angle = (60.f * static_cast<float>(i) - 90.f) * PI / 180.f;
        sf::Vector2f flatCorner = {
            flatCenter.x + _hexSize * std::cos(angle),
            flatCenter.y + _hexSize * std::sin(angle)
        };
        shape.setPoint(i, toIso(flatCorner));
    }
    shape.setFillColor(HEX_FILL_EMPTY);
    shape.setOutlineColor(HEX_OUTLINE_COLOR);
    shape.setOutlineThickness(1.5f);
}

void BattleRenderer::buildHexLabel(HexCoord c, sf::Vector2f isoCenter) {
    sf::Text& label = _labels[c];
    label.setFont(_font);
    label.setCharacterSize(HEX_LABEL_FONT_SIZE);
    label.setFillColor(HEX_COORD_COLOR);
    label.setString(std::to_string(c.q) + "," + std::to_string(c.r));
    sf::FloatRect b = label.getLocalBounds();
    label.setOrigin(b.left + b.width * 0.5f, b.top + b.height * 0.5f);
    label.setPosition(isoCenter);
    label.setRotation(90.f);
}

void BattleRenderer::build(const HexGrid& grid) {
    _hexSize = grid.getHexSize();
    _shapes.clear();
    _labels.clear();

    float minX =  std::numeric_limits<float>::max();
    float maxX = -std::numeric_limits<float>::max();
    float minY =  std::numeric_limits<float>::max();
    float maxY = -std::numeric_limits<float>::max();

    for (auto& [coord, hex] : grid.getHexes()) {
        sf::Vector2f flatCenter = grid.hexToPixel(coord);
        sf::Vector2f isoCenter  = toIso(flatCenter);
        minX = std::min(minX, isoCenter.x);
        maxX = std::max(maxX, isoCenter.x);
        minY = std::min(minY, isoCenter.y);
        maxY = std::max(maxY, isoCenter.y);
        buildHexShape(coord, flatCenter);
        buildHexLabel(coord, isoCenter);
    }
    _isoMinX = minX; _isoMaxX = maxX;
    _isoMinY = minY; _isoMaxY = maxY;
}

void BattleRenderer::initView(sf::Vector2u windowSize) {
    _lastWindowSize = windowSize;

    float pad    = _hexSize * 0.1f;
    float worldW = (_isoMaxX - _isoMinX) + 2.f * pad;  // world X extent → screen height after rotation
    float cx     = (_isoMinX + _isoMaxX) * 0.5f;
    float cy     = (_isoMinY + _isoMaxY) * 0.5f;

    // With 90° view rotation, SFML maps: world X → NDC Y (screen height) via vy,
    // and world Y → NDC X (screen width) via vx.  So vy controls vertical coverage
    // and vx controls horizontal coverage — the opposite of the unrotated case.
    // vy = worldW: grid columns (world X) always fill screen height.
    // vx = vy * winAspect: wider windows reveal more depth (world Y / grid rows).
    float winAspect = static_cast<float>(windowSize.x) / static_cast<float>(windowSize.y);
    float vy = worldW;
    float vx = vy * winAspect;

    _view.setSize(vx, vy);
    _view.setCenter(cx, cy);
    _view.setRotation(90.f);
}

void BattleRenderer::handleEvent(const sf::Event& e) {
    if (e.type == sf::Event::Resized)
        initView({e.size.width, e.size.height});
    if (e.type == sf::Event::MouseWheelScrolled) {
        float factor = (e.mouseWheelScroll.delta > 0) ? 0.85f : 1.15f;
        _view.zoom(factor);
    }
    if (e.type == sf::Event::KeyPressed && e.key.code == sf::Keyboard::R)
        initView(_lastWindowSize);
}

void BattleRenderer::renderUnitsInHex(const Hex& hex, sf::Vector2f flatCenter) {
    // Positions/sizes come from the shared layout (FormationLayout.cpp) — the
    // same function whose offsets ReplayRecorder persists, so the SFML window
    // and the web replay always show identical formations.
    std::vector<UnitPlacement> placements = layoutHexFormation(hex);
    if (placements.empty()) return;

    bool engaged = false;
    for (int d = 0; d < 6; ++d)
        if (hex.sides[d] && hex.sides[d]->engaged) engaged = true;

    // Alpha layers combat depth: frontline solid, reserves dimmed, the
    // unseated support pool faintest. Unengaged hexes draw solid.
    static const sf::Uint8 RANK_ALPHA[4] = { 140, 255, 200, 160 };
    auto alphaFor = [&](const AUnit* u) -> sf::Uint8 {
        if (!engaged) return 255;
        int rank = u->getEngagedRank();
        return (u->getFormationSide() && rank >= 1 && rank <= 3)
                   ? RANK_ALPHA[rank] : RANK_ALPHA[0];
    };

    sf::Text sym;
    sym.setFont(_font);
    sym.setRotation(90.f);

    // SPRITE SWAP POINT: replace setCharacterSize/setString/setFillColor/draw with sf::Sprite draw
    for (const UnitPlacement& p : placements) {
        AUnit* u = p.unit;
        sf::Color col;
        if (Squad* sq = u->getSquad()) {
            uint32_t h = 0;
            for (unsigned char c : sq->getName()) h = h * 31u + c;
            col = SQUAD_PALETTE[h % SQUAD_PALETTE_SIZE];
        } else {
            col = (u->getTeam() == 1) ? sf::Color(220, 60, 60) : sf::Color(60, 100, 220);
        }
        if (u->getCast() != 0) col = sf::Color::Yellow;
        if (u->getBroken())    col = sf::Color(255, 140, 0);
        col.a = alphaFor(u);
        sym.setCharacterSize(static_cast<unsigned int>(p.scale * _hexSize));
        sym.setString(std::string(1, u->getPrintSymbol()));
        sym.setFillColor(col);
        sf::FloatRect b = sym.getLocalBounds();
        sym.setOrigin(b.left + b.width * 0.5f, b.top + b.height * 0.5f);
        sym.setPosition(toIso({ flatCenter.x + p.ox * _hexSize,
                                flatCenter.y + p.oy * _hexSize }));
        _window.draw(sym);
    }
}

void BattleRenderer::render(const HexGrid& grid) {
    if (_window.getSize() != _lastWindowSize)
        initView(_window.getSize());
    float panSpeed = _view.getSize().x * PAN_SPEED_FRACTION;
    sf::Vector2f moveDir(0.f, 0.f);
    // With 90° CW view rotation: world +X → screen up, world +Y → screen right.
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Left)  || sf::Keyboard::isKeyPressed(sf::Keyboard::A))
        moveDir.y -= panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Right) || sf::Keyboard::isKeyPressed(sf::Keyboard::D))
        moveDir.y += panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Up)    || sf::Keyboard::isKeyPressed(sf::Keyboard::W))
        moveDir.x += panSpeed;
    if (sf::Keyboard::isKeyPressed(sf::Keyboard::Down)  || sf::Keyboard::isKeyPressed(sf::Keyboard::S))
        moveDir.x -= panSpeed;
    _view.move(moveDir);

    _window.clear();
    _window.setView(_view);

    // Pass 1: hex fills — terrain colour blended 50/50 with team tint when occupied.
    for (auto& [coord, shape] : _shapes) {
        const Hex* hex = grid.getHex(coord);
        AUnit* first = nullptr;
        if (hex) {
            for (AUnit* u : hex->units)
                if (u && u->getAlive()) { first = u; break; }
        }

        sf::Color fill = terrainColor(hex);
        if (first) {
            sf::Color tint = first->getTeam() == 1 ? TEAM_TINT_RED : TEAM_TINT_BLUE;
            fill = blendColors(fill, tint, 0.25f);
        }
        shape.setFillColor(fill);
        _window.draw(shape);

        if (first) {
            renderUnitsInHex(*hex, grid.hexToPixel(coord));
        } else {
            auto it = _labels.find(coord);
            if (it != _labels.end())
                _window.draw(it->second);
        }
    }

    // Pass 2: hexside markers — blocked (red) and fortified (gold) edges.
    for (const HexSide& side : grid.getSides()) {
        if (!side.hexA || !side.hexB) continue;
        bool isCliff    = std::abs(side.hexA->elevation - side.hexB->elevation) >= 2;
        bool isBlocked  = side.blocked || isCliff;
        bool isFortified = side.fortified;
        if (!isBlocked && !isFortified) continue;

        sf::Color lineColor = isBlocked ? SIDE_BLOCKED : SIDE_FORTIFIED;
        sf::Vector2f center = grid.hexToPixel(side.hexA->coord);
        int d = static_cast<int>(side.dirFromA);
        sf::Vector2f p1 = hexCorner(center, _hexSize, d);
        sf::Vector2f p2 = hexCorner(center, _hexSize, (d + 1) % 6);

        sf::Vertex line[2] = {
            sf::Vertex(p1, lineColor),
            sf::Vertex(p2, lineColor)
        };
        _window.draw(line, 2, sf::Lines);
    }

    _window.setView(_window.getDefaultView());
    _window.display();
}
