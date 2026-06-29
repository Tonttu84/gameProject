#include "render/BattleRenderer.hpp"
#include "AUnit.hpp"
#include <algorithm>
#include <cmath>
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
static const sf::Color TERRAIN_FOREST ( 55, 130,  40, 220);
static const sf::Color TERRAIN_MARSH  ( 40, 110, 115, 220);
static const sf::Color TERRAIN_RUBBLE (120, 100,  70, 220);

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
    sf::Color base;
    switch (hex->terrain) {
        case TerrainType::Forest: base = TERRAIN_FOREST; break;
        case TerrainType::Marsh:  base = TERRAIN_MARSH;  break;
        case TerrainType::Rubble: base = TERRAIN_RUBBLE; break;
        default:                  base = HEX_FILL_EMPTY; break;
    }
    float f = 1.f - static_cast<float>(hex->elevation) * 0.15f;
    if (f < 0.4f) f = 0.4f;
    return sf::Color(
        static_cast<sf::Uint8>(static_cast<float>(base.r) * f),
        static_cast<sf::Uint8>(static_cast<float>(base.g) * f),
        static_cast<sf::Uint8>(static_cast<float>(base.b) * f),
        base.a
    );
}

// Debug palette: one distinct colour per squad. Indexed by hashing the squad pointer.
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
    std::vector<AUnit*> alive;
    for (AUnit* u : hex.units)
        if (u && u->getAlive()) alive.push_back(u);
    if (alive.empty()) return;
    std::sort(alive.begin(), alive.end(),
              [](AUnit* a, AUnit* b) { return a->getSortKey() < b->getSortKey(); });

    // Edge midpoint angles (flat space, degrees) for HexDirection: NE=0,E=1,SE=2,SW=3,W=4,NW=5
    static const float EDGE_ANGLE[6] = { -60.f, 0.f, 60.f, 120.f, 180.f, -120.f };

    // Symbol size proportional to unit's physical size — larger creatures appear larger.
    // scale lets fighters render bigger than support troops.
    auto symF = [&](AUnit* u, float scale = 1.f) -> unsigned int {
        float s = _hexSize * 1.6f * std::sqrt(static_cast<float>(u->getSize())
                                              / static_cast<float>(Hex::CAPACITY)) * scale;
        return static_cast<unsigned int>(std::max(4.f, std::min(s, _hexSize * 1.5f)));
    };

    float avgSym = 0.f, avgUnitSz = 0.f;
    for (AUnit* u : alive) {
        avgSym    += _hexSize * 1.6f * std::sqrt(static_cast<float>(u->getSize())
                                                 / static_cast<float>(Hex::CAPACITY));
        avgUnitSz += static_cast<float>(u->getSize());
    }
    float nf   = static_cast<float>(alive.size());
    avgSym     = std::max(4.f, std::min(avgSym / nf, _hexSize * 1.5f));
    avgUnitSz /= nf;

    sf::Text sym;
    sym.setFont(_font);
    sym.setRotation(90.f);

    // SPRITE SWAP POINT: replace setCharacterSize/setString/setFillColor/draw with sf::Sprite draw
    auto drawUnit = [&](AUnit* u, sf::Vector2f flatPos, unsigned int px, sf::Uint8 alpha = 255) {
        sf::Color col;
        if (Squad* sq = u->getSquad()) {
            size_t idx = (reinterpret_cast<uintptr_t>(sq) >> 4) % SQUAD_PALETTE_SIZE;
            col = SQUAD_PALETTE[idx];
        } else {
            col = (u->getTeam() == 1) ? sf::Color(220, 60, 60) : sf::Color(60, 100, 220);
        }
        if (u->getCast() != 0) col = sf::Color::Yellow;
        if (u->getBroken())    col = sf::Color(255, 140, 0);
        col.a = alpha;
        sym.setCharacterSize(px);
        sym.setString(std::string(1, u->getPrintSymbol()));
        sym.setFillColor(col);
        sf::FloatRect b = sym.getLocalBounds();
        sym.setOrigin(b.left + b.width * 0.5f, b.top + b.height * 0.5f);
        sym.setPosition(toIso(flatPos));
        _window.draw(sym);
    };

    // Find engaged sides
    std::vector<int> engagedDirs;
    for (int d = 0; d < 6; ++d)
        if (hex.sides[d] && hex.sides[d]->engaged)
            engagedDirs.push_back(d);

    int N = static_cast<int>(alive.size());

    if (engagedDirs.empty()) {
        // Unengaged: march formation, front rank toward attack direction.
        // Red (team 1) at bottom rows, attacks north (low Y); Blue at top rows, attacks south.
        int   team   = alive[0]->getTeam();
        float step   = avgSym * 0.80f;
        int   perRow = std::max(1, static_cast<int>(_hexSize * 1.7f / step));
        float frontY = flatCenter.y + (team == 1 ? -1.f : +1.f) * _hexSize * 0.75f;
        float yDir   = (team == 1 ? +1.f : -1.f);
        for (int row = 0, idx = 0; idx < N; ++row) {
            int   rowCnt = std::min(perRow, N - idx);
            float rowY   = frontY + yDir * static_cast<float>(row) * step;
            float rowX0  = flatCenter.x - (rowCnt - 1) * step * 0.5f;
            for (int i = 0; i < rowCnt; ++i, ++idx)
                drawUnit(alive[idx], { rowX0 + static_cast<float>(i) * step, rowY }, symF(alive[idx]));
        }
        return;
    }

    // Engaged: mirror the combat assignment from resolveEngagements().
    // Units with getEngagedSide() set draw at their assigned edge (fighters, 1.3× size).
    // Units with no assignment are support, massed behind the line (0.7× size, dimmed).
    float fStep = avgSym * 0.85f;

    struct Placement { AUnit* unit; sf::Vector2f pos; };
    std::vector<Placement> fighters;
    std::vector<AUnit*>    support;

    static constexpr int MAX_FIGHTER_RANKS = 3;
    int edgeWidth = std::max(1, static_cast<int>(_hexSize * 1.5f / fStep));

    for (int d : engagedDirs) {
        HexSide* side = hex.sides[d];
        if (!side) continue;
        float angle = EDGE_ANGLE[d] * PI / 180.f;
        sf::Vector2f eDir  = { std::cos(angle), std::sin(angle) };
        sf::Vector2f pDir  = { -eDir.y, eDir.x };
        sf::Vector2f inDir = { -eDir.x, -eDir.y };
        sf::Vector2f eMid  = { flatCenter.x + eDir.x * _hexSize * 0.78f,
                               flatCenter.y + eDir.y * _hexSize * 0.78f };

        // Collect only the units combat-assigned to this side.
        std::vector<AUnit*> edgeUnits;
        for (AUnit* u : alive)
            if (u->getEngagedSide() == side) edgeUnits.push_back(u);

        int rem = static_cast<int>(edgeUnits.size()), ei = 0;
        for (int rank = 0; rank < MAX_FIGHTER_RANKS && ei < rem; ++rank) {
            int   rankCount = std::min(edgeWidth, rem - ei);
            float t0        = -(rankCount - 1) * fStep * 0.5f;
            float rankOff   = static_cast<float>(rank) * fStep;
            for (int i = 0; i < rankCount; ++i, ++ei)
                fighters.push_back({ edgeUnits[ei], {
                    eMid.x + pDir.x * (t0 + static_cast<float>(i) * fStep) + inDir.x * rankOff,
                    eMid.y + pDir.y * (t0 + static_cast<float>(i) * fStep) + inDir.y * rankOff }});
        }
    }
    // Unassigned units (no engagedSide from resolveEngagements) are support.
    for (AUnit* u : alive)
        if (!u->getEngagedSide()) support.push_back(u);

    // Group support by squad so same-squad members draw together; loners last.
    std::sort(support.begin(), support.end(), [](AUnit* a, AUnit* b) {
        Squad* sa = a->getSquad();
        Squad* sb = b->getSquad();
        if (sa != sb) {
            if (!sa) return false;
            if (!sb) return true;
            return reinterpret_cast<uintptr_t>(sa) < reinterpret_cast<uintptr_t>(sb);
        }
        return a->getSortKey() < b->getSortKey();
    });

    // Draw support first so fighters render on top
    if (!support.empty()) {
        float sStep   = avgSym * 0.70f;
        int   sPerRow = std::max(1, static_cast<int>(_hexSize * 1.3f / sStep));
        int   numS    = static_cast<int>(support.size());
        int   numRows = (numS + sPerRow - 1) / sPerRow;
        for (int row = 0, si = 0; si < numS; ++row) {
            int   rowCnt = std::min(sPerRow, numS - si);
            float rowX   = flatCenter.x + (static_cast<float>(row)
                           - static_cast<float>(numRows - 1) * 0.5f) * sStep;
            float rowY0  = flatCenter.y - (rowCnt - 1) * sStep * 0.5f;
            for (int i = 0; i < rowCnt; ++i, ++si)
                drawUnit(support[si], { rowX, rowY0 + static_cast<float>(i) * sStep },
                         symF(support[si], 0.7f), 140);
        }
    }

    for (auto& [u, pos] : fighters)
        drawUnit(u, pos, symF(u, 1.3f));
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
