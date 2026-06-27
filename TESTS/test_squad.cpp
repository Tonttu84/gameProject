#include "catch.hpp"

#include "../HDRS/Squad.hpp"
#include "../HDRS/Wing.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Zombie.hpp"
#include "../HDRS/Utility.hpp"


// ── Squad: membership ─────────────────────────────────────────────────────────

TEST_CASE("addMember sets squad back-pointer on unit") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    REQUIRE(s.getSquad() == &sq);
}

TEST_CASE("addMember is visible via hasMember") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    REQUIRE(sq.hasMember(&s) == true);
}

TEST_CASE("hasMember returns false for unit not in squad") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    REQUIRE(sq.hasMember(&s) == false);
}

TEST_CASE("removeMember clears squad back-pointer on unit") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    sq.removeMember(&s);
    REQUIRE(s.getSquad() == nullptr);
    REQUIRE(sq.hasMember(&s) == false);
}

TEST_CASE("disband clears back-pointers on all members") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM), c(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    sq.addMember(&c);
    sq.disband();
    REQUIRE(a.getSquad() == nullptr);
    REQUIRE(b.getSquad() == nullptr);
    REQUIRE(c.getSquad() == nullptr);
    REQUIRE(sq.getMembers().empty());
}

TEST_CASE("aliveCount counts only alive members") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    b.setAlive(false);
    REQUIRE(sq.aliveCount() == 1);
}

TEST_CASE("setAlive(false) eagerly removes unit from squad") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    b.setAlive(false);
    REQUIRE(sq.totalCount() == 1);
    REQUIRE(b.getSquad() == nullptr);
}

TEST_CASE("pruneDeadMembers removes dead unit and clears its back-pointer") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    b.setAlive(false);
    sq.pruneDeadMembers();
    REQUIRE(sq.totalCount() == 1);
    REQUIRE(b.getSquad() == nullptr);
    REQUIRE(sq.hasMember(&a) == true);
}

TEST_CASE("pruneDeadMembers clears _leader pointer when leader dies") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    sq.setLeader(&a);
    a.setAlive(false);
    sq.pruneDeadMembers();
    REQUIRE(sq.getLeader() == nullptr);
    REQUIRE(sq.hasLeader() == false);
}


// ── Squad: leadership ─────────────────────────────────────────────────────────

TEST_CASE("hasLeader returns true when leader is alive") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    sq.setLeader(&s);
    REQUIRE(sq.hasLeader() == true);
}

TEST_CASE("hasLeader returns false when leader is dead") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    sq.setLeader(&s);
    s.setAlive(false);
    REQUIRE(sq.hasLeader() == false);
}

TEST_CASE("hasLeader returns false when no leader set") {
    Squad sq("Alpha", true);
    REQUIRE(sq.hasLeader() == false);
}


// ── Squad: flag bearer ────────────────────────────────────────────────────────

TEST_CASE("setFlagBearer round-trip") {
    Squad sq("Alpha", true);
    Soldier s(REDTEAM);
    sq.addMember(&s);
    sq.setFlagBearer(&s);
    REQUIRE(sq.getFlagBearer() == &s);
}

TEST_CASE("onFlagBearerDeath assigns a new alive non-broken bearer") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    sq.setFlagBearer(&a);
    a.setAlive(false);
    AUnit* newBearer = sq.onFlagBearerDeath();
    REQUIRE(newBearer == &b);
    REQUIRE(sq.getFlagBearer() == &b);
}

TEST_CASE("onFlagBearerDeath returns nullptr when no eligible member exists") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM);
    sq.addMember(&a);
    sq.setFlagBearer(&a);
    a.setAlive(false);
    AUnit* newBearer = sq.onFlagBearerDeath();
    REQUIRE(newBearer == nullptr);
    REQUIRE(sq.getFlagBearer() == nullptr);
}

TEST_CASE("onFlagBearerDeath skips broken members") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM), c(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    sq.addMember(&c);
    sq.setFlagBearer(&a);
    a.setAlive(false);
    b.setBroken(true);
    AUnit* newBearer = sq.onFlagBearerDeath();
    REQUIRE(newBearer == &c);
}


// ── Squad: collective morale ──────────────────────────────────────────────────

TEST_CASE("moraleModifier returns 0 for Normal state") {
    Squad sq("Alpha", true);
    REQUIRE(sq.getMoraleState() == MoraleState::Normal);
    REQUIRE(sq.moraleModifier() == 0);
}

TEST_CASE("moraleModifier returns +1 for Confident state") {
    Squad sq("Alpha", true);
    sq.improveMorale();
    REQUIRE(sq.getMoraleState() == MoraleState::Confident);
    REQUIRE(sq.moraleModifier() == 1);
}

TEST_CASE("moraleModifier returns -2 for Scared state") {
    Squad sq("Alpha", true);
    sq.degradeMorale();
    REQUIRE(sq.getMoraleState() == MoraleState::Scared);
    REQUIRE(sq.moraleModifier() == -2);
}

TEST_CASE("degradeMorale steps through states in order") {
    Squad sq("Alpha", true);
    REQUIRE(sq.getMoraleState() == MoraleState::Normal);
    sq.degradeMorale();
    REQUIRE(sq.getMoraleState() == MoraleState::Scared);
    sq.degradeMorale();
    REQUIRE(sq.getMoraleState() == MoraleState::Broken);
}

TEST_CASE("degradeMorale does nothing when already Broken") {
    Squad sq("Alpha", true);
    sq.degradeMorale(); sq.degradeMorale(); // Normal→Scared→Broken
    sq.degradeMorale(); // no-op
    REQUIRE(sq.getMoraleState() == MoraleState::Broken);
}

TEST_CASE("improveMorale steps up through states") {
    Squad sq("Alpha", true);
    sq.degradeMorale(); // Normal→Scared
    sq.improveMorale(); // Scared→Normal
    REQUIRE(sq.getMoraleState() == MoraleState::Normal);
    sq.improveMorale(); // Normal→Confident
    REQUIRE(sq.getMoraleState() == MoraleState::Confident);
}

TEST_CASE("improveMorale does nothing when already Confident") {
    Squad sq("Alpha", true);
    sq.improveMorale(); // Normal→Confident
    sq.improveMorale(); // no-op
    REQUIRE(sq.getMoraleState() == MoraleState::Confident);
}

TEST_CASE("updateMoraleState initialises peak on first call without testing") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM), c(REDTEAM), d(REDTEAM);
    sq.addMember(&a); sq.addMember(&b); sq.addMember(&c); sq.addMember(&d);
    sq.updateMoraleState(); // first call — sets peak, no test
    REQUIRE(sq.getMoraleState() == MoraleState::Normal);
}

TEST_CASE("updateMoraleState degrades on forced-fail casualty test (mock dice)") {
    // Threshold: 25% of peak dead since last test → test fires.
    // Push dice so throwDice() < throwDice() → degrade.
    // dice sequence: first call=1(roll)+1(check), second call=5(roll)+1(check)
    // 1 < 5 → degrade.
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM), c(REDTEAM), d(REDTEAM);
    sq.addMember(&a); sq.addMember(&b); sq.addMember(&c); sq.addMember(&d);
    sq.updateMoraleState(); // init peak=4, lastTestedAlive=4

    // Kill one (25% of 4)
    d.setAlive(false);
    sq.pruneDeadMembers(); // alive=3

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // throwDice()=1
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1); // throwDice()=5  →  1 < 5 → degrade
    sq.updateMoraleState();
    Utility::clearDiceRolls();

    REQUIRE(sq.getMoraleState() == MoraleState::Scared);
}

TEST_CASE("updateMoraleState does not test again without further casualties") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM), c(REDTEAM), d(REDTEAM);
    sq.addMember(&a); sq.addMember(&b); sq.addMember(&c); sq.addMember(&d);
    sq.updateMoraleState(); // init

    d.setAlive(false);
    sq.pruneDeadMembers();

    // First call — may or may not degrade (dice not mocked; doesn't matter here)
    Utility::clearDiceRolls();
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1); // 5 > 1 → pass
    sq.updateMoraleState();
    MoraleState after = sq.getMoraleState();
    Utility::clearDiceRolls();

    // Second call with same alive count — no new test should fire
    sq.updateMoraleState(); // no dice needed — should not consume any
    REQUIRE(sq.getMoraleState() == after); // unchanged
}


// ── Squad: movement helpers ───────────────────────────────────────────────────

TEST_CASE("totalSizePoints sums alive members only") {
    Squad sq("Alpha", true);
    Soldier a(REDTEAM), b(REDTEAM);
    sq.addMember(&a);
    sq.addMember(&b);
    b.setAlive(false);
    REQUIRE(sq.totalSizePoints() == a.getSize());
}


// ── Squad: prestige ───────────────────────────────────────────────────────────

TEST_CASE("prestige starts at zero") {
    Squad sq("Alpha", true);
    REQUIRE(sq.getPrestige() == 0);
}

TEST_CASE("addPrestige accumulates") {
    Squad sq("Alpha", true);
    sq.addPrestige(10);
    sq.addPrestige(5);
    REQUIRE(sq.getPrestige() == 15);
}


// ── Wing: squad management ────────────────────────────────────────────────────

TEST_CASE("addSquad sets wing back-pointer on squad") {
    Wing w("Left");
    Squad sq("Alpha", true);
    w.addSquad(&sq);
    REQUIRE(sq.getWing() == &w);
    REQUIRE(w.getSquads().size() == 1);
}

TEST_CASE("removeSquad clears wing back-pointer") {
    Wing w("Left");
    Squad sq("Alpha", true);
    w.addSquad(&sq);
    w.removeSquad(&sq);
    REQUIRE(sq.getWing() == nullptr);
    REQUIRE(w.getSquads().empty());
}

TEST_CASE("Wing::disband clears back-pointers on all squads") {
    Wing w("Left");
    Squad a("Alpha", true), b("Beta", false);
    w.addSquad(&a);
    w.addSquad(&b);
    w.disband();
    REQUIRE(a.getWing() == nullptr);
    REQUIRE(b.getWing() == nullptr);
    REQUIRE(w.getSquads().empty());
}

TEST_CASE("Wing getName returns the name given at construction") {
    Wing w("Right Flank");
    REQUIRE(w.getName() == "Right Flank");
}
