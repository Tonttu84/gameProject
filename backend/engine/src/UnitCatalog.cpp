#include "UnitCatalog.hpp"
#include "hex/HexGrid.hpp"
#include "units/Soldier.hpp"
#include "units/Pikeman.hpp"
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
    // typeName          placeable spawnable factory
    static const std::vector<UnitCatalogEntry> catalog = {
        {"Soldier",     true,  true,  makeT<Soldier>},
        {"Pikeman",     true,  true,  makeT<Pikeman>},
        {"Archer",      true,  true,  makeT<Archer>},
        {"Mage",        true,  true,  makeT<Mage>},
        {"Priest",      true,  true,  makeT<Priest>},
        {"Cavalry",     true,  true,  makeT<Cavalry>},
        {"LightCavalry", true, true,  makeT<LightCavalry>},
        {"Necromancer", false, true,  makeT<Necromancer>},
        {"Zombie",      false, false, makeT<Zombie>},
        {"Skeleton",    false, false, makeT<Skeleton>},
        {"Scorpion",    false, false, makeT<Scorpion>},
        {"Horse",       false, false, makeT<Horse>},    // before Warhorse: shared 'h' resolves to Horse
        {"Warhorse",    false, false, makeT<Warhorse>},
    };
    return catalog;
}

std::unique_ptr<AUnit> makeUnitByName(const std::string& typeName, int team)
{
    for (const auto& entry : unitCatalog())
        if (entry.spawnable && typeName == entry.typeName)
            return entry.make(team);
    return nullptr;
}

std::string unitNameForSymbol(char symbol)
{
    // Built once by constructing one unit per type and reading its symbol.
    static const std::unordered_map<char, std::string> bySymbol = [] {
        std::unordered_map<char, std::string> m;
        for (const auto& entry : unitCatalog())
            m.emplace(entry.make(BLUETEAM)->getPrintSymbol(), entry.typeName);
        return m;
    }();
    auto it = bySymbol.find(symbol);
    return it != bySymbol.end() ? it->second : "";
}

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
            {"placeable",        entry.placeable},
            {"spawnable",        entry.spawnable},
            {"stats", {
                {"maxHP",          u->getmaxHP()},
                {"attack",         u->getAttackPWR()},
                {"defence",        u->getDefence()},
                {"armour",         u->getArmour()},
                {"speed",          u->getMovementSpeed()},
                {"ballisticSkill", u->getBallisticSkill()},
                {"preferredRange", u->getPreferredRange()},
            }},
        });
    }
    return json{{"units", units}}.dump();
}
