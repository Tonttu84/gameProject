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
| speed / preferred range | `movementSpeed` (hexes per tick — implemented, not cosmetic), `preferredRange` |
| ballistic skill     | `setBallisticSkill(n)` — melee-attack scale (10 = trained archer); derives the legacy 0-100 `accuracy` as n×5. Campaign scouting/foraging values derive from speed + this (`campaign-server/utils/capabilities.js`) |
| weapons             | `addWeapon(MeleeWeapons::…)` (may modify defence/shield)   |

Change a stat here later and it propagates everywhere on rebuild + server restart — that is
the whole point of the design. Don't copy stats anywhere else.

## 2. Register it in the catalog (the only hand-maintained list)

`backend/engine/src/UnitCatalog.cpp`, in `unitCatalog()`:

```cpp
{"YourUnit", UnitRole::Enemy | UnitRole::Mount, makeT<YourUnit>},
```

The one decision per row is **which roles the type carries** — the channels through which
it may legitimately enter play. They are a **composable set, not a single kind**: list
every role that applies.

| role | meaning |
| ------ | --------------------------------------------------------------------- |
| `Player` | the player recruits, owns and deploys it; appears in `/api/info` and the placement UI |
| `Enemy`  | enemy hosts may field it (campaign-server's `ENEMY_ARMY`)             |
| `Summon` | conjured mid-battle by a spell; never enters through the API          |
| `Mount`  | exists under a rider; never a standalone army entry                   |

Every type must carry **at least one** role — a roleless entry is unreachable by any code
path, and a test fails on it.

Two things follow automatically, so don't look for separate switches:

- **`/api/info`** offers exactly the `Player` types.
- **`makeUnitByName`** — the API trust boundary — accepts exactly `Player | Enemy`.
  Summon-only and mount-only types cannot be built from request JSON at all.

`Enemy` is **descriptive, not exclusive**. Soldier, Archer and LightCavalry carry
`Player | Enemy` because the campaign's enemy host really does field them, even though the
player recruits them too. Scorpion is `Enemy | Mount`: a mount that an enemy may also field
on its own legs — the case that made roles a set rather than a single kind.

> These replaced the old `placeable`/`spawnable` booleans (2026-08-10), which said the same
> thing twice and could express nonsense like `placeable && !spawnable`.

Include the header at the top of `UnitCatalog.cpp`.

### If your unit is a `Player` type, it needs a recruit row

A player unit the player cannot obtain is a dead entry. Add a row to `RECRUIT_POOL` in
`campaign-server/services/recruit.js` — see §5 for the test that enforces this. That file
is campaign design data (costs, the promotion ladder) and deliberately lives outside the
engine: the dependency runs campaign → engine, never back.

## 3. What is generated from those two places

Nothing below is ever edited by hand:

- `./game dump-units` — full catalog JSON (name, symbol, size, category, forbiddenTerrain,
  roles, stats), values read off a freshly constructed instance.
- **Campaign DB** — `campaign-server` runs `dump-units` at boot and upserts into the
  `unittypes` collection through a strict Mongoose schema (`campaign-server/models/unitType.js`,
  sync logic in `services/catalogSync.js`). A malformed/drifted export aborts the boot.
- `GET /api/units` — the DB catalog, consumed by the frontend.
- `GET /api/info` — grid info + the `Player`-role subset for the placement UI.
- Placement factory — `buildArmyFromPlacement` builds units via the catalog factory
  (`makeUnitByName`), so `"unit_type": "YourUnit"` works iff the type is `Player` or `Enemy`.
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
  list in *"lists every unit type in the engine"*, **and to its role set(s) in *"roles mark
  exactly the intended types"***. The other catalog tests (live-instance match, field shape,
  API-acceptance derivation) cover the new type automatically.
- `campaign-server/tests/engine.integration.test.js` — nothing to edit, but be ready for it
  to fail: it runs the **real binary** and cross-checks the catalog's roles against the
  campaign's unit lists. Four rules, each naming the offending unit when it trips:
  - every `Player` type has a `RECRUIT_POOL` entry (§2) — **no exemptions, casters included**;
  - `RECRUIT_POOL` (and the Travellers fallback) only sells `Player` types, so a typo'd
    `unit:` can't sell a unit no battle could deploy;
  - `ENEMY_ARMY` fields only `Enemy` types;
  - `STARTING_ROSTER`/`STARTING_SQUADS` contain only `Player` types.

  These live campaign-side because only the campaign layer can see both its own config and
  the engine dump — the engine knows nothing about recruiting, and must not.
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
