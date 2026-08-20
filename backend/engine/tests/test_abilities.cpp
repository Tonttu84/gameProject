#include "catch.hpp"
#include "Abilities.hpp"
#include "AUnit.hpp"
#include "Squad.hpp"
#include "units/Zombie.hpp"
#include "units/Skeleton.hpp"
#include "units/Soldier.hpp"

// Slice 6's ability system (docs/CAMPAIGN_PLAN.md, decisions 6-1..6-6).
//
// What these cases are really guarding is the pair of mistakes the design was
// built to make unwritable: an undead that leaves a corpse (the closure), and a
// banner's gift surviving the man walking away from the banner (membership
// scoping).

TEST_CASE("abilityClosure: Mindless implies Fearless") {
    UnitAbility set = abilityClosure(UnitAbility::Mindless);
    REQUIRE(hasAbilityFlag(set, UnitAbility::Fearless));
    REQUIRE(hasAbilityFlag(set, UnitAbility::Mindless));
}

TEST_CASE("abilityClosure: Undead implies NoCorpse") {
    UnitAbility set = abilityClosure(UnitAbility::Undead);
    REQUIRE(hasAbilityFlag(set, UnitAbility::NoCorpse));
}

TEST_CASE("abilityClosure: Undead does NOT imply Fearless") {
    // The lich/vampire case (6-4): undeath and an unbreakable mind are
    // different facts, and collapsing them would make a rattleable undead
    // unexpressible.
    UnitAbility set = abilityClosure(UnitAbility::Undead);
    REQUIRE_FALSE(hasAbilityFlag(set, UnitAbility::Fearless));
}

TEST_CASE("abilityClosure: NoCorpse alone implies nothing else") {
    // The small-summon case the user named — vanishes without being undead.
    UnitAbility set = abilityClosure(UnitAbility::NoCorpse);
    REQUIRE(hasAbilityFlag(set, UnitAbility::NoCorpse));
    REQUIRE_FALSE(hasAbilityFlag(set, UnitAbility::Undead));
    REQUIRE_FALSE(hasAbilityFlag(set, UnitAbility::Fearless));
}

TEST_CASE("abilityClosure is idempotent") {
    UnitAbility once  = abilityClosure(UnitAbility::Undead | UnitAbility::Mindless);
    UnitAbility twice = abilityClosure(once);
    REQUIRE(once == twice);
}

TEST_CASE("abilityClosure: None stays None") {
    REQUIRE(abilityClosure(UnitAbility::None) == UnitAbility::None);
}

TEST_CASE("Zombie and Skeleton declare Undead | Mindless and receive the rest") {
    Zombie z(REDTEAM);
    Skeleton s(REDTEAM);
    for (AUnit* u : {static_cast<AUnit*>(&z), static_cast<AUnit*>(&s)}) {
        REQUIRE(u->hasAbility(UnitAbility::Undead));
        REQUIRE(u->hasAbility(UnitAbility::Mindless));
        REQUIRE(u->hasAbility(UnitAbility::Fearless));  // implied
        REQUIRE(u->hasAbility(UnitAbility::NoCorpse));  // implied
    }
}

TEST_CASE("Soldier has no abilities") {
    Soldier s(BLUETEAM);
    REQUIRE(s.abilities() == UnitAbility::None);
    REQUIRE_FALSE(s.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("Fearless passes testMorale without breaking") {
    Zombie z(REDTEAM);
    REQUIRE(z.testMorale(1000) == true);   // damage that would rout anything alive
    REQUIRE_FALSE(z.getBroken());
}

TEST_CASE("a granted ability applies only while the unit is in a squad") {
    // The whole of 6-6 in one case: a banner's Fearless holds while the man
    // stands in the formation, and is gone the moment he leaves it — which is
    // exactly what Battlefield::flee() does to a man who breaks.
    Soldier s(BLUETEAM);
    Squad squad("Household", false);
    s.setGrantedAbilities(UnitAbility::Fearless);

    REQUIRE_FALSE(s.hasAbility(UnitAbility::Fearless));  // granted, but no squad

    squad.addMember(&s);
    REQUIRE(s.hasAbility(UnitAbility::Fearless));

    s.leaveSquad();
    REQUIRE_FALSE(s.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("leaving the squad cannot strip what the creature innately is") {
    // The reason the two sets are kept apart: strip a banner's Fearless from a
    // skeleton and it must still be fearless, because it is mindless.
    Skeleton bones(REDTEAM);
    Squad squad("The Barrow", false);
    bones.setGrantedAbilities(UnitAbility::Fearless);
    squad.addMember(&bones);
    bones.leaveSquad();
    REQUIRE(bones.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("a granted ability closes through the table like a declared one") {
    // Granting Mindless (nothing does today, but the closure must not care
    // where a flag came from) must bring Fearless with it.
    Soldier s(BLUETEAM);
    Squad squad("Sworn", false);
    s.setGrantedAbilities(UnitAbility::Mindless);
    squad.addMember(&s);
    REQUIRE(s.hasAbility(UnitAbility::Fearless));
}
