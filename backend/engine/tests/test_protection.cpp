// ── Natural protection (P-1..P-6, P-11 — slice NP-1) ─────────────────────────
//
// The front is "NATURAL PROTECTION AND AREA BOONS" in docs/CAMPAIGN_PLAN.md,
// and what is pinned here is its machinery:
//
//   P-2   a `naturalProtection` stat beside armour — Golem's stone and
//         Scorpion's chitin moved over, a mount answers with its rider's;
//   P-3   damage subtracts the two COMBINED, sub-additively, through ONE pure
//         function, at every site that read armour before;
//   P-4   a skin raises natural protection TO a floor, +1 past a base already
//         there, and skins never stack — highest wins;
//   P-5   the floor is checked against BASE natural protection (every standing
//         skin subtracted out), the delta is floored at 0, and the combined
//         figure NEVER decreases — pinned across the whole roster;
//   P-6   a skin is worth its GAIN × hits expected, on a fresh man;
//   P-1   every buff-flagged estimator weights by hp ÷ maxHP;
//   P-11  a melee blow subtracts protection too — full, half for Piercing,
//         none for Bypass — where until 2026-09-06 only the Piercing line did.
#include "catch.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "SpellList.hpp"
#include "TestDummies.hpp"
#include "UnitCatalog.hpp"
#include "Utility.hpp"
#include "units/Cavalry.hpp"
#include "units/Golem.hpp"
#include "units/Mage.hpp"
#include "units/Militia.hpp"
#include "units/Scorpion.hpp"
#include "units/Soldier.hpp"
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <algorithm>
#include <memory>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

constexpr int ROW = 8;
HexCoord on(int q) { return { q, ROW }; }

const SpellForm& formOf(const char* id, size_t index = 0)
{
    const Spell* spell = Spells::findSpell(id);
    REQUIRE(spell != nullptr);
    REQUIRE(spell->forms.size() > index);
    return spell->forms[index];
}

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

std::unique_ptr<Mage> earthCaster(int team)
{
    auto mage = std::make_unique<Mage>(team);
    mage->setPathLevel(SpellPath::Fire, 0);
    mage->setPathLevel(SpellPath::Earth, 1);
    return mage;
}

bool logHasDetail(const Battlefield& field, const std::string& needle)
{
    for (const LogLine& l : field.tickLog())
        if (l.tier == LogTier::Detail && l.text.find(needle) != std::string::npos) return true;
    return false;
}

// A body worth a known amount, so the fresh-weighting arithmetic below can be
// written out rather than read off a roster number that may move.
class ValuedDummy : public ImmobileDummy {
public:
    explicit ValuedDummy(int t) : ImmobileDummy(t) { unitValue = 20; }
};

// A blow that certainly lands and rolls flat: AttackAttempt 999 beats any
// defence roll (and keeps a physical shield from ever engaging), d1 = d2 = 1
// so the raw damage is exactly what was asked, and two flat morale dice for a
// body that rolls them. Whatever was not drawn is cleared afterwards.
int flatBlow(AUnit& u, int damage, ArmorPen pen)
{
    Utility::clearDiceRolls();
    for (int i = 0; i < 5; ++i) { Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); }
    const int dealt = u.defend(999, damage, pen, 0);
    Utility::clearDiceRolls();
    return dealt;
}

// Half a body's hit points taken off it through Bypass (nothing subtracted),
// with the morale throw it triggers pinned to pass.
void halve(AUnit& u)
{
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    u.takeDamage(u.getmaxHP() / 2, ArmorPen::Bypass);
    Utility::clearDiceRolls();
    REQUIRE(u.getHp() * 2 == u.getmaxHP());
}

}  // namespace

// ── (a) P-3: the combine ──────────────────────────────────────────────────────

TEST_CASE("protection: the combine is nat + armour − nat×armour÷divisor, and plain addition today",
          "[protection]") {
    REQUIRE(PROTECTION_DIVISOR == 36);
    CHECK(combinedProtection(0, 0) == 0);
    CHECK(combinedProtection(0, 5) == 5);
    CHECK(combinedProtection(2, 5) == 7);
    CHECK(combinedProtection(3, 5) == 8);
    CHECK(combinedProtection(5, 5) == 10);
    CHECK(combinedProtection(7, 0) == 7);
    // Past the roster's numbers the cross term finally bites: 12×12 ÷ 36 = 4.
    CHECK(combinedProtection(12, 12) == 20);
    // A negative part is no part: the stat floors at 0 and so does the combine.
    CHECK(combinedProtection(-3, 5) == 5);
}

// TC-1 item 6 (audit A4): the clamp, driven DIRECTLY. The comment this replaces
// said it "cannot be driven ... without a hook" — it can: the guard is inside
// combinedProtection itself, so any pair whose cross term eats past the larger
// part exercises it, and no roster body has to carry those numbers.
TEST_CASE("protection: the combine never falls below the larger part — the clamp, driven",
          "[protection]") {
    // 40 + 40 − 40×40÷36 = 80 − 44 = 36 by the raw formula, which is LESS than
    // either part. The clamp is what stops a second layer of protection from
    // making a body softer than it was with one.
    CHECK(combinedProtection(40, 40) == 40);
    CHECK(combinedProtection(30, 50) == 50);
    // ...and it is a floor, not a cap: below the crossover the formula stands.
    CHECK(combinedProtection(12, 12) == 20);
    // These are GUARD numbers, not roster numbers: nothing on the roster is
    // anywhere near them today, which is the point — the guard has to hold for
    // the day something is.
}

TEST_CASE("protection: for every roster body the combine is at least each part, and the sum less one",
          "[protection]") {
    // What the case above pins as a rule, pinned here as a CONSEQUENCE on every
    // body that exists: combined ≥ each part, and — since the cross term is 0 at
    // today's numbers — combined ≥ sum − 1 as well.
    for (const auto& entry : unitCatalog()) {
        auto u = entry.make(BLUETEAM);
        REQUIRE(u != nullptr);
        INFO("unit: " << entry.typeName);
        const int nat = u->getNaturalProtection(), arm = u->getArmour();
        CHECK(nat >= 0);
        CHECK(arm >= 0);
        CHECK(u->getProtection() == combinedProtection(nat, arm));
        CHECK(u->getProtection() >= std::max(nat, arm));
        CHECK(u->getProtection() >= nat + arm - 1);
    }
}

// ── (b) P-2: the split, on the two bodies that moved, and the mount ──────────

TEST_CASE("protection: Golem is stone and Scorpion is chitin — skin, no coat — and dump-units says so",
          "[protection]") {
    Golem golem(REDTEAM);
    CHECK(golem.getNaturalProtection() == GOLEM_NATURAL_PROTECTION);
    CHECK(golem.getNaturalProtection() == 7);
    CHECK(golem.getArmour() == 0);
    CHECK(golem.getProtection() == 7);

    Scorpion scorpion(REDTEAM);
    CHECK(scorpion.getNaturalProtection() == LIGHTARMOUR);
    CHECK(scorpion.getArmour() == 0);
    CHECK(scorpion.getProtection() == LIGHTARMOUR);

    // Men wear their protection and grow none.
    Soldier soldier(REDTEAM);
    CHECK(soldier.getNaturalProtection() == 0);
    CHECK(soldier.getArmour() == HEAVYARMOUR);
    CHECK(soldier.getProtection() == HEAVYARMOUR);

    auto j = json::parse(unitCatalogJson());
    for (const auto& u : j["units"]) {
        REQUIRE(u["stats"].contains("naturalProtection"));
        REQUIRE(u["stats"]["naturalProtection"].is_number_integer());
        CHECK(u["stats"]["naturalProtection"].get<int>() >= 0);
        if (u["name"] == "Golem") {
            CHECK(u["stats"]["naturalProtection"].get<int>() == 7);
            CHECK(u["stats"]["armour"].get<int>() == 0);
        }
        if (u["name"] == "Scorpion") {
            CHECK(u["stats"]["naturalProtection"].get<int>() == LIGHTARMOUR);
            CHECK(u["stats"]["armour"].get<int>() == 0);
        }
    }
}

TEST_CASE("protection: a mount's natural protection follows its rider, like its armour", "[protection]") {
    Cavalry cav(REDTEAM);
    REQUIRE(cav.effectTarget() != &cav);   // the rider is up
    cav.effectTarget()->setNaturalProtection(4);
    CHECK(cav.getNaturalProtection() == 4);
    CHECK(cav.getProtection() == combinedProtection(4, cav.getArmour()));
}

TEST_CASE("protection: the mod bag knows naturalProtection, floored at 0 and clamped like the rest",
          "[protection]") {
    Soldier man(REDTEAM);
    REQUIRE(man.applyStatMod("naturalProtection", 2) == true);
    CHECK(man.getNaturalProtection() == 2);
    CHECK(man.statValue("naturalProtection") == 2);
    REQUIRE(man.applyStatMod("naturalProtection", -5) == true);
    CHECK(man.getNaturalProtection() == 0);
    REQUIRE(man.applyStatMod("naturalProtection", AUnit::MAX_STAT_MOD * 3) == true);
    CHECK(man.getNaturalProtection() == AUnit::MAX_STAT_MOD);
    // What the bag moves, the damage sites read.
    CHECK(man.getProtection() == combinedProtection(AUnit::MAX_STAT_MOD, HEAVYARMOUR));
}

// ── (c) P-3 at the damage sites ──────────────────────────────────────────────

TEST_CASE("protection: takeDamage subtracts the combined figure — full, half for Piercing, none for Bypass",
          "[protection]") {
    // A Golem at natural 7 takes exactly the hit it took at armour 7. It is
    // Fearless (Mindless), so no morale die is drawn; the dummy is not, so
    // the queue is cleared first and it rolls from the generator.
    Utility::clearDiceRolls();
    Golem golem(REDTEAM);
    CHECK(golem.takeDamage(10, ArmorPen::Normal) == 3);
    ImmobileDummy plated(REDTEAM);
    plated.applyStatMod("armour", 7);
    CHECK(plated.takeDamage(10, ArmorPen::Normal) == 3);

    Golem pierced(REDTEAM);
    CHECK(pierced.takeDamage(10, ArmorPen::Piercing) == 10 - 7 / 2);
    Golem bypassed(REDTEAM);
    CHECK(bypassed.takeDamage(10, ArmorPen::Bypass) == 10);

    // A body with BOTH: skin 3 under plate 5 subtracts the combine (8), not 5.
    ImmobileDummy both(REDTEAM);
    both.applyStatMod("armour", HEAVYARMOUR);
    both.setNaturalProtection(3);
    REQUIRE(both.getProtection() == 8);
    CHECK(both.takeDamage(10, ArmorPen::Normal) == 2);
    Utility::clearDiceRolls();
}

TEST_CASE("protection: a melee blow subtracts protection — full, half for Piercing, none for Bypass (P-11)",
          "[protection]") {
    // Until 2026-09-06 a Normal melee blow subtracted nothing: plate was a
    // ranged-only stat in the line. Now it is the same three-way shape as
    // takeDamage — and against heavy armour 5 a blow lands 5 less, against a
    // Golem's stone 7 less.
    constexpr int RAW = 15;

    ImmobileDummy naked(REDTEAM);
    REQUIRE(flatBlow(naked, RAW, ArmorPen::Normal) == RAW);

    ImmobileDummy heavy(REDTEAM);
    heavy.applyStatMod("armour", HEAVYARMOUR);
    CHECK(flatBlow(heavy, RAW, ArmorPen::Normal) == RAW - HEAVYARMOUR);
    ImmobileDummy heavyPierced(REDTEAM);
    heavyPierced.applyStatMod("armour", HEAVYARMOUR);
    CHECK(flatBlow(heavyPierced, RAW, ArmorPen::Piercing) == RAW - HEAVYARMOUR / 2);
    ImmobileDummy heavyBypassed(REDTEAM);
    heavyBypassed.applyStatMod("armour", HEAVYARMOUR);
    CHECK(flatBlow(heavyBypassed, RAW, ArmorPen::Bypass) == RAW);

    // A real soldier in real plate, for the number the roster actually fights with.
    Soldier soldier(REDTEAM);
    CHECK(flatBlow(soldier, RAW, ArmorPen::Normal) == RAW - HEAVYARMOUR);

    // Stone is protection in the line exactly as plate is: a Normal blow on a
    // Golem lands 7 less than a Bypass one with the same dice.
    Golem golemNormal(REDTEAM), golemBypassed(REDTEAM);
    const int viaBypass = flatBlow(golemBypassed, RAW, ArmorPen::Bypass);
    const int viaNormal = flatBlow(golemNormal, RAW, ArmorPen::Normal);
    CHECK(viaBypass - viaNormal == GOLEM_NATURAL_PROTECTION);

    // Skin under plate: the combine again, in melee.
    ImmobileDummy both(REDTEAM);
    both.applyStatMod("armour", HEAVYARMOUR);
    both.setNaturalProtection(3);
    CHECK(flatBlow(both, RAW, ArmorPen::Normal) == RAW - combinedProtection(3, HEAVYARMOUR));

    // And never below nothing: a blow the protection swallows whole lands 0.
    ImmobileDummy wall(REDTEAM);
    wall.applyStatMod("armour", AUnit::MAX_STAT_MOD);
    wall.setNaturalProtection(AUnit::MAX_STAT_MOD);
    CHECK(flatBlow(wall, 4, ArmorPen::Normal) == 0);
    CHECK(wall.getHp() == wall.getmaxHP());
}

// ── (d) P-4/P-5: the raise-to ladder ──────────────────────────────────────────

TEST_CASE("protection: skins raise natural protection TO a floor, highest wins, order never matters",
          "[protection]") {
    SECTION("Bark then Stone on a soldier: 0 → 2 → 3") {
        Soldier man(REDTEAM);
        int before = man.getProtection();
        REQUIRE(man.skinDelta(BARKSKIN_FLOOR) == BARKSKIN_FLOOR);
        REQUIRE(man.applySkin("barkskin", BARKSKIN_FLOOR, 0) == true);
        CHECK(man.getNaturalProtection() == BARKSKIN_FLOOR);
        CHECK(man.getProtection() >= before);
        before = man.getProtection();
        REQUIRE(man.skinDelta(STONESKIN_FLOOR) == STONESKIN_FLOOR - BARKSKIN_FLOOR);
        REQUIRE(man.applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);
        CHECK(man.getNaturalProtection() == STONESKIN_FLOOR);
        CHECK(man.getProtection() >= before);
        CHECK(man.hasBuff("barkskin"));
        CHECK(man.hasBuff("stoneskin"));
        // Both stand; both come off; the base was 0.
        CHECK(man.baseNaturalProtection() == 0);
        man.revertEffects();
        CHECK(man.getNaturalProtection() == 0);
    }
    SECTION("Stone then Bark on a soldier: 0 → 3, then nothing — and NO second registry entry") {
        Soldier man(REDTEAM);
        REQUIRE(man.applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);
        CHECK(man.getNaturalProtection() == STONESKIN_FLOOR);
        const int before = man.getProtection();
        CHECK(man.skinDelta(BARKSKIN_FLOOR) == 0);
        CHECK(man.applySkin("barkskin", BARKSKIN_FLOOR, 0) == false);
        CHECK(man.getNaturalProtection() == STONESKIN_FLOOR);
        CHECK(man.getProtection() == before);
        // A skin that moved nothing did not land: he does not "wear" bark, so a
        // later, harder skin is not kept off him by an empty entry.
        CHECK(man.hasBuff("barkskin") == false);
        CHECK(man.hasBuff("stoneskin") == true);
    }
    SECTION("a body at natural 5 gets the bump from either skin, once") {
        Soldier lizard(REDTEAM);
        lizard.setNaturalProtection(5);
        const int before = lizard.getProtection();
        CHECK(lizard.skinDelta(BARKSKIN_FLOOR)  == SKIN_OVER_FLOOR_BONUS);
        CHECK(lizard.skinDelta(STONESKIN_FLOOR) == SKIN_OVER_FLOOR_BONUS);
        REQUIRE(lizard.applySkin("barkskin", BARKSKIN_FLOOR, 0) == true);
        CHECK(lizard.getNaturalProtection() == 5 + SKIN_OVER_FLOOR_BONUS);
        CHECK(lizard.getProtection() >= before);
        // The second finds base 5 ≥ floor 3 → target 6, already reached: 0.
        CHECK(lizard.skinDelta(STONESKIN_FLOOR) == 0);
        CHECK(lizard.applySkin("stoneskin", STONESKIN_FLOOR, 0) == false);
        CHECK(lizard.getNaturalProtection() == 5 + SKIN_OVER_FLOOR_BONUS);
        CHECK(lizard.hasBuff("stoneskin") == false);

        // The other order lands the same once.
        Soldier other(REDTEAM);
        other.setNaturalProtection(5);
        REQUIRE(other.applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);
        CHECK(other.applySkin("barkskin", BARKSKIN_FLOOR, 0) == false);
        CHECK(other.getNaturalProtection() == 5 + SKIN_OVER_FLOOR_BONUS);
        CHECK(other.baseNaturalProtection() == 5);
    }
    SECTION("Golem: stone at 7 gets one more from Stoneskin, and only one") {
        Golem golem(REDTEAM);
        REQUIRE(golem.skinDelta(STONESKIN_FLOOR) == SKIN_OVER_FLOOR_BONUS);
        REQUIRE(golem.applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);
        CHECK(golem.getNaturalProtection() == GOLEM_NATURAL_PROTECTION + SKIN_OVER_FLOOR_BONUS);
        CHECK(golem.skinDelta(IRONSKIN_FLOOR) == 0);
    }
}

TEST_CASE("protection: a skin is undone at battle end and on its own tick, exactly", "[protection]") {
    SECTION("battle end") {
        Soldier man(REDTEAM);
        const int protection = man.getProtection();
        REQUIRE(man.applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);
        REQUIRE(man.getProtection() == combinedProtection(STONESKIN_FLOOR, HEAVYARMOUR));
        man.restoreForNextBattle();
        CHECK(man.getNaturalProtection() == 0);
        CHECK(man.getProtection() == protection);
        CHECK(man.hasBuff("stoneskin") == false);
    }
    SECTION("a timed skin runs out and puts the number back") {
        Battlefield& field = Utility::getBattlefield();
        Army red, blue;
        ImmobileDummy* man = place(red,  std::make_unique<ImmobileDummy>(REDTEAM), 8);
        place(blue, std::make_unique<ImmobileDummy>(BLUETEAM), 0);
        field.loadArmies(std::move(red), std::move(blue));

        REQUIRE(man->applySkin("stoneskin", STONESKIN_FLOOR, 2) == true);
        REQUIRE(man->getNaturalProtection() == STONESKIN_FLOOR);
        field.tick();
        CHECK(man->hasBuff("stoneskin") == true);
        CHECK(man->getNaturalProtection() == STONESKIN_FLOOR);
        field.tick();
        CHECK(man->hasBuff("stoneskin") == false);
        CHECK(man->getNaturalProtection() == 0);
        CHECK(man->getProtection() == 0);
        field.extractResult();
    }
}

TEST_CASE("protection: MONOTONICITY — no skin ever lowers any roster body's protection",
          "[protection]") {
    // P-5, the user's rule: "it should not lower it as it isnt a debuff". For
    // every type and every rung, in both orders, natural protection and the
    // combined figure never go down.
    const int floors[] = { BARKSKIN_FLOOR, STONESKIN_FLOOR, IRONSKIN_FLOOR };
    for (const auto& entry : unitCatalog()) {
        for (int first : floors) {
            auto u = entry.make(BLUETEAM);
            REQUIRE(u != nullptr);
            INFO("unit: " << entry.typeName << " first floor " << first);
            int nat = u->getNaturalProtection(), prot = u->getProtection();
            u->applySkin("first", first, 0);
            CHECK(u->getNaturalProtection() >= nat);
            CHECK(u->getProtection() >= prot);
            for (int second : floors) {
                nat = u->getNaturalProtection(); prot = u->getProtection();
                u->applySkin("second", second, 0);
                INFO("second floor " << second);
                CHECK(u->getNaturalProtection() >= nat);
                CHECK(u->getProtection() >= prot);
            }
            // And the revert lands exactly where the body started.
            const auto fresh = entry.make(BLUETEAM);
            u->revertEffects();
            CHECK(u->getNaturalProtection() == fresh->getNaturalProtection());
        }
    }
}

// ── (e) The Stoneskin body on the ladder ─────────────────────────────────────

TEST_CASE("protection: Stoneskin raises to STONESKIN_FLOOR, without Earth growth, and a stone body pays for nothing",
          "[protection]") {
    Battlefield& field = Utility::getBattlefield();
    Army red;
    Mage*    mage  = place(red, earthCaster(REDTEAM), 8);
    Soldier* man   = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    Golem*   golem = place(red, std::make_unique<Golem>(REDTEAM), 6);
    field.loadArmies(std::move(red), {});
    mage->setPathLevel(SpellPath::Earth, 9);   // the growth that used to ride here

    const SpellForm& skin = formOf("stoneskin");
    REQUIRE(skin.skinFloor == STONESKIN_FLOOR);
    REQUIRE(skin.buff == true);

    Target t;
    t.unit = man;
    REQUIRE(skin.cast(*mage, skin, t) == true);
    CHECK(man->getNaturalProtection() == STONESKIN_FLOOR);   // not 3 + Earth ÷ 3
    CHECK(man->getProtection() == combinedProtection(STONESKIN_FLOOR, HEAVYARMOUR));
    CHECK(man->hasBuff("stoneskin") == true);

    // A golem is already harder than stone would make him... except by the
    // bump (P-4), which he gets once.
    t.unit = golem;
    REQUIRE(skin.cast(*mage, skin, t) == true);
    CHECK(golem->getNaturalProtection() == GOLEM_NATURAL_PROTECTION + SKIN_OVER_FLOOR_BONUS);

    // A man under a HARDER skin is found already hard enough: the cast still
    // reports true (it happened; fatigue is the caster's problem), nothing is
    // recorded, and the log says why.
    Army wave;
    Soldier* iron = place(wave, std::make_unique<Soldier>(REDTEAM), 5);
    for (auto& u : wave) field.getTeam(REDTEAM).push_back(std::move(u));
    REQUIRE(iron->applySkin("ironskin", IRONSKIN_FLOOR, 0) == true);
    t.unit = iron;
    REQUIRE(skin.cast(*mage, skin, t) == true);
    CHECK(iron->getNaturalProtection() == IRONSKIN_FLOOR);
    CHECK(iron->hasBuff("stoneskin") == false);
    CHECK(logHasDetail(field, "skin is already as hard as stoneskin"));

    field.extractResult();
}

TEST_CASE("protection: the catalog exports skinFloor on every row, and the description says the floor",
          "[protection]") {
    auto catalog = json::parse(Spells::spellCatalogJson());
    size_t skins = 0;
    for (const auto& row : catalog["spells"]) {
        REQUIRE(row.contains("skinFloor"));
        REQUIRE(row["skinFloor"].is_number_integer());
        CHECK(row["skinFloor"].get<int>() >= 0);
        if (row["spell"] == "stoneskin") {
            CHECK(row["skinFloor"].get<int>() == STONESKIN_FLOOR);
            ++skins;
        } else if (row["spell"] == "barkskin") {
            // NP-2's two rungs, and BOTH at the same floor: the major form buys
            // reach, not thickness (P-9).
            CHECK(row["skinFloor"].get<int>() == BARKSKIN_FLOOR);
            ++skins;
        } else {
            CHECK(row["skinFloor"].get<int>() == 0);
        }
    }
    CHECK(skins == 3);
    const std::string desc = formOf("stoneskin").description;
    CHECK(desc.find(std::to_string(STONESKIN_FLOOR)) != std::string::npos);
    CHECK(desc.find("Earth") == std::string::npos);
}

// ── (f) P-6 and P-1: the scorer ──────────────────────────────────────────────

TEST_CASE("protection: a skin is worth its gain × hits expected, on a fresh man", "[protection]") {
    const SpellForm& skin = formOf("stoneskin");
    Mage mage(REDTEAM);
    Target t;

    // A soldier in plate and a militiaman in leather gain the same three
    // points at divisor 36, so — same value — they are worth the same.
    Soldier soldier(REDTEAM);
    Militia militia(REDTEAM);
    REQUIRE(soldier.getValue() == militia.getValue());
    t.unit = &soldier;
    const int full = skin.worth(mage, skin, t);
    const int gain = combinedProtection(STONESKIN_FLOOR, HEAVYARMOUR) - combinedProtection(0, HEAVYARMOUR);
    REQUIRE(gain == STONESKIN_FLOOR);
    CHECK(full == gain * soldier.getValue() * AI_PROTECTION_HITS / AI_DAMAGE_SCALE);
    CHECK(full > 0);
    t.unit = &militia;
    CHECK(skin.worth(mage, skin, t) == full);

    // Half the man, half the worth (P-1).
    Soldier hurt(REDTEAM);
    halve(hurt);
    t.unit = &hurt;
    CHECK(skin.worth(mage, skin, t) == full / 2);

    // A Golem's stone is past the floor: the bump is one point, and that is
    // all the estimator prices.
    Golem golem(REDTEAM);
    t.unit = &golem;
    const int golemGain = combinedProtection(GOLEM_NATURAL_PROTECTION + SKIN_OVER_FLOOR_BONUS, 0)
                        - combinedProtection(GOLEM_NATURAL_PROTECTION, 0);
    REQUIRE(golemGain == 1);
    CHECK(skin.worth(mage, skin, t) == golemGain * golem.getValue() * AI_PROTECTION_HITS / AI_DAMAGE_SCALE);

    // A man under a harder skin gains nothing and is worth nothing.
    Soldier iron(REDTEAM);
    REQUIRE(iron.applySkin("ironskin", IRONSKIN_FLOOR, 0) == true);
    t.unit = &iron;
    CHECK(skin.worth(mage, skin, t) == 0);
}

TEST_CASE("protection: a body the skin cannot raise stays a candidate and is priced out, not filtered",
          "[protection]") {
    Battlefield& field = Utility::getBattlefield();
    Army red;
    Mage*    mage = place(red, earthCaster(REDTEAM), 8);
    Soldier* iron = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    field.loadArmies(std::move(red), {});
    REQUIRE(iron->applySkin("ironskin", IRONSKIN_FLOOR, 0) == true);

    const Spell* stoneskin = Spells::findSpell("stoneskin");
    REQUIRE(stoneskin != nullptr);
    const SpellForm& skin = stoneskin->forms.front();

    // He does not carry STONESKIN, so the resolver offers him (P-6: the
    // resolver has no opinion about the ladder)...
    std::vector<AUnit*> pool = Spells::candidates(*mage, skin);
    CHECK(std::find(pool.begin(), pool.end(), iron) != pool.end());
    // ...and the scorer prices him at zero, so he is no option — the caster
    // himself, unskinned, is the one.
    std::vector<CastOption> options = Spells::optionsFor(*mage, *stoneskin, 0);
    REQUIRE_FALSE(options.empty());
    for (const CastOption& o : options) CHECK(o.target.unit != iron);
    CHECK(options.front().target.unit == mage);

    field.extractResult();
}

TEST_CASE("protection: Ward and Hex of Frailty weight their worth by freshness (P-1)", "[protection]") {
    Mage caster(REDTEAM);
    Target t;

    const SpellForm& ward = formOf("ward");
    ValuedDummy fresh(REDTEAM);
    t.unit = &fresh;
    const int wardFull = ward.worth(caster, ward, t);
    CHECK(wardFull == fresh.getValue() * AI_BUFF_WORTH_PCT / 100);
    ValuedDummy hurt(REDTEAM);
    halve(hurt);
    t.unit = &hurt;
    CHECK(ward.worth(caster, ward, t) == wardFull / 2);

    // The hex is the same rule on a bane ("Same rule for debuffs"): the SHARE
    // halves; Low's price is paid by your own side whatever shape the target
    // is in, so it is subtracted whole either way.
    const SpellForm& hex = formOf("hex_of_frailty");
    const int price = LOW_BLOOD_PRICE * caster.getValue() / AI_DAMAGE_SCALE;
    ValuedDummy enemy(BLUETEAM);
    t.unit = &enemy;
    const int hexFull = hex.worth(caster, hex, t);
    CHECK(hexFull + price == enemy.getValue() * AI_DEBUFF_WORTH_PCT / 100);
    ValuedDummy hurtEnemy(BLUETEAM);
    halve(hurtEnemy);
    t.unit = &hurtEnemy;
    CHECK(hex.worth(caster, hex, t) + price == (hexFull + price) / 2);
}

TEST_CASE("protection: pricing a skin draws no dice", "[protection]") {
    Battlefield& field = Utility::getBattlefield();
    Army red;
    Mage*    mage = place(red, earthCaster(REDTEAM), 8);
    Soldier* man  = place(red, std::make_unique<Soldier>(REDTEAM), 7);
    place(red, std::make_unique<Golem>(REDTEAM), 6);
    field.loadArmies(std::move(red), {});

    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();
    Utility::pushDiceRoll(4242);
    Utility::pushLotteryRoll(7);

    const Spell* stoneskin = Spells::findSpell("stoneskin");
    REQUIRE(stoneskin != nullptr);
    const SpellForm& skin = stoneskin->forms.front();
    Target t;
    t.unit = man;
    skin.worth(*mage, skin, t);
    Spells::scoreOf(*mage, skin, t);
    Spells::optionsFor(*mage, *stoneskin, 0);
    CHECK(man->getNaturalProtection() == 0);           // priced, not applied

    CHECK(Utility::getRandom(1, 6) == 4242);   // the combat queue was never touched
    CHECK(Utility::lotteryRoll(100) == 7);     // nor the lottery's
    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();
    field.extractResult();
}

// TC-1 item 5 (audit K11): P-1 AS A SWEEP, not three cases that each happen to
// agree with it. Ward, Stoneskin and Hex of Frailty were pinned one at a time,
// so NP-2's two Barkskin rows could have shipped without the rule — and the
// next `buff` row could still. This walks the roster and asks every one of them.
//
// The fixture is built so no row has to be skipped: four bodies worth 200 each
// (enough that Low's blood price does not swallow the hex's whole share, and
// enough that halving survives the integer division), standing THREE hexes
// apart so an area row's arc reaches no one but its own target and the two
// figures compared differ in freshness alone.
TEST_CASE("protection: EVERY buff-flagged form is worth less on a half-dead body (P-1)",
          "[protection]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, std::make_unique<Mage>(REDTEAM), 8);
    ImmobileDummy* allyFull = place(red,  std::make_unique<ImmobileDummy>(REDTEAM), 5);
    ImmobileDummy* allyHurt = place(red,  std::make_unique<ImmobileDummy>(REDTEAM), 2);
    ImmobileDummy* foeFull  = place(blue, std::make_unique<ImmobileDummy>(BLUETEAM), -1);
    ImmobileDummy* foeHurt  = place(blue, std::make_unique<ImmobileDummy>(BLUETEAM), -4);
    field.loadArmies(std::move(red), std::move(blue));

    for (ImmobileDummy* d : { allyFull, allyHurt, foeFull, foeHurt }) d->setValue(200);
    halve(*allyHurt);
    halve(*foeHurt);
    REQUIRE(allyFull->getHp() == allyFull->getmaxHP());
    REQUIRE(foeFull->getHp()  == foeFull->getmaxHP());

    size_t swept = 0;
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            if (!form.buff) continue;
            ++swept;
            INFO("row: " << std::string(spell.id) << "/" << std::string(form.name));
            // A bane is aimed at the enemy and a boon at your own line; either
            // way the body it is priced against has to be a legal one.
            const bool bane = form.target == TargetKind::EnemyUnit;
            Target whole, hurt;
            whole.unit = bane ? foeFull : allyFull;
            hurt.unit  = bane ? foeHurt : allyHurt;

            const int wholeWorth = form.worth(*mage, form, whole);
            const int hurtWorth  = form.worth(*mage, form, hurt);

            // Never skipped silently: if a row cannot be priced on this fixture
            // the sweep says so out loud rather than passing vacuously.
            REQUIRE(wholeWorth > 0);
            CHECK(hurtWorth <= wholeWorth);
            CHECK(hurtWorth > 0);
            // ...and it really is the FRESHNESS doing it, not a tie.
            CHECK(hurtWorth < wholeWorth);
        }

    // The count is pinned so that a new buff row joins the sweep deliberately:
    // ward, stoneskin, both Barkskins and the hex.
    CHECK(swept == 5);

    field.extractResult();
}
