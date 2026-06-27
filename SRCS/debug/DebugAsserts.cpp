#include "Battlefield.hpp"
#include <cassert>

// Total individual assertion evaluations across all debugAsserts() calls.
// volatile: the compiler cannot elide the accumulation even under aggressive opts.
static volatile size_t s_debugAssertCount = 0;

size_t Battlefield::debugAssertCount() { return s_debugAssertCount; }

void Battlefield::debugAsserts() const
{
    size_t count = 0;

    // ── 1. Squad member invariants ────────────────────────────────────────────
    // Every pointer in a squad's member list must be non-null, alive, and
    // carry a back-pointer to the owning squad.
    // Dead units are eagerly removed via AUnit::leaveSquad() on death.
    for (const Team* t : {&_red, &_blue}) {
        for (const auto& sq : t->squads) {
            if (!sq) continue;
            for (AUnit* m : sq->getMembers()) {
                ++count; assert(m != nullptr &&
                    "null AUnit* in squad member list");
                ++count; assert(m->getAlive() &&
                    "dead unit still in squad — leaveSquad() missing on death path");
                ++count; assert(m->getSquad() == sq.get() &&
                    "squad member back-pointer does not match owning squad");
            }
        }
    }

    // ── 2. Unit → squad direction ─────────────────────────────────────────────
    // If a unit carries a squad back-pointer, the squad must list that unit.
    for (const Team* t : {&_red, &_blue}) {
        for (const auto& u : t->units) {
            if (!u) continue;
            if (const Squad* sq = u->getSquad()) {
                ++count; assert(sq->hasMember(u.get()) &&
                    "unit has squad back-pointer but is not in that squad's member list");
            }
        }
    }

    // ── 3. Squad coherence ────────────────────────────────────────────────────
    // All alive members of a squad must occupy the same hex.
    for (const Team* t : {&_red, &_blue}) {
        for (const auto& sq : t->squads) {
            if (!sq) continue;
            const Hex* squadHex = nullptr;
            for (AUnit* m : sq->getMembers()) {
                if (!m->getAlive() || !m->getHex()) continue;
                if (!squadHex) { squadHex = m->getHex(); ++count; continue; }
                ++count; assert(m->getHex() == squadHex &&
                    "squad coherence violation: member on different hex than rest of squad");
            }
        }
    }

    // ── 4. Hex → unit direction ───────────────────────────────────────────────
    // Every AUnit* in a hex's unit list must be non-null, alive, and have a
    // hex back-pointer pointing back to this hex.
    // Dead units should already be gone — their destructor calls removeFromHex().
    for (const auto& [coord, hex] : hexGrid.getHexes()) {
        for (const AUnit* u : hex.units) {
            ++count; assert(u != nullptr &&
                "null AUnit* in hex unit list");
            ++count; assert(u->getAlive() &&
                "dead unit still in hex unit list — destructor or removeFromHex() issue");
            ++count; assert(u->getHex() == &hex &&
                "unit in hex unit list but unit's hex back-pointer differs");
        }
    }

    // ── 5. Unit → hex direction ───────────────────────────────────────────────
    // If an alive unit has a non-null hex pointer, the hex must list that unit.
    for (const Team* t : {&_red, &_blue}) {
        for (const auto& u : t->units) {
            if (!u || !u->getAlive()) continue;
            const Hex* h = u->getHex();
            if (!h) continue;
            bool found = false;
            for (const AUnit* listed : h->units)
                if (listed == u.get()) { found = true; break; }
            ++count; assert(found &&
                "alive unit's hex back-pointer set but hex does not list the unit");
        }
    }

    s_debugAssertCount += count;
}
