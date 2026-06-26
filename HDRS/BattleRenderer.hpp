#pragma once
#include <SFML/Graphics.hpp>
#include <unordered_map>
#include "HexGrid.hpp"

// Owns all SFML rendering: hex shapes, coord labels, camera, unit symbols.
// The hex grid and battlefield are pure data — this class reads them and draws.
class BattleRenderer {
public:
    BattleRenderer(sf::Font& font, sf::RenderWindow& window);

    void build(const HexGrid& grid);        // build shape/label cache; call once after buildRect/buildGrid
    void initView(sf::Vector2u windowSize); // fit whole grid into view; call after build()
    void handleEvent(const sf::Event& e);  // mouse-wheel zoom + R to reset view
    void render(const HexGrid& grid);       // draw one frame

    sf::RenderWindow& getWindow();

private:
    sf::Font&         _font;
    sf::RenderWindow& _window;
    sf::View          _view;
    sf::Vector2u      _lastWindowSize;
    float             _hexSize = 35.f;

    // Bounding box of all iso-projected hex centers; computed in build(), used by initView().
    float _isoMinX = 0.f, _isoMaxX = 0.f;
    float _isoMinY = 0.f, _isoMaxY = 0.f;

    std::unordered_map<HexCoord, sf::ConvexShape, HexCoordHash> _shapes;
    std::unordered_map<HexCoord, sf::Text,        HexCoordHash> _labels;

    static sf::Vector2f toIso(sf::Vector2f flat);
    void buildHexShape(HexCoord c, sf::Vector2f flatCenter);
    void buildHexLabel(HexCoord c, sf::Vector2f isoCenter);
};
