#include "catch.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "SpellList.hpp"
#include "Utility.hpp"
#include "units/Mage.hpp"
#include "units/Necromancer.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <set>
#include <string>
#include <vector>

using json = nlohmann::json;

// ── Targeting as data (A-1, A-8 — slice AI-1) ────────────────────────────────
//
// The resolver these cases drive is Spells::candidates()/chooseTarget(): the
// declared target kind on a form, answered in one place, with no state change
// and no dice. AI-2's scorer is the caller it exists for — it will ask "whom
// would this form hit" of every candidate form on every decision, which is only
// affordable if asking costs nothing and only CORRECT if asking changes nothing.
//
// So the two properties pinned hardest below are the two a scorer depends on:
// asking is side-effect-free, and asking draws no dice (Utility::getRandom eats
// the mock queue under TESTING, so a resolver that rolled would silently steal
// the rolls a combat test seeded).
//
// EVERY PICK POLICY REPRODUCES TODAY'S CHOICE. AI-1 moved the seven hand-rolled
// searches out of the bodies; it did not improve any of them, and the cases here
// are written against what the engine does rather than what it ought to do. The
// one deliberate behaviour change in the slice is A-8's buff refresh, at the
// bottom of this file, and it says so where it is.

namespace {

// Row 8 of the default grid runs q = -4..11, so distance along it is |q1 - q2|.
constexpr int ROW = 8;
HexCoord on(int q) { return { q, ROW }; }

const SpellForm& formOf(const char* id, size_t index = 0)
{
    const Spell* spell = Spells::findSpell(id);
    REQUIRE(spell != nullptr);
    REQUIRE(spell->forms.size() > index);
    return spell->forms[index];
}

// Push a unit onto an army with its hex set, handing back the raw pointer the
// case watches. Same shape as test_enchantments.cpp's place().
template <typename T>
T* place(Army& army, std::unique_ptr<T> unit, int q)
{
    Battlefield& field = Utility::getBattlefield();
    Hex* hex = field.hexGrid.getHex(on(q));
    REQUIRE(hex != nullptr);
    unit->setHex(hex);
    T* raw = unit.get();
    army.push_back(std::move(unit));
    return raw;
}

// A caster with exactly ONE path, so the default walk cannot reach past the
// spell a case is about (a stock Mage is Fire 1 and would throw embers).
std::unique_ptr<Mage> caster(int team, SpellPath path, int level)
{
    auto mage = std::make_unique<Mage>(team);
    mage->setPathLevel(SpellPath::Fire, 0);
    mage->setPathLevel(path, level);
    return mage;
}

}  // namespace

// ── (a) Asking costs nothing and changes nothing ─────────────────────────────

TEST_CASE("targeting: candidates() touches no unit and draws no dice", "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage  = place(red,  std::make_unique<Mage>(REDTEAM), 8);
    Zombie*  ally  = place(red,  std::make_unique<Zombie>(REDTEAM), 7);
    Zombie*  foe   = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));

    ally->takeDamage(3);              // undead: no morale dice
    ally->addFatigue(12);
    ally->addShield(2);
    const int allyHp      = ally->getHp();
    const int allyFatigue = ally->getFatigue();
    const int allyShield  = ally->getShield();
    const int foeHp       = foe->getHp();
    const int mageFatigue = mage->getFatigue();

    // A sentinel roll, seeded the way a combat test seeds one. getRandom()
    // returns a queued value verbatim, so finding it still there afterwards is
    // proof that nothing in the resolver rolled.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(4242);

    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            Spells::candidates(*mage, form);
            Spells::chooseTarget(*mage, form);
        }

    CHECK(ally->getHp()      == allyHp);
    CHECK(ally->getFatigue() == allyFatigue);
    CHECK(ally->getShield()  == allyShield);
    CHECK(foe->getHp()       == foeHp);
    CHECK(mage->getFatigue() == mageFatigue);
    CHECK(field.activeEnchantments().empty());

    CHECK(Utility::getRandom(1, 6) == 4242);   // the queue was never touched
    Utility::clearDiceRolls();

    field.extractResult();
}

// ── (b) The enemy range test, exactly as findEnemyInRange had it ─────────────

TEST_CASE("targeting: EnemyUnit candidates are SPELLRANGE, elevation included",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();
    Hex* high = field.hexGrid.getHex(on(11));
    REQUIRE(high != nullptr);

    SECTION("on the flat, the range is the range") {
        Army red, blue;
        Mage*   mage = place(red,  std::make_unique<Mage>(REDTEAM), 11);
        Zombie* near = place(blue, std::make_unique<Zombie>(BLUETEAM), 1);   // dist 10
        place(blue, std::make_unique<Zombie>(BLUETEAM), -1);                 // dist 12
        field.loadArmies(std::move(red), std::move(blue));

        std::vector<AUnit*> pool = Spells::candidates(*mage, formOf("fireball"));
        REQUIRE(pool.size() == 1);
        CHECK(pool.front() == near);            // exactly SPELLRANGE is in
        field.extractResult();
    }

    SECTION("two tiers of height reach two hexes further") {
        // clamp(casterElev - targetElev) tiers come off the distance, capped at
        // ELEV_RANGED_CAP — so the man at 12 who was out of reach on the flat is
        // in reach from the hilltop, and nothing else about the test moved.
        high->elevation = ELEV_RANGED_CAP;

        Army red, blue;
        Mage*   mage = place(red,  std::make_unique<Mage>(REDTEAM), 11);
        Zombie* near = place(blue, std::make_unique<Zombie>(BLUETEAM), 1);   // dist 10
        Zombie* far  = place(blue, std::make_unique<Zombie>(BLUETEAM), -1);  // dist 12
        field.loadArmies(std::move(red), std::move(blue));

        std::vector<AUnit*> pool = Spells::candidates(*mage, formOf("fireball"));
        REQUIRE(pool.size() == 2);
        CHECK(pool[0] == near);
        CHECK(pool[1] == far);
        field.extractResult();

        high->elevation = 0;              // the grid is a singleton — put it back
        field.recomputeDistances();
    }
}

TEST_CASE("targeting: an unplaced caster has no enemy candidates", "[targeting]") {
    // A scorer may ask about ANY caster, including one not yet on the grid.
    // There is no position to measure a range from, so the answer is nobody —
    // never a read through a null hex.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    auto magePtr = std::make_unique<Mage>(REDTEAM);
    Mage* mage = magePtr.get();
    red.push_back(std::move(magePtr));           // deliberately NOT placed
    place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));

    CHECK(Spells::candidates(*mage, formOf("fireball")).empty());
    CHECK(Spells::chooseTarget(*mage, formOf("fireball")).unit == nullptr);

    field.extractResult();
}

// ── (c) Every pick policy reproduces today's choice ──────────────────────────

TEST_CASE("targeting: Densest takes the first enemy in range, as it always has",
          "[targeting]") {
    // TODAY'S CHOICE, pinned as it actually is. Utility::findTarget returns on
    // the FIRST unit its priority predicate accepts, and findEnemyInRange passed
    // the in-range test AS that predicate — so the density scorer under it is
    // consulted only when nothing is in range, where it cannot score above zero
    // either. The "densest closest hex" the old comment advertised has therefore
    // never decided anything, and AI-1 was a refactor: it moved this walk, tie-
    // break and all, rather than fixing it. AI-2 is where a real preference
    // arrives.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage  = place(red,  std::make_unique<Mage>(REDTEAM), 10);
    Zombie* first = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);   // alone, dist 6
    // A denser hex, and closer: three bodies on one hex two steps from the mage.
    Zombie* packA = place(blue, std::make_unique<Zombie>(BLUETEAM), 8);
    place(blue, std::make_unique<Zombie>(BLUETEAM), 8);
    place(blue, std::make_unique<Zombie>(BLUETEAM), 8);
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(packA->getHex()->sizeUsed > first->getHex()->sizeUsed);

    std::vector<AUnit*> pool = Spells::candidates(*mage, formOf("fireball"));
    REQUIRE(pool.size() == 4);                       // every one of them is legal
    CHECK(Spells::chooseTarget(*mage, formOf("fireball")).unit == first);

    field.extractResult();
}

TEST_CASE("targeting: Wounded takes the first hurt ally, else the first ally",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*   mage  = place(red, std::make_unique<Mage>(REDTEAM), 8);
    place(red, std::make_unique<Zombie>(REDTEAM), 7);
    Zombie* hurt  = place(red, std::make_unique<Zombie>(REDTEAM), 6);
    field.loadArmies(std::move(red), {});

    // findAllyToAid's rule: someone who needs it wins, wherever he stands in the
    // line, and there is no range check on a boon at all (that question belongs
    // to the deferred targeting front, not to AI-1).
    hurt->takeDamage(3);
    CHECK(Spells::chooseTarget(*mage, formOf("stoneskin")).unit == hurt);

    // Nobody hurt: the first ally in team order, which is the caster himself.
    hurt->heal(99);
    CHECK(Spells::chooseTarget(*mage, formOf("stoneskin")).unit == mage);

    field.extractResult();
}

TEST_CASE("targeting: Fatigued takes the most tired, and nobody on a fresh line",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*    mage  = place(red, std::make_unique<Mage>(REDTEAM), 8);
    Soldier* tired = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    Soldier* worst = place(red, std::make_unique<Soldier>(REDTEAM), 6);
    field.loadArmies(std::move(red), {});

    tired->addFatigue(10);
    worst->addFatigue(20);
    CHECK(Spells::chooseTarget(*mage, formOf("soothing_current")).unit == worst);

    // Nothing to wash off a rested line: soothing_current's own "fatigue <= 0"
    // test, now the resolver's.
    tired->addFatigue(-100);
    worst->addFatigue(-100);
    REQUIRE(worst->getFatigue() == 0);
    CHECK(Spells::chooseTarget(*mage, formOf("soothing_current")).unit == nullptr);
    // ...but they are all still LEGAL targets. The pick declined, not the kind.
    CHECK(Spells::candidates(*mage, formOf("soothing_current")).size() == 3);

    field.extractResult();
}

TEST_CASE("targeting: Broken takes a broken ally over a wounded one", "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    auto priestPtr = caster(REDTEAM, SpellPath::Holy, 1);
    Mage*    priest = place(red, std::move(priestPtr), 8);
    Zombie*  hurt   = place(red, std::make_unique<Zombie>(REDTEAM), 7);
    Soldier* broken = place(red, std::make_unique<Soldier>(REDTEAM), 6);
    field.loadArmies(std::move(red), {});

    hurt->takeDamage(3);
    broken->setBroken(true);

    // castBless's own two helpers, unchanged: broken is the priority filter and
    // wounded is only the scorer under it.
    CHECK(Spells::chooseTarget(*priest, formOf("bless")).unit == broken);

    field.extractResult();
}

// ── (d) AllyTeam hands over the whole line ───────────────────────────────────

TEST_CASE("targeting: AllyTeam gives greater_bless the line in team order",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    priest = place(red,  caster(REDTEAM, SpellPath::Holy, 3), 8);
    Soldier* second = place(red,  std::make_unique<Soldier>(REDTEAM), 7);
    Soldier* third  = place(red,  std::make_unique<Soldier>(REDTEAM), 6);
    place(blue, std::make_unique<Soldier>(BLUETEAM), 1);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& greater = formOf("bless", 1);
    REQUIRE(greater.name == "major");

    Target line = Spells::chooseTarget(*priest, greater);
    CHECK(line.unit == nullptr);              // this form aims at no one man
    REQUIRE(line.units.size() == 3);          // and at no enemy either
    CHECK(line.units[0] == priest);
    CHECK(line.units[1] == second);
    CHECK(line.units[2] == third);

    field.extractResult();
}

// ── (e) The kinds that need no target still cast ─────────────────────────────

TEST_CASE("targeting: Adjacent and Battlefield resolve to nothing, and still fire",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Necromancer* necro = place(red, std::make_unique<Necromancer>(REDTEAM), 8);
    Mage*        druid = place(red, caster(REDTEAM, SpellPath::Nature, 2), 7);
    field.loadArmies(std::move(red), {});
    field.setCorpses(0);
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST);

    SECTION("Adjacent: raise_skeleton scans its own neighbours and conjures") {
        const SpellForm& raise = formOf("raise_dead");
        REQUIRE(raise.target == TargetKind::Adjacent);
        CHECK(Spells::candidates(*necro, raise).empty());

        Target none = Spells::chooseTarget(*necro, raise);
        CHECK(none.unit == nullptr);
        CHECK(none.units.empty());

        const size_t before = field.getTeam(REDTEAM).size();
        CHECK(raise.cast(*necro, none) == true);
        CHECK(field.getTeam(REDTEAM).size() == before + 1);
    }

    SECTION("Battlefield: soothing_winds puts its instance up") {
        const SpellForm& winds = formOf("soothing_winds");
        REQUIRE(winds.target == TargetKind::Battlefield);
        CHECK(Spells::candidates(*druid, winds).empty());

        Target none = Spells::chooseTarget(*druid, winds);
        CHECK(none.unit == nullptr);
        CHECK(none.units.empty());

        CHECK(winds.cast(*druid, none) == true);
        CHECK(field.activeEnchantments().size() == 1);
    }

    field.setChannels(REDTEAM, 0);
    field.extractResult();
}

// ── (f) A-8's buff refresh — THE ONE BEHAVIOUR CHANGE IN THIS SLICE ──────────
//
// Everything else in AI-1 is a refactor. This is not: before it, a caster could
// lay Stoneskin on the same man every tick forever, because applyStatMod clamps
// each delta on its own and never the total (it was written for gear, 9-5). Now
// a man carrying the spell is not a candidate for it again, so an Earth caster
// with a fully skinned line finds no target and — by M-23 — pays nothing.

TEST_CASE("targeting: a buff marks its target and drops him from the candidates",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*    mage = place(red, caster(REDTEAM, SpellPath::Earth, 1), 8);
    Soldier* man  = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    field.loadArmies(std::move(red), {});

    const SpellForm& skin = formOf("stoneskin");
    REQUIRE(skin.buff == true);
    REQUIRE(skin.spell != nullptr);

    Target t;
    t.unit = man;
    REQUIRE(skin.cast(*mage, t) == true);
    CHECK(man->hasBuff(skin.spell->id) == true);
    CHECK(mage->hasBuff(skin.spell->id) == false);

    // The marked man is gone from the list; the caster, unmarked, is still on it.
    std::vector<AUnit*> pool = Spells::candidates(*mage, skin);
    REQUIRE(pool.size() == 1);
    CHECK(pool.front() == mage);

    // A different buff is a different mark: Ward has its own registry entry.
    CHECK(man->hasBuff(formOf("ward").spell->id) == false);
    CHECK(Spells::candidates(*mage, formOf("ward")).size() == 2);

    field.extractResult();
}

TEST_CASE("targeting: a caster whose line is fully buffed casts nothing and pays nothing",
          "[targeting]") {
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*    mage = place(red, caster(REDTEAM, SpellPath::Earth, 1), 8);
    Soldier* man  = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    field.loadArmies(std::move(red), {});

    // Earth 1 and nothing else, so Stoneskin is the only line in his walk.
    const Spell* chosen = nullptr;
    REQUIRE(mage->chooseSpellToCast(&chosen) != nullptr);
    REQUIRE(chosen->id == "stoneskin");

    mage->markBuff("stoneskin");
    man->markBuff("stoneskin");
    const int armourBefore = man->getArmour();

    Utility::clearDiceRolls();
    field.triggerSpecialPhase();        // one-tick form: it would fire this phase

    // Selection still picks the spell — targets are not a gate, exactly as
    // corpses are not (M-26's fall-through exists for the same reason). The CAST
    // then finds nobody, and M-23's other half means that costs nothing.
    CHECK(mage->getFatigue() == 0);
    CHECK(man->getArmour() == armourBefore);

    // A fresh body on the line is a target again, and now it does fire.
    Army wave;
    Soldier* fresh = place(wave, std::make_unique<Soldier>(REDTEAM), 6);
    for (auto& u : wave) field.getTeam(REDTEAM).push_back(std::move(u));

    field.triggerSpecialPhase();
    CHECK(fresh->hasBuff("stoneskin") == true);
    CHECK(mage->getFatigue() > 0);

    field.extractResult();
}

TEST_CASE("targeting: buff marks are per battle, not per campaign", "[targeting]") {
    Soldier man(REDTEAM);
    man.markBuff("stoneskin");
    REQUIRE(man.hasBuff("stoneskin") == true);

    man.restoreForNextBattle();
    CHECK(man.hasBuff("stoneskin") == false);
}

// ── (g) Roster sweeps — structural, so a spell authored next month is covered ─

TEST_CASE("targeting: every form declares a kind, and every buff names its spell",
          "[targeting]") {
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            // The back-pointer is wired for EVERY form, not only the buffs —
            // AI-2's log line needs it to name the spell it scored.
            REQUIRE(form.spell == &spell);
            REQUIRE(form.cast != nullptr);
            // A sustained spell targets the field; nothing else may claim to.
            if (form.enchantAim != EnchantAim::None)
                CHECK(form.target == TargetKind::Battlefield);
            else
                CHECK(form.target != TargetKind::Battlefield);
            // A buff is laid on an ally and on nobody else.
            if (form.buff) CHECK(form.target == TargetKind::AllyUnit);
        }
}

TEST_CASE("targeting: no unit-targeting body can be handed an empty Target and fire",
          "[targeting]") {
    // The safety property the separation has to carry: a body never dereferences
    // a target it was not given. Every EnemyUnit/AllyUnit form is asked to cast
    // at nothing, and every one of them must decline — which is also what keeps
    // "no target costs nothing" (M-23) true after the refactor.
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage* mage = place(red, std::make_unique<Mage>(REDTEAM), 8);
    field.loadArmies(std::move(red), {});

    const Target empty;
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            if (form.target != TargetKind::EnemyUnit
                && form.target != TargetKind::AllyUnit) continue;
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            CHECK(form.cast(*mage, empty) == false);
        }

    field.extractResult();
}

TEST_CASE("targeting: every buff body marks the id its own row carries", "[targeting]") {
    // The mark is written with a literal inside the body while the resolver
    // reads form.spell->id — this is the sweep that keeps the two the same
    // string, for every buff form there will ever be.
    Battlefield& field = Utility::getBattlefield();

    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            if (!form.buff) continue;
            INFO(std::string(spell.id) + "/" + std::string(form.name));

            Army red;
            Mage*    mage = place(red, std::make_unique<Mage>(REDTEAM), 8);
            Soldier* man  = place(red, std::make_unique<Soldier>(REDTEAM), 7);
            field.loadArmies(std::move(red), {});

            Target t;
            t.unit = man;
            REQUIRE(form.cast(*mage, t) == true);
            CHECK(man->hasBuff(spell.id) == true);
            CHECK(Spells::candidates(*mage, form).size() == 1);

            field.extractResult();
        }
}

// ── (h) The catalog says what a form targets ─────────────────────────────────

TEST_CASE("spellCatalogJson: every row carries its target kind and its buff flag",
          "[targeting]") {
    json catalog = json::parse(Spells::spellCatalogJson());
    REQUIRE(catalog.contains("spells"));

    const std::set<std::string> kinds = {
        "enemy_unit", "ally_unit", "ally_team", "adjacent", "battlefield", "none"
    };

    size_t rows = 0;
    for (const auto& row : catalog["spells"]) {
        INFO(row["spell"].get<std::string>() + "/" + row["form"].get<std::string>());
        REQUIRE(row.contains("target"));
        REQUIRE(row.contains("buff"));
        CHECK(kinds.count(row["target"].get<std::string>()) == 1);
        CHECK(row["buff"].is_boolean());
        ++rows;
    }

    // One row per FORM, as the export has always been.
    size_t forms = 0;
    for (const Spell& spell : Spells::roster()) forms += spell.forms.size();
    REQUIRE(rows == forms);

    // Spot-checks, so a rename of a kind cannot pass the sweep above quietly.
    for (const auto& row : catalog["spells"]) {
        if (row["spell"] == "fireball")        CHECK(row["target"] == "enemy_unit");
        if (row["spell"] == "stoneskin")     { CHECK(row["target"] == "ally_unit");
                                               CHECK(row["buff"]   == true); }
        if (row["spell"] == "soothing_winds")  CHECK(row["target"] == "battlefield");
        if (row["spell"] == "raise_dead")      CHECK(row["target"] == "adjacent");
        if (row["form"]  == "major"
            && row["spell"] == "bless")        CHECK(row["target"] == "ally_team");
    }
}
