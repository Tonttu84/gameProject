# Adding a new unit type — where stats live and what gets generated

## TL;DR

1. Write the unit class; **all stats go in its constructor** (`backend/engine/src/units/`).
2. Add **one line** to the catalog table in `backend/engine/src/UnitCatalog.cpp`.
3. `make` → restart the campaign server. Everything downstream regenerates itself.
4. Update the expected-names list in `backend/engine/tests/test_unit_catalog.cpp`
   (a deliberate tripwire so a new type can't be forgotten in review).

No Makefile changes, no frontend changes, no DB migration.

## 1. The source of truth: the unit constructor

Create `backend/engine/include/units/YourUnit.hpp` + `backend/engine/src/units/YourUnit.cpp`
(copy the closest existing unit — `Scorpion` is the smallest clean example). Everything the
rest of the system knows about the type is read off a live instance, so the constructor IS
the stat sheet:

| Fact                | Where it's set in the constructor                          |
| ------------------- | ---------------------------------------------------------- |
| name                | *not in the constructor* — the catalog entry (step 2)      |
| symbol              | `printSymbol = 'y';` (pick an unused character)            |
| size                | `size = SIZE;` with `static constexpr int SIZE = …;` in the header |
| category / forbidden terrain | `setCategory(UnitCategory::…)`; forbidden terrain derives from the category via `forbiddenTerrainForCategory()` in `AUnit.hpp` — do **not** list terrain per unit |
| maxHP / attack / defence / armour | `maxHP`, `hitpoints`, `attackPWR`, `defence`, `armour` |
| speed / preferred range | `movementSpeed`, `preferredRange`                      |
| weapons             | `addWeapon(MeleeWeapons::…)` (may modify defence/shield)   |

Change a stat here later and it propagates everywhere on rebuild + server restart — that is
the whole point of the design. Don't copy stats anywhere else.

## 2. Register it in the catalog (the only hand-maintained list)

`backend/engine/src/UnitCatalog.cpp`, in `unitCatalog()`:

```cpp
{"YourUnit", /*placeable*/ false, /*spawnable*/ false, makeT<YourUnit>},
```

- `placeable` — offered to the player: appears in `/api/info` and the placement UI.
- `spawnable` — accepted by the battle placement API at all (Necromancer is spawnable but
  not placeable: enemy armies use it, players can't pick it).
- neither — battle-internal (summons, mounts): appears in battles/replays but can never
  enter through the API.

Include the header at the top of `UnitCatalog.cpp`.

## 3. What is generated from those two places

Nothing below is ever edited by hand:

- `./game dump-units` — full catalog JSON (name, symbol, size, category, forbiddenTerrain,
  placeable, spawnable, stats), values read off a freshly constructed instance.
- **Campaign DB** — `campaign-server` runs `dump-units` at boot and upserts into the
  `unittypes` collection through a strict Mongoose schema (`campaign-server/models/unitType.js`,
  sync logic in `services/catalogSync.js`). A malformed/drifted export aborts the boot.
- `GET /api/units` — the DB catalog, consumed by the frontend.
- `GET /api/info` — grid info + the `placeable` subset for the placement UI.
- Placement factory — `buildArmyFromPlacement` builds units via the catalog factory
  (`makeUnitByName`), so `"unit_type": "YourUnit"` works iff `spawnable`.
- Survivor counts and replay unit types — symbol→name lookup (`unitNameForSymbol`).

Workflow after any stat/type change:

```sh
make                      # rebuild ./game
# restart campaign server (npm start in campaign-server/) → boot re-syncs the DB
```

## 4. Makefile

**No updates needed.** The Makefile discovers sources recursively
(`find backend -name '*.cpp'`), so new unit files compile automatically, and the catalog
export happens at *runtime* (`dump-units` at server boot), not at build time — there is no
generated file to add to the build graph.

## 5. Tests to touch

- `backend/engine/tests/test_unit_catalog.cpp` — add the type name to the expected-names
  list in *"lists every unit type in the engine"*. The other catalog tests
  (live-instance match, field shape) cover the new type automatically.
- If the constructor rolls **random gear** (like Skeleton's burial weapons/armour), add the
  type to the `randomizedLoadout` set in the live-instance test; its exported
  attack/defence/armour are then one sampled loadout, documented as representative.

## 6. Gotchas

- **Symbol collisions**: `unitNameForSymbol` resolves a shared symbol to the *earlier*
  catalog entry (Horse and Warhorse both print `'h'` → both count as "Horse" in survivors
  and replays). Prefer a unique symbol.
- **Runtime symbols**: a symbol assigned mid-battle that no type constructs with (the
  loose-horse `'H'` after a cavalry rider dies) is not in the catalog; replays fall back to
  the raw symbol as the type string and survivor counting skips it.
- **Frontend roster**: `STARTING_ROSTER` in `frontend/src/App.jsx` is the one remaining
  hardcoded unit list (starting army composition — campaign design data, not unit facts).
  It moves to the DB with the campaign-persistence work.
