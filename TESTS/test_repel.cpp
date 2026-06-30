#include "catch.hpp"
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Human.hpp"
#include "../HDRS/units/Cavalry.hpp"
#include "../HDRS/units/Warhorse.hpp"
#include "../HDRS/units/Scorpion.hpp"
#include "../HDRS/Utility.hpp"
#include "../HDRS/Defines.hpp"

// ── Repel — resolveRepel() unit tests ────────────────────────────────────────
//
// Most of these call AUnit::resolveRepel() directly rather than going through
// the full battle()/MeleeCombat::engage() pipeline (the "battle(): repel
// counter-hit..." test further down is the one full-pipeline exception).
// resolveRepel() only needs originalTarget->getHex() to be non-null — it
// doesn't need a real engagement set up via resolveEngagements() — so a
// hand-built HexSide with engagedSide set directly is enough to isolate the
// cascade/malus mechanics from the seating algorithm tested in
// test_engagements.cpp.
//
// Stats used throughout:
//   Soldier:            attackPWR=11, defence=12, strength=10, shield=4, reach=1 (SwordAndShield)
//   Human(_, Spear):     attackPWR=10, defence=11, strength=10, shield=0, reach=3 (Spear: dmg7, strDiv2)
//   Human(_, Halberd):   attackPWR=10, defence=11, strength=10, shield=0, reach=2
//   Cavalry rider (Soldier): as above
//   Cavalry mount (Warhorse): attackPWR=9,  reach=0 (Hoof)
//   Cavalry mount (Scorpion): attackPWR=8,  reach=3 (Stinger: dmg5, strDiv3)
// All units here are loners (no squad) so cohesionStatBonus()/cohesionDmgBonus()
// are always 0, and none have an engagedSide pointing at a real Hex pair, so
// computeMeleeAttackBonus() always resolves to 0 too — every roll below is
// just attackPWR - fatigue + hitBonus + reach + throwDice() [- repelMalus].

static Hex* repelHex(Battlefield& bf)
{
    Hex* hex = bf.hexGrid.getHex({1, 14});
    REQUIRE(hex != nullptr);
    return hex;
}

TEST_CASE("resolveRepel: defender with longer weapon wins, attacker fails morale, attack is aborted") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);
    Human   defender(BLUETEAM, MeleeWeapons::Spear);
    defender.setHex(hex);
    defender.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // attackerRoll = 11 - 0 + 0(hitBonus) + 1(reach) + 1 = 13
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // defenderRoll = 10 - 0 + 0(bonus) + 3(reach) + 6 - 0(malus) = 19  -> wonBy = 6
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10 + 0 + 1 - 6 = 5, 5 > 6 is false -> FAILS
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == true);
    CHECK(attacker.getBroken() == true);
    CHECK(defender.getRepelMalus() == 1);
    CHECK(defender.getAlive() == true);
    CHECK(defender.getHp() == 10); // untouched — the attack never landed
}

TEST_CASE("resolveRepel: an opponent with shorter or equal reach never repels") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    Soldier attacker(REDTEAM);
    Soldier defender(BLUETEAM); // same reach (1) as the attacker — never qualifies
    defender.setHex(hex);

    Utility::clearDiceRolls(); // deliberately push nothing — repel must not throw any dice

    bool blocked = false;
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);

    CHECK(blocked == false);
    CHECK(defender.getRepelMalus() == 0); // never even attempted
    CHECK(defender.getAlive() == true);
    CHECK(defender.getHp() == 10);
}

TEST_CASE("resolveRepel: cascades to a second defender on the same side once the first loses") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);
    Human def1(BLUETEAM, MeleeWeapons::Spear);   // reach 3
    Human def2(BLUETEAM, MeleeWeapons::Halberd); // reach 2
    def1.setHex(hex); def1.setEngagedSide(&side);
    def2.setHex(hex); def2.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // def1: attackerRoll = 11+0+1+6 = 18, def1Roll = 10+0+3+1-0 = 14 -> attacker wins
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // def2: attackerRoll = 11+0+1+6 = 18, def2Roll = 10+0+2+1-0 = 13 -> attacker wins again
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&def1, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == false); // attacker won both rounds — attack proceeds normally
    CHECK(def1.getRepelMalus() == 1); // the original target always gets first try
    CHECK(def2.getRepelMalus() == 1); // pulled into the cascade once def1 lost
}

TEST_CASE("resolveRepel: a defender who already attempted this turn is not pulled into another cascade") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);
    Human def1(BLUETEAM, MeleeWeapons::Spear);
    Human def2(BLUETEAM, MeleeWeapons::Spear);

    // Pre-spend def2's repel attempt this turn (as the primary target of some other
    // attack) on an isolated hex/side first, so this setup roll can't itself cascade
    // onto def1 — def1 isn't placed anywhere yet.
    Hex* setupHex = bf.hexGrid.getHex(bf.hexGrid.neighbors({1, 14})[0]);
    REQUIRE(setupHex != nullptr);
    HexSide setupSide;
    def2.setHex(setupHex); def2.setEngagedSide(&setupSide);

    Utility::clearDiceRolls();
    // attackerRoll = 11+0+0+6 = 17, def2Roll = 10+0+3+1-0 = 14 -> attacker wins.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    bool setupBlocked = false;
    attacker.resolveRepel(&def2, setupBlocked, /*attackerHitBonus*/0, /*attackerReach*/0);
    REQUIRE(def2.getRepelMalus() == 1);

    // Now move def2 onto def1's hex/side and attack def1; def2 already has a malus
    // this turn, so it must NOT be offered as a cascade backup.
    def1.setHex(hex); def1.setEngagedSide(&side);
    def2.setHex(hex); def2.setEngagedSide(&side);
    // def1: attackerRoll = 11+0+1+6 = 18, def1Roll = 10+0+3+1-0 = 14 -> attacker wins,
    // no other eligible candidate remains -> attack proceeds normally.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&def1, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == false);
    CHECK(def1.getRepelMalus() == 1);
    CHECK(def2.getRepelMalus() == 1); // unchanged — excluded from def1's cascade
}

TEST_CASE("resolveRepel: a defender with several weapons repels with whichever has the longest reach") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    Soldier attacker(REDTEAM);
    Soldier defender(BLUETEAM); // SwordAndShield (reach 1)...
    defender.addWeapon(MeleeWeapons::Spear); // ...plus a Spear (reach 3) — only the Spear should qualify
    defender.setHex(hex);

    Utility::clearDiceRolls();
    // attackerReach=2 sits strictly between SwordAndShield(1) and Spear(3): the
    // SwordAndShield could never qualify here, so any repel attempt at all proves
    // the longest weapon (Spear) was the one actually used.
    // attackerRoll = 11+0+2+1 = 14, defenderRoll = 11(Soldier's own attackPWR)+0+3+6-0 = 20 -> wonBy=6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10+0+6-1=15 > 6 -> PASSES
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // counter-hit defend(): defenceroll, d1, d2 — resultDMG = (7+10/2+0) + 6 - 1 = 17, capped to 1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    int hpBefore = attacker.getHp();
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/2);
    Utility::clearDiceRolls();

    CHECK(defender.getRepelMalus() == 1); // qualified at all -> must have used the Spear, not the sword
    CHECK(blocked == false); // attacker passed morale, so its own attack still proceeds
    CHECK(attacker.getHp() == hpBefore - 1); // capped counter-hit landed
}

// ── counter-hit ArmorPen: the defending weapon's own pen, not a hardcoded Normal ─
//
// Same setup in both tests except the defending weapon's pen: a fat shield
// (set manually to 10) is large enough to fully absorb a Normal-pen counter
// (shieldProt = SHIELDREDUCTION(5) + 10*2 = 25 > resultDMG(13) -> 0 damage),
// but a Bypass ("magical") counter skips the physical-shield check entirely
// and still lands its capped 1 point — proving the counter's pen is read from
// the weapon, so an attacker only vulnerable to magical damage can still be
// hurt by a magical repel.

TEST_CASE("resolveRepel: a Normal-pen counter-hit can be fully absorbed by the attacker's shield") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    Soldier attacker(REDTEAM);
    attacker.setShield(10);
    Weapon mundaneSpear{"Mundane Spear", 1, 5, 1, 3, 0, 3}; // reach 3, pen defaults to Normal
    Human defender(BLUETEAM, mundaneSpear);
    defender.setHex(hex);

    Utility::clearDiceRolls();
    // attackerRoll = 11+0+0+1+1 = 13, defenderRoll = 10+0+0+3+6-0 = 19 -> wonBy = 6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10+0+6-1=15 > 6 -> PASSES
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // counter defend(): defenceroll=1 (12+1=13 < 19, hits), d1=6,d2=1 -> resultDMG=8+6-1=13,
    // shield absorbs it entirely: 13 - (5+10*2) = -12 -> 0 damage, no shield degradation either.
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(attacker.getHp() == 10); // shield fully absorbed the counter
    CHECK(attacker.getShield() == 10); // resultDMG never went positive, so the shield didn't even take a hit
    CHECK(blocked == false);
}

TEST_CASE("resolveRepel: a Bypass (\"magical\") counter-hit ignores the attacker's shield entirely") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    Soldier attacker(REDTEAM);
    attacker.setShield(10);
    Weapon magicSpear{"Magic Spear", 1, 5, 1, 3, 0, 3, ArmorPen::Bypass}; // identical stats, Bypass pen
    Human defender(BLUETEAM, magicSpear);
    defender.setHex(hex);

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(attacker.getHp() == 9); // the shield never even gets consulted for a Bypass counter
    CHECK(attacker.getShield() == 10);
    CHECK(blocked == false);
}

// ── battle()/MeleeCombat::engage() full-pipeline integration ────────────────

TEST_CASE("battle(): repel counter-hit is capped at 1, skips morale, and does not add defence malus, "
          "then the original attack still resolves") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex({1, 14});
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors({1, 14})[0]);
    REQUIRE(enHex != nullptr);

    Soldier attacker(REDTEAM);
    attacker.setHex(redHex);
    Human defender(BLUETEAM, MeleeWeapons::Spear);
    defender.setHex(enHex);

    bf.resolveEngagements();
    REQUIRE(attacker.getEngagedSide() != nullptr);
    REQUIRE(defender.getEngagedSide() == attacker.getEngagedSide());

    Utility::clearDiceRolls();
    // hitResult (MeleeCombat::engage, before onAttack fires) = 11+0+0(attackBonus)+6 = 17
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // repel: attackerRoll = 11+0+0+1+1 = 13, defenderRoll = 10+0+0+3+6-0 = 19 -> wonBy=6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10+0+6-1=15 > 6 -> PASSES, no break
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // counter-hit defend(AttackAttempt=19, damage=12, reach=3, repelCounter=true) on attacker:
    // defenceroll=1 (12+1=13 < 19, hits), d1=6,d2=1 -> resultDMG=12+6-1=17, capped to 1
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // original attack lands on defender: defend(AttackAttempt=17, damage=8, reach=1):
    // defenceroll=1 (11+1=12 < 17, hits), d1=6,d2=1 -> resultDMG=8+6-1=13 -> lethal
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // defender's own testMorale(13) (this is a normal hit, not a repel counter): 10+6-1=15 > 13 -> passes,
    // but the unit still dies from the raw hp loss regardless.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    attacker.battle(bf);
    Utility::clearDiceRolls();

    // The counter-hit landed and was capped at exactly 1, never the uncapped 17.
    CHECK(attacker.getHp() == 9);
    CHECK(attacker.getAlive() == true);
    // Morale held — no break from the counter (a morale check already happened to allow it).
    CHECK(attacker.getBroken() == false);
    // The "hard to detect" bug this guards against: a repel counter-hit must NOT
    // go through MeleeCombat::engage()/incrementAttacksReceived(), or every
    // repelled attacker would quietly get easier to hit by everyone else this turn.
    CHECK(attacker.getAttacksReceivedThisTurn() == 0);
    CHECK(defender.getRepelMalus() == 1);
    // The attacker's own attack still went through afterward, at full (uncapped) force.
    CHECK(defender.getAlive() == false);
    CHECK(defender.getHp() == -3);
}

// ── MountedUnit defenders: rider and mount each get one independent attempt ─

TEST_CASE("resolveRepel: MountedUnit defender — only the rider repels when the mount's weapon is too short") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Warhorse>(BLUETEAM); // Hoof, reach 0
    Warhorse* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // rider: attackerRoll = 11+0+0+6 = 17, riderRoll = 11+0+1+1-0 = 13 -> attacker wins
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // mount's Hoof (reach 0) is never strictly greater than attackerReach (0) — no dice for it.

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/0);
    Utility::clearDiceRolls();

    CHECK(blocked == false);
    CHECK(rider->getRepelMalus() == 1);
    CHECK(mount->getRepelMalus() == 0); // too short to even try
}

TEST_CASE("resolveRepel: MountedUnit defender — a long-reached mount (Scorpion) repels even when the rider can't") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM); // Stinger, reach 3
    Scorpion* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // attackerReach=1 ties the rider's own SwordAndShield (reach 1) — rider never qualifies,
    // no dice for it. Only the Scorpion's Stinger (reach 3) is strictly longer.
    // attackerRoll = 11+(-4)+1+1 = 9, mountRoll = 8+0+3+6-0 = 17 -> wonBy = 8
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(8) on attacker: 10+0+1-6=5, 5 > 8 is false -> FAILS
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);

    bool blocked = false;
    // attackerHitBonus=-4 here is just a deliberately chosen test parameter (resolveRepel takes
    // it directly rather than recomputing computeMeleeAttackBonus()) to keep the morale-fail
    // arithmetic simple given the Scorpion's lower attackPWR than the Spear/Halberd cases above.
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/-4, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == true);
    CHECK(attacker.getBroken() == true);
    CHECK(rider->getRepelMalus() == 0);  // excluded by reach — never attempted
    CHECK(mount->getRepelMalus() == 1);  // the stinger is what actually repelled
}

TEST_CASE("resolveRepel: MountedUnit defender — once the rider wins, the mount never gets a turn") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM); // would also qualify at reach 3
    Scorpion* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // Both rider (reach 1) and mount (reach 3) would qualify against attackerReach=0,
    // but the rider is tried first and wins outright, so the cycle stops there.
    // attackerRoll = 11+0+0+1 = 12, riderRoll = 11+0+1+6-0 = 18 -> wonBy = 6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10+0+1-6=5, 5 > 6 is false -> FAILS
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/0);
    Utility::clearDiceRolls();

    CHECK(blocked == true);
    CHECK(rider->getRepelMalus() == 1);
    CHECK(mount->getRepelMalus() == 0); // never reached — the rider already decided the outcome
}

// ── a weapon's special effects must never fire from a repel counter-hit ─────

TEST_CASE("resolveRepel: a counter-hit from a weapon with Lifedrain + MagicalChip triggers neither effect") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    // Recycles both existing effects on one weapon — the strongest single proof
    // that resolveRepel()'s counter-hit (a direct defend() call, never
    // MeleeCombat::engage()) cannot trigger onAttack/onDamage at all, regardless
    // of what the defending weapon is enchanted with.
    Weapon magicalSpear{"Magical Spear", 1, 7, 2, 2, 0, 3,
                         ArmorPen::Normal, WeaponEffect::Lifedrain | WeaponEffect::MagicalChip};
    Soldier attacker(REDTEAM);
    Human defender(BLUETEAM, magicalSpear);

    Utility::clearDiceRolls();
    // Pre-damage the defender so an erroneous Lifedrain heal from its own counter
    // would be visible rather than masked by max-hp clamping.
    // testMorale(5) on defender: 10+0+6-1=15 > 5 -> passes.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    defender.takeDamage(5, ArmorPen::Bypass);
    REQUIRE(defender.getHp() == 5);
    defender.setHex(hex);

    // attackerRoll = 11+0+0+1+1 = 13, defenderRoll = 10+0+0+3+6-0 = 19 -> wonBy = 6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker: 10+0+6-1=15 > 6 -> PASSES
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // counter defend(): defenceroll=1 (12+1=13 < 19, hits), d1=6,d2=1 ->
    // resultDMG = (7+10/2+0) + 6 - 1 = 17, capped to 1. If MagicalChip had wrongly
    // fired too, the attacker would be down 2, not 1; if Lifedrain had wrongly
    // fired off the counter's damage, the defender's hp would have risen above 5.
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&defender, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(attacker.getHp() == 9);     // exactly the capped 1, no extra MagicalChip point
    CHECK(attacker.getBroken() == false);
    CHECK(defender.getHp() == 5);     // unchanged — no Lifedrain heal from its own counter
    CHECK(defender.getRepelMalus() == 1);
    CHECK(blocked == false);
}

// ── known-gap coverage ───────────────────────────────────────────────────────

TEST_CASE("resolveRepel: the primary target's malus correctly penalizes a second attack later the same turn") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Human defender(BLUETEAM, MeleeWeapons::Spear);
    defender.setHex(hex);
    defender.setEngagedSide(&side);

    Soldier attacker1(REDTEAM);
    Soldier attacker2(REDTEAM);

    Utility::clearDiceRolls();
    // Attack 1 (malus=0): attackerRoll=11+0+0+1+1=13, defenderRoll=10+0+0+3+6-0=19 -> wonBy=6
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(6) on attacker1: 10+0+6-1=15 > 6 -> PASSES
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // counter defend(): defenceroll=1 (13<19 hits), d1=6,d2=1 -> resultDMG=12+6-1=17,
    // shield(4) check 12+4+0+1=17<19 -> doesn't apply, capped to 1.
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked1 = false;
    attacker1.resolveRepel(&defender, blocked1, /*attackerHitBonus*/0, /*attackerReach*/1);

    REQUIRE(defender.getRepelMalus() == 1);
    CHECK(blocked1 == false);
    CHECK(attacker1.getHp() == 9);

    // Attack 2, same turn (malus still 1 — nothing reset it): attackerRoll2=11+0+0+1+6=18.
    // defenderRoll2 raw = 10+0+0+3+6=19; WITH the -1 malus applied, it's 18, which only
    // ties (not beats) attackerRoll2, so the attacker wins this round. If the malus were
    // wrongly not applied, defenderRoll2 would stay 19 and the defender would win instead,
    // needing morale/counter dice this test deliberately doesn't supply.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);

    bool blocked2 = false;
    attacker2.resolveRepel(&defender, blocked2, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(defender.getRepelMalus() == 2); // still eligible as primary target despite the malus
    CHECK(blocked2 == false);
    CHECK(attacker2.getHp() == 10); // unaffected — the defender lost this round, no counter
    CHECK(attacker2.getBroken() == false);
}

TEST_CASE("resolveRepel: a MountedUnit can volunteer as a cascade backup, not just as the primary target") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    Human primary(BLUETEAM, MeleeWeapons::Spear); // reach 3 — the actual find_target() pick
    primary.setHex(hex);
    primary.setEngagedSide(&side);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM);
    Scorpion* mount = mountPtr.get();
    Cavalry backup(BLUETEAM, std::move(riderPtr), std::move(mountPtr)); // sits on the same side, NOT the primary target
    backup.setHex(hex);
    backup.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // primary (Human/Spear) loses: attackerRoll=11+0+0+0+6=17, humanRoll=10+0+0+3+1-0=14
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // backup's rider loses too: attackerRoll=11+0+0+0+6=17, riderRoll=11+0+0+1+1-0=13
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // backup's mount wins: attackerRoll=11+0+0+0+1=12, mountRoll=8+0+0+3+6-0=17 -> wonBy=5
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    // testMorale(5) on attacker: 10+0+1-6=5, 5 > 5 is false -> FAILS
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&primary, blocked, /*attackerHitBonus*/0, /*attackerReach*/0);
    Utility::clearDiceRolls();

    CHECK(blocked == true);
    CHECK(attacker.getBroken() == true);
    CHECK(primary.getRepelMalus() == 1);
    CHECK(rider->getRepelMalus() == 1);
    CHECK(mount->getRepelMalus() == 1); // a cascade backup, not the primary target, decided this attack
}

TEST_CASE("resetRepelMalus: zeroes a unit's malus, and MountedUnit cascades the reset to rider and mount") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    // A separate hex for cav, not shared with lone — otherwise, with neither unit
    // seated on a real engagedSide, resolveRepel()'s cascade can't tell them apart
    // and each would leak into the other's candidate pool (see the malus-exclusion
    // test above for the same pitfall).
    Hex* hex2 = bf.hexGrid.getHex(bf.hexGrid.neighbors({1, 14})[0]);
    REQUIRE(hex2 != nullptr);

    Soldier attacker(REDTEAM);
    Human lone(BLUETEAM, MeleeWeapons::Spear);
    lone.setHex(hex);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM);
    Scorpion* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex2);

    Utility::clearDiceRolls();
    // Each gets exactly one attempt (attacker wins all three, no morale/counter dice needed):
    // lone: attackerRoll=11+0+0+6=17, loneRoll=10+0+3+1-0=14
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    bool b1 = false;
    attacker.resolveRepel(&lone, b1, 0, 0);
    // cav (rider then mount, attackerReach=0 so both qualify): rider loses, mount loses too
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    bool b2 = false;
    attacker.resolveRepel(&cav, b2, 0, 0);
    Utility::clearDiceRolls();

    REQUIRE(lone.getRepelMalus() == 1);
    REQUIRE(rider->getRepelMalus() == 1);
    REQUIRE(mount->getRepelMalus() == 1);

    lone.resetRepelMalus();
    cav.resetRepelMalus();

    CHECK(lone.getRepelMalus() == 0);
    CHECK(rider->getRepelMalus() == 0);
    CHECK(mount->getRepelMalus() == 0);
}

// ── MountedUnit death transitions: does the survivor still know its hex/side? ─
//
// _rider/_mount are never independently placed in the grid — only the composite
// is (see MountedUnit.hpp). syncTacticalState() (called from defend()/takeDamage()/
// repelParts()) is what gives the surviving sub-unit a correct currentHex/
// engagedSide on each call. These tests kill one half of a Cavalry via massive
// Bypass damage (routed deterministically via a forced pickMountTarget() roll —
// a single Utility::getRandom() value, not a throwDice() pair) and then confirm
// the composite's own position is untouched and a subsequent repel call against
// the survivor resolves cleanly with no crash and no stale data.

TEST_CASE("MountedUnit: mount dies in combat, composite survives as dismounted rider with intact hex/side") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Warhorse>(BLUETEAM);
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // Force pickMountTarget() to route to the mount (a single getRandom() value,
    // not a throwDice() pair): boundary = clamp(mountSize-0, 1, mountSize+riderSize-1)
    // = 20, so any roll <= 20 picks the mount.
    Utility::pushDiceRoll(1);
    // _mount->defend(999, 999, Bypass, ...): defenceroll/d1/d2 barely matter at this
    // scale, and defend() always rolls testMorale() before checking hp (unlike
    // takeDamage(), which skips it on a lethal hit) — push something for all of it.
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    cav.defend(999, 999, ArmorPen::Bypass, /*attackerReach*/0);

    // onMountDeath() calls _mount.reset() — the Warhorse object is destroyed here,
    // so there is no longer a valid pointer to check getAlive() on directly; the
    // composite's own hasMount()/getAlive() are the only safe post-death observation.
    REQUIRE(cav.hasMount() == false);
    CHECK(cav.getAlive() == true);          // rider survives
    CHECK(cav.getHex() == hex);             // composite's own placement is untouched —
    CHECK(cav.getEngagedSide() == &side);   // it was never tied to the mount

    // A subsequent repel call against the now-rider-only composite must still
    // resolve correctly (no crash, no stale currentHex) — repelParts() re-syncs
    // the rider fresh on every call.
    Soldier attacker(REDTEAM);
    // attackerRoll = 11+0+0+0+6 = 17, riderRoll = 11+0+0(synced bonus)+1+1-0 = 13
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/0);
    Utility::clearDiceRolls();

    CHECK(blocked == false);
    CHECK(rider->getRepelMalus() == 1); // resolved cleanly through the surviving rider
}

TEST_CASE("MountedUnit: rider dies in combat, composite survives as a broken loose mount with intact hex/side") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM); // long-reach mount, so the
    Scorpion* mount = mountPtr.get();                     // post-death repel check below is meaningful
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // Force pickMountTarget() to route to the rider: boundary tops out at
    // mountSize+riderSize-1 = 29, so a roll of 30 always picks the rider instead.
    Utility::pushDiceRoll(30);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    cav.defend(999, 999, ArmorPen::Bypass, /*attackerReach*/0);

    // onRiderDeath() calls _rider.reset() — the Soldier object is destroyed here,
    // so getAlive() can't be checked on it directly anymore; cav.hasRider() is the
    // only safe post-death observation.
    REQUIRE(cav.hasRider() == false);
    CHECK(cav.getAlive() == true);          // mount survives
    CHECK(cav.getBroken() == true);         // onRiderDeath(): a riderless mount panics
    CHECK(cav.getCategory() == UnitCategory::Beast); // reverted from Mounted — see looseCategory()
    CHECK(cav.getHex() == hex);             // composite's own placement is untouched —
    CHECK(cav.getEngagedSide() == &side);   // it was never tied to the rider

    // The surviving mount (Scorpion, reach 3) is panicking (cav.getBroken() == true,
    // checked above) — resolveRepel()'s broken-primary gate now correctly takes a
    // riderless, routing mount off the repel table too, with no MountedUnit-specific
    // casing needed: cav.getBroken() already delegates to the mount once there's no
    // rider left to override it (effectTarget()), so "broken means it doesn't fight
    // back" just falls out of the normal rule.
    Soldier attacker(REDTEAM);
    Utility::clearDiceRolls(); // nothing pushed — repel must not throw any dice at all

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);

    CHECK(blocked == false);
    CHECK(mount->getRepelMalus() == 0); // broken — never attempted
}

// ── broken defenders: the primary target's own getBroken() gates its repel,
// but doesn't take the cascade off the table, and MountedUnit's getBroken()
// (deferring to the rider while mounted) is what actually gets checked ──────

TEST_CASE("resolveRepel: a broken primary target does not repel itself, but a non-broken cascade backup still can") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);
    Human broken1(BLUETEAM, MeleeWeapons::Spear);   // reach 3, but routing
    broken1.setBroken(true);
    Human backup(BLUETEAM, MeleeWeapons::Halberd);  // reach 2, still fighting
    broken1.setHex(hex); broken1.setEngagedSide(&side);
    backup.setHex(hex);  backup.setEngagedSide(&side);

    Utility::clearDiceRolls();
    // broken1 is skipped entirely — no dice consumed for it at all.
    // backup loses: attackerRoll = 11+0+1+6=18, backupRoll = 10+0+2+1-0=13
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&broken1, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == false);
    CHECK(broken1.getRepelMalus() == 0); // never attempted — broken units don't fight back
    CHECK(backup.getRepelMalus() == 1);  // but the cascade backup still got its shot
}

TEST_CASE("resolveRepel: a broken primary target with no other eligible defender lets the attack through untouched") {
    Battlefield bf;
    Hex* hex = repelHex(bf);

    Soldier attacker(REDTEAM);
    Human broken1(BLUETEAM, MeleeWeapons::Spear); // reach 3 — would easily qualify if not broken
    broken1.setBroken(true);
    broken1.setHex(hex);

    Utility::clearDiceRolls(); // nothing pushed — repel must not throw any dice at all

    bool blocked = false;
    attacker.resolveRepel(&broken1, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);

    CHECK(blocked == false);
    CHECK(broken1.getRepelMalus() == 0);
    CHECK(broken1.getHp() == 10); // attack proceeds normally afterward, untouched by repel
}

TEST_CASE("resolveRepel: MountedUnit defender — a broken rider takes the whole composite off the repel table, "
          "even though the mount itself isn't broken") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    Soldier* rider = riderPtr.get();
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM); // reach 3 — would otherwise repel easily
    Scorpion* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);
    cav.setBroken(true); // delegates to the rider (effectTarget()) while mounted

    REQUIRE(cav.getBroken() == true);
    REQUIRE(mount->getBroken() == false); // the mount itself was never individually broken

    Utility::clearDiceRolls(); // no dice at all — repel must be fully skipped

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/0);

    CHECK(blocked == false);
    CHECK(rider->getRepelMalus() == 0);
    CHECK(mount->getRepelMalus() == 0); // the long-reached stinger never even got a chance
}

TEST_CASE("resolveRepel: MountedUnit defender — a broken mount still attempts to repel normally "
          "as long as its rider is in control") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide side;

    Soldier attacker(REDTEAM);

    auto riderPtr = std::make_unique<Soldier>(BLUETEAM);
    auto mountPtr = std::make_unique<Scorpion>(BLUETEAM); // Stinger, reach 3
    Scorpion* mount = mountPtr.get();
    Cavalry cav(BLUETEAM, std::move(riderPtr), std::move(mountPtr));
    cav.setHex(hex);
    cav.setEngagedSide(&side);
    mount->setBroken(true); // the mount itself panics, but the rider stays in control

    REQUIRE(cav.getBroken() == false); // getBroken() defers to the rider while mounted —
                                        // the mount's own broken flag never propagates up

    Utility::clearDiceRolls();
    // attackerReach=1 ties the rider's own SwordAndShield (reach 1) — rider never qualifies,
    // no dice for it. Only the Scorpion's Stinger (reach 3) is strictly longer.
    // attackerRoll = 11+0+0+1+6 = 18, mountRoll = 8+0+0+3+1-0 = 12 -> attacker wins outright
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&cav, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == false);
    CHECK(mount->getRepelMalus() == 1); // the broken mount still got its attempt — its own
                                         // panic doesn't take it off the repel table while ridden
}

// ── undefended primary target: every enemy in the hex is a valid cascade ────
// candidate, not just ones sharing its (nonexistent) side — representing an
// attacker that's broken into the hex and is taking a target of opportunity
// from whoever's standing there, not just the unit holding the boundary.

TEST_CASE("resolveRepel: when the primary target has no engagedSide, every other enemy in the hex "
          "is a valid cascade candidate regardless of its own side, and nothing crashes without a hexside") {
    Battlefield bf;
    Hex* hex = repelHex(bf);
    HexSide unrelatedSide; // def2 sits on a side that has nothing to do with this attack

    Soldier attacker(REDTEAM);
    Human def1(BLUETEAM, MeleeWeapons::Spear);   // reach 3, no engagedSide — a target of opportunity,
                                                  // same as find_target()'s own undefended-hex fallback.
    Human def2(BLUETEAM, MeleeWeapons::Halberd); // reach 2, seated on an unrelated side
    def1.setHex(hex); // deliberately no setEngagedSide()
    def2.setHex(hex);
    def2.setEngagedSide(&unrelatedSide);

    Utility::clearDiceRolls();
    // def1 (primary, side==nullptr) loses: attackerRoll = 11+0+1+6=18, def1Roll = 10+0+3+1-0=14
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    // def2 (cascade, despite its mismatched side) loses too: attackerRoll=18, def2Roll=10+0+2+1-0=13
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    bool blocked = false;
    attacker.resolveRepel(&def1, blocked, /*attackerHitBonus*/0, /*attackerReach*/1);
    Utility::clearDiceRolls();

    CHECK(blocked == false); // attacker won both rounds
    CHECK(def1.getRepelMalus() == 1);
    CHECK(def2.getRepelMalus() == 1); // pulled in despite its own side not matching def1's
                                       // (none) — proves the side==nullptr branch truly
                                       // skips the side filter rather than coincidentally
                                       // matching
}
