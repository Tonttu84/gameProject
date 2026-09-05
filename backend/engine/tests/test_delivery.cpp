// ── Spell delivery (T-1, T-2, assistant's call 1 — slice TG-1) ───────────────
//
// The front is "SPELL TARGETING AND DELIVERY" in docs/CAMPAIGN_PLAN.md and the
// rules pinned here are its first three:
//
//   T-1  A form carries a SIGNED accuracy modifier on the caster's own stat, and
//        a form written at SPELL_PRECISE just lands — no roll, no scatter, no
//        elevation or forest adjustment on the way.
//   T-2  A form carries a RANGE, and boons are range-checked by it like
//        everything else. Before TG-1 a Ward reached a man across the map.
//   call 1  An imprecise spell's whole miss is the SCATTER. The archer's second
//        "roll ≤ accuracy to hit the aimed man" is gone from spells: land on his
//        hex and he is hit, drift off it and whoever stands there is — friend
//        included (T-7) — or nobody, if the hex is empty.
//
// The dice are what most of this file is really about, so it seeds them the way
// test_targeting.cpp does: a sentinel roll pushed before the act and STILL
// QUEUED after it is the proof that nothing rolled. Utility::getRandom returns a
// queued value verbatim under TESTING, so a stray draw shows up as a wrong
// answer to the sentinel rather than as silence.
#include "catch.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "Utility.hpp"
#include "units/Mage.hpp"
#include "units/Priest.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

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

// A roster row with one field moved. TG-1's fields are DATA, so the honest way
// to test what a number does is to author a row that carries it — the roster's
// own values are pinned by the sweep at the bottom of this file instead.
SpellForm withAccuracy(const SpellForm& form, int accuracy)
{
    SpellForm copy = form;
    copy.accuracy = accuracy;
    return copy;
}

SpellForm withRange(const SpellForm& form, int range)
{
    SpellForm copy = form;
    copy.range = range;
    return copy;
}

// The sentinel: push it, act, and ask for it back. Anything that rolled in
// between would have eaten it.
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

// ── (a) T-1's arithmetic ─────────────────────────────────────────────────────

TEST_CASE("delivery: spellAccuracy is the caster's stat plus the row, clamped — or 100",
          "[delivery]") {
    Mage   mage(REDTEAM);
    Priest priest(REDTEAM);
    const int mageStat   = mage.getAccuracy();
    const int priestStat = priest.getAccuracy();
    REQUIRE(mageStat != priestStat);   // the two casters must actually differ

    const SpellForm& ember = formOf("fireball", 0);
    const SpellForm& shock = formOf("shock");

    SECTION("a precise row ignores the caster entirely") {
        REQUIRE(spellPrecise(shock));
        CHECK(spellAccuracy(mage,   shock) == SPELL_PRECISE);
        CHECK(spellAccuracy(priest, shock) == SPELL_PRECISE);
    }

    SECTION("an unmodified row is the caster's own stat") {
        REQUIRE_FALSE(spellPrecise(ember));
        REQUIRE(ember.accuracy == 0);
        CHECK(spellAccuracy(mage,   ember) == mageStat);
        CHECK(spellAccuracy(priest, ember) == priestStat);
    }

    SECTION("the modifier is signed, and additive on the caster's stat") {
        CHECK(spellAccuracy(mage, withAccuracy(ember,  15)) == mageStat + 15);
        CHECK(spellAccuracy(mage, withAccuracy(ember, -15)) == mageStat - 15);
    }

    SECTION("and it clamps at both ends of the 0..100 scale") {
        CHECK(spellAccuracy(mage, withAccuracy(ember, -100)) == 0);
        // Clamped to 100 WITHOUT becoming precise: precision is a property of
        // what the row says, never of arithmetic that happened to top out.
        const SpellForm nearly = withAccuracy(ember, SPELL_PRECISE - 1);
        CHECK(spellAccuracy(mage, nearly) == SPELL_PRECISE);
        CHECK_FALSE(spellPrecise(nearly));
    }
}

// ── (b) The precise path ─────────────────────────────────────────────────────

TEST_CASE("delivery: a precise form strikes the man it was aimed at, and rolls nothing",
          "[delivery]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Air, 1), 8);
    // TWO enemies on ONE hex: the whole question is whether the shot picks a
    // body out of the hex (what an arrow does) or takes the one it was handed.
    Zombie* bystander = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    Zombie* aimed     = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));
    REQUIRE(bystander->getHex() == aimed->getHex());

    const SpellForm& shock = formOf("shock");
    REQUIRE(spellPrecise(shock));

    RangedCombat::resetCache();
    seedSentinel();

    Target t;
    t.unit = aimed;
    CHECK(shock.cast(*mage, shock, t) == true);

    CHECK(aimed->getHp()     == aimed->getmaxHP() - (SHOCK_DAMAGE + 1));
    CHECK(bystander->getHp() == bystander->getmaxHP());
    // No deviation and no aimed-hit roll: a precise spell asks the dice nothing.
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("delivery: drain life is precise now, and takes the man it was aimed at",
          "[delivery]") {
    // A DELIBERATE CHANGE, not a transcription (assistant's call 3): drain life
    // used to ride the archer's pipeline, so a scattered draught could pull the
    // life out of a bystander. Its row is SPELL_PRECISE now.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* necro = place(red, caster(REDTEAM, SpellPath::Unholy, 1), 8);
    Zombie* bystander = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    Zombie* aimed     = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& drain = formOf("drain_life");
    REQUIRE(spellPrecise(drain));

    RangedCombat::resetCache();
    seedSentinel();

    Target t;
    t.unit = aimed;
    CHECK(drain.cast(*necro, drain, t) == true);

    CHECK(aimed->getHp()     == aimed->getmaxHP() - (DRAIN_DAMAGE + 1));
    CHECK(bystander->getHp() == bystander->getmaxHP());
    CHECK(sentinelUntouched());

    field.extractResult();
}

// ── (c) The imprecise path: scatter IS the miss ──────────────────────────────

TEST_CASE("delivery: an imprecise shot that stays on the hex takes the aimed man",
          "[delivery]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
    Zombie* aimed = place(blue, std::make_unique<Zombie>(BLUETEAM), -2);   // dist 10
    field.loadArmies(std::move(red), std::move(blue));

    // A row deliberately made bad at arriving, so the deviation loop actually
    // runs: accuracy 60 - 55 = 5, distance 10, so Deviate drifts 10/5 = 2 steps
    // and draws TWO getRandom(-1, 1) per step.
    const SpellForm ember = withAccuracy(formOf("fireball", 0), -55);
    REQUIRE(spellAccuracy(*mage, ember) == 5);

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(0); Utility::pushDiceRoll(0);   // step 1: no drift
    Utility::pushDiceRoll(0); Utility::pushDiceRoll(0);   // step 2: no drift
    Utility::pushDiceRoll(SENTINEL);                      // nothing may reach this

    Target t;
    t.unit = aimed;
    CHECK(ember.cast(*mage, ember, t) == true);

    // Landed on his own hex, so the aimed man is struck — and struck WITHOUT the
    // archer's "roll ≤ accuracy" that a 5% shot would essentially always fail
    // (T-1: scatter is the whole of a spell's miss).
    CHECK(aimed->getHp() == aimed->getmaxHP() - (EMBER_DAMAGE + 1));
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("delivery: a shot that scatters off the hex takes a body there — an ALLY too",
          "[delivery]") {
    // T-7, preserved rather than introduced: a spell lands where it lands, and
    // pickHexTarget has never had a team filter. TG-1 keeps that on purpose.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*    mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
    Zombie*  friendly = place(red, std::make_unique<Zombie>(REDTEAM), -1);
    Zombie*  aimed = place(blue, std::make_unique<Zombie>(BLUETEAM), -2);   // dist 10
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm ember = withAccuracy(formOf("fireball", 0), -55);

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    // Step 1 drifts one hex along q (onto the friendly's hex), step 2 stays.
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(0);
    Utility::pushDiceRoll(0); Utility::pushDiceRoll(0);
    Utility::pushDiceRoll(1);      // pickHexTarget: the first body's slot range

    Target t;
    t.unit = aimed;
    CHECK(ember.cast(*mage, ember, t) == true);

    CHECK(friendly->getHp() == friendly->getmaxHP() - (EMBER_DAMAGE + 1));
    CHECK(aimed->getHp()    == aimed->getmaxHP());   // untouched: it went wide

    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("delivery: a shot that scatters onto empty ground hits nobody, and still cast",
          "[delivery]") {
    // M-23's other half: the CASTING happened, so the body reports true and the
    // caster pays for it. Missing is not the same as never having cast.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
    Zombie* aimed = place(blue, std::make_unique<Zombie>(BLUETEAM), -2);   // dist 10
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm ember = withAccuracy(formOf("fireball", 0), -55);

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(0);   // one hex off his line
    Utility::pushDiceRoll(0); Utility::pushDiceRoll(0);
    Utility::pushDiceRoll(SENTINEL);   // an empty hex is not even rolled for

    Target t;
    t.unit = aimed;
    CHECK(ember.cast(*mage, ember, t) == true);

    CHECK(aimed->getHp() == aimed->getmaxHP());
    CHECK(sentinelUntouched());

    field.extractResult();
}

// ── (d) T-2: the range is the row's, and boons have one ──────────────────────

TEST_CASE("delivery: EnemyUnit candidates use the FORM's range, not a constant",
          "[delivery]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage = place(red,  caster(REDTEAM, SpellPath::Air, 1), 8);
    Zombie* near = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);   // dist 3
    place(blue, std::make_unique<Zombie>(BLUETEAM), 4);                  // dist 4
    field.loadArmies(std::move(red), std::move(blue));

    // Both are inside the default reach...
    CHECK(Spells::candidates(*mage, formOf("shock")).size() == 2);

    // ...and a row of range 3 reaches exactly one of them.
    const SpellForm shortRanged = withRange(formOf("shock"), 3);
    std::vector<AUnit*> pool = Spells::candidates(*mage, shortRanged);
    REQUIRE(pool.size() == 1);
    CHECK(pool.front() == near);

    field.extractResult();
}

TEST_CASE("delivery: a boon is range-checked too, and the caster is always in reach",
          "[delivery]") {
    // T-2's whole point: a Ward across the map was a hole. The predicate and the
    // elevation clamp are the enemy rule's — one rule for range.
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*    mage = place(red, caster(REDTEAM, SpellPath::Earth, 1), 11);
    Soldier* near = place(red, std::make_unique<Soldier>(REDTEAM), 1);   // dist 10
    Soldier* far  = place(red, std::make_unique<Soldier>(REDTEAM), 0);   // dist 11
    field.loadArmies(std::move(red), {});

    const SpellForm& skin = formOf("stoneskin");
    REQUIRE(skin.range == SPELLRANGE);

    std::vector<AUnit*> pool = Spells::candidates(*mage, skin);
    REQUIRE(pool.size() == 2);
    CHECK(pool[0] == mage);    // himself first, and always
    CHECK(pool[1] == near);    // exactly the range is in
    for (AUnit* u : pool) CHECK(u != far);

    // AllyTeam is the same rule: greater_bless walks the line it can reach.
    const SpellForm& greater = formOf("bless", 1);
    REQUIRE(greater.target == TargetKind::AllyTeam);
    Target line = Spells::chooseTarget(*mage, greater);
    REQUIRE(line.units.size() == 2);
    CHECK(line.units[0] == mage);
    CHECK(line.units[1] == near);

    field.extractResult();
}

TEST_CASE("delivery: range needs two placed bodies — except for the caster himself",
          "[delivery]") {
    Battlefield& field = Utility::getBattlefield();

    SECTION("an unplaced caster still has himself, and nobody else") {
        Army red;
        auto magePtr = caster(REDTEAM, SpellPath::Earth, 1);
        Mage* mage = magePtr.get();
        red.push_back(std::move(magePtr));                       // NOT placed
        place(red, std::make_unique<Soldier>(REDTEAM), 8);
        field.loadArmies(std::move(red), {});

        // A boon on yourself crosses no distance, so it needs no position; the
        // man standing over there cannot be measured to at all.
        std::vector<AUnit*> pool = Spells::candidates(*mage, formOf("stoneskin"));
        REQUIRE(pool.size() == 1);
        CHECK(pool.front() == mage);

        // An enemy-targeted form still answers nobody, exactly as it did before.
        CHECK(Spells::candidates(*mage, formOf("shock")).empty());
        field.extractResult();
    }

    SECTION("an unplaced ally is nobody's candidate") {
        Army red;
        Mage* mage = place(red, caster(REDTEAM, SpellPath::Earth, 1), 8);
        auto ghostPtr = std::make_unique<Soldier>(REDTEAM);
        Soldier* ghost = ghostPtr.get();
        red.push_back(std::move(ghostPtr));                      // NOT placed
        field.loadArmies(std::move(red), {});

        std::vector<AUnit*> pool = Spells::candidates(*mage, formOf("stoneskin"));
        REQUIRE(pool.size() == 1);
        CHECK(pool.front() == mage);
        for (AUnit* u : pool) CHECK(u != ghost);
        field.extractResult();
    }
}

TEST_CASE("delivery: the Broken pick respects the range like every other pick",
          "[delivery]") {
    // bless used to walk the whole team through Utility::findTarget, which would
    // have reached straight past T-2's new range. It walks the candidates now.
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage*    priest = place(red, caster(REDTEAM, SpellPath::Holy, 1), 11);
    Soldier* hurt   = place(red, std::make_unique<Soldier>(REDTEAM), 1);   // dist 10
    Soldier* broken = place(red, std::make_unique<Soldier>(REDTEAM), 0);   // dist 11
    field.loadArmies(std::move(red), {});

    hurt->takeDamage(9, ArmorPen::Normal);
    broken->setBroken(true);

    // A broken man is the priority pick — but not from out there.
    CHECK(Spells::chooseTarget(*priest, formOf("bless")).unit == hurt);

    // Walk him into reach and the priority reasserts itself.
    broken->setHex(field.hexGrid.getHex(on(2)));
    CHECK(Spells::chooseTarget(*priest, formOf("bless")).unit == broken);

    field.extractResult();
}

// ── (e) The scorer reads the row, not the caster's raw stat ──────────────────

TEST_CASE("delivery: the worth estimators price the FORM's effective accuracy",
          "[delivery]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
    Zombie* foe  = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Air, 1);

    Target t;
    t.unit = foe;

    // Both computed from the constants, not from the function under test:
    // worthDamage is damage × hitPct × value / (100 × AI_DAMAGE_SCALE).
    auto expected = [&](int damage, int hitPct) {
        return damage * hitPct * foe->getValue() / (100 * AI_DAMAGE_SCALE);
    };

    // Shock is PRECISE, so it is priced at a certainty however poor a shot the
    // caster is — which is the point of paying for a precise spell.
    const SpellForm& shock = formOf("shock");
    CHECK(shock.worth(*mage, shock, t) == expected(SHOCK_DAMAGE + 1, SPELL_PRECISE));

    // Ember carries no modifier, so it is priced at the caster's own accuracy.
    const SpellForm& ember = formOf("fireball", 0);
    CHECK(ember.worth(*mage, ember, t) == expected(EMBER_DAMAGE + 1, mage->getAccuracy()));

    // ...and a row that made him worse at it is worth less, off the same body.
    const SpellForm clumsy = withAccuracy(ember, -30);
    CHECK(clumsy.worth(*mage, clumsy, t)
          == expected(EMBER_DAMAGE + 1, mage->getAccuracy() - 30));
    CHECK(clumsy.worth(*mage, clumsy, t) < ember.worth(*mage, ember, t));

    field.extractResult();
}

// ── (f) Roster and wire sweeps ───────────────────────────────────────────────

TEST_CASE("delivery: every row carries a sane range, and only the thrown ones scatter",
          "[delivery]") {
    // The current table, PINNED — not because these numbers are right (they are
    // balance-deferred like every other number on a row) but so that a form
    // authored next month has to say what it is rather than inherit a default
    // nobody looked at. Everything whose body applies its effect directly never
    // rolled to hit anything, and precise is what that was.
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            CHECK(form.range >= 1);
            CHECK(form.accuracy >= -SPELL_PRECISE);
            CHECK(form.accuracy <= SPELL_PRECISE);

            // fireball's two forms are the only things that are THROWN.
            const bool thrown = spell.id == "fireball";
            CHECK(spellPrecise(form) == !thrown);
        }
}

TEST_CASE("delivery: the catalog exports accuracy, precise and range on every row",
          "[delivery]") {
    json catalog = json::parse(Spells::spellCatalogJson());
    REQUIRE(catalog.contains("spells"));

    size_t rows = 0;
    for (const auto& row : catalog["spells"]) {
        INFO(row["spell"].get<std::string>() + "/" + row["form"].get<std::string>());
        REQUIRE(row.contains("accuracy"));
        REQUIRE(row.contains("precise"));
        REQUIRE(row.contains("range"));
        CHECK(row["accuracy"].is_number_integer());
        CHECK(row["precise"].is_boolean());
        // The boolean is the same fact as the number, and the campaign layer
        // pins the biconditional on its own side too (engine.integration.test.js)
        // — a reader should never have to know which of the two to trust.
        CHECK(row["precise"].get<bool>()
              == (row["accuracy"].get<int>() == SPELL_PRECISE));
        CHECK(row["range"].get<int>() >= 1);
        ++rows;
    }

    size_t forms = 0;
    for (const Spell& spell : Spells::roster()) forms += spell.forms.size();
    REQUIRE(rows == forms);

    for (const auto& row : catalog["spells"]) {
        if (row["spell"] == "shock")    CHECK(row["precise"] == true);
        if (row["spell"] == "fireball") CHECK(row["precise"] == false);
    }
}

// ── (g) The area: the arc, the two modes, friendly fire (T-6, T-7 — TG-2) ────
//
// T-6  An area is HEX SIZE POINTS covered as ONE CONTIGUOUS ARC per hex: a
//      rolled start slot and `points` consecutive slots from it, wrapping past
//      640 back to 1, striking every body whose slot range overlaps — once.
//      640 or more covers the hex whole and rolls nothing.
// T-6  EXPLOSION fills the landed hex first, then opens the ring outward, 640
//      a hex, the last hex reached taking the remainder as an arc. RANDOM drops
//      AREA_CHUNK-sized chunks on hexes drawn from the smallest ring set that
//      could hold the area, and each hex then covers its share as one arc.
// T-7  Friendly fire is real: no team filter anywhere in coverage, the caster
//      included, and the scorer NETS his own losses rather than being forbidden.
//
// The dice discipline is the file's: everything is pushed, and the sentinel is
// what proves a case rolled nothing it was not asked to.

namespace {

// N size-10 bodies on ONE hex, in slot order: the first zombie occupies slots
// 1-10, the second 11-20, and so on — pickHexTarget's layout, which is the same
// layout the arc reads (that being the point of sharing the slot cache).
std::vector<Zombie*> crowd(Army& army, int q, int n, int team)
{
    std::vector<Zombie*> made;
    for (int i = 0; i < n; ++i)
        made.push_back(place(army, std::make_unique<Zombie>(team), q));
    return made;
}

// A shot carrying nothing but an area — what coverHex/coverArea read.
RangedShot areaShot(AreaMode mode, int points, int damage)
{
    RangedShot shot;
    shot.areaMode   = mode;
    shot.areaPoints = points;
    shot.areaDamage = damage;
    return shot;
}

constexpr int AREA_DMG = 3;   // arbitrary, and not FIREBALL_BLAST on purpose:
                              // the primitive knows nothing about fireball

bool hurt(const AUnit* u) { return u->getHp() < u->getmaxHP(); }

}  // namespace

TEST_CASE("area: the arc covers consecutive slots from the rolled start, wrapping past 640",
          "[delivery][area]") {
    // The user's own example: 50 points thrown from start 630 covers 630-640 and
    // 1-40, so of twenty men standing in slots 1-200 exactly the FOUR in 1-40
    // are struck. Everything else about an area follows from this.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    std::vector<Zombie*> line = crowd(blue, 5, 20, BLUETEAM);
    field.loadArmies(std::move(red), std::move(blue));
    Hex* hex = line.front()->getHex();

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(630);        // the arc's start slot
    Utility::pushDiceRoll(SENTINEL);   // one roll per hex, and no more

    std::vector<AUnit*> struck;
    RangedCombat::coverHex(mage, hex, 50, areaShot(AreaMode::Explosion, 50, AREA_DMG),
                           0, nullptr, struck);

    CHECK(struck.size() == 4);
    for (size_t i = 0; i < line.size(); ++i) {
        INFO("body " << i << " in slots " << (i * 10 + 1) << "-" << (i * 10 + 10));
        CHECK(hurt(line[i]) == (i < 4));
    }
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("area: 640 points or more take the whole hex, and roll nothing at all",
          "[delivery][area]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    std::vector<Zombie*> line = crowd(blue, 5, 20, BLUETEAM);
    field.loadArmies(std::move(red), std::move(blue));
    Hex* hex = line.front()->getHex();

    RangedCombat::resetCache();
    seedSentinel();

    std::vector<AUnit*> struck;
    RangedCombat::coverHex(mage, hex, Hex::CAPACITY,
                           areaShot(AreaMode::Explosion, Hex::CAPACITY, AREA_DMG),
                           0, nullptr, struck);

    CHECK(struck.size() == line.size());
    for (Zombie* z : line) CHECK(hurt(z));
    // There is no start slot that would leave a slot uncovered, so a full hex is
    // DETERMINISTIC — asking the dice would be asking a question with one answer.
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("area: the man the shot already struck is not struck again by his own blast",
          "[delivery][area]") {
    // T-6's "once per body". The aimed man takes the centre damage and the arc
    // steps over him; everyone else standing in it takes the blast.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    std::vector<Zombie*> line = crowd(blue, 5, 3, BLUETEAM);
    field.loadArmies(std::move(red), std::move(blue));
    Zombie* aimed = line[1];

    const SpellForm& fb = formOf("fireball", 1);
    REQUIRE(fb.areaMode == AreaMode::Explosion);

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    // Distance 3 at accuracy 60 deviates 3/60 = 0 hexes, so the shot stays on
    // the aimed man's hex and no deviation rolls are drawn.
    Utility::pushDiceRoll(1);          // the arc starts at slot 1: all three bodies
    Utility::pushDiceRoll(SENTINEL);

    Target t;
    t.unit = aimed;
    CHECK(fb.cast(*mage, fb, t) == true);

    CHECK(aimed->getHp() == aimed->getmaxHP() - (FIREBALL_CENTRE + 3));
    CHECK(line[0]->getHp() == line[0]->getmaxHP() - FIREBALL_BLAST);
    CHECK(line[2]->getHp() == line[2]->getmaxHP() - FIREBALL_BLAST);
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("area: an explosion fills the landed hex, then opens the ring outward",
          "[delivery][area]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    std::vector<Zombie*> here = crowd(blue, 5, 3, BLUETEAM);
    std::vector<Zombie*> next = crowd(blue, 6, 3, BLUETEAM);   // the E neighbour
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    // 700 points: 640 fill the landed hex (no roll — it is covered whole), the
    // ring then opens with ONE rotation roll, and the 60 left over land on the
    // first hex of the rotated ring as an arc.
    Utility::pushDiceRoll(1);          // rotation: neighbour order turned by one,
                                        // so E — the hex the men are on — comes first
    Utility::pushDiceRoll(631);        // the arc's start: 631-640 then 1-50
    Utility::pushDiceRoll(SENTINEL);

    RangedCombat::coverArea(mage, here.front()->getHex(),
                            areaShot(AreaMode::Explosion, 700, AREA_DMG), 0, nullptr);

    for (Zombie* z : here) CHECK(hurt(z));   // the landed hex, covered whole
    // 60 points from slot 631 reach 1-50, which is the first five bodies' worth
    // of ground — and only three men stand there.
    for (Zombie* z : next) CHECK(hurt(z));
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("area: random mode drops its chunks on drawn hexes, each covered as one arc",
          "[delivery][area]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    std::vector<Zombie*> here = crowd(blue, 5, 3, BLUETEAM);
    std::vector<Zombie*> next = crowd(blue, 6, 3, BLUETEAM);
    field.loadArmies(std::move(red), std::move(blue));
    Hex* landed = here.front()->getHex();

    // The ring set for 650 points is radius 1 (640 < 650, so the landed hex
    // alone cannot hold it) — seven hexes, the landed hex first and its
    // neighbours after it in neighbour order. The E neighbour is index 2.
    std::vector<Hex*> ring1 = RangedCombat::ringHexes(landed, 1);
    REQUIRE(ring1.size() == 6);
    REQUIRE(ring1[1] == next.front()->getHex());
    const int eastDraw = 3;   // 1-based over [landed, NE, E, SE, SW, W, NW]

    SECTION("every chunk on one hex covers it as one arc") {
        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        // 650 points is 65 chunks of AREA_CHUNK; send 62 of them east (620
        // points, an arc) and the last 3 onto the landed hex (30 points).
        for (int i = 0; i < 62; ++i) Utility::pushDiceRoll(eastDraw);
        for (int i = 0; i < 3;  ++i) Utility::pushDiceRoll(1);
        // Covered in ring-set order: the landed hex first, the east neighbour
        // after it. One start roll each, both partial.
        Utility::pushDiceRoll(631);   // 30 points from 631: 631-640, then 1-20
        Utility::pushDiceRoll(1);     // 620 points from 1: 1-620, all three men
        Utility::pushDiceRoll(SENTINEL);

        RangedCombat::coverArea(mage, landed,
                                areaShot(AreaMode::Random, 650, AREA_DMG), 0, nullptr);

        CHECK(hurt(here[0]));            // slots 1-10, inside 1-20
        CHECK(hurt(here[1]));            // slots 11-20
        CHECK_FALSE(hurt(here[2]));      // slots 21-30, past the arc
        for (Zombie* z : next) CHECK(hurt(z));   // 620 points from 1 reach them all
        CHECK(sentinelUntouched());
    }

    SECTION("a hex that drew nothing is not touched") {
        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        for (int i = 0; i < 65; ++i) Utility::pushDiceRoll(eastDraw);
        // 650 on one hex is more than the 640 it holds, so it is covered whole
        // and no start is rolled for it either.
        Utility::pushDiceRoll(SENTINEL);

        RangedCombat::coverArea(mage, landed,
                                areaShot(AreaMode::Random, 650, AREA_DMG), 0, nullptr);

        for (Zombie* z : next) CHECK(hurt(z));
        for (Zombie* z : here) CHECK_FALSE(hurt(z));
        CHECK(sentinelUntouched());
    }

    field.extractResult();
}

TEST_CASE("area: friendly fire is real — own men in it are struck, the caster included",
          "[delivery][area]") {
    // T-7. There is no team filter anywhere in coverage, and this is the case
    // that says so out loud: the blast takes the caster's own soldier standing
    // among the enemy, and takes the caster himself when the ring reaches him.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage*   mage   = place(red,  caster(REDTEAM, SpellPath::Fire, 3), 6);  // the E neighbour
    // One of his own, raised and standing in the enemy's hex. A zombie rather
    // than a soldier so that the pushed queue stays readable: heavy armour would
    // soak a small blast, and a LIVING body struck mid-coverage rolls for morale
    // — which would eat the rolls the ring is about to ask for.
    Zombie* ourOwn = place(red,  std::make_unique<Zombie>(REDTEAM), 5);
    Zombie* theirs = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);          // rotation: E first, which is where the caster stands
    Utility::pushDiceRoll(1);          // the remainder's arc starts at slot 1

    RangedCombat::coverArea(mage, ourOwn->getHex(),
                            areaShot(AreaMode::Explosion, 700, AREA_DMG), 0, nullptr);

    CHECK(hurt(ourOwn));   // his own man, in the hex the blast landed on
    CHECK(hurt(theirs));
    CHECK(hurt(mage));     // and the man who threw it, one hex out
    // No sentinel here on purpose: the caster is a LIVING man, so being struck
    // sends him to testMorale and that is two more dice. What this case is about
    // is who the blast reaches, not what it costs to ask.
    Utility::clearDiceRolls();

    field.extractResult();
}

TEST_CASE("area: off-map ring hexes are skipped, and their share is not spent",
          "[delivery][area]") {
    // At the western edge of row 8 only three of the six ring-1 hexes exist. The
    // three that do not must cost the blast nothing — otherwise a fireball
    // thrown at the map's edge would quietly lose half its force to the void.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
    Zombie* edge = place(blue, std::make_unique<Zombie>(BLUETEAM), -4);   // q = -4, the edge
    field.loadArmies(std::move(red), std::move(blue));
    Hex* landed = edge->getHex();

    std::vector<Hex*> ring = RangedCombat::ringHexes(landed, 1);
    REQUIRE(ring.size() == 3);   // NE, E and SE exist; SW, W and NW are off the map

    // A body in each on-map ring hex, placed straight onto the hexes the walk
    // reports rather than by coordinate — the ring is what is under test.
    Army blue2;
    std::vector<Zombie*> ringMen;
    for (Hex* h : ring) {
        auto z = std::make_unique<Zombie>(BLUETEAM);
        z->setHex(h);
        ringMen.push_back(z.get());
        blue2.push_back(std::move(z));
    }
    for (auto& u : blue2) field.getTeam(BLUETEAM).push_back(std::move(u));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(0);          // no rotation, so the ring runs in neighbour order
    Utility::pushDiceRoll(SENTINEL);   // every hex is covered WHOLE: no start rolls

    // Exactly four full hexes' worth. If the three off-map hexes had been given
    // 640 each, the points would have run out with two of these men unhurt.
    RangedCombat::coverArea(mage, landed,
                            areaShot(AreaMode::Explosion, Hex::CAPACITY * 4, AREA_DMG),
                            0, nullptr);

    CHECK(hurt(edge));
    for (Zombie* z : ringMen) CHECK(hurt(z));
    CHECK(sentinelUntouched());

    field.extractResult();
}

// ── (h) The scorer nets what it would cost (assistant's call 2, T-7) ─────────

TEST_CASE("area: the scorer prices the blast, and subtracts the caster's own men",
          "[delivery][area]") {
    Battlefield& field = Utility::getBattlefield();

    const SpellForm& fb = formOf("fireball", 1);
    REQUIRE(fb.area > 0);

    // Three aim points, the same spell, the same caster. Only who else is
    // standing in the blast changes.
    auto worthWith = [&](int enemies, int allies) {
        Army red, blue;
        Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 3), 8);
        std::vector<Zombie*> foes = crowd(blue, 5, enemies, BLUETEAM);
        for (int i = 0; i < allies; ++i)
            place(red, std::make_unique<Soldier>(REDTEAM), 5);
        field.loadArmies(std::move(red), std::move(blue));

        Utility::clearDiceRolls();
        Utility::pushDiceRoll(SENTINEL);
        Target t;
        t.unit = foes.front();
        int worth = fb.worth(*mage, fb, t);
        CHECK(sentinelUntouched());     // A-1: the estimator rolls nothing
        field.extractResult();
        return worth;
    };

    const int alone     = worthWith(1, 0);
    const int withOwn   = worthWith(1, 2);
    const int threeFoes = worthWith(3, 0);

    // T-7 netted in A-3's one currency: two of your own men standing where the
    // fireball would fall make it worth LESS than the same shot on clean ground,
    // and a packed enemy hex is worth more than a lone man. Nothing forbids the
    // first case — it prices itself out.
    CHECK(withOwn < alone);
    CHECK(alone < threeFoes);
}

// ── (i) The row says what the body does, and the wire says it too ───────────

TEST_CASE("area: only fireball's major form carries an area, and the row IS the blast",
          "[delivery][area]") {
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            const bool isBlast = spell.id == "fireball" && form.name == "major";
            CHECK((form.areaMode != AreaMode::None) == isBlast);
            // The pair is a biconditional: a mode with no points, or points with
            // no mode, is a row that says two different things about itself.
            CHECK((form.area > 0) == (form.areaMode != AreaMode::None));
            if (isBlast) CHECK(form.area == FIREBALL_AREA);
        }
}

TEST_CASE("area: the size the body covers is the size the ROW names", "[delivery][area]") {
    // Read back through the arc rather than through a test seam: what the row
    // claims has to be what the men on the ground actually feel, and the
    // arithmetic of a 100-point arc pins the number from both sides. Two bodies
    // in slots 1-20; one of the caster's OWN is FIRST, so the aimed zombie
    // (slots 11-20) is the primary and the friendly body is the area's only
    // candidate — armourless and undead, so nothing it does asks the dice.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& fb = formOf("fireball", 1);

    auto castFrom = [&](int start) {
        Army red, blue;
        Mage*   mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 3), 8);
        Zombie* own   = place(red,  std::make_unique<Zombie>(REDTEAM), 5);
        Zombie* aimed = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
        field.loadArmies(std::move(red), std::move(blue));

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        Utility::pushDiceRoll(start);
        Utility::pushDiceRoll(SENTINEL);

        Target t;
        t.unit = aimed;
        REQUIRE(fb.cast(*mage, fb, t) == true);
        REQUIRE(aimed->getHp() == aimed->getmaxHP() - (FIREBALL_CENTRE + 3));
        bool struck = hurt(own);
        CHECK(sentinelUntouched());
        field.extractResult();
        return struck;
    };

    // FIREBALL_AREA points from slot 541 cover 541-640 and stop: exactly one
    // point short of wrapping onto the first body.
    CHECK_FALSE(castFrom(Hex::CAPACITY - FIREBALL_AREA + 1));
    // One slot later the arc wraps onto slot 1, and the soldier standing in
    // 1-10 takes the blast. Both halves of the assertion move if the row does.
    CHECK(castFrom(Hex::CAPACITY - FIREBALL_AREA + 2));
}

TEST_CASE("area: the catalog exports areaMode and area on every row", "[delivery][area]") {
    json catalog = json::parse(Spells::spellCatalogJson());
    REQUIRE(catalog.contains("spells"));

    for (const auto& row : catalog["spells"]) {
        INFO(row["spell"].get<std::string>() + "/" + row["form"].get<std::string>());
        REQUIRE(row.contains("areaMode"));
        REQUIRE(row.contains("area"));
        const std::string mode = row["areaMode"].get<std::string>();
        CHECK((mode == "none" || mode == "explosion" || mode == "random"));
        CHECK(row["area"].is_number_integer());
        CHECK(row["area"].get<int>() >= 0);
        // The same biconditional the roster carries, pinned on the wire too:
        // a reader should never have to know which of the two to trust.
        CHECK((row["area"].get<int>() > 0) == (mode != "none"));
        if (row["spell"] == "fireball" && row["form"] == "major") {
            CHECK(mode == "explosion");
            CHECK(row["area"].get<int>() == FIREBALL_AREA);
        }
    }
}
