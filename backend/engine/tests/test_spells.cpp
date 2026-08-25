#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Mage.hpp"
#include "units/Necromancer.hpp"
#include "units/Priest.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "RangedCombat.hpp"
#include "SpellList.hpp"
#include "UnitCatalog.hpp"
#include "Utility.hpp"
#include "Defines.hpp"
#include <set>

// ── Caster characterization tests ────────────────────────────────────────────
//
// Written BEFORE the Stage R0 spell-roster migration (docs/UNITS_AS_DATA_PLAN.md)
// to pin the current Mage::special() / Necromancer::special() behavior the way
// the Priest tests in test_combat.cpp already pin castBless. They drive the
// battlefield-level surface (triggerSpecialPhase) rather than special() directly
// so the same assertions keep guarding the behavior after casting moves into
// AUnit::castSpells().
//
// All units are constructed BEFORE dice are pushed — every AUnit constructor
// consumes one getRandom() for its sortKey.

// ── Mage fireball ─────────────────────────────────────────────────────────────
// Mage BS 12 → accuracy 60 → aimed range 6 hexes. Zombie target: undead (no
// morale dice), armour 0 — takes exactly FIREBALL_CENTRE damage from a hit.
//
// Dice for one aimed fireball on flat open ground at distance 3:
//   deviation:  dist/accuracy = 3/60 = 0 → no rolls
//   aimed roll: getRandom(1,100) ≤ 60 → push 1
//   morale:     undead target → no rolls
//   splash:     FIREBALL_SECONDARY × pickHexTarget getRandom(1,640);
//               push 640 each — lands on empty ground slots, hits nobody.

TEST_CASE("Mage fireball hits an in-range enemy for FIREBALL_CENTRE plus its Fire level") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
    Zombie* zombie = zombiePtr.get();

    magePtr->setHex(field.hexGrid.getHex({5, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({2, 8}));
    // The blast is fireball's MAJOR form now, gated on Fire 3 (M-13/M-18); a
    // stock Mage is Fire 1 and would throw the minor ember instead.
    magePtr->setPathLevel(SpellPath::Fire, 3);

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    REQUIRE(zombie->getHp() == zombie->getmaxHP());

    RangedCombat::resetCache(); // tick() normally does this before the phase
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // aimed-hit roll succeeds
    for (int i = 0; i < FIREBALL_SECONDARY; ++i)
        Utility::pushDiceRoll(640); // splash finds only empty ground

    // The major form channels for two ticks (M-23): the first phase starts it
    // and consumes no dice, the second fires it.
    field.triggerSpecialPhase();
    REQUIRE(zombie->getHp() == zombie->getmaxHP()); // still mid-channel
    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    // M-20: the blast scales on the caster's PRIMARY path level.
    REQUIRE(zombie->getHp() == zombie->getmaxHP() - (FIREBALL_CENTRE + 3));
    REQUIRE(zombie->getAlive() == true);

    field.extractResult();
}

TEST_CASE("a Fire 1 Mage throws the minor ember, not the blast") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
    Zombie* zombie = zombiePtr.get();

    magePtr->setHex(field.hexGrid.getHex({5, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({2, 8}));

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // aimed-hit roll succeeds; ember has no splash

    field.triggerSpecialPhase();   // minor form is one tick, so it fires at once
    Utility::clearDiceRolls();

    // This is M-18's whole point: a level-1 path is never a dud roll.
    REQUIRE(zombie->getHp() == zombie->getmaxHP() - (EMBER_DAMAGE + 1));

    field.extractResult();
}

TEST_CASE("Mage does nothing when no enemy is within SPELLRANGE") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
    Zombie* zombie = zombiePtr.get();

    // Distance 15 > SPELLRANGE (10) on the default 16×30 grid.
    magePtr->setHex(field.hexGrid.getHex({11, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({-4, 8}));

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls(); // no dice needed: no target → no shot, no rolls

    field.triggerSpecialPhase();

    REQUIRE(zombie->getHp() == zombie->getmaxHP());

    field.extractResult();
}

// ── Necromancer raise-dead ────────────────────────────────────────────────────
// No dice pushed anywhere: raiseDead/placeZombie roll nothing (summon ctors
// draw their sortKey/gear from the real RNG, which is fine — we only assert
// counts and flags). Corpse economy pinned exactly as implemented today:
//   corpses ≥ 3 → setCorpses(corpses-3), then up to 3 zombies placed, each
//                 placement decrementing corpses further iff corpses > 0
//   corpses 1-2 → 1 zombie, corpse count decremented by the placement
//   corpses 0   → 1 free skeleton conjured from ancient bones

TEST_CASE("Necromancer with enough corpses raises a zombie battle-summon per corpse") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));
    // Zombies are raise_dead's MAJOR form (Death 3); a stock Necromancer is
    // Death 1 and raises a single skeleton instead — see the test below.
    necroPtr->setPathLevel(SpellPath::Death, 3);

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    // The major form is hungry: RAISE_DEAD_BODIES + Death/3 = 4 at Death 3.
    field.setCorpses(4);

    field.triggerSpecialPhase();   // starts the two-tick channel
    field.triggerSpecialPhase();   // fires it

    auto& redTeam = field.getTeam(REDTEAM);
    REQUIRE(redTeam.size() == 5); // necro + 4 zombies
    for (size_t i = 1; i < redTeam.size(); ++i) {
        REQUIRE(redTeam[i]->getBattleSummon() == true);
        REQUIRE(redTeam[i]->hasAbility(UnitAbility::Undead) == true);
        REQUIRE(redTeam[i]->getPrintSymbol() == 'Z');
        REQUIRE(redTeam[i]->getHex() != nullptr);
    }
    REQUIRE(field.getCorpses() == 0);
    // M-23 replaced the post-cast cooldown with a casting TIME, so a finished
    // cast leaves the slot clear rather than counting down.
    REQUIRE(redTeam[0]->getCast() == 0);
    REQUIRE(redTeam[0]->isChannelling() == false);

    // The next phase starts a FRESH channel. Selection still picks the major —
    // corpses are not a gate, so chooseSpellToCast cannot see the shortage —
    // and nothing lands until that two-tick channel completes, at which point
    // the major fails and the fallback raises a skeleton instead.
    field.triggerSpecialPhase();
    REQUIRE(field.getTeam(REDTEAM).size() == 5);

    field.setCorpses(0);
    field.extractResult();
}

TEST_CASE("Necromancer falls back to the minor form when the major runs short of corpses") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));
    necroPtr->setPathLevel(SpellPath::Death, 3);

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(1);

    field.triggerSpecialPhase();
    field.triggerSpecialPhase();

    // The major wanted 4 corpses and there is 1, so it fails — and the caster
    // falls through to the MINOR form rather than wasting the channel entirely
    // (user: "try major if gate closed for any reason, try minor"). A skeleton
    // costs no corpse, so the one on the field is still there.
    REQUIRE(field.getTeam(REDTEAM).size() == 2); // necro + 1 skeleton
    REQUIRE(field.getTeam(REDTEAM)[1]->getPrintSymbol() == 'S');
    REQUIRE(field.getCorpses() == 1);

    field.setCorpses(0);
    field.extractResult();
}

// A stock Necromancer is Death 1, so this exercises raise_dead's MINOR form —
// which is exactly M-18's guarantee that a level-1 path is never a dud roll.
TEST_CASE("Necromancer with no corpses conjures one free skeleton instead") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(0);

    field.triggerSpecialPhase();

    auto& redTeam = field.getTeam(REDTEAM);
    REQUIRE(redTeam.size() == 2); // necro + 1 skeleton
    REQUIRE(redTeam[1]->getBattleSummon() == true);
    REQUIRE(redTeam[1]->hasAbility(UnitAbility::Undead) == true);
    REQUIRE(redTeam[1]->getPrintSymbol() == 'S');
    REQUIRE(field.getCorpses() == 0);
    REQUIRE(redTeam[0]->getCast() == 0);   // casting TIME, not a cooldown (M-23)

    field.extractResult();
}

// ── Spell roster tripwires (Stage R0, docs/UNITS_AS_DATA_PLAN.md) ────────────
// The roster is the single source of truth for what can be cast and by whom.
// Requirements are name-gated as a stopgap until spell paths exist (Stage R4).

TEST_CASE("spell roster: every spell id is unique and every form is well-formed") {
    std::set<std::string_view> seen;
    for (const Spell& s : Spells::roster()) {
        REQUIRE_FALSE(s.id.empty());
        REQUIRE(seen.insert(s.id).second); // duplicate id = tripwire
        REQUIRE_FALSE(s.forms.empty());
        int previousPrimary = 0;
        for (const SpellForm& f : s.forms) {
            REQUIRE(f.cast != nullptr);
            REQUIRE_FALSE(f.name.empty());
            REQUIRE(f.fatigue > 0);
            // M-23: nothing casts instantly.
            REQUIRE(f.castingTime >= 1);
            // M-14/M-20: the requirement list is ordered and its first entry is
            // the PRIMARY path, so it can never be empty.
            REQUIRE_FALSE(f.paths.empty());
            REQUIRE(f.paths.front().level >= 1);
            // Ordered HIGHEST REQUIREMENT FIRST — the primary must lead.
            for (const PathRequirement& req : f.paths)
                REQUIRE(req.level <= f.paths.front().level);
            // Forms run weakest first, which is what makes chooseSpellToCast's
            // "last one that qualifies" equal M-13's "most powerful form".
            REQUIRE(f.paths.front().level > previousPrimary);
            previousPrimary = f.paths.front().level;
        }
    }
    REQUIRE_FALSE(seen.empty());
}

TEST_CASE("spell roster: every one of the ten paths has a castable level-1 spell") {
    // M-18 calls this CORRECTNESS, not polish: paths are rolled at hire (M-5),
    // so a path with no level-1 spell makes that roll a dud and the player hires
    // a Water 2 mage who can do nothing.
    std::set<int> covered;
    for (const Spell& s : Spells::roster())
        for (const SpellForm& f : s.forms)
            if (!f.paths.empty() && f.paths.front().level == 1)
                covered.insert(static_cast<int>(f.paths.front().path));

    for (int p = 0; p < SPELL_PATH_COUNT; ++p)
        INFO("no minor spell for path " << spellPathName(static_cast<SpellPath>(p)));
    REQUIRE(covered.size() == static_cast<size_t>(SPELL_PATH_COUNT));
}

TEST_CASE("spell roster: only Low carries a price, and Low always does") {
    // M-21/M-24: Low is cheaper in fatigue and dearer in blood. A Low spell with
    // no price would be a pure discount, which is the one thing Low must not be.
    for (const Spell& s : Spells::roster())
        for (const SpellForm& f : s.forms) {
            bool lowPrimary = !f.paths.empty() && f.paths.front().path == SpellPath::Low;
            REQUIRE(lowPrimary == (f.price != nullptr));
        }
}

TEST_CASE("spell roster: Holy and Unholy carry no school gate") {
    // M-14: they are GRANTED, not researched — a Priest's Holy level alone
    // gates their blessings.
    for (const Spell& s : Spells::roster())
        for (const SpellForm& f : s.forms) {
            if (f.paths.empty()) continue;
            SpellPath primary = f.paths.front().path;
            if (primary == SpellPath::Holy || primary == SpellPath::Unholy)
                REQUIRE(f.school == SpellSchool::None);
        }
}

TEST_CASE("path and school names round-trip, and unknown names are rejected") {
    for (int p = 0; p < SPELL_PATH_COUNT; ++p) {
        SpellPath path = static_cast<SpellPath>(p);
        REQUIRE(spellPathFromName(spellPathName(path)) == path);
    }
    for (int c = 0; c < SPELL_SCHOOL_COUNT; ++c) {
        SpellSchool school = static_cast<SpellSchool>(c);
        REQUIRE(spellSchoolFromName(spellSchoolName(school)) == school);
    }
    // The JSON boundary depends on this: an unknown name is skipped, not thrown.
    REQUIRE(spellPathFromName("necromancy") == SpellPath::Count);
    REQUIRE(spellSchoolFromName("alteration") == SpellSchool::Count);
}

TEST_CASE("qualifies: paths gate the caster, not unit-type names") {
    // The exact-name gate is gone (M-18): fireball, bless and raise_dead are not
    // unique spells, they are the first three entries of a real roster. What
    // decides now is the path level on the body.
    Mage mage(REDTEAM);          // Fire 1 out of the box
    Priest priest(REDTEAM);      // Holy 1

    const Spell* fireball = nullptr;
    const Spell* bless    = nullptr;
    for (const Spell& s : Spells::roster()) {
        if (s.id == "fireball") fireball = &s;
        if (s.id == "bless")    bless    = &s;
    }
    REQUIRE(fireball != nullptr);
    REQUIRE(bless    != nullptr);

    REQUIRE(Spells::qualifies(mage,   fireball->forms[0]) == true);   // Fire 1
    REQUIRE(Spells::qualifies(mage,   fireball->forms[1]) == false);  // needs Fire 3
    REQUIRE(Spells::qualifies(mage,   bless->forms[0])    == false);  // no Holy

    // Nothing about being a "Mage" is consulted — give the Priest Fire and the
    // fire spell is his too.
    priest.setPathLevel(SpellPath::Fire, 3);
    REQUIRE(Spells::qualifies(priest, fireball->forms[1]) == true);
}

TEST_CASE("qualifies: the school gate blocks arcane spells but never Holy") {
    Battlefield& field = Utility::getBattlefield();
    Mage   mage(REDTEAM);
    Priest priest(REDTEAM);

    const Spell* fireball = nullptr;
    const Spell* bless    = nullptr;
    for (const Spell& s : Spells::roster()) {
        if (s.id == "fireball") fireball = &s;
        if (s.id == "bless")    bless    = &s;
    }

    // Defaults are open, so a Fire 1 mage casts today (slice 1 must never
    // remove magic from a battle that already has it).
    REQUIRE(Spells::qualifies(mage, fireball->forms[0]) == true);

    // M-19: the encounter can declare a lower school level, and BOTH sides pass
    // the identical gate.
    field.setSchoolLevel(REDTEAM, SpellSchool::Evocation, 0);
    REQUIRE(Spells::qualifies(mage, fireball->forms[0]) == false);

    // M-14: Holy is granted, not researched — no school level touches it.
    REQUIRE(Spells::qualifies(priest, bless->forms[0]) == true);

    field.setSchoolLevel(REDTEAM, SpellSchool::Evocation, SPELL_SCHOOL_OPEN_DEFAULT);
}

// ── castSpells() gating on AUnit ──────────────────────────────────────────────

TEST_CASE("chooseSpellToCast: takes the most powerful form the caster qualifies for") {
    Mage mage(REDTEAM);
    const Spell* picked = nullptr;

    // Fire 1 → the minor form (M-13).
    const SpellForm* form = mage.chooseSpellToCast(&picked);
    REQUIRE(form != nullptr);
    REQUIRE(picked->id == "fireball");
    REQUIRE(form->name == "minor");

    // Fire 3 → the same spell, but now the major form.
    mage.setPathLevel(SpellPath::Fire, 3);
    form = mage.chooseSpellToCast(&picked);
    REQUIRE(form != nullptr);
    REQUIRE(picked->id == "fireball");
    REQUIRE(form->name == "major");
}

TEST_CASE("chooseSpellToCast: fatigue never blocks selection") {
    // M-22, and it is deliberate: under M-2 nothing is unaffordable, so a caster
    // may cast himself into the overflow and bleed for it. The old
    // `mana >= manaCost` clause has no successor.
    Mage mage(REDTEAM);
    const Spell* picked = nullptr;
    mage.addFatigue(FATIGUE_HARD_MAX);
    REQUIRE(mage.getFatigue() == FATIGUE_HARD_MAX);
    REQUIRE(mage.chooseSpellToCast(&picked) != nullptr);
}

TEST_CASE("castSpells: a unit with no paths does nothing") {
    Soldier soldier(REDTEAM);
    REQUIRE(soldier.hasAnyPath() == false);
    soldier.castSpells(); // must be a harmless no-op without a hex or targets
    REQUIRE(soldier.getCast() == 0);
    REQUIRE(soldier.isChannelling() == false);
}

TEST_CASE("castSpells: fatigue is paid on a successful cast, never when no target exists") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);

    magePtr->setHex(field.hexGrid.getHex({5, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({2, 8}));
    AUnit* mage = magePtr.get();

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // aimed-hit roll (the ember has no splash)

    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    // M-23: fatigue POWERS the spell, so it lands when the spell goes off.
    REQUIRE(mage->getFatigue() > 0);

    field.extractResult();

    // No enemy at all: targeting fails, no mana is spent.
    auto lonerPtr = std::make_unique<Mage>(REDTEAM);
    lonerPtr->setHex(field.hexGrid.getHex({5, 8}));
    AUnit* loner = lonerPtr.get();

    Army red2;
    red2.push_back(std::move(lonerPtr));
    field.loadArmies(std::move(red2), {});

    RangedCombat::resetCache();
    field.triggerSpecialPhase();

    // No spell happened, so no fatigue: the other half of M-23's rule.
    REQUIRE(loner->getFatigue() == 0);

    field.extractResult();
}

TEST_CASE("castSpells: a broken caster does not cast") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
    Zombie* zombie = zombiePtr.get();

    magePtr->setHex(field.hexGrid.getHex({5, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({2, 8}));
    magePtr->setBroken(true);

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls(); // no dice: nothing may fire

    field.triggerSpecialPhase();

    REQUIRE(zombie->getHp() == zombie->getmaxHP());

    field.extractResult();
}

// ── The cost formula (M-10, M-20, M-21) ──────────────────────────────────────

TEST_CASE("spellFatigueCost: the divide reads the PRIMARY path and nothing else") {
    Mage mage(REDTEAM);
    SpellForm form{};
    form.name        = "test";
    form.paths       = {{SpellPath::Fire, 1}, {SpellPath::Water, 1}};
    form.school      = SpellSchool::None;
    form.schoolLevel = 0;
    form.fatigue     = 24;
    form.castingTime = 1;
    form.cast        = nullptr;
    form.price       = nullptr;

    // Fire 1 casting a Fire 1 spell: 24 / (1 - 1 + 1) + encumbrance.
    mage.setPathLevel(SpellPath::Fire, 1);
    REQUIRE(mage.spellFatigueCost(form) == 24 + mage.getFatigueCost());

    // Fire 4: 24 / (4 - 1 + 1) = 6. A path level buys a real price curve, which
    // is the whole reason M-10 rejected a flat cost.
    mage.setPathLevel(SpellPath::Fire, 4);
    REQUIRE(mage.spellFatigueCost(form) == 6 + mage.getFatigueCost());

    // M-20: a SECONDARY path never enters the arithmetic. Raising Water changes
    // nothing at all.
    mage.setPathLevel(SpellPath::Water, 9);
    REQUIRE(mage.spellFatigueCost(form) == 6 + mage.getFatigueCost());
}

TEST_CASE("spellFatigueCost: a Low-primary spell costs half") {
    Mage mage(REDTEAM);
    SpellForm form{};
    form.name        = "test";
    form.school      = SpellSchool::None;
    form.schoolLevel = 0;
    form.fatigue     = 24;
    form.castingTime = 1;
    form.cast        = nullptr;
    form.price       = nullptr;

    form.paths = {{SpellPath::Fire, 1}};
    mage.setPathLevel(SpellPath::Fire, 1);
    const int full = mage.spellFatigueCost(form);

    // M-21: the discount is the temptation; the blood is the price, and it is
    // charged separately by the form's second effect.
    form.paths = {{SpellPath::Low, 1}};
    mage.setPathLevel(SpellPath::Low, 1);
    REQUIRE(mage.spellFatigueCost(form) == (full - mage.getFatigueCost()) / 2
                                           + mage.getFatigueCost());
}

// ── Fatigue past the ceiling turns into blood (M-2) ──────────────────────────

TEST_CASE("addFatigue: fatigue clamps at twice the ceiling and the excess wounds") {
    Soldier soldier(REDTEAM);   // universal rule — not a caster
    const int startHp = soldier.getHp();

    soldier.addFatigue(FATIGUE_HARD_MAX);
    REQUIRE(soldier.getFatigue() == FATIGUE_HARD_MAX);
    REQUIRE(soldier.getHp() == startHp);          // exactly at the ceiling: no blood yet

    // Four whole points past it: one certain wound, no roll involved.
    soldier.addFatigue(FATIGUE_PER_WOUND);
    REQUIRE(soldier.getFatigue() == FATIGUE_HARD_MAX);   // clamps, never above
    REQUIRE(soldier.getHp() == startHp - 1);
}

TEST_CASE("addFatigue: at the hard ceiling a body is at fatigue level 10") {
    Soldier soldier(REDTEAM);
    soldier.addFatigue(FATIGUE_HARD_MAX);
    // M-2's own worked example: -20 defence, so an overcast mage is not asleep,
    // he is a free kill.
    REQUIRE(soldier.getFatigue() / FATIGUE_LEVEL_DIV == 10);
}

TEST_CASE("addFatigue: still floors at zero") {
    Soldier soldier(REDTEAM);
    soldier.addFatigue(10);
    soldier.addFatigue(-100);
    REQUIRE(soldier.getFatigue() == 0);
}

// ── Channelling (M-23) ───────────────────────────────────────────────────────

TEST_CASE("castSpells: a two-tick spell fires on the second phase, not the first") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));
    necroPtr->setPathLevel(SpellPath::Death, 3);   // the major, two-tick form
    AUnit* necro = necroPtr.get();

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(4);

    field.triggerSpecialPhase();
    REQUIRE(necro->isChannelling() == true);
    REQUIRE(field.getTeam(REDTEAM).size() == 1);   // nothing raised yet
    REQUIRE(necro->getFatigue() == 0);             // and nothing paid yet

    field.triggerSpecialPhase();
    REQUIRE(necro->isChannelling() == false);
    REQUIRE(field.getTeam(REDTEAM).size() == 5);
    REQUIRE(necro->getFatigue() > 0);

    field.setCorpses(0);
    field.extractResult();
}

TEST_CASE("testConcentration: a wound can break a channel, and costs nothing when it does") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));
    necroPtr->setPathLevel(SpellPath::Death, 3);
    AUnit* necro = necroPtr.get();

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(3);

    field.triggerSpecialPhase();
    REQUIRE(necro->isChannelling() == true);

    // A wound far past anything the throw can beat: focus is Death 3 * 2 = 6,
    // and the opposed dice cannot make up 500.
    REQUIRE(necro->testConcentration(500) == false);
    REQUIRE(necro->isChannelling() == false);

    // M-23 again: the spell never happened, so nothing was paid for it.
    REQUIRE(necro->getFatigue() == 0);
    REQUIRE(field.getTeam(REDTEAM).size() == 1);

    field.setCorpses(0);
    field.extractResult();
}

TEST_CASE("testConcentration: a unit that is not casting is unaffected") {
    Soldier soldier(REDTEAM);
    REQUIRE(soldier.testConcentration(500) == true);
}

// ── The army-wide banner channel pool (M-11) ─────────────────────────────────

TEST_CASE("drawChannels: the pool is army-wide, per side, and runs dry") {
    Battlefield& field = Utility::getBattlefield();
    field.setChannels(REDTEAM, 5);
    field.setChannels(BLUETEAM, 0);

    REQUIRE(field.getChannels(REDTEAM) == 5);
    REQUIRE(field.drawChannels(REDTEAM, 3) == 3);
    REQUIRE(field.getChannels(REDTEAM) == 2);
    // Asking for more than is left yields what is left, not a negative pool.
    REQUIRE(field.drawChannels(REDTEAM, 9) == 2);
    REQUIRE(field.getChannels(REDTEAM) == 0);
    REQUIRE(field.drawChannels(REDTEAM, 1) == 0);

    // Each side draws from its own pool — one army's banners never feed another.
    REQUIRE(field.drawChannels(BLUETEAM, 1) == 0);

    field.setChannels(REDTEAM, 0);
}

TEST_CASE("castSpells: channels cut the fatigue a cast actually costs") {
    Battlefield& field = Utility::getBattlefield();

    auto makeMage = [&](int channels) {
        auto magePtr   = std::make_unique<Mage>(REDTEAM);
        auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);
        magePtr->setHex(field.hexGrid.getHex({5, 8}));
        zombiePtr->setHex(field.hexGrid.getHex({2, 8}));
        AUnit* mage = magePtr.get();

        Army red, blue;
        red.push_back(std::move(magePtr));
        blue.push_back(std::move(zombiePtr));
        field.loadArmies(std::move(red), std::move(blue));
        field.setChannels(REDTEAM, channels);

        RangedCombat::resetCache();
        Utility::clearDiceRolls();
        Utility::pushDiceRoll(1);
        field.triggerSpecialPhase();
        Utility::clearDiceRolls();
        int paid = mage->getFatigue();
        field.extractResult();
        return paid;
    };

    const int unaided = makeMage(0);
    const int aided   = makeMage(5);

    REQUIRE(unaided > 0);
    // M-11: a caster draws from the pool to push past their own fatigue. The
    // draw is capped at the primary path level (Fire 1 here), so this is a
    // small, deliberate discount rather than free magic.
    REQUIRE(aided == unaided - 1);

    field.setChannels(REDTEAM, 0);
}

TEST_CASE("completeCast: the fallback pays for the form that actually fired") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));
    necroPtr->setPathLevel(SpellPath::Death, 3);
    AUnit* necro = necroPtr.get();

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(0);          // the major cannot fire at all

    field.triggerSpecialPhase();
    field.triggerSpecialPhase();

    // It fell back to the minor and raised a skeleton...
    REQUIRE(field.getTeam(REDTEAM).size() == 2);
    REQUIRE(field.getTeam(REDTEAM)[1]->getPrintSymbol() == 'S');

    // ...so it is the MINOR form's price that was charged, not the major's.
    const Spell* raise = nullptr;
    for (const Spell& s : Spells::roster())
        if (s.id == "raise_dead") raise = &s;
    REQUIRE(raise != nullptr);
    REQUIRE(necro->getFatigue() == necro->spellFatigueCost(raise->forms[0]));
    REQUIRE(necro->getFatigue() <  necro->spellFatigueCost(raise->forms[1]));

    field.extractResult();
}
