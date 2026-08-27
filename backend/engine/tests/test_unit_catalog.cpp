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

    for (const char* expected : {"Soldier", "RoyalGuard", "Pikeman", "Militia", "Archer", "Mage",
                                 "Priest", "Necromancer", "Golem", "Cavalry", "LightCavalry",
                                 "Zombie", "Skeleton", "Scorpion", "Horse", "Warhorse"}) {
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
        REQUIRE(u.contains("roles"));
        REQUIRE(u["roles"].is_array());
        // Every type enters play through at least one channel — a roleless
        // entry is unreachable by any code path and is always a mistake.
        REQUIRE(!u["roles"].empty());
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

// ── Anatomy (5-4 / 5-6) ──────────────────────────────────────────────────────
//
// The "no default, an undeclared type is an error" rule is enforced by the
// COMPILER — AUnit::anatomy() is pure virtual, so a type that declares nothing
// does not build and can never reach this test. What is left for a test is the
// part a compiler cannot check: that the export carries the layout, and that
// every count sits inside the cap decision 5-4 set.
TEST_CASE("unit catalog: every type exports an anatomy inside the slot cap") {
    auto j = json::parse(unitCatalogJson());
    REQUIRE(!j["units"].empty());
    for (const auto& u : j["units"]) {
        INFO("unit: " << u.value("name", "<missing>"));
        REQUIRE(u.contains("anatomy"));
        const auto& a = u["anatomy"];
        int total = 0;
        for (const char* k : {"head", "torso", "legs", "hand", "misc"}) {
            INFO("slot: " << k);
            REQUIRE(a.contains(k));
            REQUIRE(a[k].is_number_integer());
            const int n = a[k].get<int>();
            REQUIRE(n >= 0);
            REQUIRE(n <= MAX_SLOTS_PER_KIND);
            total += n;
        }
        // A body with nowhere at all to wear anything is not a body plan, it
        // is a forgotten one — and the pure virtual cannot tell the two apart.
        REQUIRE(total > 0);
    }
}

TEST_CASE("unit catalog: anatomy is declared down the inheritance chain") {
    auto j = json::parse(unitCatalogJson());

    // Human declares HUMANOID once; its subclasses inherit it rather than
    // repeating the numbers. If someone gives one of them its own plan, this
    // is where the intent gets re-examined.
    const json humanoid = {{"head", 1}, {"torso", 1}, {"legs", 1},
                           {"hand", 2}, {"misc", 1}};
    // Golem is humanoid on purpose (C-4): a statue of a man, and bearing
    // artifacts in a man's slots is the point of forging one.
    for (const char* name : {"Soldier", "RoyalGuard", "Pikeman", "Militia",
                             "Archer", "Mage", "Priest", "Necromancer",
                             "Zombie", "Skeleton", "Golem"}) {
        INFO("unit: " << name);
        REQUIRE(findUnit(j, name)["anatomy"] == humanoid);
    }

    // A horse has no hands, and Warhorse inherits that from Horse.
    const json quadruped = {{"head", 1}, {"torso", 1}, {"legs", 1},
                            {"hand", 0}, {"misc", 1}};
    REQUIRE(findUnit(j, "Horse")["anatomy"] == quadruped);
    REQUIRE(findUnit(j, "Warhorse")["anatomy"] == quadruped);

    // A MountedUnit wears what its RIDER wears — the composite delegates to
    // effectTarget(), so a Cavalry reads as the humanoid on top of the horse
    // rather than as the horse.
    REQUIRE(findUnit(j, "Cavalry")["anatomy"] == humanoid);
    REQUIRE(findUnit(j, "LightCavalry")["anatomy"] == humanoid);

    // Scorpion writes its own: two CLAWS in the hand slots. This is the
    // "4 armed monsters" case 5-4 kept the counts flexible for, at two — and
    // the reason nothing here defaults to humanoid.
    const json scorpion = findUnit(j, "Scorpion")["anatomy"];
    REQUIRE(scorpion["hand"].get<int>() == 2);
    REQUIRE(scorpion["legs"].get<int>() == 1);
}

TEST_CASE("slots(): clamps a layout into the per-kind cap") {
    // The factory is the only documented way to write a plan, and it clamps at
    // COMPILE time so a typo'd literal is a legal layout rather than a number
    // the campaign layer has to defend against downstream.
    constexpr Anatomy over = slots(99, 1, 1, 1, 1);
    STATIC_REQUIRE(over.head == MAX_SLOTS_PER_KIND);
    constexpr Anatomy under = slots(-3, 1, 1, 1, 1);
    STATIC_REQUIRE(under.head == 0);
    // Everything the roster actually uses passes through unchanged.
    STATIC_REQUIRE(anatomy::HUMANOID.hand == 2);
    STATIC_REQUIRE(anatomy::QUADRUPED.hand == 0);
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

// Exact per-role membership. This is the tripwire a new unit type trips: adding
// one without deciding its roles fails here, and the campaign-server side then
// checks these roles against RECRUIT_POOL/ENEMY_ARMY (see
// campaign-server/tests/engine.integration.test.js). Roles are composable, so a
// type appears in every set that applies to it.
static std::set<std::string> namesWithRole(const json& j, const char* role) {
    std::set<std::string> out;
    for (const auto& u : j["units"])
        for (const auto& r : u["roles"])
            if (r == role) out.insert(u["name"].get<std::string>());
    return out;
}

TEST_CASE("unit catalog: roles mark exactly the intended types") {
    auto j = json::parse(unitCatalogJson());

    // The player owns and deploys these, and every one of them must be
    // OBTAINABLE in the campaign — hired from the Recruit phase, or trained
    // through a reinforcement recipe. RoyalGuard is the first of the second
    // kind: no recruit row sells one, and a line squad's royal_guard upgrade
    // is what makes them exist at all.
    REQUIRE(namesWithRole(j, "Player") == std::set<std::string>{
        "Soldier", "RoyalGuard", "Pikeman", "Militia", "Archer", "Mage", "Priest", "Cavalry",
        "LightCavalry"});

    // Descriptive, not exclusive: the first three are player types the enemy
    // host also fields (campaign-server's ENEMY_ARMY).
    REQUIRE(namesWithRole(j, "Enemy") == std::set<std::string>{
        "Soldier", "Archer", "LightCavalry", "Necromancer", "Scorpion"});

    REQUIRE(namesWithRole(j, "Summon") == std::set<std::string>{"Zombie", "Skeleton"});

    // Crafted (C-5): forged with a mage's turn and mithril, never hired. The
    // campaign-side twin tripwire (engine.integration.test.js) requires every
    // type here to carry a forge-catalog row.
    REQUIRE(namesWithRole(j, "Crafted") == std::set<std::string>{"Golem"});

    // Scorpion is both ridden and independently fieldable — the case that made
    // roles a composable set rather than a single kind.
    REQUIRE(namesWithRole(j, "Mount") == std::set<std::string>{"Horse", "Warhorse", "Scorpion"});
}

// The two booleans roles replaced are still the rules the API enforces; pin
// the derivation so the gate can't loosen unnoticed.
TEST_CASE("unit catalog: placement API accepts exactly the Player, Enemy and Crafted types") {
    for (const auto& entry : unitCatalog()) {
        const bool fieldable = hasRole(entry.roles, UnitRole::Player)
                            || hasRole(entry.roles, UnitRole::Enemy)
                            || hasRole(entry.roles, UnitRole::Crafted);
        INFO("unit: " << entry.typeName);
        REQUIRE((makeUnitByName(entry.typeName, BLUETEAM) != nullptr) == fieldable);
    }
}

TEST_CASE("roleNames: stable order, and None yields nothing") {
    REQUIRE(roleNames(UnitRole::Player) == std::vector<std::string>{"Player"});
    // Declaration order must not matter — both spellings give the export order.
    REQUIRE(roleNames(UnitRole::Mount | UnitRole::Enemy)
            == std::vector<std::string>{"Enemy", "Mount"});
    REQUIRE(roleNames(UnitRole::Enemy | UnitRole::Mount)
            == std::vector<std::string>{"Enemy", "Mount"});
    REQUIRE(roleNames(UnitRole::None).empty());
}

// Campaign-relevant stats: the campaign layer derives scouting/foraging value
// from speed + ballisticSkill, so pin the values that give each type its role.
TEST_CASE("unit catalog: movement speed and ballistic skill pinned per type") {
    auto j = json::parse(unitCatalogJson());
    // Movement-points-per-tick scale: normal human 10, horse 28 (Cavalry and
    // LightCavalry both ride a standard Horse until barding lands), giant
    // scorpion 18. Open ground costs 12 to enter — see TERRAIN_COST_* .
    REQUIRE(findUnit(j, "Soldier")["stats"]["speed"].get<int>()        == 10);
    REQUIRE(findUnit(j, "Cavalry")["stats"]["speed"].get<int>()        == 28);
    REQUIRE(findUnit(j, "LightCavalry")["stats"]["speed"].get<int>()   == 28);
    REQUIRE(findUnit(j, "Horse")["stats"]["speed"].get<int>()          == 28);
    REQUIRE(findUnit(j, "Scorpion")["stats"]["speed"].get<int>()       == 18);

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

TEST_CASE("makeUnitByName: builds Player/Enemy types, rejects the rest") {
    auto soldier = makeUnitByName("Soldier", BLUETEAM);
    REQUIRE(soldier != nullptr);
    REQUIRE(soldier->getPrintSymbol() == 'X');
    REQUIRE(soldier->getTeam() == BLUETEAM);

    // Enemy-role types are API-fieldable (enemy armies use them) but never
    // offered to the player. Scorpion is Enemy|Mount: fieldable on its own
    // legs as well as ridden.
    REQUIRE(makeUnitByName("Necromancer", REDTEAM) != nullptr);
    REQUIRE(makeUnitByName("Scorpion",    REDTEAM) != nullptr);

    // Crafted types stand in the line like hired ones (C-5).
    REQUIRE(makeUnitByName("Golem", BLUETEAM) != nullptr);

    // Summon-only / mount-only types must not be creatable through the API.
    REQUIRE(makeUnitByName("Zombie",   BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("Skeleton", BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("Horse",    BLUETEAM) == nullptr);
    REQUIRE(makeUnitByName("Warhorse", BLUETEAM) == nullptr);

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
    REQUIRE(unitNameForSymbol('g') == "Golem");
    REQUIRE(unitNameForSymbol('?') == "");
}

TEST_CASE("categoryName: covers every UnitCategory") {
    REQUIRE(std::string(categoryName(UnitCategory::Foot))       == "Foot");
    REQUIRE(std::string(categoryName(UnitCategory::Mounted))    == "Mounted");
    REQUIRE(std::string(categoryName(UnitCategory::Flyer))      == "Flyer");
    REQUIRE(std::string(categoryName(UnitCategory::Beast))      == "Beast");
    REQUIRE(std::string(categoryName(UnitCategory::Skirmisher)) == "Skirmisher");
}
