#pragma once

#include "AUnit.hpp"
#include <functional>
#include <memory>
#include <string>
#include <vector>

// ── Unit catalog — the single source of truth for unit-type facts ────────────
//
// One entry per constructible unit type. This table is the ONLY hand-maintained
// list of unit types; everything else (symbol, size, category, forbidden
// terrain, combat stats) is derived by constructing a unit through `make` and
// reading its live fields, so a stat changed in a unit's constructor propagates
// to every consumer (placement factory, /api/info, survivor counting, the
// dump-units JSON export and the campaign DB built from it) with no other edit.
//
// ── Roles — how a type may legitimately enter play ───────────────────────────
//
// A composable flag set, not an exclusive kind: a type carries EVERY channel
// that applies to it. Scorpion is the reason (user, 2026-08-10) — it is a
// ridden mount AND a creature an enemy host may field on its own, so it is
// `Enemy | Mount` rather than being forced to pick one.
//
// These replace the old `placeable`/`spawnable` booleans, which said the same
// thing twice and could express nonsense (placeable && !spawnable). Both are
// now derived:
//     placeable (offered to the player in /api/info) == Player | Crafted
//     spawnable (accepted by the placement API)      == Player | Enemy | Crafted
//
// `Enemy` is DESCRIPTIVE, not exclusive: Soldier/Archer/LightCavalry carry it
// because the campaign's enemy host actually fields them, even though the
// player recruits them too. That is what lets the campaign layer check its
// ENEMY_ARMY against the catalog instead of drifting from it.
//
// This is battle-layer access control — who may legally stand on a
// battlefield — NOT campaign knowledge. Recruit costs, ladders and army
// compositions stay in campaign-server; the dependency points campaign →
// engine, never back. See docs/ADDING_UNITS.md.
enum class UnitRole : unsigned {
    None    = 0,
    Player  = 1u << 0, // the player recruits, owns and deploys it
    Enemy   = 1u << 1, // enemy hosts may field it
    Summon  = 1u << 2, // conjured mid-battle by a spell; never enters via the API
    Mount   = 1u << 3, // exists under a rider; never a standalone army entry
    // Forged at the campaign's workbench (Construction slice C3, C-5): a body
    // bought with a mage's turn and mithril, never hired. A new channel gets a
    // new flag rather than an amendment to Player's promise — Player means
    // "obtainable through recruit/reinforce rows", and the campaign-side
    // tripwire holds Crafted to the twin rule: a Crafted type without a
    // forge-catalog row is a bug. Composes like the rest (Enemy | Crafted is
    // an anticipated combination).
    Crafted = 1u << 4,
};

inline UnitRole operator|(UnitRole a, UnitRole b) {
    return static_cast<UnitRole>(static_cast<unsigned>(a) | static_cast<unsigned>(b));
}

// Does `set` include `role`? Single-bit queries only — that is all any caller
// needs, and it keeps the intent readable at the call site.
inline bool hasRole(UnitRole set, UnitRole role) {
    return (static_cast<unsigned>(set) & static_cast<unsigned>(role)) != 0;
}

struct UnitCatalogEntry {
    const char* typeName;
    UnitRole    roles;
    std::function<std::unique_ptr<AUnit>(int team)> make;
};

// The catalog itself, in stable export order (Player types first).
const std::vector<UnitCatalogEntry>& unitCatalog();

// Factory for the placement API: returns nullptr for unknown types and for
// types no army may field through the API (summon-only / mount-only types).
std::unique_ptr<AUnit> makeUnitByName(const std::string& typeName, int team);

// The role names of `roles`, in stable order (Player, Enemy, Summon, Mount,
// Crafted). Empty only for UnitRole::None, which no catalog entry may carry.
std::vector<std::string> roleNames(UnitRole roles);

// Reverse lookup from a unit's construction-time printSymbol to its type name.
// Returns "" for symbols no catalog type constructs with (e.g. the runtime
// loose-horse 'H'). Where two types share a symbol (Horse/Warhorse 'h') the
// earlier catalog entry wins.
std::string unitNameForSymbol(char symbol);

// Build unitNameForSymbol's lookup once, early. Call at the top of main() (and
// at the start of a test run) — NEVER from a static initialiser: see the note
// in UnitCatalog.cpp for the deadlock that causes.
void warmUnitNames();

// Human-readable name for a UnitCategory ("Foot", "Mounted", ...).
const char* categoryName(UnitCategory cat);

// Full catalog as JSON: {"units":[{name, symbol, size, category,
// forbiddenTerrain, roles, anatomy{head, torso, legs, hand, misc},
// stats{maxHP, attack, defence,
// armour, speed, ballisticSkill, preferredRange, reconTag}}, ...]}.
// Printed by `./game dump-units`;
// the campaign server imports it into the DB at startup.
// NOTE: types whose constructors roll random gear (currently Skeleton) export
// one sampled loadout for attack/defence/armour — treat those as representative,
// not exact.
std::string unitCatalogJson();
