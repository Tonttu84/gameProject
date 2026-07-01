#include "catch.hpp"
#include <set>
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/units/Soldier.hpp"
#include "../HDRS/units/Cavalry.hpp"
#include "../HDRS/units/Zombie.hpp"

// Coordinate inside the 16×30 grid (buildRect(16,30)) with all 6 neighbours valid.
// col=8, r=14 → q = 8 - 14/2 = 1
static constexpr HexCoord RED_HEX = {1, 14};

// Returns false when any HexSide is assigned to both a squad member and a lone
// unit on the same hex — that would be the "mixing" bug.
static bool noMixedSides(const Hex* hex) {
    std::set<HexSide*> squadSides, lonerSides;
    for (AUnit* u : hex->units) {
        if (!u || !u->getAlive()) continue;
        HexSide* s = u->getEngagedSide();
        if (!s) continue;
        if (u->getSquad()) squadSides.insert(s);
        else               lonerSides.insert(s);
    }
    for (HexSide* s : lonerSides)
        if (squadSides.count(s)) return false;
    return true;
}

// ── resolveEngagements: squad / loner side separation ────────────────────────

TEST_CASE("resolveEngagements: fresh squad and loners never share a HexSide") {
    // Red hex: Squad Alpha (5 soldiers) + 3 lone soldiers.
    // Enemy hexes on 3 sides (NE, E, SE), each with 1 blue soldier.
    // size=10, FRONTAGE=40 → 4 fill one side exactly.
    //
    // Pass 1A:  sm0–sm3 → first available side (fills it), sm4 → next (partial).
    //           Both sides claimed by Alpha; the third side stays unclaimed.
    // Pass 1B:  3 loners → round-robin across the one unclaimed side.
    // Invariant: no HexSide appears in both squad and loner assignment sets.

    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);

    auto nb      = bf.hexGrid.neighbors(RED_HEX);
    // nb[0]=NE  nb[1]=E  nb[2]=SE  (all inside the 16×30 grid)
    Hex* enNE = bf.hexGrid.getHex(nb[0]);
    Hex* enE  = bf.hexGrid.getHex(nb[1]);
    Hex* enSE = bf.hexGrid.getHex(nb[2]);
    REQUIRE(enNE != nullptr);
    REQUIRE(enE  != nullptr);
    REQUIRE(enSE != nullptr);

    // Squad must be declared before the soldiers so it is destroyed after them.
    // Soldier::~Soldier calls leaveSquad(), which touches the Squad; if the Squad
    // dies first the call is a use-after-free.
    Squad alpha("Alpha", true);
    Soldier sm0(REDTEAM), sm1(REDTEAM), sm2(REDTEAM), sm3(REDTEAM), sm4(REDTEAM);
    Soldier ln0(REDTEAM), ln1(REDTEAM), ln2(REDTEAM);
    Soldier en0(BLUETEAM), en1(BLUETEAM), en2(BLUETEAM);
    alpha.addMember(&sm0); sm0.setHex(redHex);
    alpha.addMember(&sm1); sm1.setHex(redHex);
    alpha.addMember(&sm2); sm2.setHex(redHex);
    alpha.addMember(&sm3); sm3.setHex(redHex);
    alpha.addMember(&sm4); sm4.setHex(redHex);

    ln0.setHex(redHex); ln1.setHex(redHex); ln2.setHex(redHex);
    en0.setHex(enNE);   en1.setHex(enE);    en2.setHex(enSE);

    bf.resolveEngagements();

    // Core invariant
    CHECK(noMixedSides(redHex));

    // Sanity: all 5 squad members must be assigned (3 sides available, 5 members)
    int assignedSM = 0;
    for (Soldier* u : {&sm0, &sm1, &sm2, &sm3, &sm4})
        if (u->getEngagedSide()) ++assignedSM;
    CHECK(assignedSM == 5);

    // Sanity: all 3 loners must be assigned (third side is unclaimed)
    int assignedLoners = 0;
    for (Soldier* u : {&ln0, &ln1, &ln2})
        if (u->getEngagedSide()) ++assignedLoners;
    CHECK(assignedLoners == 3);
}

TEST_CASE("resolveEngagements: tired loners do not poach from partially-filled squad side") {
    // Same layout, but 1 fresh squad member + 3 tired loners.
    // Pass 1A: squad member → side[0], frontage=10, sideOwner[0]=Alpha (not full).
    // Pass 1B: fresh loners → none.
    // Pass 2B: tired loners → freeSides = {side[1], side[2]} only (side[0] owned by Alpha).
    // Invariant: tired loners must NOT land on side[0].

    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);

    auto nb   = bf.hexGrid.neighbors(RED_HEX);
    Hex* enNE = bf.hexGrid.getHex(nb[0]);
    Hex* enE  = bf.hexGrid.getHex(nb[1]);
    Hex* enSE = bf.hexGrid.getHex(nb[2]);
    REQUIRE(enNE != nullptr);
    REQUIRE(enE  != nullptr);
    REQUIRE(enSE != nullptr);

    Squad alpha("Alpha", true);  // must outlive its members (see first test for explanation)
    Soldier sm(REDTEAM);
    Soldier ln0(REDTEAM), ln1(REDTEAM), ln2(REDTEAM);
    Soldier en0(BLUETEAM), en1(BLUETEAM), en2(BLUETEAM);
    alpha.addMember(&sm); sm.setHex(redHex);

    // Make loners tired (FATIGUE_TIRED=30 → tired pool)
    ln0.addFatigue(FATIGUE_TIRED); ln0.setHex(redHex);
    ln1.addFatigue(FATIGUE_TIRED); ln1.setHex(redHex);
    ln2.addFatigue(FATIGUE_TIRED); ln2.setHex(redHex);

    en0.setHex(enNE); en1.setHex(enE); en2.setHex(enSE);

    bf.resolveEngagements();

    CHECK(noMixedSides(redHex));

    // Squad member should be assigned
    CHECK(sm.getEngagedSide() != nullptr);
    // Loners must NOT be on the same side as the squad member
    for (Soldier* u : {&ln0, &ln1, &ln2}) {
        if (u->getEngagedSide())
            CHECK(u->getEngagedSide() != sm.getEngagedSide());
    }
}

// ── fillLonerPass / fillSquadPass: eviction-based displacement ──────────────
// Soldier size=10, Cavalry size=20 (mount-only footprint). Rubble reduces
// FRONTAGE(40) by a quarter -> 30 (room for exactly 3 soldiers, or 1 soldier
// + 1 cavalry). Forest halves it -> 20 (exactly 1 cavalry, or 2 soldiers).
//
// Only ONE enemy unit is placed (on a single neighbor hex) so the red hex
// has exactly one engaged side — isolates the capacity math to one side.

TEST_CASE("resolveEngagements: a bigger tired loner evicts a smaller fresh one to fit a capped side") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    redHex->terrain = TerrainType::Rubble; // effectiveFrontage = 30

    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    Soldier s1(REDTEAM), s2(REDTEAM);
    Cavalry cav(REDTEAM);
    s1.setHex(redHex); s2.setHex(redHex);
    cav.addFatigue(FATIGUE_TIRED); // processed in the second (tired) loner pass
    cav.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    // Pass 1 (fresh): both soldiers fit (10+10=20 <= 30). Pass 2 (tired):
    // cavalry doesn't fit alongside both (20+20=40 > 30); evicts the
    // smallest seated unit (one soldier, size 10) — frontage drops to 10,
    // then 10+20=30 fits exactly. Only one soldier should be evicted, not
    // both (eviction stops as soon as it fits).
    REQUIRE(cav.getEngagedSide() != nullptr);
    HexSide* side = cav.getEngagedSide();
    int soldiersStillOnSide = (s1.getEngagedSide() == side ? 1 : 0)
                             + (s2.getEngagedSide() == side ? 1 : 0);
    REQUIRE(soldiersStillOnSide == 1);
}

// ── find_target: fighting happens across a hexside, not across a whole hex ──

TEST_CASE("find_target: attacker on a defended hexside only targets the unit holding that boundary") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);
    enHex->terrain = TerrainType::Forest; // effectiveFrontage = 20 — room for exactly one Cavalry

    Soldier attacker(REDTEAM);
    attacker.setHex(redHex);

    Cavalry defender(BLUETEAM); // size 20 — claims the whole capped side alone
    defender.setHex(enHex);
    Soldier decoy(BLUETEAM); // size 10 — too big to also fit alongside the cavalry, stays unseated
    decoy.setHex(enHex);

    bf.resolveEngagements();

    REQUIRE(attacker.getEngagedSide() != nullptr);
    REQUIRE(defender.getEngagedSide() == attacker.getEngagedSide());
    REQUIRE(decoy.getEngagedSide() == nullptr); // present in the hex, but not holding the boundary

    AUnit* target = attacker.find_target(bf);
    CHECK(target == &defender);
    CHECK(target != &decoy);
}

TEST_CASE("find_target: an undefended hexside falls back to attacking the hex directly") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    Soldier attacker(REDTEAM);
    attacker.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.addFatigue(FATIGUE_MAX); // too exhausted to be seated on any side this tick
    enemy.setHex(enHex);

    bf.resolveEngagements();

    // The boundary still counts as engaged (an enemy is present), so the
    // attacker gets seated normally — it's the defender who couldn't hold it.
    REQUIRE(attacker.getEngagedSide() != nullptr);
    REQUIRE(enemy.getEngagedSide() == nullptr);

    AUnit* target = attacker.find_target(bf);
    CHECK(target == &enemy);
}

// find_target() proves the *selection*; this proves the full battle() pipeline
// (computeMeleeAttackBonus + MeleeCombat::engage) actually lands a hit through
// that fallback target — i.e. units can engage through an undefended hexside,
// not just be eligible to in theory.
TEST_CASE("battle(): attacker actually deals damage through an undefended hexside") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    Soldier attacker(REDTEAM);
    attacker.setHex(redHex);

    Zombie target(BLUETEAM);
    target.addFatigue(FATIGUE_MAX); // too exhausted to be seated on any side this tick
    target.setHex(enHex);

    bf.resolveEngagements();
    REQUIRE(attacker.getEngagedSide() != nullptr);
    REQUIRE(target.getEngagedSide() == nullptr); // confirms the side is undefended

    Utility::clearDiceRolls();
    // attacker-hit-roll(6,1) defenceroll(1,1) d1(6,1) d2(1,1) — same shape as
    // the Cavalry battle() test above: guarantees the hit lands, resolving to
    // damage = getDamage()(5) + strength(10)/strDivider(3) + d1(6) - d2(1) = 13
    // against the Zombie's 0 armour / 0 shield.
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(6); Utility::pushDiceRoll(1);
    Utility::pushDiceRoll(1); Utility::pushDiceRoll(1);

    int hpBefore = target.getHp();
    attacker.battle(bf);
    Utility::clearDiceRolls();

    CHECK(target.getHp() == hpBefore - 13);
}

TEST_CASE("resolveEngagements: a smaller tired loner cannot evict a bigger one already seated") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    redHex->terrain = TerrainType::Forest; // effectiveFrontage = 20

    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    Cavalry cav(REDTEAM); // size 20 — fills the Forest-capped side alone
    cav.setHex(redHex);
    Soldier soldier(REDTEAM);
    soldier.addFatigue(FATIGUE_TIRED); // processed after the cavalry is already seated
    soldier.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    REQUIRE(cav.getEngagedSide() != nullptr);
    REQUIRE(soldier.getEngagedSide() == nullptr); // not big enough to evict the cavalry
}

TEST_CASE("resolveEngagements: eviction also works for squad members across fatigue tiers") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    redHex->terrain = TerrainType::Rubble; // effectiveFrontage = 30

    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    // Squad must outlive its members (their destructors call leaveSquad()).
    Squad sq("Vanguard", false);
    Soldier s1(REDTEAM), s2(REDTEAM);
    Cavalry cav(REDTEAM);
    sq.addMember(&s1); s1.setHex(redHex);
    sq.addMember(&s2); s2.setHex(redHex);
    sq.addMember(&cav);
    cav.addFatigue(FATIGUE_TIRED);
    cav.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    REQUIRE(cav.getEngagedSide() != nullptr);
    HexSide* side = cav.getEngagedSide();
    int soldiersStillOnSide = (s1.getEngagedSide() == side ? 1 : 0)
                             + (s2.getEngagedSide() == side ? 1 : 0);
    REQUIRE(soldiersStillOnSide == 1);
}

// ── Bug-fix regression: corner-hex multi-side distribution ────────────────
// When a hex is engaged on 2 sides simultaneously, fillSquadPass distributes
// squad members round-robin so both sides get fighters instead of all
// troops piling on the first side only.
//
// Setup: RED_HEX engaged from NE and E simultaneously. 8 soldiers in one
// squad — enough to fill both Open-terrain sides (FRONTAGE=40 each, soldier
// size=10 → 4 per side). Each side should end up with at least one soldier.

TEST_CASE("resolveEngagements: squad distributes members across 2 simultaneously engaged sides") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);

    auto nb     = bf.hexGrid.neighbors(RED_HEX);
    Hex* enNE   = bf.hexGrid.getHex(nb[0]); // NE neighbor
    Hex* enE    = bf.hexGrid.getHex(nb[1]); // E neighbor
    REQUIRE(enNE != nullptr);
    REQUIRE(enE  != nullptr);

    // Squad must outlive its members.
    Squad alpha("Alpha", true);
    Soldier sm0(REDTEAM), sm1(REDTEAM), sm2(REDTEAM), sm3(REDTEAM);
    Soldier sm4(REDTEAM), sm5(REDTEAM), sm6(REDTEAM), sm7(REDTEAM);
    alpha.addMember(&sm0); sm0.setHex(redHex);
    alpha.addMember(&sm1); sm1.setHex(redHex);
    alpha.addMember(&sm2); sm2.setHex(redHex);
    alpha.addMember(&sm3); sm3.setHex(redHex);
    alpha.addMember(&sm4); sm4.setHex(redHex);
    alpha.addMember(&sm5); sm5.setHex(redHex);
    alpha.addMember(&sm6); sm6.setHex(redHex);
    alpha.addMember(&sm7); sm7.setHex(redHex);

    // Enemies on both sides to create two simultaneously engaged HexSides.
    Soldier enA(BLUETEAM), enB(BLUETEAM);
    enA.setHex(enNE);
    enB.setHex(enE);

    bf.resolveEngagements();

    // Identify the two engaged sides from redHex.
    HexSide* sideNE = bf.hexGrid.getSide(RED_HEX, HexDirection::NE);
    HexSide* sideE  = bf.hexGrid.getSide(RED_HEX, HexDirection::E);
    REQUIRE(sideNE != nullptr);
    REQUIRE(sideE  != nullptr);
    REQUIRE(sideNE->engaged);
    REQUIRE(sideE->engaged);

    int onNE = 0, onE = 0;
    for (Soldier* u : {&sm0, &sm1, &sm2, &sm3, &sm4, &sm5, &sm6, &sm7}) {
        if (u->getEngagedSide() == sideNE) ++onNE;
        if (u->getEngagedSide() == sideE)  ++onE;
    }

    // With round-robin distribution both sides must have fighters.
    // Neither side should be left empty while the other overflows.
    CHECK(onNE >= 1);
    CHECK(onE  >= 1);
    // All 8 soldiers should be assigned (4 per side × 2 sides = 8 capacity).
    CHECK(onNE + onE == 8);
}

// ── Bug-fix regression: loner path skips blocked unit instead of stopping ──
// When a too-large loner can't fit on the only free side, smaller loners that
// DO fit must still get a chance — the loop must not break early on the first
// failure.
//
// Rubble effectiveFrontage=30. One cavalry (size 20) fills the side halfway.
// A second cavalry (size 20) can't join (20+20=40 > 30 and nothing smaller
// to evict). The cavalry behind it should NOT block a soldier (size 10) from
// taking the remaining 10 frontage units.

TEST_CASE("resolveEngagements: loner smaller than blocker fills remaining rubble frontage") {
    Battlefield bf;
    Hex* redHex = bf.hexGrid.getHex(RED_HEX);
    REQUIRE(redHex != nullptr);
    redHex->terrain = TerrainType::Rubble; // effectiveFrontage = 30

    Hex* enHex = bf.hexGrid.getHex(bf.hexGrid.neighbors(RED_HEX)[0]);
    REQUIRE(enHex != nullptr);

    // Two loner cavalry (each size 20) and one loner soldier (size 10).
    // Sorted: cav1, cav2, soldier — cav2 can't fit after cav1 is placed,
    // but soldier (10) can fill the remaining 10-unit gap.
    Cavalry cav1(REDTEAM), cav2(REDTEAM);
    Soldier soldier(REDTEAM);
    cav1.setHex(redHex);
    cav2.setHex(redHex);
    soldier.setHex(redHex);

    Soldier enemy(BLUETEAM);
    enemy.setHex(enHex);

    bf.resolveEngagements();

    // cav1 must be assigned (first to try the only free side).
    REQUIRE(cav1.getEngagedSide() != nullptr);

    // cav2 must NOT be assigned (20+20=40 > cap 30, nothing smaller to evict).
    CHECK(cav2.getEngagedSide() == nullptr);

    // soldier MUST be assigned — it fits in the remaining 10-unit gap.
    // (If the loop broke early on cav2's failure, soldier would be wrongly left out.)
    REQUIRE(soldier.getEngagedSide() != nullptr);
    CHECK(soldier.getEngagedSide() == cav1.getEngagedSide()); // same side as cav1
}
