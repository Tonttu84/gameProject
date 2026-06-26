#include "../HDRS/BattleRenderer.hpp"
#include "../HDRS/AUnit.hpp"
#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <string>
#include <SFML/Window/Keyboard.hpp>

static constexpr float PI = 3.14159265358979323846f;

static constexpr unsigned int HEX_LABEL_FONT_SIZE   = 10u;
static constexpr float        HEX_SINGLE_TYPE_SCALE = 0.65f;
static constexpr float        HEX_MULTI_TYPE_SCALE  = 0.45f;
static constexpr float        PAN_SPEED_FRACTION    = 0.008f;

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
            std::map<char, int> groups;
            for (AUnit* u : hex->units)
                if (u && u->getAlive())
                    groups[u->getPrintSymbol()]++;

            std::string labelStr;
            for (auto& [ch, cnt] : groups) {
                if (!labelStr.empty()) labelStr += '\n';
                labelStr += std::to_string(cnt) + ch;
            }

            float scale = (groups.size() > 1) ? HEX_MULTI_TYPE_SCALE : HEX_SINGLE_TYPE_SCALE;
            sf::Text sym;
            sym.setFont(_font);
            sym.setCharacterSize(static_cast<unsigned int>(_hexSize * scale));
            sym.setString(labelStr);
            sf::Color col = (first->getTeam() == 1) ? sf::Color::Red : sf::Color::Cyan;
            if (first->getCast() != 0) col = sf::Color::Yellow;
            if (first->getBroken())    col = sf::Color(255, 140, 0);
            sym.setFillColor(col);
            sf::FloatRect sb = sym.getLocalBounds();
            sym.setOrigin(sb.left + sb.width * 0.5f, sb.top + sb.height * 0.5f);
            sym.setPosition(toIso(grid.hexToPixel(coord)));
            _window.draw(sym);
        } else {
            auto it = _labels.find(coord);
            if (it != _labels.end())
                _window.draw(it->second);
        }
    }

    _window.setView(_window.getDefaultView());
    _window.display();
}
