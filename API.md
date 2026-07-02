# API Reference

This document covers every point where data crosses a subsystem boundary: the HTTP server,
the map/scenario loaders, the engine's external entry points, and the frontend's calls into
the server. It does not cover internal engine logic (combat math, movement, targeting) — see
`ARCHITECTURE.md` / `DESIGN.md` for that.

**Trust model**: everything documented here as "untrusted input" comes from the network (HTTP
request bodies/params) or from files that can be selected by a network request (map names).
`auth/` is currently unimplemented (empty placeholder) — there is no authentication on any
endpoint below. Treat this server as suitable for local/trusted-network use only until that
changes; see `SECURITY_NOTES.md`.

---

## 1. HTTP server — `backend/server/`

Started via `./game server <port>`. Binds `0.0.0.0:<port>`. CORS is wide open
(`Access-Control-Allow-Origin: *`).

### `GET /api/info`
Returns static metadata: grid dimensions, hex capacity, deployment zone row ranges, placeable
unit types (with placement size, category, forbidden terrain), and terrain color table.
No input. No errors (always 200).

### `GET /api/map?name=<mapName>`
Returns the raw JSON contents of `maps/<mapName>.json`.
- **Input**: `name` query param, defaults to `sample_battle` if absent.
- **Output**: the map file's JSON verbatim, `Content-Type: application/json`.
- **Errors**: `404 {"error":"map not found"}` if the file doesn't exist.
- ⚠️ `name` is concatenated directly into a filesystem path with no sanitization — see
  SECURITY_NOTES.md (path traversal).

### `POST /api/battle`
Runs one battle and returns the result. Body is a `BattleInput` JSON object:

```jsonc
{
  "map": "sample_battle",                          // optional, default "sample_battle"
  "player_placement": [                             // optional; explicit blue-team placement
    { "unit_type": "Soldier", "q": 3, "r": 5 }, ...
  ],
  "enemy_placement": [ ... ]                         // optional; explicit red-team placement
}
```
If `player_placement`/`enemy_placement` is absent or empty, a hardcoded default army
(`buildDefaultPlayerArmy`/`buildDefaultEnemyArmy`) is randomly placed in the map's deployment
zone instead.

Implementation: the server does **not** run the battle in-process. It writes the request body
to a PID-named temp file under `/tmp`, shells out to `./game battle < in.json > out.json`, and
streams the subprocess's stdout back as the response.

Response (`BattleResult` JSON):
```jsonc
{ "winner": "blue" | "red" | "draw",
  "blue_survivors": { "Soldier": 12, "Archer": 3, ... },  // unit-type → count
  "red_survivors":  { ... } }
```

- **Errors**: `500 {"error":"battle process failed"}` if the subprocess couldn't be read back
  (crashed, or didn't write output).
- ⚠️ No auth, no request size limit, no per-request temp-file uniqueness, no validation of
  `player_placement`/`enemy_placement` entries before they reach the engine — see
  SECURITY_NOTES.md.

---

## 2. Auth — `auth/`

**Not implemented.** The directory contains only `.gitkeep`. No endpoint above requires
credentials of any kind.

---

## 3. Map / scenario loaders — `backend/scenarios/`, `maps/`

### `HexGrid::toJson(cols, rows, name) -> std::string`
Serializes only non-default hexes (terrain ≠ Open, elevation ≠ 0, impassable, or has
blocked/fortified sides) plus deployment zone rows. Used by `dump-map` and by any future map
editor.

### `HexGrid::fromJson(const std::string& jsonStr)`
Parses a map JSON produced by `toJson` (or hand-authored) and applies it to the grid: builds
the grid from `cols`/`rows` if empty, sets per-hex terrain/elevation/impassable, blocked/
fortified sides, and player/enemy deployment zone row ranges.
- **Input**: whatever JSON file `readMapFile()` in `BattleServer.cpp` loaded — reachable
  indirectly from the network via `GET /api/map?name=` and the `"map"` field of
  `POST /api/battle`'s body (both go through the same path-traversal-vulnerable file lookup).
  Any file the traversal can reach that happens to be valid JSON will be parsed here.
- **Errors**: none handled. Missing/wrong-typed `cols`/`rows`/`q`/`r`/`terrain` fields, or
  `cols`/`rows` outside a sane range, throw `nlohmann::json` exceptions or overflow — uncaught,
  crashing the `./game battle` subprocess. See SECURITY_NOTES.md.

### `backend/scenarios/SampleBattle.{hpp,cpp}`, `SpreadTest.{hpp,cpp}`
Hardcoded (not JSON-driven) dev scenarios used only by the SFML `sample`/`spread` modes and to
seed `maps/sample_battle.json`. Not reachable from the network.

---

## 4. Engine entry points — `backend/engine/`

These are the functions through which an `Army` (or its constituent data) crosses into or out
of the simulation core. By the time data reaches these, it has already passed through the
server/UnitRegistry layer above — they are the *last* line of defense, not the first.

### `appendArmy<UnitType>(Army& army, size_t count, int team)` — `BattleSetup.hpp`
Template; pushes `count` freshly-constructed units of `UnitType` onto `army`. `count` is a
`size_t` — no upper bound is enforced here (the caller, e.g. `UnitRegistry`, is responsible for
not passing an unreasonable count).

### `randomPlaceArmy(Army& army, Battlefield& field, PlacementZone zone)` — `BattleSetup.cpp`
Randomly places every not-yet-placed unit in `army` within `zone` (row/col bounds), skipping
hexes that are full or hold an enemy unit.
- **Precondition** (asserted, not gracefully handled): `zone.wEnd >= zone.wStart` and
  `zone.hEnd >= zone.hStart`. A malformed map's deployment zone rows (see `HexGrid::fromJson`
  above) can violate this.
- **On zone-full**: calls `exit(1)`, terminating the whole process — not just returning an
  error. See SECURITY_NOTES.md.

### `Battlefield::loadArmies(Army red, Army blue)`
Takes ownership of both armies (`std::move`) and precomputes flee-distance BFS tables. Assumes
every unit already has a valid hex (asserted via `debugAsserts()` at the top of the first
`tick()`, not at `loadArmies()` itself).

### `Battlefield::tick() -> bool`
Advances the simulation one turn: special abilities → movement → engagement resolution →
combat → cleanup. Returns `true` while both teams still have living units. Takes no external
input — operates purely on state already loaded via `loadArmies`.

### `Battlefield::extractResult() -> BattleResult`
Drains surviving (alive, non-`battleSummon`) units out of both teams into a `BattleResult`,
along with the winner and corpse count. Called once `tick()` returns `false`.

---

## 5. Frontend — `frontend/`

`frontend/src/services/api.js` is the sole point of contact with the server:
- `getInfo()` → `GET /api/info`
- `getMap(name)` → `GET /api/map?name=` (name is `encodeURIComponent`-escaped client-side)
- `postBattle(payload)` → `POST /api/battle`

Consumers:
- `App.jsx` fetches `info`+`map` on mount, drives the setup → augury → placement → battle →
  result phase machine, and is the only place `postBattle` is called (with a
  client-constructed `player_placement` array built from the placement UI's local state).
- `HexGrid.jsx` renders the map (terrain colors from `info.terrain` + `map.hexes`) and the
  placement UI; delegates per-hex unit counts to `ReachMenu.jsx`.
- `ReachMenu.jsx` enforces roster/hex-capacity caps **client-side only**, for UX — the server
  does not re-check the roster budget (only per-hex capacity), so these caps are not a
  security boundary. See SECURITY_NOTES.md.
- `BattleResult.jsx` renders `winner`/`blue_survivors`/`red_survivors` from the server response
  as plain text (React auto-escapes; no `dangerouslySetInnerHTML` anywhere in the frontend).

---

## 6. Rendering — `backend/render/`

`BattleRenderer` (SFML) reads `Battlefield`/`HexGrid`/`AUnit` state to draw the window. It
never receives external input directly — everything it reads has already been validated (or
not) further upstream. Not a trust boundary; documented here only because the task scope named
it as one of the six areas.
