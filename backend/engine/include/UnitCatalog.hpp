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
// Flags:
//   placeable — offered to the player in /api/info and placeable via the
//               placement API.
//   spawnable — accepted by the placement API at all (superset of placeable:
//               Necromancer is enemy-placeable but not offered to the player).
//   Neither   — battle-internal types (summons, loose mounts): they can appear
//               in battles and replays but can never enter through the API.
struct UnitCatalogEntry {
    const char* typeName;
    bool placeable;
    bool spawnable;
    std::function<std::unique_ptr<AUnit>(int team)> make;
};

// The catalog itself, in stable export order (placeable types first).
const std::vector<UnitCatalogEntry>& unitCatalog();

// Factory for the placement API: returns nullptr for unknown types and for
// types that are not spawnable (summon-only / mount types).
std::unique_ptr<AUnit> makeUnitByName(const std::string& typeName, int team);

// Reverse lookup from a unit's construction-time printSymbol to its type name.
// Returns "" for symbols no catalog type constructs with (e.g. the runtime
// loose-horse 'H'). Where two types share a symbol (Horse/Warhorse 'h') the
// earlier catalog entry wins.
std::string unitNameForSymbol(char symbol);

// Human-readable name for a UnitCategory ("Foot", "Mounted", ...).
const char* categoryName(UnitCategory cat);

// Full catalog as JSON: {"units":[{name, symbol, size, category,
// forbiddenTerrain, placeable, spawnable, stats{maxHP, attack, defence,
// armour, speed, preferredRange}}, ...]}. Printed by `./game dump-units`;
// the campaign server imports it into the DB at startup.
// NOTE: types whose constructors roll random gear (currently Skeleton) export
// one sampled loadout for attack/defence/armour — treat those as representative,
// not exact.
std::string unitCatalogJson();
