#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Mage.hpp"
#include "units/Necromancer.hpp"
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

TEST_CASE("Mage fireball hits an in-range enemy for FIREBALL_CENTRE damage") {
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

    REQUIRE(zombie->getHp() == zombie->getmaxHP());

    RangedCombat::resetCache(); // tick() normally does this before the phase
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // aimed-hit roll succeeds
    for (int i = 0; i < FIREBALL_SECONDARY; ++i)
        Utility::pushDiceRoll(640); // splash finds only empty ground

    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    REQUIRE(zombie->getHp() == zombie->getmaxHP() - FIREBALL_CENTRE);
    REQUIRE(zombie->getAlive() == true);

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

TEST_CASE("Necromancer with 3 corpses raises 3 zombie battle-summons and sets cooldown") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(3);

    field.triggerSpecialPhase();

    auto& redTeam = field.getTeam(REDTEAM);
    REQUIRE(redTeam.size() == 4); // necro + 3 zombies
    for (size_t i = 1; i < redTeam.size(); ++i) {
        REQUIRE(redTeam[i]->getBattleSummon() == true);
        REQUIRE(redTeam[i]->hasAbility(UnitAbility::Undead) == true);
        REQUIRE(redTeam[i]->getPrintSymbol() == 'Z');
        REQUIRE(redTeam[i]->getHex() != nullptr);
    }
    REQUIRE(field.getCorpses() == 0);
    REQUIRE(redTeam[0]->getCast() == 6);

    // Next phase: cooldown ticks down, nothing new is raised.
    field.triggerSpecialPhase();
    REQUIRE(field.getTeam(REDTEAM).size() == 4);
    REQUIRE(field.getTeam(REDTEAM)[0]->getCast() == 5);

    field.setCorpses(0);
    field.extractResult();
}

TEST_CASE("Necromancer with 1 corpse raises a single zombie and consumes it") {
    Battlefield& field = Utility::getBattlefield();

    auto necroPtr = std::make_unique<Necromancer>(REDTEAM);
    necroPtr->setHex(field.hexGrid.getHex({5, 8}));

    Army red;
    red.push_back(std::move(necroPtr));
    field.loadArmies(std::move(red), {});
    field.setCorpses(1);

    field.triggerSpecialPhase();

    REQUIRE(field.getTeam(REDTEAM).size() == 2); // necro + 1 zombie
    REQUIRE(field.getTeam(REDTEAM)[1]->getPrintSymbol() == 'Z');
    REQUIRE(field.getCorpses() == 0);

    field.setCorpses(0);
    field.extractResult();
}

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
    REQUIRE(redTeam[0]->getCast() == 6);

    field.extractResult();
}

// ── Spell roster tripwires (Stage R0, docs/UNITS_AS_DATA_PLAN.md) ────────────
// The roster is the single source of truth for what can be cast and by whom.
// Requirements are name-gated as a stopgap until spell paths exist (Stage R4).

TEST_CASE("spell roster: every spell id is unique and non-empty") {
    std::set<std::string_view> seen;
    for (const Spell& s : Spells::roster()) {
        REQUIRE_FALSE(s.id.empty());
        REQUIRE(seen.insert(s.id).second); // duplicate id = tripwire
        REQUIRE(s.cast != nullptr);
        REQUIRE(s.manaCost > 0);
        REQUIRE(s.cooldown >= 0);
    }
    REQUIRE_FALSE(seen.empty());
}

TEST_CASE("spell roster: name-gated spells resolve to exactly their caster type") {
    auto ids = [](std::vector<const Spell*> spells) {
        std::vector<std::string_view> out;
        for (const Spell* s : spells) out.push_back(s->id);
        return out;
    };

    REQUIRE(ids(Spells::forUnitType("Mage"))        == std::vector<std::string_view>{"fireball"});
    REQUIRE(ids(Spells::forUnitType("Priest"))      == std::vector<std::string_view>{"bless"});
    REQUIRE(ids(Spells::forUnitType("Necromancer")) == std::vector<std::string_view>{"raise_dead"});
    REQUIRE(Spells::forUnitType("Soldier").empty());
    REQUIRE(Spells::forUnitType("NoSuchUnit").empty());
}

TEST_CASE("spell roster: every catalog unit type knows at most one spell (current design rule)") {
    // Deliberate simplification: until casters have spell paths and a real
    // cast-selection algorithm (Stage R4), each spellcaster type carries
    // exactly one spell. Remove this tripwire when multi-spell casters land.
    for (const UnitCatalogEntry& entry : unitCatalog())
        REQUIRE(Spells::forUnitType(entry.typeName).size() <= 1);
}

// ── castSpells() gating on AUnit ──────────────────────────────────────────────

TEST_CASE("chooseSpellToCast: picks the caster's spell when affordable, nullptr when not") {
    Mage mage(REDTEAM);

    REQUIRE(mage.chooseSpellToCast() != nullptr);
    REQUIRE(mage.chooseSpellToCast()->id == "fireball");

    mage.setMana(0);
    REQUIRE(mage.chooseSpellToCast() == nullptr);
}

TEST_CASE("castSpells: a unit with no spells does nothing") {
    Soldier soldier(REDTEAM);
    REQUIRE(soldier.chooseSpellToCast() == nullptr);
    soldier.castSpells(); // must be a harmless no-op without a hex or targets
    REQUIRE(soldier.getCast() == 0);
}

TEST_CASE("castSpells: mana is spent on a successful cast, kept when no target exists") {
    Battlefield& field = Utility::getBattlefield();

    auto magePtr   = std::make_unique<Mage>(REDTEAM);
    auto zombiePtr = std::make_unique<Zombie>(BLUETEAM);

    magePtr->setHex(field.hexGrid.getHex({5, 8}));
    zombiePtr->setHex(field.hexGrid.getHex({2, 8}));
    magePtr->setMana(2);
    AUnit* mage = magePtr.get();

    Army red, blue;
    red.push_back(std::move(magePtr));
    blue.push_back(std::move(zombiePtr));
    field.loadArmies(std::move(red), std::move(blue));

    RangedCombat::resetCache();
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1);   // aimed-hit roll
    for (int i = 0; i < FIREBALL_SECONDARY; ++i)
        Utility::pushDiceRoll(640);

    field.triggerSpecialPhase();
    Utility::clearDiceRolls();

    REQUIRE(mage->getMana() == 1); // one cast, one mana

    field.extractResult();

    // No enemy at all: targeting fails, no mana is spent.
    auto lonerPtr = std::make_unique<Mage>(REDTEAM);
    lonerPtr->setHex(field.hexGrid.getHex({5, 8}));
    lonerPtr->setMana(2);
    AUnit* loner = lonerPtr.get();

    Army red2;
    red2.push_back(std::move(lonerPtr));
    field.loadArmies(std::move(red2), {});

    RangedCombat::resetCache();
    field.triggerSpecialPhase();

    REQUIRE(loner->getMana() == 2);

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
