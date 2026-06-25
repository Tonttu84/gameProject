#pragma once
#include <array>
#include <unordered_map>
#include <vector>
#include <SFML/Graphics.hpp>

enum class HexDirection { NE = 0, E = 1, SE = 2, SW = 3, W = 4, NW = 5 };

struct HexCoord {
    int q = 0, r = 0;
    bool operator==(const HexCoord& o) const noexcept { return q == o.q && r == o.r; }
};

struct HexCoordHash {
    size_t operator()(const HexCoord& c) const noexcept {
        return std::hash<int>()(c.q) ^ (std::hash<int>()(c.r) << 16);
    }
};

struct Hex;

struct HexSide {
    Hex*         hexA     = nullptr;
    Hex*         hexB     = nullptr;
    HexDirection dirFromA = HexDirection::NE;
    bool         engaged  = false;
};

enum class FormationType { NORMAL, TIGHT, LOOSE };

struct Hex {
    static constexpr int CAPACITY = 640;

    HexCoord      coord    {};
    int           team     = 0;
    int           sizeUsed = 0;
    FormationType formation = FormationType::NORMAL;
    std::array<HexSide*, 6> sides {};  // indexed by HexDirection, null if no neighbor
    sf::ConvexShape shape;
    sf::Text        label;
};

class HexGrid {
public:
    static constexpr float HEX_SIZE = 40.f;

    HexGrid(sf::Font& font, sf::Vector2f origin = {0.f, 0.f});

    void buildGrid(int radius);
    void render(sf::RenderWindow& window);

    Hex*     getHex(HexCoord c);
    HexSide* getSide(HexCoord c, HexDirection dir);
    std::array<HexCoord, 6> neighbors(HexCoord c) const;

private:
    sf::Font&    _font;
    sf::Vector2f _origin;

    std::unordered_map<HexCoord, Hex, HexCoordHash> _hexes;
    std::vector<HexSide> _sides;

    sf::Vector2f hexToPixel(HexCoord c) const;
    void         buildShape(Hex& hex);
    void         buildLabel(Hex& hex);
    HexCoord     neighborCoord(HexCoord c, HexDirection d) const;
    HexDirection opposite(HexDirection d) const;
};
