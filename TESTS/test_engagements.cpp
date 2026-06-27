#include "catch.hpp"
#include <set>
#include "../HDRS/Battlefield.hpp"
#include "../HDRS/units/Soldier.hpp"

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
