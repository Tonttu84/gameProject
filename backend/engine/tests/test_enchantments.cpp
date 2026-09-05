#include "catch.hpp"
#include "BattleLogCapture.hpp"
#include "Battlefield.hpp"
#include "Defines.hpp"
#include "SpellList.hpp"
#include "Utility.hpp"
#include "units/Golem.hpp"
#include "units/Mage.hpp"
#include "units/Skeleton.hpp"
#include "units/Soldier.hpp"

#include <memory>
#include <string>
#include <vector>

// ── Battlefield-wide enchantments (E-2..E-6) ─────────────────────────────────
//
// The sustained spells: one instance per side, tagged with the caster holding
// it up, standing until the battle ends or that caster does. The decisions
// these cases pin are in docs/CAMPAIGN_PLAN.md's enemy-scripts interview:
// E-2 (the pool pays in full, and the M-11 discount does not apply on top),
// E-3 (script-only), E-4 (a sustained instance, once per side per battle),
// E-5 (symmetric applies once, friendly is per side), E-6 (the two spells). What separates
// them from every spell test_spells.cpp covers is that nothing they do happens
// at the moment of casting — the cast only puts the instance UP, and the effect
// is a per-turn hook. So these cases drive whole TICKS rather than
// triggerSpecialPhase(): applyEnchantments() runs in onTurnStart and
// sweepEnchantments() in onTurnEnd, and neither is reachable from the special
// phase alone.
//
// THE ARITHMETIC EVERY FATIGUE ASSERTION BELOW RESTS ON: onTurnStart recovers
// FATIGUERECOVERY (4) off every body and THEN applies the standing effects. The
// only other things that touch fatigue in this engine are melee attacks,
// casting, and MOVING (fatigueCost/2 a step) — so every unit here is pinned
// (see pin() below) and the armies stand 25 rows apart. Nothing marches,
// nothing meets, and a fatigue reading is recovery plus the enchantment and
// nothing else. A body resting at 0 therefore carries exactly what one
// application put on it, which is what makes "once, not twice" testable.

namespace {

// Even-r offset → axial, the same mapping HexGrid::buildRect uses.
HexCoord at(int col, int row) { return { col - row / 2, row }; }

constexpr int RED_ROW  = 27;   // Red's end of the field
constexpr int BLUE_ROW = 2;    // Blue's end — 25 rows away, out of every reach

// A caster with exactly ONE path, because setChosenSpells appends the default
// walk after the chosen ids: a stock Mage's Fire 1 would throw embers into
// every assertion here.
std::unique_ptr<Mage> makeCaster(int team, SpellPath path, int level,
                                 const std::vector<std::string>& script)
{
    auto caster = std::make_unique<Mage>(team);
    caster->setPathLevel(SpellPath::Fire, 0);
    caster->setPathLevel(path, level);
    caster->setChosenSpells(script);
    return caster;
}

// How many ticks a pinned unit stays put — comfortably more than any case here
// runs, since one is burned per tick.
constexpr size_t PIN_TICKS = 30;

// Stand still for the rest of the case. `spentMove` is the engine's own action
// recovery (an archer that has just fired owes a tick), and moveToward() burns
// one instead of stepping — so this is the existing seam for "this unit is not
// what the test is measuring", and it keeps movement fatigue out of arithmetic
// that is entirely about the enchantment.
void pin(AUnit& unit) { unit.setSpentMove(PIN_TICKS); }

// Push a unit onto an army with its hex set and pinned, handing back the raw
// pointer the test watches. The Army owns it until loadArmies moves it in.
template <typename T>
T* place(Army& army, std::unique_ptr<T> unit, HexCoord coord)
{
    Battlefield& field = Utility::getBattlefield();
    Hex* hex = field.hexGrid.getHex(coord);
    REQUIRE(hex != nullptr);
    unit->setHex(hex);
    pin(*unit);
    T* raw = unit.get();
    army.push_back(std::move(unit));
    return raw;
}

// Kill a unit the way a real death leaves it: not alive, and off the grid.
// setAlive(false) alone would leave a dead body in a hex's unit list, which
// debugAsserts() rejects at the top of the next tick — the engine's own deaths
// happen INSIDE a tick and are pruned by cleanup() before that check ever runs.
// After the next tick the object itself is gone, so nothing may read the
// pointer afterwards.
void kill(AUnit& unit)
{
    unit.setAlive(false);
    unit.reset();
}

const SpellForm& formOf(const char* id)
{
    const Spell* spell = Spells::findSpell(id);
    REQUIRE(spell != nullptr);
    REQUIRE_FALSE(spell->forms.empty());
    return spell->forms.front();
}

// Every case starts from a known field: no leftover dice, no leftover pool.
// loadArmies() clears the instances and the once-per-side register itself.
void clearMagicState()
{
    Battlefield& field = Utility::getBattlefield();
    Utility::clearDiceRolls();
    field.setChannels(REDTEAM, 0);
    field.setChannels(BLUETEAM, 0);
}

}  // namespace

// ── Script-only ──────────────────────────────────────────────────────────────

TEST_CASE("enchantments: no battlefield spell is in the default walk", "[enchantments]") {
    // STRUCTURAL, like the roster sweeps in test_spells.cpp: a global authored
    // next month is covered the day it is written, rather than the day someone
    // remembers to name it here.
    for (const Spell* s : Spells::defaultScript())
        REQUIRE_FALSE(Spells::isBattlefieldSpell(*s));

    // ...and the sweep above means something only if the roster has some.
    int globals = 0;
    for (const Spell& s : Spells::roster())
        if (Spells::isBattlefieldSpell(s)) ++globals;
    REQUIRE(globals >= 2);
}

TEST_CASE("enchantments: an unscripted caster never calls one, however long it stands",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    // Nature 2 and a pool that could pay three times over — everything the
    // spell needs EXCEPT a script line naming it.
    auto casterPtr = std::make_unique<Mage>(REDTEAM);
    casterPtr->setPathLevel(SpellPath::Fire, 0);
    casterPtr->setPathLevel(SpellPath::Nature, 2);
    casterPtr->setChosenSpells({});           // exactly the default walk
    place(red, std::move(casterPtr), at(8, RED_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST * 3);

    for (int i = 0; i < 6; ++i) field.tick();

    CAPTURE_BATTLE_LOG(field);
    CHECK(field.activeEnchantments().empty());
    CHECK_FALSE(logHas(field, "Soothing Winds"));
    CHECK(field.getChannels(REDTEAM) == SOOTHING_WINDS_POOL_COST * 3);

    field.extractResult();
    clearMagicState();
}

// ── A scripted global goes up, and stands ────────────────────────────────────

TEST_CASE("enchantments: a scripted Soothing Winds stands over its own side only",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    Mage* caster = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds"}),
                         at(8, RED_ROW));
    Soldier* friendly = place(red, std::make_unique<Soldier>(REDTEAM), at(6, RED_ROW));
    Soldier* enemy    = place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST + 3);

    // Both start tired enough that FATIGUERECOVERY cannot floor them at zero
    // and hide the wind's extra point.
    friendly->addFatigue(60);
    enemy->addFatigue(60);

    field.tick();   // turn 1: the channel begins (castingTime 2)
    CHECK(field.activeEnchantments().empty());

    field.tick();   // turn 2: it completes and the instance goes up
    {
        CAPTURE_BATTLE_LOG(field);
        REQUIRE(field.activeEnchantments().size() == 1);
        const Battlefield::ActiveEnchantment& e = field.activeEnchantments()[0];
        CHECK(e.team   == REDTEAM);
        CHECK(e.caster == caster);
        CHECK(std::string(e.form->label) == "Soothing Winds");
        // Drawn IN FULL, and only once.
        CHECK(field.getChannels(REDTEAM) == 3);
        // No M-11 discount on top of the pool price: the caster paid the whole
        // fatigue the form is authored at. With the discount applied he would
        // have paid up to his Nature level less.
        CHECK(caster->getFatigue() == caster->spellFatigueCost(formOf("soothing_winds")));
        // Nobody has felt the wind yet — it applies at the START of a turn.
        CHECK(friendly->getFatigue() == 60 - 2 * FATIGUERECOVERY);
    }

    field.tick();   // turn 3: the first turn the wind actually blows
    CHECK(friendly->getFatigue() == 60 - 3 * FATIGUERECOVERY - SOOTHING_WINDS_RELIEF);
    CHECK(enemy->getFatigue()    == 60 - 3 * FATIGUERECOVERY);

    field.tick();   // turn 4: and it keeps blowing, every turn, for free
    CHECK(friendly->getFatigue() == 60 - 4 * FATIGUERECOVERY - 2 * SOOTHING_WINDS_RELIEF);
    CHECK(enemy->getFatigue()    == 60 - 4 * FATIGUERECOVERY);

    field.extractResult();
    clearMagicState();
}

// ── The sustainer, and the one call a side gets ──────────────────────────────

TEST_CASE("enchantments: a dead sustainer ends the instance, and the effect with it",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    Mage* caster = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds"}),
                         at(8, RED_ROW));
    Soldier* friendly = place(red, std::make_unique<Soldier>(REDTEAM), at(6, RED_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST);
    friendly->addFatigue(60);

    field.tick();   // channel
    field.tick();   // instance up
    field.tick();   // first turn of relief
    REQUIRE(field.activeEnchantments().size() == 1);
    const int afterRelief = friendly->getFatigue();
    REQUIRE(afterRelief == 60 - 3 * FATIGUERECOVERY - SOOTHING_WINDS_RELIEF);

    // Fleeing off the field sets `alive` too, so this is the same event the
    // sweep sees when a caster runs rather than falls.
    kill(*caster);

    // The tick the sustainer is gone still opens with the wind — the sweep runs
    // at turn END, so an instance is retired after the turn its caster left,
    // never mid-turn. Then it is gone, and cleanup() may destroy the caster.
    field.tick();
    {
        CAPTURE_BATTLE_LOG(field);
        CHECK(field.activeEnchantments().empty());
        CHECK(logHas(field, "Soothing Winds fades — its sustainer is gone"));
        CHECK(friendly->getFatigue()
              == afterRelief - FATIGUERECOVERY - SOOTHING_WINDS_RELIEF);
    }

    // ...and from the next turn the line rests on its own again.
    const int afterFade = friendly->getFatigue();
    field.tick();
    CHECK(friendly->getFatigue() == afterFade - FATIGUERECOVERY);

    field.extractResult();
    clearMagicState();
}

TEST_CASE("enchantments: a side that has called one cannot call it again", "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    const Spell* winds = Spells::findSpell("soothing_winds");
    REQUIRE(winds != nullptr);

    Army red, blue;
    Mage* first = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds"}),
                        at(8, RED_ROW));
    // The understudy: scripted from the start, but with no Nature to cast it
    // with until the first caster is gone. Keeps him out of the fizzle path
    // (covered separately) so what blocks him below is only the register.
    Mage* second = place(red, makeCaster(REDTEAM, SpellPath::Nature, 0, {"soothing_winds"}),
                         at(7, RED_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    // Three times the price, so nothing below can be mistaken for the pool gate.
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST * 3);

    field.tick();
    field.tick();
    REQUIRE(field.activeEnchantments().size() == 1);
    REQUIRE(field.enchantmentCastAlready(REDTEAM, *winds));
    // The register is per side: Blue has not spent its own call.
    REQUIRE_FALSE(field.enchantmentCastAlready(BLUETEAM, *winds));

    kill(*first);
    field.tick();                       // the sweep retires the instance
    REQUIRE(field.activeEnchantments().empty());
    // The register OUTLIVES the instance on purpose — that is the whole rule.
    REQUIRE(field.enchantmentCastAlready(REDTEAM, *winds));

    second->setPathLevel(SpellPath::Nature, 2);
    for (int i = 0; i < 4; ++i) field.tick();

    CAPTURE_BATTLE_LOG(field);
    CHECK(field.activeEnchantments().empty());
    // Not a fizzle at completion either: the walk skipped the spell outright,
    // so the second caster never began the channel and nothing was drawn.
    CHECK(field.getChannels(REDTEAM) == SOOTHING_WINDS_POOL_COST * 2);

    field.extractResult();
    clearMagicState();
}

// ── The symmetric aim: once, however many instances stand ────────────────────

TEST_CASE("enchantments: Leaden Air presses once even with both sides holding it",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    Mage* redCaster = place(red, makeCaster(REDTEAM, SpellPath::Death, 2, {"leaden_air"}),
                            at(8, RED_ROW));
    Soldier* soldier = place(red, std::make_unique<Soldier>(REDTEAM), at(6, RED_ROW));
    place(blue, makeCaster(BLUETEAM, SpellPath::Death, 2, {"leaden_air"}), at(8, BLUE_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(6, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM,  LEADEN_AIR_POOL_COST);
    field.setChannels(BLUETEAM, LEADEN_AIR_POOL_COST);

    field.tick();   // both channel
    field.tick();   // both complete: two instances of one spell, one per side
    REQUIRE(field.activeEnchantments().size() == 2);
    CHECK(field.getChannels(REDTEAM)  == 0);
    CHECK(field.getChannels(BLUETEAM) == 0);

    field.tick();
    {
        CAPTURE_BATTLE_LOG(field);
        // The discriminator: a body resting at zero carries exactly ONE
        // application. Two would read 2 * LEADEN_AIR_WEIGHT, which is what a
        // per-instance loop with no dedupe would produce.
        CHECK(soldier->getFatigue() == LEADEN_AIR_WEIGHT);
    }

    // One sustainer down; the other side's instance still stands, so the air
    // stays heavy for everyone — including the side that just lost its caster.
    kill(*redCaster);
    field.tick();
    REQUIRE(field.activeEnchantments().size() == 1);
    field.tick();
    CHECK(soldier->getFatigue() == LEADEN_AIR_WEIGHT);

    field.extractResult();
    clearMagicState();
}

TEST_CASE("enchantments: Leaden Air spares the bodies that do not tire", "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    place(red, makeCaster(REDTEAM, SpellPath::Death, 2, {"leaden_air"}), at(8, RED_ROW));
    Soldier*  soldier  = place(red, std::make_unique<Soldier>(REDTEAM),  at(6, RED_ROW));
    Skeleton* skeleton = place(red, std::make_unique<Skeleton>(REDTEAM), at(5, RED_ROW));
    Golem*    golem    = place(red, std::make_unique<Golem>(REDTEAM),    at(4, RED_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, LEADEN_AIR_POOL_COST);

    // The exemptions, read structurally rather than by unit name.
    REQUIRE(soldier->tires());
    REQUIRE_FALSE(skeleton->tires());
    REQUIRE(skeleton->hasAbility(UnitAbility::Undead));
    REQUIRE_FALSE(golem->tires());          // animated stone, and not undead
    REQUIRE_FALSE(golem->hasAbility(UnitAbility::Undead));

    field.tick();
    field.tick();
    REQUIRE(field.activeEnchantments().size() == 1);
    field.tick();

    CAPTURE_BATTLE_LOG(field);
    CHECK(soldier->getFatigue()  == LEADEN_AIR_WEIGHT);
    CHECK(skeleton->getFatigue() == 0);
    CHECK(golem->getFatigue()    == 0);

    field.extractResult();
    clearMagicState();
}

// ── The pool gate ────────────────────────────────────────────────────────────

TEST_CASE("enchantments: a pool that cannot pay in full drops the line, and the walk goes on",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    Army red, blue;
    // Two Nature lines, the global first. The enemy stands inside SPELLRANGE so
    // the SECOND line has something to do — which is what makes "the walk went
    // on" observable rather than an absence.
    AUnit* druid = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2,
                                        {"soothing_winds", "briar_snare"}),
                         at(8, RED_ROW));
    Soldier* enemy = place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, RED_ROW - 4));
    // TG-3 made briar_snare resistible (T-4), and this case is about the POOL —
    // it asserts the exact fatigue the snare inflicts, which a shrugged-off
    // snare would not. The contest is settled out of the way rather than
    // seeded: the tick below rolls for a dozen other things and there is no
    // saying which draw the contest would take. Penetration is a real stat and
    // this is what a great deal of it does.
    druid->setPenetration(1000);

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST - 1);   // one short

    field.tick();   // briar_snare is a one-tick cast: it fires in this phase

    {
        CAPTURE_BATTLE_LOG(field);
        CHECK(field.activeEnchantments().empty());
        CHECK(logHas(field, "casts Briar Snare"));
        // At full strength, too: SNARE_FATIGUE plus 5 a Nature level (M-20).
        CHECK(enemy->getFatigue() == SNARE_FATIGUE + 2 * 5);
    }
    field.extractResult();

    // Same caster, same script, a pool that CAN pay: the global is reached, and
    // what it does not need is left in the pool for the rest of the army.
    clearMagicState();
    Army red2, blue2;
    place(red2, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds", "briar_snare"}),
          at(8, RED_ROW));
    place(blue2, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red2), std::move(blue2));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST + 3);

    field.tick();
    field.tick();

    CAPTURE_BATTLE_LOG(field);
    CHECK(field.activeEnchantments().size() == 1);
    CHECK(field.getChannels(REDTEAM) == 3);

    field.extractResult();
    clearMagicState();
}

// ── The fizzle ───────────────────────────────────────────────────────────────

TEST_CASE("enchantments: a second caster of the same side fizzles, and pays nothing",
          "[enchantments]") {
    Battlefield& field = Utility::getBattlefield();
    clearMagicState();

    const Spell* winds = Spells::findSpell("soothing_winds");
    REQUIRE(winds != nullptr);

    Army red, blue;
    // Both begin the channel on the same turn, so neither can see the other's
    // register entry at selection: the collision can only be caught at
    // completion, which is what this case exists to pin.
    Mage* one = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds"}),
                      at(8, RED_ROW));
    Mage* two = place(red, makeCaster(REDTEAM, SpellPath::Nature, 2, {"soothing_winds"}),
                      at(7, RED_ROW));
    place(blue, std::make_unique<Soldier>(BLUETEAM), at(8, BLUE_ROW));

    field.loadArmies(std::move(red), std::move(blue));
    field.setChannels(REDTEAM, SOOTHING_WINDS_POOL_COST * 3);

    field.tick();
    field.tick();

    CAPTURE_BATTLE_LOG(field);
    // One instance, one entry in the register, one payment out of the pool.
    REQUIRE(field.activeEnchantments().size() == 1);
    CHECK(field.enchantmentCastAlready(REDTEAM, *winds));
    CHECK(field.getChannels(REDTEAM) == SOOTHING_WINDS_POOL_COST * 2);
    CHECK(logHas(field, "fizzles — it has already been called over this field"));

    // Exactly one of the two paid the fatigue, and it is the one holding the
    // instance up. Which of them got there first is phase order, not a rule —
    // a cast body that returns false costs nothing, so the other paid nothing
    // at all (M-23).
    const AUnit* sustainer = field.activeEnchantments()[0].caster;
    const Mage*  loser     = (sustainer == one) ? two : one;
    CHECK((sustainer == one || sustainer == two));
    CHECK(loser->getFatigue() == 0);
    CHECK(field.activeEnchantments()[0].caster->getFatigue() > 0);

    field.extractResult();
    clearMagicState();
}
