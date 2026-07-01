#pragma once
#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <queue>
#include <string>
#include <unordered_map>
#include <vector>
#include <SFML/System/Vector2.hpp>

enum class HexDirection { NE = 0, E = 1, SE = 2, SW = 3, W = 4, NW = 5 };
enum class TerrainType  { Open, Forest, Marsh, Rubble };

// Single source of truth for terrain display — both BattleRenderer (SFML) and
// the React campaign UI read name/color from here.
struct TerrainMeta {
    const char* name;
    uint8_t r, g, b;
};
inline constexpr TerrainMeta TERRAIN_META[] = {
    {"Open",    90, 100,  65},
    {"Forest",  55, 130,  40},
    {"Marsh",   40, 110, 115},
    {"Rubble", 120, 100,  70},
};
inline constexpr const TerrainMeta& terrainMeta(TerrainType t) {
    return TERRAIN_META[static_cast<int>(t)];
}

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
    bool          impassable = false; // no ground/mounted unit may enter (cliff face, deep
                                       // water); Flyer units are exempt everywhere this is checked
    std::array<HexSide*, 6> sides {};
    std::vector<AUnit*>     units {};
};

// How many size-points can fight on this side given its terrain.
// Forest halves the space; Rubble reduces it by a quarter; Open is full FRONTAGE.
// Minimum 10 so even giant creatures can always place at least one fighter.
inline int effectiveFrontage(const HexSide& side) {
    int f = HexSide::FRONTAGE;
    if ((side.hexA && side.hexA->terrain == TerrainType::Forest) ||
        (side.hexB && side.hexB->terrain == TerrainType::Forest))
        f /= 2;
    else if ((side.hexA && side.hexA->terrain == TerrainType::Rubble) ||
             (side.hexB && side.hexB->terrain == TerrainType::Rubble))
        f = f * 3 / 4;
    return std::max(f, 10);
}

class HexGrid {
public:
    HexGrid();

    void buildGrid(int radius);
    void buildRect(int cols, int rows);
    void clearUnits();

    // Serialize the grid's terrain/elevation/impassable/side state to JSON.
    // Only non-default hexes are emitted. cols/rows must match the buildRect call.
    std::string toJson(int cols, int rows, const std::string& name = "") const;

    // Apply hex overrides from a JSON string produced by toJson().
    // If the grid is empty, builds it from the JSON's cols/rows first.
    void fromJson(const std::string& jsonStr);

    Hex*        getHex(HexCoord c);
    const Hex*  getHex(HexCoord c) const;
    Hex*        safeGetHex(int q, int r);
    HexSide*    getSide(HexCoord c, HexDirection dir);
    std::array<HexCoord, 6> neighbors(HexCoord c) const;
    HexCoord    neighborCoord(HexCoord c, HexDirection d) const;
    std::vector<HexSide>&       getSides();
    const std::vector<HexSide>& getSides() const { return _sides; }

    // Deployment zone row ranges (inclusive). Returns -1 if not set.
    int playerZoneMinRow() const { return _playerZoneMinRow; }
    int playerZoneMaxRow() const { return _playerZoneMaxRow; }
    int enemyZoneMinRow()  const { return _enemyZoneMinRow;  }
    int enemyZoneMaxRow()  const { return _enemyZoneMaxRow;  }
    bool hasPlayerZone()   const { return _playerZoneMinRow >= 0; }
    bool hasEnemyZone()    const { return _enemyZoneMinRow  >= 0; }

    // Returns all hexes in the player/enemy zone (empty if zone not set).
    std::vector<HexCoord> playerZone() const;
    std::vector<HexCoord> enemyZone()  const;

    sf::Vector2f hexToPixel(HexCoord c) const;  // axial → flat 2D pixel position
    float        getHexSize() const;
    static int   distance(HexCoord a, HexCoord b);

    const std::unordered_map<HexCoord, Hex, HexCoordHash>& getHexes() const;

    // Precompute BFS hop distances across the passable hex graph.
    // Call once at battle start and again whenever terrain/impassable flags change.
    // Ground graph: walls = impassable hexes + blocked/cliff hexsides.
    // Mounted graph: additionally treats Forest and Marsh hexes as walls.
    // redFleeRow / blueFleeRow: the r-coordinate of each team's home edge
    // (the row they flee toward). Typically height-1 for Red, 0 for Blue.
    void computeDistances(int redFleeRow, int blueFleeRow);

    // Hop distance between two hexes for the given movement graph.
    // Returns UNREACHABLE if no path exists. Flyers should use the static distance() instead.
    static constexpr int UNREACHABLE = 30000;
    int bfsDistance(const Hex* from, const Hex* to, bool mounted) const;

    // Hops from a hex to the team's home edge (the row they flee toward).
    // Returns UNREACHABLE if the edge is not reachable via the passable graph.
    int fleeDistance(const Hex* hex, bool mounted, bool redTeam) const;

    int hexCount() const { return static_cast<int>(_hexIndex.size()); }

private:
    sf::Vector2f _origin;
    float        _hexSize;

    // Deployment zone row ranges. -1 = not set.
    int _playerZoneMinRow = -1;
    int _playerZoneMaxRow = -1;
    int _enemyZoneMinRow  = -1;
    int _enemyZoneMaxRow  = -1;

    std::unordered_map<HexCoord, Hex, HexCoordHash> _hexes;
    std::vector<HexSide> _sides;

    // Stable integer index assigned to each hex at build time.
    std::unordered_map<HexCoord, int, HexCoordHash> _hexIndex;
    std::vector<Hex*>                                _indexedHexes; // index → Hex*

    // distGround[from][to] and distMounted[from][to]: hop counts.
    std::vector<std::vector<int>> _distGround;
    std::vector<std::vector<int>> _distMounted;

    // flee distances toward each team's home edge (the r-row they flee toward).
    std::vector<int> _redFleeGround;
    std::vector<int> _redFleeMounted;
    std::vector<int> _blueFleeGround;
    std::vector<int> _blueFleeMounted;

    void         linkSides();
    HexDirection opposite(HexDirection d) const;

    // Run multi-source BFS from `sources` on the given adjacency graph.
    // Returns a per-hex distance array indexed by _hexIndex.
    std::vector<int> bfsFromSources(const std::vector<int>& sources,
                                     bool mounted) const;
};
