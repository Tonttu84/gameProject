// ── Magic resistance (T-4 — slice TG-3) ──────────────────────────────────────
//
// The front is "SPELL TARGETING AND DELIVERY" in docs/CAMPAIGN_PLAN.md and the
// rule pinned here is its fourth:
//
//   T-4  A form carries a RESIST TAG. An untagged form cannot be resisted and
//        rolls nothing for it. A tagged one is CONTESTED, per target body, at
//        delivery time: RESIST_BASE + the caster's mastery of the form's primary
//        path beyond what the form requires + his penetration + an exploding
//        die, against the body's resistance + the form's resistMod + an
//        exploding die. The spell lands only if the caster's total is STRICTLY
//        the higher — a tie goes to the body.
//
// A resisted cast still HAPPENED: the body reports true, the caster pays the
// fatigue, and Low's price is still taken. M-23's "no spell, no fatigue" is
// about a spell that never fired; this one fired and was thrown off.
//
// The dice are what most of this file is about, so it seeds them the way
// test_delivery.cpp does: a sentinel pushed before the act and STILL QUEUED
// after it is the proof that nothing rolled. Utility::getRandom returns a queued
// value verbatim under TESTING, so a stray draw shows up as a wrong answer to
// the sentinel rather than as silence.
//
// FOUR pushes make one contest, in this order: the caster's die (face, then the
// explode check) and then the target's. A 6 on an explode check would explode,
// so every check below is pushed as a 1.
#include "catch.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "UnitCatalog.hpp"
#include "Utility.hpp"
#include "units/Golem.hpp"
#include "units/Mage.hpp"
#include "units/Skeleton.hpp"
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

// A caster with exactly ONE path, so nothing but the spell under test is in his
// hands (a stock Mage is Fire 1 and would throw embers into every case).
std::unique_ptr<Mage> caster(int team, SpellPath path, int level)
{
    auto mage = std::make_unique<Mage>(team);
    mage->setPathLevel(SpellPath::Fire, 0);
    mage->setPathLevel(path, level);
    return mage;
}

// ONE contest, pushed: the caster throws `casterDie`, the body throws
// `targetDie`, and neither explodes.
void pushContest(int casterDie, int targetDie)
{
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(casterDie); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(targetDie); Utility::pushDiceRoll(1);
}

constexpr int SENTINEL = 4242;

void seedSentinel()
{
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(SENTINEL);
}

bool sentinelUntouched()
{
    bool still = Utility::getRandom(1, 6) == SENTINEL;
    Utility::clearDiceRolls();
    return still;
}

}  // namespace

// ── (a) The tag, and what an untagged form costs ─────────────────────────────

TEST_CASE("resist: an untagged form cannot be resisted and rolls nothing", "[resist]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Air, 1), 8);
    Soldier* man  = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& shock = formOf("shock");
    REQUIRE(shock.resist == ResistKind::None);

    seedSentinel();
    CHECK(Spells::resisted(*mage, shock, *man) == false);
    // Not "rolled and won" — an untagged form must not touch the queue at all,
    // or every combat test that seeds a shot would be seeding this instead.
    CHECK(sentinelUntouched());

    field.extractResult();
}

// ── (b) The contest's arithmetic, on both sides of the boundary ──────────────

TEST_CASE("resist: the higher total wins and a TIE goes to the body", "[resist]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    // Low 1 against hex_of_frailty's Low 1 requirement: no mastery bonus, no
    // penetration, so the caster's side is RESIST_BASE plus his die.
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Low, 1), 8);
    Soldier* man  = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& hex = formOf("hex_of_frailty");
    REQUIRE(hex.resist == ResistKind::Negates);
    REQUIRE(hex.resistMod == 0);
    // The numbers the cases below are arithmetic on, asserted rather than
    // assumed: both sides start from the same place, so the dice decide.
    REQUIRE(RESIST_BASE == man->getResistance());
    REQUIRE(mage->getPenetration() == 0);

    SECTION("one point clear is a landed spell") {
        pushContest(4, 3);
        CHECK(Spells::resisted(*mage, hex, *man) == false);
    }
    SECTION("equal totals are RESISTED — the spell must beat the will, not match it") {
        pushContest(3, 3);
        CHECK(Spells::resisted(*mage, hex, *man) == true);
    }
    SECTION("one point short is resisted") {
        pushContest(3, 4);
        CHECK(Spells::resisted(*mage, hex, *man) == true);
    }

    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("resist: mastery of the form's primary path beyond its requirement pushes through",
          "[resist]") {
    // The user's "+1 per extra path": what the caster holds ABOVE what the form
    // asks for is what forces the spell past a will. Read off the PRIMARY path
    // and nothing else (M-20).
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    weak   = place(red,  caster(REDTEAM, SpellPath::Low, 1), 8);
    Mage*    strong = place(red,  caster(REDTEAM, SpellPath::Low, 3), 7);
    Soldier* man    = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& hex = formOf("hex_of_frailty");
    REQUIRE(hex.paths.front().level == 1);

    // The same dice for both: 11 against 12 for the Low 1, and the Low 3's two
    // spare levels turn the same throw into 13 against 12.
    pushContest(1, 2);
    CHECK(Spells::resisted(*weak, hex, *man) == true);
    pushContest(1, 2);
    CHECK(Spells::resisted(*strong, hex, *man) == false);

    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("resist: penetration and resistance move the contest through the mod bag",
          "[resist]") {
    // T-4's reserved mod-bag names, which is the whole reason they go through
    // applyStatMod rather than being set fields: no item carries either today,
    // and the day one does it comes through the same door a helm does.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Low, 1), 8);
    Soldier* man  = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& hex = formOf("hex_of_frailty");

    // Baseline: one point short.
    pushContest(1, 2);
    CHECK(Spells::resisted(*mage, hex, *man) == true);

    // +2 penetration on the caster turns the same throw around.
    REQUIRE(mage->applyStatMod("penetration", 2) == true);
    CHECK(mage->getPenetration() == 2);
    pushContest(1, 2);
    CHECK(Spells::resisted(*mage, hex, *man) == false);

    // ...and +3 resistance on the body turns it back.
    REQUIRE(man->applyStatMod("resistance", 3) == true);
    CHECK(man->getResistance() == RESIST_HUMAN + 3);
    pushContest(1, 2);
    CHECK(Spells::resisted(*mage, hex, *man) == true);

    // Both floor at 0 rather than going negative, which would hand a body its
    // own malus back through the subtraction.
    REQUIRE(mage->applyStatMod("penetration", -AUnit::MAX_STAT_MOD) == true);
    CHECK(mage->getPenetration() == 0);

    Utility::clearDiceRolls();
    field.extractResult();
}

// ── (c) A resisted cast is still a cast ──────────────────────────────────────

TEST_CASE("resist: a resisted hex changes nothing, and is still paid for in full",
          "[resist]") {
    // Driven through the real selection path (castSpells → completeCast), because
    // the claim is about what the CASTER pays, not about what the body returns.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Low, 1), 8);
    Soldier* man  = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));
    // A-3 prices a hex against what the bargain costs your own side, and at
    // ordinary values a common soldier is not worth the blood. A man worth
    // spending it on is what puts the line over the script floor.
    man->setValue(100);
    mage->setChosenSpells({"hex_of_frailty"});

    const int defenceBefore = man->getDefence();
    const int hpBefore      = mage->getHp();

    RangedCombat::resetCache();
    pushContest(1, 5);   // 11 against 15: thrown off
    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    // Nothing landed on him, and nothing is standing on him either.
    CHECK(man->getDefence() == defenceBefore);
    CHECK(man->hasBuff("hex_of_frailty") == false);
    // But the spell was CAST: the fatigue is paid...
    CHECK(mage->getFatigue() > 0);
    // ...and M-24's price is taken all the same. The bargain was struck when he
    // reached for it; what the enemy made of the spell is not the creditor's
    // business. No other ally stands here, so it comes out of the caster.
    CHECK(mage->getHp() == hpBefore - LOW_BLOOD_PRICE);

    field.extractResult();
}

TEST_CASE("resist: a hex that LANDS takes the defence and stands on the man", "[resist]") {
    // The other side of the same case, so the one above is a comparison rather
    // than an absence.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Low, 1), 8);
    Soldier* man  = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));
    man->setValue(100);
    mage->setChosenSpells({"hex_of_frailty"});

    const int defenceBefore = man->getDefence();

    RangedCombat::resetCache();
    pushContest(5, 1);   // 15 against 11: it holds
    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    CHECK(man->getDefence() == defenceBefore - 1);   // Low 1: one point, no more
    CHECK(man->hasBuff("hex_of_frailty") == true);
    CHECK(mage->getFatigue() > 0);

    field.extractResult();
}

// ── (d) A resisted SHOT: the contest rides the shot, not the body ────────────

TEST_CASE("resist: a body that shrugs off drain life takes nothing and gives nothing",
          "[resist]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   necro = place(red,  caster(REDTEAM, SpellPath::Unholy, 1), 8);
    Zombie* foe   = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& drain = formOf("drain_life");
    REQUIRE(drain.resist == ResistKind::Negates);
    // Undead resist better than men, which is the point of the per-type table.
    REQUIRE(foe->getResistance() == RESIST_UNDEAD);

    // Wounded, so "the caster healed nothing" is a claim that could fail.
    necro->takeDamage(5, ArmorPen::Bypass);
    const int casterHp = necro->getHp();
    REQUIRE(casterHp < necro->getmaxHP());

    RangedCombat::resetCache();
    Target t;
    t.unit = foe;

    SECTION("resisted: no damage, no drain, and the cast still reports true") {
        pushContest(1, 5);   // 11 against 19
        Utility::pushDiceRoll(SENTINEL);   // nothing past the contest may roll
        CHECK(drain.cast(*necro, drain, t) == true);
        CHECK(foe->getHp() == foe->getmaxHP());
        CHECK(necro->getHp() == casterHp);
        // The shot stopped at the contest: no block roll, no cover roll.
        CHECK(sentinelUntouched());
    }

    SECTION("not resisted: the damage lands and half of it comes back") {
        pushContest(6, 1);   // 16 against 15
        CHECK(drain.cast(*necro, drain, t) == true);
        const int dealt = DRAIN_DAMAGE + 1;   // Unholy 1, and a zombie wears no armour
        CHECK(foe->getHp() == foe->getmaxHP() - dealt);
        CHECK(necro->getHp() == casterHp + dealt / 2);
    }

    Utility::clearDiceRolls();
    field.extractResult();
}

// ── (e) The per-type table, and what crosses the wire ────────────────────────

TEST_CASE("resist: every unit type brings its own resistance, and a man is the default",
          "[resist]") {
    Soldier  man(REDTEAM);
    Skeleton bones(REDTEAM);
    Zombie   corpse(REDTEAM);
    Golem    stone(REDTEAM);
    Mage     mage(REDTEAM);

    CHECK(man.getResistance()    == RESIST_HUMAN);
    CHECK(bones.getResistance()  == RESIST_UNDEAD);
    CHECK(corpse.getResistance() == RESIST_UNDEAD);
    CHECK(stone.getResistance()  == RESIST_GOLEM);
    CHECK(mage.getResistance()   == RESIST_CASTER);
    // The ordering is the design, not the numbers: stone is the hardest thing
    // to enchant and a common man the easiest of these.
    CHECK(stone.getResistance() > corpse.getResistance());
    CHECK(corpse.getResistance() > man.getResistance());
    // Nobody carries penetration yet — the stat exists for the items that will.
    CHECK(mage.getPenetration() == 0);
}

TEST_CASE("resist: the unit catalog exports both contest stats on every row", "[resist]") {
    json catalog = json::parse(unitCatalogJson());
    REQUIRE(catalog.contains("units"));

    size_t rows = 0;
    for (const auto& row : catalog["units"]) {
        INFO(row["name"].get<std::string>());
        REQUIRE(row["stats"].contains("resistance"));
        REQUIRE(row["stats"].contains("penetration"));
        // Every body has SOME will, and nothing has negative penetration.
        CHECK(row["stats"]["resistance"].get<int>() >= 1);
        CHECK(row["stats"]["penetration"].get<int>() >= 0);
        ++rows;
    }
    CHECK(rows == unitCatalog().size());

    // Spot-checks, so a table edit cannot pass the sweep above quietly.
    for (const auto& row : catalog["units"]) {
        if (row["name"] == "Golem")   CHECK(row["stats"]["resistance"] == RESIST_GOLEM);
        if (row["name"] == "Skeleton") CHECK(row["stats"]["resistance"] == RESIST_UNDEAD);
        if (row["name"] == "Soldier")  CHECK(row["stats"]["resistance"] == RESIST_HUMAN);
        if (row["name"] == "Scorpion") CHECK(row["stats"]["resistance"] == RESIST_BEAST);
    }
}

// ── (f) The scorer's half: an estimate, and a pure one ───────────────────────

TEST_CASE("resist: landChancePct is pure, certain for an untagged form, and ordered",
          "[resist]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage   = place(red,  caster(REDTEAM, SpellPath::Nature, 1), 8);
    Soldier* man    = place(blue, std::make_unique<Soldier>(BLUETEAM), 5);
    Zombie*  corpse = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& snare = formOf("briar_snare");
    const SpellForm& shock = formOf("shock");
    REQUIRE(snare.resist == ResistKind::Negates);

    seedSentinel();
    const int vsMan    = Spells::landChancePct(*mage, snare, *man);
    const int vsCorpse = Spells::landChancePct(*mage, snare, *corpse);
    // AI-1's rule: the scorer never rolls, so it can be asked as often as it
    // likes without eating a queue a combat test seeded.
    CHECK(sentinelUntouched());

    // An untagged form is a certainty as far as resistance goes, so a caller
    // can multiply by it unconditionally.
    CHECK(Spells::landChancePct(*mage, shock, *man) == SPELL_PRECISE);

    // Parity between RESIST_BASE and a man's resistance is an even chance...
    CHECK(vsMan == SPELL_PRECISE / 2);
    // ...and the tougher will is the worse bet, by the estimator's own slope.
    CHECK(vsCorpse < vsMan);
    CHECK(vsCorpse == SPELL_PRECISE / 2
                      - (RESIST_UNDEAD - RESIST_HUMAN) * RESIST_PCT_PER_POINT);

    // Mastery moves it the other way, and it never reaches a certainty at
    // either end — two exploding dice can always surprise you, so the estimate
    // is clamped well short of both.
    mage->setPathLevel(SpellPath::Nature, 9);
    corpse->setResistance(0);
    CHECK(Spells::landChancePct(*mage, snare, *corpse) == RESIST_CHANCE_MAX_PCT);
    corpse->setResistance(1000);
    CHECK(Spells::landChancePct(*mage, snare, *corpse) == RESIST_CHANCE_MIN_PCT);

    field.extractResult();
}

TEST_CASE("resist: scoreOf scales a tagged form's worth by the chance it lands",
          "[resist]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage   = place(red,  caster(REDTEAM, SpellPath::Nature, 1), 8);
    Zombie* corpse = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& snare = formOf("briar_snare");
    // A body worth spending a spell on, so the arithmetic below is about the
    // scaling rather than about integer division against a value of five.
    corpse->setValue(100);

    Target t;
    t.unit = corpse;

    const int worth  = snare.worth(*mage, snare, t);
    const int chance = Spells::landChancePct(*mage, snare, *corpse);
    REQUIRE(worth > 0);
    REQUIRE(chance < SPELL_PRECISE);

    // Composed from the pieces rather than from the function under test: the
    // land chance scales the WORTH, before A-4's divider, so the ratio forms
    // are compared on is a ratio of expected value.
    CHECK(Spells::scoreOf(*mage, snare, t)
          == (worth * chance / 100) * AI_SCORE_SCALE / spellDivider(snare));
    // And it is strictly worse than the same cast against a will it would beat.
    corpse->setResistance(RESIST_HUMAN);
    CHECK(Spells::scoreOf(*mage, snare, t)
          > (worth * chance / 100) * AI_SCORE_SCALE / spellDivider(snare));

    field.extractResult();
}

// ── (g) Roster and wire sweeps ───────────────────────────────────────────────

TEST_CASE("resist: the roster's tags are the three named ones, and nothing else",
          "[resist]") {
    // The current table, PINNED — not because these three are the right three
    // (they are balance-deferred like every other authoring choice on a row)
    // but so that tagging a fourth is a deliberate act rather than a default
    // nobody looked at.
    const std::set<std::string> tagged = { "hex_of_frailty", "briar_snare", "drain_life" };
    std::set<std::string> found;

    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            // A duration is a count of ticks, never a negative one.
            CHECK(form.duration >= 0);
            // The modifier is Dominions' "easily"/"hard" as data — a small
            // signed nudge, not a second resistance stat.
            CHECK(form.resistMod >= -AUnit::MAX_STAT_MOD);
            CHECK(form.resistMod <= AUnit::MAX_STAT_MOD);
            if (form.resist == ResistKind::None) continue;
            found.insert(std::string(spell.id));
            // Only a spell aimed at a BODY can be resisted by one. A blessing
            // nobody may refuse and a wind over the whole field have nothing to
            // contest against.
            CHECK(form.target == TargetKind::EnemyUnit);
        }

    CHECK(found == tagged);
}

TEST_CASE("spellCatalogJson: every row carries its resist kind, modifier and duration",
          "[resist]") {
    json catalog = json::parse(Spells::spellCatalogJson());
    REQUIRE(catalog.contains("spells"));

    const std::set<std::string> kinds = { "none", "negates" };

    size_t rows = 0;
    for (const auto& row : catalog["spells"]) {
        INFO(row["spell"].get<std::string>() + "/" + row["form"].get<std::string>());
        REQUIRE(row.contains("resist"));
        REQUIRE(row.contains("resistMod"));
        REQUIRE(row.contains("duration"));
        CHECK(kinds.count(row["resist"].get<std::string>()) == 1);
        CHECK(row["resistMod"].is_number_integer());
        CHECK(row["duration"].get<int>() >= 0);
        ++rows;
    }

    size_t forms = 0;
    for (const Spell& spell : Spells::roster()) forms += spell.forms.size();
    REQUIRE(rows == forms);

    // Spot-checks, so a rename of a kind cannot pass the sweep above quietly.
    for (const auto& row : catalog["spells"]) {
        if (row["spell"] == "hex_of_frailty") {
            CHECK(row["resist"]   == "negates");
            CHECK(row["duration"] == HEX_FRAILTY_DURATION);
        }
        if (row["spell"] == "drain_life")  CHECK(row["resist"] == "negates");
        if (row["spell"] == "shock")     { CHECK(row["resist"] == "none");
                                           CHECK(row["duration"] == 0); }
    }
}
