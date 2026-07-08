# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning & session continuity (multi-machine)

This project is developed across **multiple computers**. Keep plans, TODOs, staged designs, and
session-handoff notes **in the repo so they travel with git** — never leave durable project state
only in Claude's per-machine auto-memory (`~/.claude/…`, which does NOT move between machines).

- **`docs/CAMPAIGN_PLAN.md`** is the living campaign-mode plan + session handoff (what's done,
  what's next, working conventions). Read it at the start of a campaign-mode session; **update and
  commit it** whenever a stage lands or the plan changes.
- Put new plans/design docs under `docs/` (precedent: `docs/RENDERING_PLAN.md`,
  `docs/CAMPAIGN_PLAN.md`) rather than in machine-local memory.
- Auto-memory may still be used for cross-project user preferences, but anything another machine
  needs to continue the work belongs in a committed file.

## Build & test commands

This is a Linux-targeted project. The engine is fully headless (no SFML/X11/font deps — the
browser is the only renderer), so `make` just needs g++/clang++ + make on the host. There is no
native Windows build path and none is planned — Windows machines run the stack via Docker (see
`make docker-up`) or WSL.

```sh
make                 # builds ./game (fully headless — no SFML/X11)
make clean / fclean   # remove objects / remove objects+binaries
make re               # fclean + all

make test             # builds run_tests, shards test cases across processes via
                       # backend/engine/tests/run_parallel.sh (JOBS=N to override shard count)
make test-serial       # builds run_tests, runs it as one process — this is what CI uses
                       # (a sharding bug in run_parallel.sh must never be able to mask a
                       # failure that test-serial would catch)
make clang             # cross-compile with clang++ into a separate object dir (catches
                       # compiler-specific UB/warnings gcc doesn't)

make server            # ./game server 8080 — starts the HTTP campaign server
make frontend          # cd frontend && npm run dev — Vite dev server
make serve             # both of the above together
make frontend-test     # npm --prefix frontend test (vitest run), via the pinned nvm node

make docker-up         # docker compose up --build: the WHOLE stack (engine + campaign
                        # server + built frontend + MongoDB) in containers on
                        # http://localhost:3001, login testuser/test. For machines with
                        # Docker (e.g. Windows via Docker Desktop). Battles are headless
                        # (no X server), so the image is plain node + the engine binary.
                        # CI's "docker" job builds this image and smokes a full campaign
                        # turn through it.
make docker-down       # stop the stack (campaign DB volume survives)
make docker-clean      # stop AND wipe the campaign DB volume (Docker twin of db-clean)
make docker-logs       # follow the game server's container logs
make docker-build      # build just the image, start nothing

./game info                       # headless: print buildInfoJson() and exit
./game server 8080                # headless: run the HTTP server
./game dump-map [path]             # headless: write the sample battle's terrain to JSON
./game battle < in.json > out.json # headless: run one battle from BattleInput JSON on
                                    # stdin, print BattleResult JSON (result + recorded
                                    # replay) to stdout (this is what POST /api/battle
                                    # spawns as a subprocess)
./game sample                      # headless dev scenario: simulate and print the SAME
                                    # {result, replay} JSON as `battle` to stdout. The
                                    # campaign server runs it via POST /api/sample-battle
                                    # (the login-screen "Watch a battle" demo), persisting
                                    # it through the one battle pipeline so the browser
                                    # ReplayView renders it from the DB like any battle.
./game spread [outDir]             # headless dev scenario: one replay JSON per terrain to
                                    #   outDir (default replays/). Browser ReplayView is the
                                    #   only renderer.
```

Frontend-only commands (run from `frontend/`): `npm run dev`, `npm run build`, `npm run lint`
(oxlint), `npm test` (vitest run), `npm run test:watch`.

To run a single C++ test case, build `run_tests` (via `make test-serial` once, or directly) and
invoke the Catch2 binary with a name filter, e.g. `./run_tests "[movement]"` or
`./run_tests "specific test name"`. Test sources live in `backend/engine/tests/*.cpp`, framework
is `catch.hpp` (bundled). All engine sources are compiled a second time with `-DTESTING` for the
test binary.

To run a single Vitest test: `cd frontend && npx vitest run src/__tests__/placementBudget.test.jsx`.

## Architecture

The C++ **battle engine** (`backend/engine/`) is the only fully implemented subsystem; the
strategic campaign layer is a placeholder React app (`frontend/`) that talks to it over HTTP.
See `ARCHITECTURE.md` for the full data-flow diagrams and `DESIGN.md` for hex/formation/combat
design (most of DESIGN.md is marked `[PLANNED]` and not yet implemented — the hex-side
engagement/frontage/formation system it describes is only partially built in
`Battlefield::resolveEngagements()`).

**Module boundaries** (mirrored under `BUILD/` by the Makefile's recursive source discovery):
- `backend/engine/` — core simulation: `HexGrid`/`Hex`/`HexSide`, `AUnit` hierarchy
  (`Human` → `Soldier`/`Archer`/`Mage`/`Priest`/`Necromancer`, plus `Cavalry`, `Zombie`,
  `Skeleton`, `Scorpion`), `Battlefield` (owns two `Team`s), `Squad`/`Wing` formation grouping,
  `Utility` (global RNG/targeting/distance singleton accessor).
- Rendering lives entirely in the browser: `frontend/src/components/ReplayView.jsx` draws
  battles from the recorded per-tick JSON. There is no C++/SFML renderer (retired 2026-07-07);
  `FormationLayout` (engine) is the single source of in-hex unit positions, which
  `ReplayRecorder` writes into each tick.
- `backend/server/` — `httplib`-based HTTP server (`BattleServer.cpp`) and the JSON unit
  factory / army-from-placement builder (`UnitRegistry.cpp`). This is the trust boundary between
  the outside world and the engine.
- `backend/scenarios/` — hardcoded dev scenarios (`SampleBattle`, `SpreadTest`) run headless by
  the `sample`/`spread` modes (each writes a replay JSON) and used to seed
  `maps/sample_battle.json` via `dump-map`.
- `auth/` — currently just a `.gitkeep`; no authentication is implemented yet. Every HTTP
  endpoint in `BattleServer.cpp` is unauthenticated.
- `maps/` — JSON map files (terrain/elevation/impassable/deployment zones), read by
  `HexGrid::fromJson` / written by `HexGrid::toJson`.
- `frontend/` — React (Vite) campaign UI. `frontend/src/services/api.js` is the only place HTTP
  calls to the C++ server are made.

**Per-tick flow** (`Battlefield::tick()`): `triggerSpecialPhase()` (archers/mages/priests/
necromancers act) → `moveUnits()` (squad pre-pass, then per-unit movement/flee/preferred-range
logic) → `resolveEngagements()` (assigns units to contested hex sides, squads before loners,
fresh before tired) → `makeBattle()` (interleaved red/blue attacks) → `cleanup()` (prune dead).

**Process model**: `./game server` runs one long-lived `httplib` server. `POST /api/battle`
does *not* run the battle in-process — it shells out to `./game battle` as a subprocess (via
`std::system`), piping the request body in on stdin and reading `BattleResult` JSON back from
its stdout, using PID-named temp files in `/tmp`.

**Army transfer type**: `Army = std::vector<std::unique_ptr<AUnit>>` is the value passed across
every boundary (`loadArmies`, `BattleResult::redSurvivors`/`blueSurvivors`, `appendArmy<T>`).
Units with `battleSummon = true` (e.g. necromancer-raised zombies) are filtered out before
survivors cross back out of the engine.
