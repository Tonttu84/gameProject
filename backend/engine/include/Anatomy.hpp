#pragma once

// ── Anatomy — where a creature can wear things ───────────────────────────────
//
// A body plan: how many of each TYPED SLOT this creature has
// (docs/CAMPAIGN_PLAN.md, decisions 5-4 and 5-6). It is a fact about the
// creature, like its size, so it lives in the ENGINE beside the rest of the
// catalog rather than in a second table campaign-side that
// docs/ADDING_UNITS.md would have to remind people to update.
//
// The dependency still runs campaign → engine: the engine DECLARES anatomy and
// never learns what an item is. What fills a slot, what it costs and what it
// does are campaign facts and stay in campaign-server.
//
// ── Declared down the inheritance chain, with NO DEFAULT ─────────────────────
//
// (user, 2026-08-19: "the CPP already has the inheritance system… no type is an
// error it doesn't default to anything. Better to be strict than vague.")
//
// AUnit::anatomy() is PURE VIRTUAL, so a type that fails to declare a body plan
// does not compile. That is stricter than the CI sweep the interview imagined —
// a new creature cannot reach a test run undeclared, let alone a player — and
// it is why nothing here has a fallback value. `Human` declares HUMANOID once
// and its eight subclasses inherit it; a hydra declares its own heads.
//
// Counts are CAPPED at MAX_SLOTS_PER_KIND (5-4). The cap is headroom for
// modders — "hydra could have 2 or more head slots. we might have 4 armed
// monsters" — not a number our own roster comes near.
struct Anatomy {
    int head  = 0;
    int torso = 0;
    int legs  = 0;
    int hand  = 0;
    int misc  = 0;
};

// The per-kind ceiling (5-4). Ten of anything is already absurd for the roster
// we field; it exists so an odd body is expressible rather than fenced off.
inline constexpr int MAX_SLOTS_PER_KIND = 10;

// The only way a body plan should be written. Clamps each count into
// [0, MAX_SLOTS_PER_KIND] at COMPILE time, so a typo'd literal becomes a legal
// (if wrong) layout rather than a number the campaign layer must defend against
// downstream. test_unit_catalog.cpp additionally sweeps every catalog type.
constexpr int fitSlots(int n)
{
    return n < 0 ? 0 : (n > MAX_SLOTS_PER_KIND ? MAX_SLOTS_PER_KIND : n);
}

constexpr Anatomy slots(int head, int torso, int legs, int hand, int misc)
{
    return Anatomy{ fitSlots(head), fitSlots(torso), fitSlots(legs), fitSlots(hand), fitSlots(misc) };
}

// The shared plans, named once so two humanoids cannot drift apart by a typo.
// A type that is NOT one of these writes its own `slots(...)` — see Scorpion.
namespace anatomy {
    // Head, torso, legs-as-one-harness, two hands, and a misc for whatever
    // hangs off a belt. `legs` is ONE slot rather than two on purpose: greaves
    // are worn as a pair, and nothing in the design wants to armour one shin.
    inline constexpr Anatomy HUMANOID  = slots(1, 1, 1, 2, 1);
    // A horse: barding over the body, a chamfron on the head, one harness for
    // all four legs, and no hands at all.
    inline constexpr Anatomy QUADRUPED = slots(1, 1, 1, 0, 1);
}
