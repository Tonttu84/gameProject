// ── Area boons: Barkskin (P-7..P-10 — slice NP-2) ────────────────────────────
//
// The front is "NATURAL PROTECTION AND AREA BOONS" in docs/CAMPAIGN_PLAN.md.
// NP-1 built the machinery (the stat, the combine, the raise-to ladder); what
// is pinned here is the first content that uses it, and the three rules the
// content exists to prove:
//
//   P-7   A BOON IS DELIVERED LIKE A BOLT. The shot carries an effect instead
//         of damage, the PRIMARY strike lands on the man it was aimed at, and
//         the arc then covers ground around him from its own rolled start.
//   P-8   The `Affects` tag says who standing on covered ground is TOUCHED.
//         Both Barkskin rows are Friendly, so the enemy is never hardened —
//         in delivery and, by the same predicate, in the estimator.
//   P-9   Two rows, ONE floor: the major buys REACH (three times the ground,
//         thrown rather than laid on), never a harder skin.
//   P-10  THE FIVE-MILITIA TEST, the user's own: five men in one hex and a
//         320-point arc that overlaps them barely half the time — and the man
//         it was cast at carries bark every single cast. The guarantee is the
//         primary strike, never the arc, and this file says so three ways.
#include "catch.hpp"
#include "BattleLogCapture.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "Utility.hpp"
#include "units/Mage.hpp"
#include "units/Militia.hpp"
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wformat"
#pragma GCC diagnostic ignored "-Wformat-nonliteral"
#pragma GCC diagnostic ignored "-Wformat-security"
#include "extern/json.hpp"
#pragma GCC diagnostic pop

#include <memory>
#include <set>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

// Row 8 of the default grid runs q = -4..11, so distance along it is |q1 - q2|.
constexpr int ROW = 8;
HexCoord on(int q) { return { q, ROW }; }

// The two rows under test, by position: forms[0] is the minor, forms[1] the
// major — read off the roster rather than rebuilt, because what is being tested
// is what the ROSTER says.
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

// A caster with Nature and nothing else — a stock Mage is Fire 1 and would
// throw embers through every case here.
std::unique_ptr<Mage> natureCaster(int team, int level)
{
    auto mage = std::make_unique<Mage>(team);
    mage->setPathLevel(SpellPath::Fire, 0);
    mage->setPathLevel(SpellPath::Nature, level);
    return mage;
}

// N militia on one hex, in slot order: the first holds slots 1-10, the second
// 11-20, and so on — pickHexTarget's layout, which is the layout the arc reads.
std::vector<Militia*> line(Army& army, int q, int n, int team)
{
    std::vector<Militia*> made;
    for (int i = 0; i < n; ++i)
        made.push_back(place(army, std::make_unique<Militia>(team), q));
    return made;
}

constexpr int SENTINEL = 4242;

bool sentinelUntouched()
{
    bool still = Utility::getRandom(1, 6) == SENTINEL;
    Utility::clearDiceRolls();
    return still;
}

// The one string NP-1 writes when a skin moved nothing. Its ABSENCE is how this
// file proves "once per body per cast" (T-6): a body touched a second time
// would find itself already as hard as the bark would make him, and say so.
const std::string kAlreadyHard = "skin is already as hard as barkskin";

// A form with one field moved, for the cases that need to compare the roster's
// tag against another (P-8 is a claim about a DIFFERENCE, and the honest way to
// show one is to score the same field twice under two tags).
SpellForm withAffects(const SpellForm& form, Affects tag)
{
    SpellForm copy = form;
    copy.affects = tag;
    return copy;
}

}  // namespace

// ── (a) P-10: five militia in one hex ────────────────────────────────────────

TEST_CASE("barkskin: the man it is cast at carries bark every time, whatever the arc does",
          "[barkskin]") {
    // The user's case, exactly: "a test case where there are only 5 militia in a
    // hex but it always needs to hit at least one of them". Five size-10 bodies
    // hold slots 1-50 of the hex's 640; a BARKSKIN_AREA arc from a random start
    // overlaps that stretch a little over half the time — so the guarantee
    // cannot be the arc, and is not. It is P-7's primary strike.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& bark = formOf("barkskin", 0);
    REQUIRE(bark.skinFloor == BARKSKIN_FLOOR);
    REQUIRE(bark.area == BARKSKIN_AREA);
    REQUIRE(spellPrecise(bark));
    REQUIRE(Militia::SIZE * 5 < BARKSKIN_AREA);   // the arc can hold all five...
    REQUIRE(BARKSKIN_AREA < Hex::CAPACITY);       // ...and can also miss them all

    // One cast on a fresh field of five militia, answering "what did each of
    // them end up with". `start` < 0 leaves the arc's roll to the real dice.
    auto castWithStart = [&](int start) {
        Army red;
        Mage* mage = place(red, natureCaster(REDTEAM, 1), 8);
        std::vector<Militia*> men = line(red, 5, 5, REDTEAM);
        field.loadArmies(std::move(red), {});

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        if (start >= 0) Utility::pushDiceRoll(start);

        Target t;
        t.unit = men.front();                    // aimed at militia #1
        REQUIRE(bark.cast(*mage, bark, t) == true);

        std::vector<int> got;
        for (Militia* m : men) got.push_back(m->getNaturalProtection());
        CAPTURE_BATTLE_LOG(field);
        // T-6, and the only instrument that can see it: a body touched TWICE
        // would be found already as hard as bark would make him the second
        // time, and NP-1's Detail line would be in the log. It is not.
        CHECK_FALSE(logHas(field, kAlreadyHard));
        Utility::clearDiceRolls();
        field.extractResult();
        return got;
    };

    SECTION("unseeded, twenty times over: the aimed man is hardened every single cast") {
        for (int i = 0; i < 20; ++i) {
            INFO("cast " << i);
            const std::vector<int> got = castWithStart(-1);
            CHECK(got[0] == BARKSKIN_FLOOR);
            // And every other man is either covered by the arc or not — both
            // are legal, which is exactly why the aimed man needed a guarantee.
            for (size_t j = 1; j < got.size(); ++j)
                CHECK((got[j] == BARKSKIN_FLOOR || got[j] == 0));
        }
    }

    SECTION("the arc starting at slot 1 covers all five") {
        const std::vector<int> got = castWithStart(1);
        for (int nat : got) CHECK(nat == BARKSKIN_FLOOR);
    }

    SECTION("the arc starting at slot 100 covers the aimed man alone") {
        // Slots 100-419: past the five men entirely, and not far enough to wrap
        // back onto them. The primary is the whole of what lands.
        const std::vector<int> got = castWithStart(100);
        CHECK(got[0] == BARKSKIN_FLOOR);
        for (size_t j = 1; j < got.size(); ++j) CHECK(got[j] == 0);
    }
}

TEST_CASE("barkskin: the fatigue is one cast's, not one body's", "[barkskin]") {
    // The other half of "once per cast": five men take the bark and the caster
    // pays for ONE casting. Driven through the real phase rather than by calling
    // the body, because fatigue is completeCast's business and not the body's.
    Battlefield& field = Utility::getBattlefield();

    Army red;
    auto casterPtr = natureCaster(REDTEAM, 1);
    casterPtr->setChosenSpells({"barkskin"});   // the opening line, so no lottery
    Mage* mage = place(red, std::move(casterPtr), 8);
    std::vector<Militia*> men = line(red, 5, 5, REDTEAM);
    field.loadArmies(std::move(red), {});
    field.setChannels(REDTEAM, 0);              // no M-11 shave in the arithmetic

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    field.triggerSpecialPhase();

    CAPTURE_BATTLE_LOG(field);
    const SpellForm& bark = formOf("barkskin", 0);
    CHECK(mage->getFatigue() == mage->spellFatigueCost(bark));
    CHECK(logCount(field, "casts Barkskin") == 1);
    // Somebody was hardened — the caster is his own candidate (T-2) and may be
    // the man the scorer chose, so the claim is about the cast, not about whom.
    int hardened = mage->getNaturalProtection() > 0 ? 1 : 0;
    for (Militia* m : men) if (m->getNaturalProtection() > 0) ++hardened;
    CHECK(hardened >= 1);

    Utility::clearDiceRolls();
    field.extractResult();
}

// ── (b) P-9: the major buys REACH ────────────────────────────────────────────

TEST_CASE("barkskin: the greater form opens the ring, at the same floor", "[barkskin]") {
    // GREATER_BARKSKIN_AREA fills the hex it lands on (640, deterministically —
    // no start to roll) and carries the rest into ring 1, which is what the one
    // rotation roll then aims. The floor is the MINOR's floor: reach, not
    // thickness.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& greater = formOf("barkskin", 1);
    REQUIRE(greater.skinFloor == BARKSKIN_FLOOR);
    REQUIRE(greater.area == GREATER_BARKSKIN_AREA);
    REQUIRE(GREATER_BARKSKIN_AREA > Hex::CAPACITY);
    REQUIRE_FALSE(spellPrecise(greater));

    Army red;
    Mage* mage = place(red, natureCaster(REDTEAM, 3), 8);
    std::vector<Militia*> here = line(red, 5, 3, REDTEAM);
    std::vector<Militia*> next = line(red, 6, 3, REDTEAM);   // the E neighbour
    field.loadArmies(std::move(red), {});

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    // Distance 3 at accuracy 70 deviates 3/70 = 0 hexes, so the shot stays on
    // the aimed man's hex and the deviation loop draws nothing.
    Utility::pushDiceRoll(1);   // the rotation: neighbour order turned by one,
                                 // so E — where the second group stands — is first
    Utility::pushDiceRoll(1);   // the ring hex's arc: slots 1-320, all three men
    Utility::pushDiceRoll(SENTINEL);

    Target t;
    t.unit = here.front();
    REQUIRE(greater.cast(*mage, greater, t) == true);

    CAPTURE_BATTLE_LOG(field);
    for (Militia* m : here) CHECK(m->getNaturalProtection() == BARKSKIN_FLOOR);
    for (Militia* m : next) CHECK(m->getNaturalProtection() == BARKSKIN_FLOOR);
    // Two hexes out, the caster is past the reach of his own cast.
    CHECK(mage->getNaturalProtection() == 0);
    CHECK_FALSE(logHas(field, kAlreadyHard));
    CHECK(sentinelUntouched());

    field.extractResult();
}

TEST_CASE("barkskin: men already under a harder skin take nothing, and the log says why",
          "[barkskin]") {
    // P-4/P-5 through an AREA: the ladder is per body, so a hex of men under
    // Stoneskin is a hex the bark cannot improve — every one of them keeps his
    // 3, records no bark (so a harder skin is never kept off him by an empty
    // entry) and NP-1's Detail line is written for each.
    Battlefield& field = Utility::getBattlefield();

    Army red;
    Mage* mage = place(red, natureCaster(REDTEAM, 1), 8);
    std::vector<Militia*> men = line(red, 5, 5, REDTEAM);
    field.loadArmies(std::move(red), {});
    for (Militia* m : men)
        REQUIRE(m->applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // the arc from slot 1: all five are covered
    Utility::pushDiceRoll(SENTINEL);

    const SpellForm& bark = formOf("barkskin", 0);
    Target t;
    t.unit = men.front();
    REQUIRE(bark.cast(*mage, bark, t) == true);   // the CAST happened (M-23)

    CAPTURE_BATTLE_LOG(field);
    for (Militia* m : men) {
        CHECK(m->getNaturalProtection() == STONESKIN_FLOOR);
        CHECK_FALSE(m->hasBuff("barkskin"));
    }
    CHECK(logCount(field, kAlreadyHard) == men.size());
    CHECK(sentinelUntouched());

    field.extractResult();
}

// ── (c) The scorer: the gain, the crowd, and the tag (P-6, P-8) ──────────────

TEST_CASE("barkskin: a crowd is worth more than a lone man, and a hardened hex nothing",
          "[barkskin]") {
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& bark = formOf("barkskin", 0);

    // The same cast, the same caster, the same aimed man — only the number of
    // his neighbours changes. Nothing here rolls: the estimator is pure (A-1).
    auto worthWith = [&](int men, bool hardened) {
        Army red;
        Mage* mage = place(red, natureCaster(REDTEAM, 1), 8);
        std::vector<Militia*> group = line(red, 5, men, REDTEAM);
        field.loadArmies(std::move(red), {});
        if (hardened)
            for (Militia* m : group)
                REQUIRE(m->applySkin("stoneskin", STONESKIN_FLOOR, 0) == true);

        Utility::clearDiceRolls();
        Utility::pushDiceRoll(SENTINEL);
        Target t;
        t.unit = group.front();
        const int worth = bark.worth(*mage, bark, t);
        CHECK(sentinelUntouched());
        field.extractResult();
        return worth;
    };

    const int alone = worthWith(1, false);
    const int crowd = worthWith(5, false);
    CHECK(alone > 0);
    // P-7's shape, priced: the aimed man is certain (the row is precise) and
    // everyone else is worth his gain times the chance the arc reaches him.
    CHECK(crowd > alone);
    // P-4/P-6: a hex of men the bark cannot raise is worth exactly nothing —
    // priced out rather than filtered out, aimed man included.
    CHECK(worthWith(5, true) == 0);
}

TEST_CASE("barkskin: a friendly-only boon prices the enemy at zero, never below",
          "[barkskin]") {
    // P-8, and the whole reason the tag reaches the estimator: the same five
    // enemy bodies standing where the bark would fall are worth NOTHING to a
    // Friendly row and a real LOSS to an Everyone one (you would be hardening
    // theirs). Both rows are scored over the identical field.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& bark     = formOf("barkskin", 0);
    const SpellForm  everyone = withAffects(bark, Affects::Everyone);
    REQUIRE(bark.affects == Affects::Friendly);

    auto worthOf = [&](const SpellForm& form, int foes) {
        Army red, blue;
        Mage*    mage  = place(red, natureCaster(REDTEAM, 1), 8);
        Militia* mine  = place(red, std::make_unique<Militia>(REDTEAM), 5);
        // Standing on the same ground as the man the bark is cast at, which is
        // the only way an area this size reaches them at all.
        for (int i = 0; i < foes; ++i)
            place(blue, std::make_unique<Militia>(BLUETEAM), 5);
        field.loadArmies(std::move(red), std::move(blue));

        Utility::clearDiceRolls();
        Utility::pushDiceRoll(SENTINEL);
        Target t;
        t.unit = mine;
        const int worth = form.worth(*mage, form, t);
        CHECK(sentinelUntouched());
        field.extractResult();
        return worth;
    };

    const int clean    = worthOf(bark, 0);
    const int friendly = worthOf(bark, 3);
    const int mixed    = worthOf(everyone, 3);

    CHECK(clean > 0);
    // Zero, not negative: three enemies standing there change the price of a
    // friendly-only bark by nothing at all.
    CHECK(friendly == clean);
    // The same three under an Everyone tag are a cost, and the estimator says so.
    CHECK(mixed < clean);
}

TEST_CASE("barkskin: the greater form's ring prices the enemy's ground at zero too",
          "[barkskin]") {
    // The same rule one hex out: GREATER_BARKSKIN_AREA opens ring 1, so the
    // estimator walks the NEIGHBOURING hexes as well — and a friend-only boon
    // is worth nothing over an enemy hex however much ground it covers.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& greater  = formOf("barkskin", 1);
    const SpellForm  everyone = withAffects(greater, Affects::Everyone);

    // The estimator walks the rings in ringHexes() order and hands the leftover
    // 320 points to the FIRST hex of ring 1 (delivery turns the ring by its
    // rotation roll; the estimate does not, which is TG-2's own approximation).
    // So the enemies are placed straight onto the hex the walk reaches, exactly
    // as TG-2's edge case places bodies on the hexes the ring reports.
    Hex* centre = field.hexGrid.getHex(on(5));
    REQUIRE(centre != nullptr);
    std::vector<Hex*> ring = RangedCombat::ringHexes(centre, 1);
    REQUIRE(ring.size() == 6);
    Hex* reached = ring.front();

    auto worthOf = [&](const SpellForm& form, int foes) {
        Army red, blue;
        Mage*    mage = place(red, natureCaster(REDTEAM, 3), 8);
        Militia* mine = place(red, std::make_unique<Militia>(REDTEAM), 5);
        for (int i = 0; i < foes; ++i) {
            auto foe = std::make_unique<Militia>(BLUETEAM);
            foe->setHex(reached);
            blue.push_back(std::move(foe));
        }
        field.loadArmies(std::move(red), std::move(blue));

        Utility::clearDiceRolls();
        Utility::pushDiceRoll(SENTINEL);
        Target t;
        t.unit = mine;
        const int worth = form.worth(*mage, form, t);
        CHECK(sentinelUntouched());     // A-1: the estimator rolls nothing
        field.extractResult();
        return worth;
    };

    const int clean = worthOf(greater, 0);
    CHECK(clean > 0);
    CHECK(worthOf(greater, 3) == clean);      // friend-only: the ring is worth 0 there
    CHECK(worthOf(everyone, 3) < clean);      // and a real cost under Everyone
}

TEST_CASE("barkskin: a half-dead man is worth half a skin (P-1)", "[barkskin]") {
    // The fresh weighting, on the new row: worth × hp ÷ maxHP. One man alone on
    // his hex, so the arc has nobody else to price and the number under test is
    // the primary term alone.
    Battlefield& field = Utility::getBattlefield();
    const SpellForm& bark = formOf("barkskin", 0);

    auto worthOfMan = [&](bool wounded) {
        Army red;
        Mage*    mage = place(red, natureCaster(REDTEAM, 1), 8);
        Militia* man  = place(red, std::make_unique<Militia>(REDTEAM), 5);
        field.loadArmies(std::move(red), {});
        if (wounded) {
            Utility::clearDiceRolls();
            for (int i = 0; i < 4; ++i) Utility::pushDiceRoll(1);
            man->takeDamage(man->getmaxHP() / 2, ArmorPen::Bypass);
            Utility::clearDiceRolls();
            REQUIRE(man->getHp() * 2 == man->getmaxHP());
        }
        Target t;
        t.unit = man;
        const int worth = bark.worth(*mage, bark, t);
        field.extractResult();
        return worth;
    };

    const int full = worthOfMan(false);
    CHECK(full > 0);
    CHECK(worthOfMan(true) == full / 2);
}

// ── (d) The rows, on the wire and in the table ───────────────────────────────

TEST_CASE("barkskin: the catalog carries the tag, the floor and the ground", "[barkskin]") {
    json catalog = json::parse(Spells::spellCatalogJson());
    REQUIRE(catalog.contains("spells"));

    const std::set<std::string> tags = { "everyone", "friendly", "enemy" };
    size_t rows = 0;
    for (const auto& row : catalog["spells"]) {
        INFO(row["spell"].get<std::string>() + "/" + row["form"].get<std::string>());
        // On EVERY row, like every other engine field on this wire: a reader
        // that has to ask whether a key exists is a reader that will one day
        // forget to.
        REQUIRE(row.contains("affects"));
        CHECK(tags.count(row["affects"].get<std::string>()) == 1);
        if (row["spell"] == "barkskin") {
            CHECK(row["affects"] == "friendly");
            CHECK(row["skinFloor"].get<int>() == BARKSKIN_FLOOR);
            CHECK(row["areaMode"] == "explosion");
            CHECK(row["area"].get<int>()
                  == (row["form"] == "major" ? GREATER_BARKSKIN_AREA : BARKSKIN_AREA));
            ++rows;
        } else {
            // T-7 as written: everything else touches whoever it reaches.
            CHECK(row["affects"] == "everyone");
        }
    }
    CHECK(rows == 2);
}

TEST_CASE("barkskin: a floor means a skin body and a skin body means a floor", "[barkskin]") {
    // The biconditional NP-1 and NP-2 both rest on, swept over the whole roster
    // so a row authored next month cannot half-declare itself: `skinFloor` is
    // the number the BODY hands to applySkin and the number worthSkin prices
    // the gain from, so a row carrying one without a skin body would export a
    // floor nothing reads, and a skin body without one would raise protection
    // to zero.
    //
    // "A skin body" is pinned as the set of cast pointers the two skin spells
    // actually use — the bodies are static to SpellList.cpp, and their addresses
    // off the roster are the only handle a test has on them.
    const SpellForm& stone   = formOf("stoneskin");
    const SpellForm& barkMin = formOf("barkskin", 0);
    const SpellForm& barkMaj = formOf("barkskin", 1);
    // P-9: ONE body for both Barkskin forms — they differ only in row numbers.
    CHECK(barkMin.cast == barkMaj.cast);
    CHECK(stone.cast != barkMin.cast);

    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            const bool skinBody = form.cast == stone.cast || form.cast == barkMin.cast;
            CHECK((form.skinFloor > 0) == skinBody);
            // And a skin is a STANDING EFFECT the man keeps (A-8/T-5), or the
            // resolver would relay it onto the same body every tick.
            if (skinBody) CHECK(form.buff);
        }
}

TEST_CASE("barkskin: the description says the floor, the ground and whose men it takes",
          "[barkskin]") {
    // S3-4: The Study is the player's only written source on what a spell does,
    // and every clause below is built from the constant it quotes.
    const std::string minor = formOf("barkskin", 0).description;
    const std::string major = formOf("barkskin", 1).description;

    for (const std::string& desc : { minor, major }) {
        CHECK(desc.find(std::to_string(BARKSKIN_FLOOR)) != std::string::npos);
        CHECK(desc.find("friend only") != std::string::npos);
    }
    CHECK(minor.find(std::to_string(BARKSKIN_AREA / AREA_CHUNK)) != std::string::npos);
    CHECK(major.find(std::to_string(GREATER_BARKSKIN_AREA / AREA_CHUNK)) != std::string::npos);
    // Only the major is thrown, and only the major says so.
    CHECK(major.find("thrown") != std::string::npos);
    CHECK(minor.find("thrown") == std::string::npos);
}
