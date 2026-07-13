#include "catch.hpp"
#include "UnitCatalog.hpp"
#include "units/Soldier.hpp"
#include "units/Horse.hpp"
#include "units/Zombie.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <algorithm>
#include <set>

using json = nlohmann::json;

static const json findUnit(const json& j, const std::string& name)
{
    for (const auto& u : j["units"])
        if (u["name"] == name) return u;
    return json();
}

// ── Catalog contents ─────────────────────────────────────────────────────────

TEST_CASE("unit catalog: lists every unit type in the engine") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(j.contains("units"));
    std::set<std::string> names;
    for (const auto& u : j["units"])
        names.insert(u["name"].get<std::string>());

    for (const char* expected : {"Soldier", "Pikeman", "Archer", "Mage", "Priest",
                                 "Necromancer", "Cavalry", "LightCavalry", "Zombie",
                                 "Skeleton", "Scorpion", "Horse", "Warhorse"}) {
        INFO("missing type: " << expected);
        REQUIRE(names.count(expected) == 1);
    }
}

TEST_CASE("unit catalog: every entry has the full field set") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(!j["units"].empty());
    for (const auto& u : j["units"]) {
        INFO("unit: " << u.value("name", "<missing>"));
        REQUIRE(u.contains("name"));
        REQUIRE(u["name"].is_string());
        REQUIRE(u.contains("symbol"));
        REQUIRE(u["symbol"].is_string());
        REQUIRE(u["symbol"].get<std::string>().size() == 1);
        REQUIRE(u.contains("size"));
        REQUIRE(u["size"].get<int>() > 0);
        REQUIRE(u.contains("category"));
        REQUIRE(u["category"].is_string());
        REQUIRE(u.contains("forbiddenTerrain"));
        REQUIRE(u["forbiddenTerrain"].is_array());
        REQUIRE(u.contains("placeable"));
        REQUIRE(u["placeable"].is_boolean());
        REQUIRE(u.contains("stats"));
        const auto& s = u["stats"];
        for (const char* k : {"maxHP", "attack", "defence", "armour",
                              "speed", "ballisticSkill", "preferredRange",
                              "reconTag"}) {
            INFO("stat: " << k);
            REQUIRE(s.contains(k));
            REQUIRE(s[k].is_number_integer());
        }
        REQUIRE(s["maxHP"].get<int>() > 0);
    }
}

// The core single-source-of-truth guarantee: every exported value is read off a
// freshly constructed unit, so a stat changed in a constructor is exported with
// no other edit. This test re-instantiates each type and compares.
TEST_CASE("unit catalog: exported values match a live instance of each type") {
    auto j = json::parse(unitCatalogJson());
    // Skeletons roll a random weapon and armour at construction (buried with
    // whatever they had), so attack/defence/armour differ between instances —
    // the catalog entry is one sampled loadout for those stats.
    const std::set<std::string> randomizedLoadout = {"Skeleton"};
    for (const auto& entry : unitCatalog()) {
        auto u = entry.make(BLUETEAM);
        REQUIRE(u != nullptr);
        const json cat = findUnit(j, entry.typeName);
        INFO("unit: " << entry.typeName);
        REQUIRE(!cat.is_null());
        REQUIRE(cat["symbol"].get<std::string>()[0] == u->getPrintSymbol());
        REQUIRE(cat["size"].get<int>() == static_cast<int>(u->getSize()));
        REQUIRE(cat["category"].get<std::string>() == categoryName(u->getCategory()));
        REQUIRE(cat["stats"]["maxHP"].get<int>()          == u->getmaxHP());
        if (!randomizedLoadout.count(entry.typeName)) {
            REQUIRE(cat["stats"]["attack"].get<int>()  == u->getAttackPWR());
            REQUIRE(cat["stats"]["defence"].get<int>() == u->getDefence());
            REQUIRE(cat["stats"]["armour"].get<int>()  == u->getArmour());
        }
        REQUIRE(cat["stats"]["speed"].get<int>()          == u->getMovementSpeed());
        REQUIRE(cat["stats"]["ballisticSkill"].get<int>() == u->getBallisticSkill());
        REQUIRE(cat["stats"]["preferredRange"].get<int>() == u->getPreferredRange());
        REQUIRE(cat["stats"]["reconTag"].get<int>()       == u->getReconTag());

        // forbiddenTerrain mirrors forbiddenTerrainForCategory()
        auto forbidden = forbiddenTerrainForCategory(u->getCategory());
        REQUIRE(cat["forbiddenTerrain"].size() == forbidden.size());
    }
}

TEST_CASE("unit catalog: placeable flags mark exactly the player-placeable seven") {
    auto j = json::parse(unitCatalogJson());
    std::set<std::string> placeable;
    for (const auto& u : j["units"])
        if (u["placeable"].get<bool>())
            placeable.insert(u["name"].get<std::string>());
    REQUIRE(placeable == std::set<std::string>{
        "Soldier", "Pikeman", "Archer", "Mage", "Priest", "Cavalry", "LightCavalry"});
}

// Campaign-relevant stats: the campaign layer derives scouting/foraging value
// from speed + ballisticSkill, so pin the values that give each type its role.
TEST_CASE("unit catalog: movement speed and ballistic skill pinned per type") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(findUnit(j, "Soldier")["stats"]["speed"].get<int>()        == 1);
    REQUIRE(findUnit(j, "Cavalry")["stats"]["speed"].get<int>()        == 2);
    REQUIRE(findUnit(j, "LightCavalry")["stats"]["speed"].get<int>()   == 3);
    REQUIRE(findUnit(j, "Horse")["stats"]["speed"].get<int>()          == 2);
    REQUIRE(findUnit(j, "Scorpion")["stats"]["speed"].get<int>()       == 2);

    REQUIRE(findUnit(j, "Archer")["stats"]["ballisticSkill"].get<int>()       == 10);
    REQUIRE(findUnit(j, "Mage")["stats"]["ballisticSkill"].get<int>()         == 12);
    REQUIRE(findUnit(j, "LightCavalry")["stats"]["ballisticSkill"].get<int>() == 8);
    // Fast but ranged-blind — the flag that keeps quick animals from scouting.
    REQUIRE(findUnit(j, "Horse")["stats"]["ballisticSkill"].get<int>()        == 1);
}

// reconTag: the signed designer knob in the campaign's reconValue
// (speed² + ⌊ballisticSkill/2⌋ + reconTag). Default 0 — only units whose
// scouting worth diverges from what speed+ballistics already say carry one:
// LightCavalry positive (trained outriders), Warhorse negative (a battle
// mount bred for the charge, not the picket line).
TEST_CASE("unit catalog: reconTag pinned per type, default 0") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(findUnit(j, "LightCavalry")["stats"]["reconTag"].get<int>() == 4);
    REQUIRE(findUnit(j, "Warhorse")["stats"]["reconTag"].get<int>()     == -2);
    REQUIRE(findUnit(j, "Soldier")["stats"]["reconTag"].get<int>()      == 0);
    REQUIRE(findUnit(j, "Cavalry")["stats"]["reconTag"].get<int>()      == 0);
    REQUIRE(findUnit(j, "Horse")["stats"]["reconTag"].get<int>()        == 0);
}

TEST_CASE("unit catalog: pinned sizes stay consistent with SIZE constexprs") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(findUnit(j, "Soldier")["size"].get<int>() == Soldier::SIZE);
    REQUIRE(findUnit(j, "Cavalry")["size"].get<int>() == Horse::SIZE);
    REQUIRE(findUnit(j, "Zombie")["size"].get<int>()  == Zombie::SIZE);
}

TEST_CASE("unit catalog: mounted units export Forest and Marsh as forbidden") {
    auto j = json::parse(unitCatalogJson());
    for (const char* name : {"Cavalry", "LightCavalry", "Scorpion"}) {
        const json u = findUnit(j, name);
        INFO("unit: " << name);
        REQUIRE(u["category"] == "Mounted");
        bool forest = false, marsh = false;
        for (const auto& t : u["forbiddenTerrain"]) {
            if (t == "Forest") forest = true;
            if (t == "Marsh")  marsh  = true;
        }
        REQUIRE(forest);
        REQUIRE(marsh);
    }
}

// ── Factory / lookups ─────────────────────────────────────────────────────────

TEST_CASE("makeUnitByName: builds spawnable types, rejects the rest") {
    auto soldier = makeUnitByName("Soldier", BLUETEAM);
    REQUIRE(soldier != nullptr);
    REQUIRE(soldier->getPrintSymbol() == 'X');
    REQUIRE(soldier->getTeam() == BLUETEAM);

    // Necromancer is API-spawnable (enemy armies use it) but not player-placeable.
    REQUIRE(makeUnitByName("Necromancer", REDTEAM) != nullptr);

    // Summon-only / mount types must not be creatable through the placement API.
    REQUIRE(makeUnitByName("Zombie",   BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("Skeleton", BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("Horse",    BLUETEAM) == nullptr);

    REQUIRE(makeUnitByName("Dragon",   BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("",         BLUETEAM) == nullptr);
}

TEST_CASE("unitNameForSymbol: maps engine print symbols back to type names") {
    REQUIRE(unitNameForSymbol('X') == "Soldier");
    REQUIRE(unitNameForSymbol('A') == "Archer");
    REQUIRE(unitNameForSymbol('M') == "Mage");
    REQUIRE(unitNameForSymbol('P') == "Priest");
    REQUIRE(unitNameForSymbol('C') == "Cavalry");
    REQUIRE(unitNameForSymbol('l') == "LightCavalry");
    REQUIRE(unitNameForSymbol('N') == "Necromancer");
    REQUIRE(unitNameForSymbol('S') == "Skeleton");
    REQUIRE(unitNameForSymbol('Z') == "Zombie");
    REQUIRE(unitNameForSymbol('?') == "");
}

TEST_CASE("categoryName: covers every UnitCategory") {
    REQUIRE(std::string(categoryName(UnitCategory::Foot))       == "Foot");
    REQUIRE(std::string(categoryName(UnitCategory::Mounted))    == "Mounted");
    REQUIRE(std::string(categoryName(UnitCategory::Flyer))      == "Flyer");
    REQUIRE(std::string(categoryName(UnitCategory::Beast))      == "Beast");
    REQUIRE(std::string(categoryName(UnitCategory::Skirmisher)) == "Skirmisher");
}
