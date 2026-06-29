#pragma once
#include <array>
#include <cstddef>
#include <unordered_map>
#include <vector>
#include <SFML/System/Vector2.hpp>

enum class HexDirection { NE = 0, E = 1, SE = 2, SW = 3, W = 4, NW = 5 };
enum class TerrainType  { Open, Forest, Marsh, Rubble };

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
    static constexpr int FRONTAGE = 40;

    Hex*         hexA     = nullptr;
    Hex*         hexB     = nullptr;
    HexDirection dirFromA = HexDirection::NE;
    bool         engaged  = false;

    // No crossing at all (cliff edge, sealed wall, river without ford).
    // Auto-set when |hexA->elevation - hexB->elevation| >= 2.
    // Can also be set manually for walls and gates.
    bool  blocked           = false;
    // One side has a defensive work (rampart, barricade).
    // fortifiedDefender points to the hex whose occupants benefit.
    bool  fortified         = false;
    Hex*  fortifiedDefender = nullptr;

    // Accumulated during a tick's combat phase. Positive means hexA's side is
    // winning (dealing more net damage), negative means hexB's side is winning.
    // Reset to 0 at the start of each resolveEngagements call.
    // Intended use: after makeBattle(), compare combatScore against a push
    // threshold to decide whether the losing side is forced to retreat one hex,
    // and the winning side advances. This lets sustained pressure translate into
    // terrain gain rather than combat being purely attrition-based.
    int combatScore = 0;
};

enum class FormationType { NORMAL, TIGHT, LOOSE };

struct Hex {
    static constexpr int CAPACITY = 640;

    HexCoord      coord    {};
    int           sizeUsed = 0;
    FormationType formation = FormationType::NORMAL;
    TerrainType   terrain   = TerrainType::Open;
    int           elevation = 0;    // 0 = sea level; valid range 0–3
    bool          impassable = false; // no unit may enter (cliff face, deep water)
    std::array<HexSide*, 6> sides {};
    std::vector<AUnit*>     units {};
};

class HexGrid {
public:
    HexGrid();

    void buildGrid(int radius);
    void buildRect(int cols, int rows);
    void clearUnits();

    Hex*        getHex(HexCoord c);
    const Hex*  getHex(HexCoord c) const;
    Hex*        safeGetHex(int q, int r);
    HexSide*    getSide(HexCoord c, HexDirection dir);
    std::array<HexCoord, 6> neighbors(HexCoord c) const;
    HexCoord    neighborCoord(HexCoord c, HexDirection d) const;
    std::vector<HexSide>&       getSides();
    const std::vector<HexSide>& getSides() const { return _sides; }

    sf::Vector2f hexToPixel(HexCoord c) const;  // axial → flat 2D pixel position
    float        getHexSize() const;
    static int   distance(HexCoord a, HexCoord b);

    const std::unordered_map<HexCoord, Hex, HexCoordHash>& getHexes() const;

private:
    sf::Vector2f _origin;
    float        _hexSize;

    std::unordered_map<HexCoord, Hex, HexCoordHash> _hexes;
    std::vector<HexSide> _sides;

    void         linkSides();
    HexDirection opposite(HexDirection d) const;
};
