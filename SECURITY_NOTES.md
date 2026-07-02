# Security Notes

Findings from a boundary audit of `backend/server/`, `auth/`, `backend/scenarios/`+`maps/`,
the engine entry points, `frontend/`, and `backend/render/` — see `API.md` for what each
boundary does. Scope: input crossing from the frontend/network into the engine is treated as
untrusted. Internal-only logic is out of scope.

Status legend: **Open** = documented, not yet fixed. **Fixed** = fixed in this branch, with a
regression test. **Accepted / follow-up** = documented but deliberately not fixed here because
it needs a design decision beyond a bug-fix pass.

---

## Findings

### 1. Path traversal in map name lookup — Critical — Accepted / follow-up needs auth first
**Where**: `backend/server/src/BattleServer.cpp:196-207` (`GET /api/map`), and
`readMapFile()` at `BattleServer.cpp:87-92`, reached from `POST /api/battle` via the `"map"`
JSON field (`BattleServer.cpp:135-141`).

Both build a filesystem path as `"maps/" + name + ".json"` with zero sanitization of `name`.
`name` comes directly from the `?name=` query param or the request body's `"map"` field —
fully attacker-controlled. A request like `GET /api/map?name=../../../../etc/passwd%00` (no
null-truncation in C++, but `..`-sequences work fine) can read any `.json`-suffixed file
reachable from the process's working directory, and — via `POST /api/battle`'s `"map"` field —
can also cause `HexGrid::fromJson` to parse attacker-chosen file content (see finding 3).

**Status: Fixed** — see commit "Fix path traversal in map name lookup". Reject any `name`
containing `/`, `\`, or `..`, or that is empty, before building the path.

### 2. No authentication on any endpoint — Critical — Accepted / follow-up
**Where**: `backend/server/src/BattleServer.cpp` (all three routes), `auth/` (empty).

Every endpoint, including `POST /api/battle` (which spawns a subprocess per request) is open
to anyone who can reach the port. `auth/` is an empty placeholder — there is no session,
token, or API-key mechanism to hang a check on yet.

**Not fixed in this pass**: adding real authentication is a design decision (session vs. API
key vs. reverse-proxy auth, single-player-campaign-vs-multiplayer intent, etc.), not a bug fix.
Flagging as the top follow-up item. Until it exists, treat this server as local/trusted-network
only — do not expose the port publicly.

### 3. Uncaught exceptions from malformed JSON crash the battle subprocess — High — Fixed
**Where**: `backend/server/src/UnitRegistry.cpp` `buildArmyFromPlacement()` (was
`UnitRegistry.cpp:131-173`); `backend/engine/src/hex/HexGrid.cpp` `fromJson()` (was
`HexGrid.cpp:377-420`).

Both call `nlohmann::json::operator[]` / `.get<int>()` / `.get<std::string>()` directly on
attacker-controlled JSON without checking the key exists or has the right type first. A
`player_placement` entry missing `"unit_type"`, `"q"`, or `"r"` (or with e.g. `"q": "abc"`)
throws `json::out_of_range` / `json::type_error`. `runBattleFromJson()` only wraps the *outer*
`json::parse(input)` in try/catch (`BattleServer.cpp:126-132`) — `buildArmyFromPlacement()` and
`field.hexGrid.fromJson()` are called *outside* that try/catch, so the exception is uncaught
and terminates the `./game battle` subprocess (SIGABRT via `std::terminate`).

Impact: any client can crash the battle subprocess per request with a single malformed field —
cheap repeatable DoS against `/api/battle` (the parent server itself survives; it just returns
500, but every such request burns a process spawn).

**Status: Fixed** — validate field presence/type in `buildArmyFromPlacement` and
`HexGrid::fromJson`, skip malformed entries instead of throwing; wrap the whole
`runBattleFromJson` body in try/catch as defense in depth.

### 4. Unbounded placement array size — Medium — Fixed
**Where**: `backend/server/src/UnitRegistry.cpp` `buildArmyFromPlacement()`.

The loop over `player_placement`/`enemy_placement` has no cap on array length. A client can
send an array with millions of entries; each iteration heap-allocates a unit
(`std::make_unique<Soldier>` etc.) before any capacity check rejects it. Resource-exhaustion
DoS, cheap to send (a JSON array of `{"unit_type":"Soldier","q":0,"r":0}` repeated is small on
the wire but expensive to process).

**Status: Fixed** — cap placement array length before processing (loop simply stops
accepting entries past the cap; already-collected units are kept, not an error).

### 5. No server-side roster/budget validation — Medium — Accepted / follow-up
**Where**: `backend/server/src/UnitRegistry.cpp` `buildArmyFromPlacement()`.

The only checks applied to a placement entry are: known unit type, valid non-impassable hex in
the placement zone, terrain allowed for the unit's category, and per-hex capacity. There is no
check against any campaign-level "roster" or "budget" — a client can place an arbitrary number
of any unit type anywhere in its zone regardless of what the (client-side-only) roster in
`frontend/src/App.jsx`/`ReachMenu.jsx` says is available. `ReachMenu.jsx`'s caps
(`frontend/src/components/ReachMenu.jsx:18-22`) are UX only, not enforcement.

**Not fixed in this pass**: there is currently no server-side concept of "a player's roster" to
validate against — the server is stateless per-battle. This needs the roster/campaign state to
move server-side (ties into the TODO.txt item about migrating battle state to a DB) before it
can be enforced. Flagged as a design-scope item, not a one-line fix.

### 6. `randomPlaceArmy` calls `exit(1)` on a recoverable condition — Medium — Fixed
**Where**: `backend/engine/src/BattleSetup.cpp:57-61`.

If the deployment zone is too small for the army being placed, the function calls
`std::exit(1)`, terminating the entire process immediately — including, in the `/api/battle`
subprocess case, mid-battle with no output written, and in any future in-process caller (the
Makefile SFML modes), the whole `./game` process. A capacity-exceeding army (reachable from
attacker-controlled placement data — a huge default-army fallback combined with a small custom
map's zone, or a future explicit-placement-with-overflow path) can be used to kill the process
outright rather than fail gracefully.

**Status: Fixed** — `randomPlaceArmy` now returns `bool` (false = zone was too small to place
everyone) instead of exiting; `runBattleFromJson` checks the return value and responds with a
JSON error instead of the process dying. Existing internal-only call sites in `main.cpp`/
scenarios were also possible callers, so the signature change is a breaking-but-mechanical
change no more than 6 call sites deep — see the fix commit for the full list.

### 7. Deployment zone assertion can be violated by a malformed map — Medium — Fixed
**Where**: `backend/engine/src/BattleSetup.cpp:8-9` (`assert(zone.hEnd >= zone.hStart)` etc.);
data flows in from `HexGrid::fromJson`'s `player_zone_rows`/`enemy_zone_rows`
(`HexGrid.cpp:384-391`) with no validation that `min <= max` or that either is within
`[0, rows)`.

Since asserts are compiled in (no `-DNDEBUG` in the Makefile's `CFLAGS`), a violated assertion
aborts the process — same DoS shape as finding 6, but reachable purely through a bad map file
(itself reachable via finding 1's path traversal, or simply a corrupted/hand-edited map JSON).

**Status: Fixed** — `HexGrid::fromJson` now clamps/rejects zone rows that are out of range or
inverted (min > max) instead of storing them as-is; added a regression test.

### 8. `cols`/`rows` in map JSON are not bounds-checked before grid allocation — Low — Accepted / follow-up
**Where**: `backend/engine/src/hex/HexGrid.cpp` `fromJson()` → `buildRect(cols, rows)`
(`HexGrid.cpp:125-149`).

`j["cols"].get<int>()` / `j["rows"].get<int>()` accept any `int`, including negative or huge
values, with no range check before `buildRect` computes `cols * rows` (int, can overflow) and
reserves that many hex map entries. A crafted map file with e.g. `"cols": 1000000000` can
trigger a very large allocation attempt.

**Not fixed in this pass**: lower severity than findings 1-7 (only reachable through the same
path-traversal/malformed-file vector as finding 3, and `Battlefield::width`/`height` are
actually fixed compile-time constants in the only real caller — `runBattleFromJson` always
loads the map into the already-built `Battlefield::hexGrid`, so `buildRect` only runs if
`_hexes.empty()`, i.e. this path is largely dev/tooling-only today). Flagged for when map files
become more dynamically generated/uploaded.

---

## Test-audit notes

See commit "Test audit: gaps and regressions" for what was found. Summary once that pass is
complete: `[to be filled in]`.
