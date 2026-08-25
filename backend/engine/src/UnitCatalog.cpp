#include "UnitCatalog.hpp"
#include "hex/HexGrid.hpp"
#include "units/Soldier.hpp"
#include "units/RoyalGuard.hpp"
#include "units/Pikeman.hpp"
#include "units/Militia.hpp"
#include "units/Archer.hpp"
#include "units/Mage.hpp"
#include "units/Priest.hpp"
#include "units/Necromancer.hpp"
#include "units/Cavalry.hpp"
#include "units/LightCavalry.hpp"
#include "units/Zombie.hpp"
#include "units/Skeleton.hpp"
#include "units/Scorpion.hpp"
#include "units/Horse.hpp"
#include "units/Warhorse.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <unordered_map>

using json = nlohmann::json;

// Shorthand for the factory lambdas below — the only boilerplate per entry.
template <typename T>
static std::unique_ptr<AUnit> makeT(int team) { return std::make_unique<T>(team); }

const std::vector<UnitCatalogEntry>& unitCatalog()
{
    using R = UnitRole;
    // Roles are DESCRIPTIVE and composable — list every channel that applies.
    // `Enemy` on Soldier/Archer/LightCavalry is not a mistake: the campaign's
    // ENEMY_ARMY fields them, and the campaign-server tripwire checks that
    // list against these flags.
    // typeName          roles                      factory
    static const std::vector<UnitCatalogEntry> catalog = {
        {"Soldier",      R::Player | R::Enemy,      makeT<Soldier>},
        // Player ONLY, and deliberately: enemy hosts do not field royal guards.
        // Whether they ever should is a balance question the user declined to
        // bundle into 4d — adding R::Enemy here is the whole change if it is
        // ever answered yes. Not buyable either: the campaign's royal_guard
        // squad upgrade is the only channel through which one exists, so it is
        // the first Player type obtainable through a reinforcement recipe
        // rather than a recruit row (see docs/ADDING_UNITS.md §5).
        {"RoyalGuard",   R::Player,                 makeT<RoyalGuard>},
        {"Pikeman",      R::Player,                 makeT<Pikeman>},
        {"Militia",      R::Player,                 makeT<Militia>},
        {"Archer",       R::Player | R::Enemy,      makeT<Archer>},
        {"Mage",         R::Player,                 makeT<Mage>},
        {"Priest",       R::Player,                 makeT<Priest>},
        {"Cavalry",      R::Player,                 makeT<Cavalry>},
        {"LightCavalry", R::Player | R::Enemy,      makeT<LightCavalry>},
        {"Necromancer",  R::Enemy,                  makeT<Necromancer>},
        {"Zombie",       R::Summon,                 makeT<Zombie>},
        {"Skeleton",     R::Summon,                 makeT<Skeleton>},
        // A ridden mount that an enemy host may also field on its own.
        {"Scorpion",     R::Enemy | R::Mount,       makeT<Scorpion>},
        {"Horse",        R::Mount,                  makeT<Horse>}, // before Warhorse: shared 'h' resolves to Horse
        {"Warhorse",     R::Mount,                  makeT<Warhorse>},
    };
    return catalog;
}

std::unique_ptr<AUnit> makeUnitByName(const std::string& typeName, int team)
{
    // The API trust boundary: only types some army may legitimately field can
    // be built from request JSON. Summon-only and mount-only types are
    // unreachable here by construction — see SECURITY_NOTES.md.
    for (const auto& entry : unitCatalog())
        if ((hasRole(entry.roles, UnitRole::Player) || hasRole(entry.roles, UnitRole::Enemy))
            && typeName == entry.typeName)
            return entry.make(team);
    return nullptr;
}

std::vector<std::string> roleNames(UnitRole roles)
{
    // Stable order, so the exported array is deterministic and tests can
    // compare it directly.
    static const std::pair<UnitRole, const char*> ALL[] = {
        {UnitRole::Player, "Player"},
        {UnitRole::Enemy,  "Enemy"},
        {UnitRole::Summon, "Summon"},
        {UnitRole::Mount,  "Mount"},
    };
    std::vector<std::string> out;
    for (const auto& [flag, name] : ALL)
        if (hasRole(roles, flag)) out.push_back(name);
    return out;
}

std::string unitNameForSymbol(char symbol)
{
    // Built once by constructing one unit per type and reading its symbol.
    //
    // BUILDING IT CONSUMES RNG — every AUnit constructor draws a number for its
    // sortKey — so WHEN it is built shifts the random stream for everything
    // after it. That was harmless while this was only called from the JSON
    // export, and stopped being harmless the moment the tiered battle log
    // started naming units from inside combat: the first Trace line of a battle
    // would build the map mid-fight and eat a dozen draws, which broke every
    // test that pushes an exact dice sequence and made a seeded replay depend
    // on whether a log line happened to fire first.
    //
    // warmUnitNames() below is called at the top of main() and at the start of
    // a test run, so the cost is paid once, early, where nothing can observe
    // it — before any battle and before any test pushes a dice sequence.
    static const std::unordered_map<char, std::string> bySymbol = [] {
        std::unordered_map<char, std::string> m;
        for (const auto& entry : unitCatalog())
            m.emplace(entry.make(BLUETEAM)->getPrintSymbol(), entry.typeName);
        return m;
    }();
    auto it = bySymbol.find(symbol);
    return it != bySymbol.end() ? it->second : "";
}

// Build the map NOW, at a moment of the caller's choosing.
//
// Called from main() and from the test runner's start, both of which are
// RUNTIME — deliberately not a static initialiser. Building it at static-init
// deadlocks the test binary: the map constructs units, every AUnit constructor
// calls Utility::getRandom(), and getRandom touches `mockValues`/`gen`, which
// are statics in ANOTHER translation unit with no guaranteed construction order.
// Reading an unconstructed std::queue is undefined and in practice spins
// forever. `./game` never showed it because only the -DTESTING build compiles
// the mock-queue branch.
void warmUnitNames() { unitNameForSymbol('\0'); }

const char* categoryName(UnitCategory cat)
{
    switch (cat) {
        case UnitCategory::Foot:       return "Foot";
        case UnitCategory::Mounted:    return "Mounted";
        case UnitCategory::Flyer:      return "Flyer";
        case UnitCategory::Beast:      return "Beast";
        case UnitCategory::Skirmisher: return "Skirmisher";
    }
    return "Unknown";
}

std::string unitCatalogJson()
{
    json units = json::array();
    for (const auto& entry : unitCatalog()) {
        auto u = entry.make(BLUETEAM);

        json forbidden = json::array();
        for (TerrainType t : forbiddenTerrainForCategory(u->getCategory()))
            forbidden.push_back(terrainMeta(t).name);

        units.push_back({
            {"name",             entry.typeName},
            {"symbol",           std::string(1, u->getPrintSymbol())},
            {"size",             static_cast<int>(u->getSize())},
            {"category",         categoryName(u->getCategory())},
            {"forbiddenTerrain", forbidden},
            {"roles",            roleNames(entry.roles)},
            // Where this creature can wear things (5-6). Exported beside size
            // and category because a body plan is the same kind of fact, and
            // synced into the campaign's UnitType at boot — so adding a hydra
            // in C++ brings its anatomy along rather than needing a second
            // table someone has to remember to edit.
            {"anatomy", {
                {"head",  u->anatomy().head},
                {"torso", u->anatomy().torso},
                {"legs",  u->anatomy().legs},
                {"hand",  u->anatomy().hand},
                {"misc",  u->anatomy().misc},
            }},
            {"stats", {
                {"maxHP",          u->getmaxHP()},
                {"attack",         u->getAttackPWR()},
                {"defence",        u->getDefence()},
                {"armour",         u->getArmour()},
                {"speed",          u->getMovementSpeed()},
                {"ballisticSkill", u->getBallisticSkill()},
                {"preferredRange", u->getPreferredRange()},
                {"reconTag",       u->getReconTag()},
                // How much less room than its real size this TYPE packs into
                // (4c) — 0 for everything today. The squad upgrade adds to it
                // per squad and is not visible here; `size` above stays the
                // real body either way.
                {"formationFighter", u->getFormationFighter()},
            }},
        });
    }
    return json{{"units", units}}.dump();
}
