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

class AUnit;
struct Hex;

struct HexSide {
    static constexpr int FRONTAGE = 40;   // size-points that can fight across one face

    Hex*         hexA     = nullptr;
    Hex*         hexB     = nullptr;
    HexDirection dirFromA = HexDirection::NE;
    bool         engaged  = false;
};

enum class FormationType { NORMAL, TIGHT, LOOSE };

struct Hex {
    static constexpr int CAPACITY = 640;

    HexCoord      coord    {};
    int           sizeUsed = 0;
    FormationType formation = FormationType::NORMAL;
    std::array<HexSide*, 6> sides {};
    std::vector<AUnit*>     units {};  // non-owning; ordered by arrival
    sf::ConvexShape shape;
    sf::Text        label;
};

class HexGrid {
public:
    HexGrid();  // default: hexSize=20, origin=(20,25), no font

    void setFont(sf::Font* font);   // call after font is loaded to enable labels
    void buildGrid(int radius);     // hexagonal grid
    void buildRect(int cols, int rows); // rectangular grid

    void render(sf::RenderWindow& window);

    Hex*     getHex(HexCoord c);
    Hex*     safeGetHex(int q, int r);
    HexSide* getSide(HexCoord c, HexDirection dir);
    std::array<HexCoord, 6> neighbors(HexCoord c) const;
    HexCoord neighborCoord(HexCoord c, HexDirection d) const;

    static int distance(HexCoord a, HexCoord b);
    sf::Vector2f pixelCenter(HexCoord c) const;
    std::vector<HexSide>& getSides();

private:
    sf::Font*    _font;
    sf::Vector2f _origin;
    float        _hexSize;

    std::unordered_map<HexCoord, Hex, HexCoordHash> _hexes;
    std::vector<HexSide> _sides;

    sf::Vector2f hexToPixel(HexCoord c) const;
    void         buildShape(Hex& hex);
    void         buildLabel(Hex& hex);
    void         linkSides();
    HexDirection opposite(HexDirection d) const;
};
