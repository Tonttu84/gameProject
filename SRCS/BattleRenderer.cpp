#include "../HDRS/BattleRenderer.hpp"
#include "../HDRS/AUnit.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <string>
#include <vector>
#include <SFML/Window/Keyboard.hpp>

static constexpr float PI = 3.14159265358979323846f;

static constexpr unsigned int HEX_LABEL_FONT_SIZE = 10u;
static constexpr float        PAN_SPEED_FRACTION  = 0.008f;

static const sf::Color HEX_FILL_EMPTY   (30,  30,  40,  200);
static const sf::Color HEX_OUTLINE_COLOR(160, 160, 200);
static const sf::Color HEX_FILL_RED     (60,  15,  15,  220);
static const sf::Color HEX_FILL_BLUE    (15,  15,  60,  220);
static const sf::Color HEX_COORD_COLOR  (100, 100, 130);

BattleRenderer::BattleRenderer(sf::Font& font, sf::RenderWindow& window)
    : _font(font), _window(window)
{}

sf::RenderWindow& BattleRenderer::getWindow() {
    return _window;
}

sf::Vector2f BattleRenderer::toIso(sf::Vector2f flat) {
    return { flat.x, flat.y * 0.5f };
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

    float pad = _hexSize * 2.f;
    float w   = (_isoMaxX - _isoMinX) + 2.f * pad;
    float h   = (_isoMaxY - _isoMinY) + 2.f * pad;
    float cx  = (_isoMinX + _isoMaxX) * 0.5f;
    float cy  = (_isoMinY + _isoMaxY) * 0.5f;

    float winAspect = static_cast<float>(windowSize.x) / static_cast<float>(windowSize.y);
    if (w / h < winAspect)
        w = h * winAspect;
    else
        h = w / winAspect;

    _view.setSize(w, h);
    _view.setCenter(cx, cy);
}

void BattleRenderer::handleEvent(const sf::Event& e) {
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

    // SPRITE SWAP POINT: replace setCharacterSize/setString/setFillColor/draw with sf::Sprite draw
    auto drawUnit = [&](AUnit* u, sf::Vector2f flatPos, unsigned int px, sf::Uint8 alpha = 255) {
        sf::Color col = (u->getTeam() == 1) ? sf::Color(220, 60, 60) : sf::Color(60, 100, 220);
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
        // Red (team 1) attacks west — front at low-X edge; Blue attacks east — front at high-X edge.
        int   team   = alive[0]->getTeam();
        float step   = avgSym * 0.80f;
        int   perRow = std::max(1, static_cast<int>(_hexSize * 1.7f / step));
        float frontX = flatCenter.x + (team == 1 ? -1.f : +1.f) * _hexSize * 0.75f;
        float xDir   = (team == 1 ? +1.f : -1.f);
        for (int row = 0, idx = 0; idx < N; ++row) {
            int   rowCnt = std::min(perRow, N - idx);
            float rowX   = frontX + xDir * static_cast<float>(row) * step;
            float rowY0  = flatCenter.y - (rowCnt - 1) * step * 0.5f;
            for (int i = 0; i < rowCnt; ++i, ++idx)
                drawUnit(alive[idx], { rowX, rowY0 + static_cast<float>(i) * step }, symF(alive[idx]));
        }
        return;
    }

    // Engaged: assign fighters to each engaged edge, rest are support massed behind them.
    // Fighters draw at 1.3× size, full brightness.
    // Support draws at 0.7× size, dimmed — visually present but clearly in reserve.
    int   fightSlots = std::max(1, static_cast<int>(
        std::ceil(static_cast<float>(HexSide::FRONTAGE) / avgUnitSz)));
    float fStep = avgSym * 0.85f;

    struct Placement { AUnit* unit; sf::Vector2f pos; };
    std::vector<Placement> fighters;
    std::vector<AUnit*>    support;
    int unitIdx = 0;

    // Up to 3 ranks can show at each engaged edge (supports units with longer weapons later).
    // Front rank at the edge, subsequent ranks step inward toward hex center.
    static constexpr int MAX_FIGHTER_RANKS = 3;
    // How many units fit along the edge in one rank
    int edgeWidth = std::max(1, static_cast<int>(_hexSize * 1.5f / fStep));

    for (int d : engagedDirs) {
        if (unitIdx >= N) break;
        float angle = EDGE_ANGLE[d] * PI / 180.f;
        sf::Vector2f eDir  = { std::cos(angle), std::sin(angle) };
        sf::Vector2f pDir  = { -eDir.y, eDir.x };          // along the edge
        sf::Vector2f inDir = { -eDir.x, -eDir.y };          // inward toward center
        sf::Vector2f eMid  = { flatCenter.x + eDir.x * _hexSize * 0.78f,
                               flatCenter.y + eDir.y * _hexSize * 0.78f };

        int remaining = std::min(fightSlots, N - unitIdx);
        for (int rank = 0; rank < MAX_FIGHTER_RANKS && remaining > 0; ++rank) {
            int   rankCount = std::min(edgeWidth, remaining);
            float t0        = -(rankCount - 1) * fStep * 0.5f;
            float rankOff   = static_cast<float>(rank) * fStep;
            for (int i = 0; i < rankCount; ++i, ++unitIdx, --remaining)
                fighters.push_back({ alive[unitIdx], {
                    eMid.x + pDir.x * (t0 + static_cast<float>(i) * fStep) + inDir.x * rankOff,
                    eMid.y + pDir.y * (t0 + static_cast<float>(i) * fStep) + inDir.y * rankOff }});
        }
    }
    for (; unitIdx < N; ++unitIdx)
        support.push_back(alive[unitIdx]);

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

    _window.clear();
    _window.setView(_view);

    for (auto& [coord, shape] : _shapes) {
        const Hex* hex = grid.getHex(coord);
        AUnit* first = nullptr;
        if (hex) {
            for (AUnit* u : hex->units)
                if (u && u->getAlive()) { first = u; break; }
        }

        shape.setFillColor(first
            ? (first->getTeam() == 1 ? HEX_FILL_RED : HEX_FILL_BLUE)
            : HEX_FILL_EMPTY);
        _window.draw(shape);

        if (first) {
            renderUnitsInHex(*hex, grid.hexToPixel(coord));
        } else {
            auto it = _labels.find(coord);
            if (it != _labels.end())
                _window.draw(it->second);
        }
    }

    _window.setView(_window.getDefaultView());
    _window.display();
}
