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
    // The Squad is declared FIRST so it outlives its members: ~Squad does not
    // clear members' back-pointers (only disband() does), so a Squad dying
    // first leaves the unit's destructor calling leaveSquad() on freed memory.
    // The same note is on test_engagements' fixtures, and ASan finds it every
    // time it is forgotten.
    Squad squad("Household");
    Soldier s(BLUETEAM);
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
    Squad squad("The Barrow");  // must outlive its members
    Skeleton bones(REDTEAM);
    bones.setGrantedAbilities(UnitAbility::Fearless);
    squad.addMember(&bones);
    bones.leaveSquad();
    REQUIRE(bones.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("a granted ability closes through the table like a declared one") {
    // Granting Mindless (nothing does today, but the closure must not care
    // where a flag came from) must bring Fearless with it.
    Squad squad("Sworn");  // must outlive its members
    Soldier s(BLUETEAM);
    s.setGrantedAbilities(UnitAbility::Mindless);
    squad.addMember(&s);
    REQUIRE(s.hasAbility(UnitAbility::Fearless));
}

// ── Suppression (slice 9a, decision 9-4) ────────────────────────────────────
//
// Items are fully general: a row may both ADD and REMOVE abilities. What keeps
// that safe is not a rule about which abilities may be denied — it is the
// ORDER. Suppression is subtracted first and abilityClosure() runs after, so a
// denial of an implied flag is representable and INERT. These cases pin the
// order, because the whole safety argument is the order.

TEST_CASE("suppression removes an ability the creature innately has") {
    Skeleton bones(REDTEAM);
    REQUIRE(bones.hasAbility(UnitAbility::Mindless));

    bones.setSuppressedAbilities(UnitAbility::Mindless);
    REQUIRE_FALSE(bones.hasAbility(UnitAbility::Mindless));
}

TEST_CASE("suppression removes a granted ability too") {
    // A cursed helm beats the banner overhead — the subtraction happens after
    // the grant is folded in, not only against what the creature innately is.
    Squad squad("Household");  // must outlive its members
    Soldier s(BLUETEAM);
    s.setGrantedAbilities(UnitAbility::Fearless);
    squad.addMember(&s);
    REQUIRE(s.hasAbility(UnitAbility::Fearless));

    s.setSuppressedAbilities(UnitAbility::Fearless);
    REQUIRE_FALSE(s.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("denying an IMPLIED ability is legal to write and does nothing") {
    // The case 9-4 exists for. Undead => NoCorpse is in the implication table,
    // so an item denying NoCorpse on a skeleton is authorable — and inert,
    // because the closure runs afterwards and puts it straight back.
    //
    // This is what makes 6-3's invariant survive a fully general item system:
    // an undead that leaves a corpse stays UNWRITABLE, and no eligibility rule
    // anywhere had to enumerate which flags are implied.
    Skeleton bones(REDTEAM);
    REQUIRE(bones.hasAbility(UnitAbility::NoCorpse));

    bones.setSuppressedAbilities(UnitAbility::NoCorpse);
    REQUIRE(bones.hasAbility(UnitAbility::NoCorpse));
}

TEST_CASE("suppressing the SOURCE of an implication removes the implied flag") {
    // The other side of the same coin, and the reason denial is not simply
    // ignored: deny Mindless on a skeleton and its Fearless goes with it,
    // because Fearless was only ever there by implication. Its NoCorpse stays —
    // that one is implied by Undead, which nothing denied.
    Skeleton bones(REDTEAM);
    REQUIRE(bones.hasAbility(UnitAbility::Fearless));

    bones.setSuppressedAbilities(UnitAbility::Mindless);
    REQUIRE_FALSE(bones.hasAbility(UnitAbility::Fearless));
    REQUIRE(bones.hasAbility(UnitAbility::NoCorpse));
}

TEST_CASE("suppression is NOT scoped to squad membership, unlike a grant") {
    // A banner is flown over a formation and stops covering a man who leaves
    // it (6-6). Gear is worn on the body: a man who breaks and runs takes his
    // cursed helm with him.
    Squad squad("The Barrow");  // must outlive its members
    Skeleton bones(REDTEAM);
    squad.addMember(&bones);
    bones.setSuppressedAbilities(UnitAbility::Mindless);
    REQUIRE_FALSE(bones.hasAbility(UnitAbility::Fearless));

    bones.leaveSquad();
    REQUIRE_FALSE(bones.hasAbility(UnitAbility::Fearless));
}

TEST_CASE("suppressing nothing changes nothing") {
    Skeleton bones(REDTEAM);
    bones.setSuppressedAbilities(UnitAbility::None);
    REQUIRE(bones.hasAbility(UnitAbility::Mindless));
    REQUIRE(bones.hasAbility(UnitAbility::Undead));
    REQUIRE(bones.hasAbility(UnitAbility::Fearless));
    REQUIRE(bones.hasAbility(UnitAbility::NoCorpse));
}

TEST_CASE("a suppressed Fearless actually breaks under fire") {
    // Behaviour, not bookkeeping: testMorale() short-circuits on Fearless, so
    // stripping it has to reach the morale roll. Damage far above any morale
    // score makes the outcome deterministic.
    Skeleton bones(REDTEAM);
    bones.setSuppressedAbilities(UnitAbility::Mindless);
    REQUIRE_FALSE(bones.testMorale(1000));
    REQUIRE(bones.getBroken());
}

TEST_CASE("withoutAbilities: subtracts only the named flags") {
    constexpr UnitAbility both = UnitAbility::Undead | UnitAbility::Mindless;
    STATIC_REQUIRE(withoutAbilities(both, UnitAbility::Mindless) == UnitAbility::Undead);
    STATIC_REQUIRE(withoutAbilities(both, UnitAbility::None) == both);
    STATIC_REQUIRE(withoutAbilities(both, both) == UnitAbility::None);
    // Subtracting a flag that was never there is a no-op, not an inversion.
    STATIC_REQUIRE(withoutAbilities(UnitAbility::Undead, UnitAbility::Fearless)
                   == UnitAbility::Undead);
}
