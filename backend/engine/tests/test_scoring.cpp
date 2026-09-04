// The casting AI (docs/CAMPAIGN_PLAN.md "THE CASTING AI", A-1..A-7) — slice
// AI-2. What is pinned here: the scorer is PURE, the divider is what A-4 says,
// a wire `value` moves a target's score, the script is an opening SEQUENCE
// with a sanity floor (A-6), the shortlist narrows the lottery and never cages
// it (A-7), the lottery draws through its own seam (A-2), battlefield spells
// stay script-only (E-3), and every form carries a worth.
#include "catch.hpp"
#include "Battlefield.hpp"
#include "RangedCombat.hpp"
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

// The same, at an explicit coordinate — for a body that must stand OUT of
// spell range, which ROW's sixteen columns cannot provide. Even-r offset: row
// 26 holds q in -13..2, so {2, 26} is eighteen hexes from {2, ROW}.
template <typename T>
T* placeAt(Army& army, std::unique_ptr<T> unit, HexCoord at)
{
    Battlefield& field = Utility::getBattlefield();
    Hex* hex = field.hexGrid.getHex(at);
    REQUIRE(hex != nullptr);
    unit->setHex(hex);
    T* raw = unit.get();
    army.push_back(std::move(unit));
    return raw;
}
constexpr HexCoord FAR_AWAY  = { 2, 26 };   // 18 hexes from {2, ROW}: out of SPELLRANGE
constexpr HexCoord IN_RANGE  = { 2, 16 };   //  8 hexes: inside it

std::unique_ptr<Mage> caster(int team, SpellPath path, int level)
{
    auto mage = std::make_unique<Mage>(team);
    mage->setPathLevel(SpellPath::Fire, 0);
    mage->setPathLevel(path, level);
    return mage;
}

bool logHasDetail(const Battlefield& field, const std::string& needle)
{
    for (const LogLine& l : field.tickLog())
        if (l.tier == LogTier::Detail && l.text.find(needle) != std::string::npos) return true;
    return false;
}

}  // namespace


TEST_CASE("scoring: every form on the roster carries a worth", "[scoring]") {
    // A form without one is a form the AI can never choose — a new spell must
    // not be able to fall silently out of every caster's hands.
    for (const Spell& spell : Spells::roster())
        for (const SpellForm& form : spell.forms) {
            INFO(spell.id << " / " << form.name);
            REQUIRE(form.worth != nullptr);
            REQUIRE(form.spell == &spell);
        }
}

TEST_CASE("scoring: the divider is A-4's formula, and the catalog exports it", "[scoring]") {
    const SpellForm& ember    = formOf("fireball", 0);
    const SpellForm& fireball = formOf("fireball", 1);
    auto expect = [](const SpellForm& f) {
        int cost  = f.fatigue + f.poolCost * AI_POOL_COST_WEIGHT;
        int ticks = f.castingTime > 1 ? f.castingTime : 1;
        return ticks * (AI_DIVIDER_BASE + cost / AI_FATIGUE_PER_DIVIDER);
    };
    REQUIRE(spellDivider(ember)    == expect(ember));
    REQUIRE(spellDivider(fireball) == expect(fireball));
    // A slow big spell divides by more than a quick small one.
    REQUIRE(spellDivider(fireball) > spellDivider(ember));
    // A battlefield enchantment's pool draw counts as cost.
    const SpellForm& leaden = formOf("leaden_air");
    REQUIRE(spellDivider(leaden) == expect(leaden));
    REQUIRE(leaden.poolCost > 0);

    json catalog = json::parse(Spells::spellCatalogJson());
    for (const auto& row : catalog["spells"]) {
        const Spell* spell = Spells::findSpell(row["spell"].get<std::string>());
        REQUIRE(spell != nullptr);
        bool found = false;
        for (const SpellForm& f : spell->forms)
            if (f.name == row["form"].get<std::string>()) {
                REQUIRE(row["divider"].get<int>() == spellDivider(f));
                found = true;
            }
        REQUIRE(found);
    }
}

TEST_CASE("scoring: scoreOf and optionsFor touch nothing and draw from neither queue", "[scoring]") {
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*   mage = place(red,  caster(REDTEAM, SpellPath::Fire, 3), 8);
    Zombie* ally = place(red,  std::make_unique<Zombie>(REDTEAM), 7);
    Zombie* foe  = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Earth, 1);
    mage->setPathLevel(SpellPath::Holy, 1);
    mage->setPathLevel(SpellPath::Water, 1);
    ally->takeDamage(2);
    ally->addFatigue(10);

    const int allyHp = ally->getHp(), allyFatigue = ally->getFatigue(), foeHp = foe->getHp();
    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();
    Utility::pushDiceRoll(4242);
    Utility::pushLotteryRoll(7);

    for (const Spell& spell : Spells::roster()) {
        Spells::optionsFor(*mage, spell, 0);
        for (const SpellForm& form : spell.forms)
            Spells::scoreOf(*mage, form, Spells::chooseTarget(*mage, form));
    }

    CHECK(ally->getHp() == allyHp);
    CHECK(ally->getFatigue() == allyFatigue);
    CHECK(foe->getHp() == foeHp);
    CHECK(field.activeEnchantments().empty());
    CHECK(Utility::getRandom(1, 6) == 4242);   // the combat queue was never touched
    CHECK(Utility::lotteryRoll(100) == 7);     // nor the lottery's
    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();
    field.extractResult();
}

TEST_CASE("scoring: a wire value raises a target's score, one option per enemy", "[scoring]") {
    // A-5: the campaign sends `value`; the scorer reads it. A kitted
    // supercombatant is a target that scores higher — nothing more.
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*   mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
    Zombie* plain = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    Zombie* prize = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    prize->setValue(60);

    const Spell* fireball = Spells::findSpell("fireball");
    std::vector<CastOption> options = Spells::optionsFor(*mage, *fireball, 0);
    REQUIRE(options.size() == 2);
    int plainScore = -1, prizeScore = -1;
    for (const CastOption& o : options) {
        if (o.target.unit == plain) plainScore = o.score;
        if (o.target.unit == prize) prizeScore = o.score;
    }
    REQUIRE(plainScore > 0);
    REQUIRE(prizeScore > plainScore);

    // The wire's clamp.
    prize->setValue(0);
    REQUIRE(prize->getValue() == 1);
    prize->setValue(AI_VALUE_CAP + 5);
    REQUIRE(prize->getValue() == AI_VALUE_CAP);
    field.extractResult();
}

TEST_CASE("scoring: the lottery draws through its own seam, tickets in proportion to score",
          "[scoring]") {
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*   mage  = place(red,  caster(REDTEAM, SpellPath::Fire, 3), 8);
    Zombie* first = place(blue, std::make_unique<Zombie>(BLUETEAM), 5);
    Zombie* last  = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    // Two equal targets, so the draw alone decides — and a two-tick major so
    // the chosen target is still held when the phase ends.
    const Spell* fireball = Spells::findSpell("fireball");
    std::vector<CastOption> options = Spells::optionsFor(*mage, *fireball, AI_LOTTERY_FLOOR);
    REQUIRE(options.size() == 2);
    REQUIRE(options[0].form->name == "major");
    int total = options[0].score + options[1].score;

    Utility::clearLotteryRolls();
    Utility::pushLotteryRoll(1);          // the first ticket
    field.triggerSpecialPhase();
    REQUIRE(mage->isChannelling());
    REQUIRE(mage->channelTarget() == first);
    field.extractResult();

    Army red2, blue2;
    Mage*   mage2  = place(red2,  caster(REDTEAM, SpellPath::Fire, 3), 8);
    place(blue2, std::make_unique<Zombie>(BLUETEAM), 5);
    Zombie* last2  = place(blue2, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red2), std::move(blue2));
    (void) last;
    Utility::pushLotteryRoll(total);      // the last ticket
    field.triggerSpecialPhase();
    REQUIRE(mage2->isChannelling());
    REQUIRE(mage2->channelTarget() == last2);
    REQUIRE(logHasDetail(field, "weighs"));
    Utility::clearLotteryRolls();
    field.extractResult();
}

TEST_CASE("scoring: the script is an opening sequence — each line once, then the pool",
          "[scoring]") {
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Earth, 1), 8);
    Soldier* man  = place(red,  std::make_unique<Soldier>(REDTEAM), 7);
    Zombie*  foe  = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Fire, 1);
    mage->setChosenSpells({"stoneskin", "fireball"});
    REQUIRE(mage->scriptCursor() == 0);
    const int armourBefore = man->getArmour();
    const int mageArmourBefore = mage->getArmour();

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();

    // Tick 1: line one, Stoneskin, on whichever ally the scorer rates — one
    // tick, so it lands at once. The cursor has moved past it.
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 1);
    REQUIRE((man->getArmour() > armourBefore || mage->getArmour() > mageArmourBefore));

    // Tick 2: line two, Ember at the foe. Cursor at the end.
    Utility::pushDiceRoll(1);
    const int foeHp = foe->getHp();
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 2);
    REQUIRE(foe->getHp() < foeHp);

    // Tick 3: the sequence is spent; the pool takes over and something still
    // fires (Ember again, or Stoneskin on the ally left fresh) — the cursor
    // never runs past the script.
    Utility::pushDiceRoll(1);
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 2);
    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("scoring: an enemy-targeted line waits for range instead of being spent", "[scoring]") {
    // AI-3's finding: armies start out of spell range, so a damage line that is
    // skipped for "nobody in range" on tick one is the player's whole order
    // thrown away on the approach march. Such a line HOLDS; meanwhile the
    // caster improvises from the pool, and the line still fires first once the
    // enemy arrives.
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 2);
    Soldier* man  = place(red,  std::make_unique<Soldier>(REDTEAM), 3);
    Zombie*  foe  = placeAt(blue, std::make_unique<Zombie>(BLUETEAM), FAR_AWAY);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Earth, 1);
    mage->setChosenSpells({"fireball"});
    REQUIRE(Spells::awaitsRange(*mage, *Spells::findSpell("fireball")));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::clearLotteryRolls();
    const int armourBefore = man->getArmour();
    const int mageArmourBefore = mage->getArmour();

    // Tick 1: the foe is out of range. The line is HELD (cursor still 0) and
    // the pool improvises — Stoneskin is the one thing with a target, so it
    // lands on someone this very tick rather than the caster standing mute.
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 0);
    REQUIRE((man->getArmour() > armourBefore || mage->getArmour() > mageArmourBefore));

    // The probe agrees: with the line held, what fires next is the pool's.
    const Spell* probed = nullptr;
    const SpellForm* next = mage->chooseSpellToCast(&probed);
    REQUIRE(next != nullptr);
    REQUIRE(probed->id == "stoneskin");

    // The foe walks into range: the held line fires FIRST, and only now does
    // the cursor move past it.
    foe->setHex(field.hexGrid.getHex(IN_RANGE));
    REQUIRE_FALSE(Spells::awaitsRange(*mage, *Spells::findSpell("fireball")));
    Utility::pushDiceRoll(1);
    const int foeHp = foe->getHp();
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 1);
    REQUIRE(foe->getHp() < foeHp);
    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("scoring: a held line is not a cage — nothing to improvise means idle, not skip", "[scoring]") {
    // The same hold with no pool to fall back on: the caster idles and the
    // line stays pending, because a later line must never overtake the order
    // the player wrote merely because the enemy is slow.
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*   mage = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 2);
    Zombie* foe  = placeAt(blue, std::make_unique<Zombie>(BLUETEAM), FAR_AWAY);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Air, 1);
    mage->setChosenSpells({"fireball", "shock"});

    RangedCombat::resetCache();
    Utility::clearLotteryRolls();
    const int foeHp = foe->getHp();
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 0);
    REQUIRE_FALSE(mage->isChannelling());
    REQUIRE(foe->getHp() == foeHp);
    REQUIRE(mage->chooseSpellToCast(nullptr) == nullptr);
    field.extractResult();
}

TEST_CASE("scoring: a worthless scripted line is skipped in the same tick", "[scoring]") {
    // A-6's sanity floor: nobody to skin, so Stoneskin is passed over and the
    // NEXT line fires this very tick, at no cost in ticks or fatigue.
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Earth, 1), 8);
    Soldier* man  = place(red,  std::make_unique<Soldier>(REDTEAM), 7);
    Zombie*  foe  = place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    mage->setPathLevel(SpellPath::Fire, 1);
    mage->markBuff("stoneskin");
    man->markBuff("stoneskin");
    mage->setChosenSpells({"stoneskin", "fireball"});

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);
    const int foeHp = foe->getHp();
    field.triggerSpecialPhase();
    REQUIRE(mage->scriptCursor() == 2);
    REQUIRE(foe->getHp() < foeHp);
    Utility::clearDiceRolls();
    field.extractResult();
}

TEST_CASE("scoring: the shortlist narrows the pool, widens when worthless, and idles at nothing",
          "[scoring]") {
    Battlefield& field = Utility::getBattlefield();

    SECTION("a shortlist of one is the only thing cast") {
        Army red, blue;
        Mage*   mage = place(red,  caster(REDTEAM, SpellPath::Fire, 1), 8);
        place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
        field.loadArmies(std::move(red), std::move(blue));
        mage->setPathLevel(SpellPath::Air, 1);
        mage->setShortlist({"shock"});
        REQUIRE(mage->getShortlist().size() == 1);

        const Spell* picked = nullptr;
        const SpellForm* form = mage->chooseSpellToCast(&picked);
        REQUIRE(form != nullptr);
        REQUIRE(picked->id == "shock");
        field.extractResult();
    }

    SECTION("a shortlist worth nothing widens to the roster") {
        Army red, blue;
        Mage*    mage = place(red,  caster(REDTEAM, SpellPath::Earth, 1), 8);
        Soldier* man  = place(red,  std::make_unique<Soldier>(REDTEAM), 7);
        place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
        field.loadArmies(std::move(red), std::move(blue));
        mage->setPathLevel(SpellPath::Fire, 1);
        mage->markBuff("stoneskin");
        man->markBuff("stoneskin");
        mage->setShortlist({"stoneskin"});

        const Spell* picked = nullptr;
        REQUIRE(mage->chooseSpellToCast(&picked) != nullptr);
        REQUIRE(picked->id == "fireball");
        field.extractResult();
    }

    SECTION("nothing worth casting means no cast at all") {
        Army red;
        Mage* mage = place(red, caster(REDTEAM, SpellPath::Fire, 1), 8);
        field.loadArmies(std::move(red), {});   // nobody to burn
        const int fatigue = mage->getFatigue();
        field.triggerSpecialPhase();
        REQUIRE_FALSE(mage->isChannelling());
        REQUIRE(mage->getFatigue() == fatigue);
        REQUIRE(mage->chooseSpellToCast(nullptr) == nullptr);
        field.extractResult();
    }

    SECTION("a battlefield spell on a shortlist is dropped: script-only (E-3)") {
        Mage mage(REDTEAM);
        mage.setShortlist({"leaden_air", "shock", "soothing_winds"});
        REQUIRE(mage.getShortlist().size() == 1);
        REQUIRE(mage.getShortlist()[0]->id == "shock");
    }
}

TEST_CASE("scoring: the post-script pool never holds a battlefield spell", "[scoring]") {
    // An unscripted Death 2 caster with a full pool and the school open never
    // calls Leaden Air on his own (E-3): the roster he draws from excludes it.
    Battlefield& field = Utility::getBattlefield();
    Army red, blue;
    auto necro = std::make_unique<Necromancer>(REDTEAM);
    necro->setPathLevel(SpellPath::Death, 2);
    Necromancer* n = place(red, std::move(necro), 8);
    place(blue, std::make_unique<Zombie>(BLUETEAM), 4);
    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, 9);
    field.setSchoolLevel(REDTEAM, SpellSchool::Enchantment, 9);
    Utility::clearLotteryRolls();
    for (int i = 0; i < 4; ++i) field.triggerSpecialPhase();
    REQUIRE(field.activeEnchantments().empty());
    (void) n;
    field.extractResult();
}
