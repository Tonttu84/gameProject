// ── Duration, and the standing-effect registry (T-5 — slice TG-3) ────────────
//
// The front is "SPELL TARGETING AND DELIVERY" in docs/CAMPAIGN_PLAN.md and the
// rule pinned here is its fifth:
//
//   T-5  A form carries a `duration`: how many ticks its standing effect
//        stands, 0 being the whole battle. A-8's refresh rule becomes "not
//        WHILE ACTIVE"; the same spell never stacks on one body and different
//        spells do; and the stat change is UNDONE — when the effect expires, and
//        again at battle end.
//
// The last of those is the bug AI-1 found and left standing: applyStatMod was
// written for GEAR and mutates the stat outright, so before TG-3 a Stoneskin
// cast in one battle followed its bearer for the life of the process. Latent
// while the campaign ran one battle per process; not latent in the battle lab,
// which runs N in a row.
//
// The registry records what ACTUALLY landed rather than what was asked for, and
// the floor case below is what proves the distinction: applyStatMod floors each
// stat, so a −3 asked of a body standing at 1 moves it by −1, and a revert that
// trusted the asked-for number would hand it back +3.
#include "catch.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "SpellList.hpp"
#include "TestDummies.hpp"
#include "Utility.hpp"
#include "units/Mage.hpp"
#include "units/Soldier.hpp"

#include <memory>
#include <string>
#include <vector>

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

// A body standing at ONE point of defence, so a −3 hex has somewhere to floor.
// The whole of the applied-versus-asked distinction needs a stat that cannot
// take the change it is handed, and a real unit type would have to be beaten
// down to get there.
class FrailDummy : public ImmobileDummy {
public:
    explicit FrailDummy(int t) : ImmobileDummy(t) { defence = 1; }
};

}  // namespace

// ── (a) 0 means the whole battle ─────────────────────────────────────────────

TEST_CASE("duration: a form written 0 stands for the whole battle", "[duration]") {
    // Two immobile bodies that never reach each other, so a tick is nothing but
    // its bookkeeping — which is exactly what is under test.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    ImmobileDummy* man = place(red,  std::make_unique<ImmobileDummy>(REDTEAM), 8);
    place(blue, std::make_unique<ImmobileDummy>(BLUETEAM), 0);
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(formOf("stoneskin").duration == 0);
    const int armour = man->getArmour();
    man->applyEffect("stoneskin", "armour", 2, formOf("stoneskin").duration);
    REQUIRE(man->getArmour() == armour + 2);

    for (int i = 0; i < HEX_FRAILTY_DURATION * 3; ++i) field.tick();

    CHECK(man->hasBuff("stoneskin") == true);
    CHECK(man->getArmour() == armour + 2);

    field.extractResult();
}

// ── (b) A timed effect expires, and puts back exactly what it took ───────────

TEST_CASE("duration: a timed effect runs out on its own tick and reverts exactly",
          "[duration]") {
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    FrailDummy* man = place(blue, std::make_unique<FrailDummy>(BLUETEAM), 0);
    place(red, std::make_unique<ImmobileDummy>(REDTEAM), 8);
    field.loadArmies(std::move(red), std::move(blue));

    // Defence 1, asked for −3: the stat FLOORS at 0, so what actually landed is
    // −1. A revert that undid the asked-for number would leave him at 3 — better
    // off than the hex found him, and permanently.
    const int defence = man->getDefence();
    REQUIRE(defence == 1);
    man->applyEffect("hex_of_frailty", "defence", -3, HEX_FRAILTY_DURATION);
    REQUIRE(man->getDefence() == 0);

    // One short of the duration: still standing.
    for (int i = 0; i < HEX_FRAILTY_DURATION - 1; ++i) field.tick();
    CHECK(man->hasBuff("hex_of_frailty") == true);
    CHECK(man->getDefence() == 0);

    // And the tick it runs out on, it is gone and the point is back — the point
    // that was taken, not the three that were asked for.
    field.tick();
    CHECK(man->hasBuff("hex_of_frailty") == false);
    CHECK(man->getDefence() == defence);

    field.extractResult();
}

// ── (c) "Not while active" — the refresh rule, on both sides ─────────────────

TEST_CASE("duration: a body carrying a standing effect is no candidate for it until it expires",
          "[duration]") {
    // A-8 as T-5 restates it. The two bodies are dummies rather than a caster
    // and a soldier deliberately: nothing here should CAST during the ticks, so
    // what the candidate list says is about the registry and about nothing else.
    Battlefield& field = Utility::getBattlefield();

    Army red, blue;
    ImmobileDummy* seer = place(red,  std::make_unique<ImmobileDummy>(REDTEAM), 8);
    ImmobileDummy* foe  = place(blue, std::make_unique<ImmobileDummy>(BLUETEAM), 5);
    field.loadArmies(std::move(red), std::move(blue));

    const SpellForm& hex = formOf("hex_of_frailty");
    REQUIRE(hex.buff == true);          // T-5: a bane is a standing effect too
    REQUIRE(hex.duration == HEX_FRAILTY_DURATION);

    // Before: the one enemy in range is a candidate, and the Densest pick — a
    // separate walk from candidates(), through Utility::findTarget — agrees.
    REQUIRE(Spells::candidates(*seer, hex).size() == 1);
    REQUIRE(Spells::chooseTarget(*seer, hex).unit == foe);

    foe->applyEffect("hex_of_frailty", "defence", -1, hex.duration);
    CHECK(Spells::candidates(*seer, hex).empty());
    CHECK(Spells::chooseTarget(*seer, hex).unit == nullptr);

    // A DIFFERENT spell is a different effect: nothing about carrying the hex
    // keeps a snare off him.
    CHECK(Spells::candidates(*seer, formOf("briar_snare")).size() == 1);

    for (int i = 0; i < HEX_FRAILTY_DURATION - 1; ++i) field.tick();
    CHECK(Spells::candidates(*seer, hex).empty());

    // The tick it expires on, he is a target again — which is what makes the
    // duration a real dial rather than a cosmetic one.
    field.tick();
    CHECK(Spells::candidates(*seer, hex).size() == 1);
    CHECK(Spells::chooseTarget(*seer, hex).unit == foe);

    field.extractResult();
}

// ── (d) The battle ends and the body is handed back as it was ────────────────

TEST_CASE("duration: battle end reverts every standing effect and empties the shield stack",
          "[duration]") {
    // The bug T-5 closed. restoreForNextBattle() cleared the MARK and left the
    // STAT, so a survivor carried a spell's armour into every later battle in
    // the process — and a Ward's shield layers with it.
    Soldier man(REDTEAM);
    const int armour  = man.getArmour();
    const int defence = man.getDefence();

    man.applyEffect("stoneskin", "armour", 2, 0);
    man.applyEffect("hex_of_frailty", "defence", -2, HEX_FRAILTY_DURATION);
    // Ward records PRESENCE and no number: its barrier is a consumable shield
    // layer, so there is nothing for a revert to put back.
    man.addShield(3);
    man.applyEffect("ward", "", 0, 0);

    REQUIRE(man.getArmour()  == armour + 2);
    REQUIRE(man.getDefence() == defence - 2);
    REQUIRE(man.hasBuff("ward") == true);

    man.restoreForNextBattle();

    CHECK(man.getArmour()  == armour);
    CHECK(man.getDefence() == defence);
    CHECK(man.hasBuff("stoneskin") == false);
    CHECK(man.hasBuff("hex_of_frailty") == false);
    CHECK(man.hasBuff("ward") == false);
    // The shield stack goes with them. tryBlockExtraShield rolls against every
    // layer it finds, so a layer left behind would be a free block in the next
    // battle — and would eat a die doing it, which is why this is checked with
    // a sentinel rather than by asking for a count the class does not expose.
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // a 1 would block against a strength-3 layer
    CHECK(man.tryBlockExtraShield() == false);
    Utility::clearDiceRolls();
}

TEST_CASE("duration: different spells stack on one body, the same spell never does",
          "[duration]") {
    // T-5's sentence in full. Both halves matter: a man may be skinned AND
    // warded, and he may not be skinned twice.
    Soldier man(REDTEAM);
    const int armour = man.getArmour();

    REQUIRE(man.applyEffect("stoneskin", "armour", 2, 0) == true);
    REQUIRE(man.applyEffect("ward", "", 0, 0) == true);
    CHECK(man.hasBuff("stoneskin") == true);
    CHECK(man.hasBuff("ward") == true);
    CHECK(man.getArmour() == armour + 2);

    // Nothing here FORBIDS a second stoneskin — the registry is a record, and
    // the rule that keeps it off him is the resolver's (candidates() drops a
    // body that carries the spell). What is pinned is that the record is what
    // the resolver reads, and that a revert of two effects is two reverts.
    man.revertEffects();
    CHECK(man.getArmour() == armour);
    CHECK(man.hasBuff("stoneskin") == false);
    CHECK(man.hasBuff("ward") == false);
}

TEST_CASE("duration: an effect on a stat nothing knows is not recorded at all", "[duration]") {
    // applyStatMod is INERT for a name it does not handle (the campaign layer's
    // contract for every effect reader), so an effect that could not be applied
    // must not leave the registry claiming it is standing — hasBuff would then
    // keep the spell off a man it never touched.
    Soldier man(REDTEAM);
    CHECK(man.applyEffect("nonsense", "charisma", 3, 0) == false);
    CHECK(man.hasBuff("nonsense") == false);
}

// ── (e) The one row that carries a real duration ─────────────────────────────

TEST_CASE("duration: hex of frailty is the roster's timed row, and says so", "[duration]") {
    // One real timed row, deliberately (T-5): the expiry machinery is walked by
    // a spell rather than only by a test. The description is built from the same
    // constant, so a retune moves the sentence with it.
    const SpellForm& hex = formOf("hex_of_frailty");
    CHECK(hex.duration == HEX_FRAILTY_DURATION);
    CHECK(hex.description.find(std::to_string(HEX_FRAILTY_DURATION) + " ticks")
          != std::string::npos);

    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(std::string(spell.id) + "/" + std::string(form.name));
            if (spell.id == "hex_of_frailty") continue;
            CHECK(form.duration == 0);
        }
}
