#include "catch.hpp"
#include "Battlefield.hpp"
#include "units/Soldier.hpp"
#include "units/Zombie.hpp"
#include "Squad.hpp"
#include "Utility.hpp"

// ── Squad cohesion bonus ─────────────────────────────────────────────────────
//
// resolveEngagements grants rank-1 squad members their squad's cohesion tier
// (Squad::cohesionLevel(): avg member cohesion ≥ 50 → 1, ≥ 80 → 2, ≥ 100 → 3),
// halved on Forest/Rubble hexes (cohesionTierForHex). Loners never get a tier,
// even when seated on a squad-owned side. The tier feeds hit/defence/damage/
// morale rolls through cohesionStatBonus()/cohesionDmgBonus().
//
// Grid anchor as in test_engagements: col=8, r=14 → q = 8 - 14/2 = 1;
// all 6 neighbours valid on the 16×30 grid.
static constexpr HexCoord COH_RED_HEX = {1, 14};

TEST_CASE("cohesion: rank-1 squad members get the tier; a loner on the same side does not") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(COH_RED_HEX);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(COH_RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    // Squad must outlive its members (their dtors call leaveSquad()).
    Squad alpha("Alpha");
    Soldier sm0(REDTEAM), sm1(REDTEAM), sm2(REDTEAM);
    alpha.addMember(&sm0); sm0.setHex(redHex);
    alpha.addMember(&sm1); sm1.setHex(redHex);
    alpha.addMember(&sm2); sm2.setHex(redHex);

    Soldier loner(REDTEAM);
    loner.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    // Default cohesion 50 = COHESION_NORMAL → tier 1 for every rank-1 member.
    for (Soldier* u : {&sm0, &sm1, &sm2}) {
        REQUIRE(u->getEngagedRank() == 1);
        CHECK(u->getCohesionBonus() == 1);
        CHECK(u->cohesionStatBonus() == 1);
    }

    // The loner fills the remaining rank-1 frontage on the squad's side
    // (30 + 10 = 40 = FRONTAGE) — seated and fighting, but no cohesion tier.
    REQUIRE(loner.getEngagedRank() == 1);
    REQUIRE(loner.getEngagedSide() != nullptr);
    CHECK(loner.getCohesionBonus() == 0);
    CHECK(loner.cohesionStatBonus() == 0);
}

// Runs a 2-man squad (both setCohesion(100) → squad tier 3) against one enemy
// on a hex of the given terrain and reports the tier the members were granted.
// 2 × size 10 fits rank 1 even at Forest's halved frontage (20).
static int grantedTierOnTerrain(TerrainType terrain) {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(COH_RED_HEX);
    REQUIRE(redHex != nullptr);
    redHex->terrain = terrain;
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(COH_RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    Squad alpha("Alpha"); // must outlive its members
    Soldier sm0(REDTEAM), sm1(REDTEAM);
    sm0.setCohesion(100); sm1.setCohesion(100);
    alpha.addMember(&sm0); sm0.setHex(redHex);
    alpha.addMember(&sm1); sm1.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    REQUIRE(sm0.getEngagedRank() == 1);
    REQUIRE(sm1.getEngagedRank() == 1);
    REQUIRE(sm0.getCohesionBonus() == sm1.getCohesionBonus());
    return sm0.getCohesionBonus();
}

TEST_CASE("cohesion: Forest and Rubble halve the granted tier; Open keeps it whole") {
    CHECK(grantedTierOnTerrain(TerrainType::Open)   == 3); // super cohesion intact
    CHECK(grantedTierOnTerrain(TerrainType::Forest) == 1); // 3 / 2 — formation dressing broken
    CHECK(grantedTierOnTerrain(TerrainType::Rubble) == 1); // 3 / 2
}

// ── The tier changes a real combat outcome ───────────────────────────────────
// Identical scripted dice; the only variable is the attacker being in a squad
// (tier 1 → +1 attack via cohesionStatBonus) vs being a loner.
//   Attacker Soldier: attackPWR 11, addFatigue(6) → engage's hit roll is
//     11 − 6 + attackBonus + throwDice(3) = 8 (loner) / 9 (squadded).
//   Defender Zombie: defence 5 (6 base − 1 Claws), shield 0, armour 0, undead
//     (no morale dice). Missed when defence + defenceroll ≥ AttackAttempt:
//     5 + 3 = 8 → shrugs off the loner's 8, is hit by the squadded 9.
//   On the hit: damage = S&S 5 + strength 10/3 + cohesionDmg(tier 1 → 0) = 8;
//     resultDMG = 8 + d1(5) − d2(3) = 10 → hp 20 → 10.
// No repel dice: Claws reach 0 never repels a reach-1 sword. The same dice are
// pushed in both scenarios; the miss consumes only the first four values and
// the rest are cleared.
static int zombieHpAfterCohesionAttack(bool squadded) {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(COH_RED_HEX);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(COH_RED_HEX)[1]);
    REQUIRE(enHex != nullptr);

    Squad alpha("Alpha"); // must outlive its members
    Soldier attacker(REDTEAM), buddy(REDTEAM);
    if (squadded) {
        alpha.addMember(&attacker);
        alpha.addMember(&buddy);
        buddy.setHex(redHex);
    }
    attacker.addFatigue(6); // still fresh (< FATIGUE_TIRED); trims the hit roll into d6 range
    attacker.setHex(redHex);

    Zombie target(BLUETEAM);
    target.setHex(enHex);

    bf.resolveEngagements();
    REQUIRE(attacker.getEngagedSide() != nullptr);
    REQUIRE(attacker.getCohesionBonus() == (squadded ? 1 : 0));

    Utility::clearDiceRolls();
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // attacker hit roll
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // defenceroll
    Utility::pushDiceRoll(5); Utility::pushDiceRoll(1); // d1 (hit path only)
    Utility::pushDiceRoll(3); Utility::pushDiceRoll(1); // d2 (hit path only)
    attacker.battle(bf);
    Utility::clearDiceRolls();

    return target.getHp();
}

TEST_CASE("cohesion: the +1 attack tier turns the same scripted dice from a miss into a hit") {
    CHECK(zombieHpAfterCohesionAttack(false) == 20); // loner: 5 + 3 ≥ 8 — attack shrugged off
    CHECK(zombieHpAfterCohesionAttack(true)  == 10); // squadded: 8 < 9 — 10-damage hit lands
}
