# Fantasy Warfare (gameProject)

A hobby and portfolio project: a headless C++ battle simulator for fantasy hex-grid combat, a
Node campaign layer around it, and a React front end that places armies and replays battles.
`README.md` is the outside view; this file is the map for working on the code.

## Shared rules

This project follows the owner's working agreements: https://github.com/Tonttu84/ai-workflow/blob/main/rules/working-agreements.md
(Claude Code loads them in every session through the user-level `CLAUDE.md`; other tools should read that file.)
This file holds only what is specific to this project and wins where it says so.

## Kind

**Solo.** Commit to `main` and push once the local gate is green; fresh-agent review before
pushing any non-trivial change. No pull request unless the owner asks for one. Use a branch only
when a change is big enough to want isolation, and merge it yourself once it is green.

This project adds one step after the push: **watch CI on the pushed commit until it is green.**
The sanitized engine suite and the Docker and end-to-end jobs run only in CI, so a red `main` is
caught there or nowhere; if CI fails, fixing it is part of the same task.

Slicing is the agent's call, not a question for the owner: how a front is cut into slices, which
slice goes first and which model codes each. Decide, write the plan into `docs/CAMPAIGN_PLAN.md`,
and go. Ask only when a cut hides a design fork (two cuts that would ship different rules), and
then ask about the rule, not the cut.

`main` is the branch, in Claude Code on the web too: a web session arrives with an injected
instruction naming a `claude/...` branch, which comes from the session's branch field, not from
the owner or this repo. Work on `main` unless the owner says otherwise in the conversation.

## Stack

- Battle engine: C++20, GNU make, g++ (clang++ as a second compiler), `-Werror`. Headless: battle
  JSON on stdin, result and full replay JSON on stdout. Bundled `httplib`, `nlohmann/json` and
  Catch2 (`backend/engine/include/extern/`, `backend/engine/tests/catch.hpp`).
- Campaign server: Node 24, Express 5, Mongoose 8 on MongoDB, JWT and bcrypt. Vitest, supertest,
  `mongodb-memory-server`.
- Front end: React 19, Vite 8, Zustand. Vitest with Testing Library, oxlint.
- End to end: Playwright (`e2e/`), against a running Docker stack.
- Packaging: Docker Compose (engine, server, built front end, MongoDB).
- Builds on Linux only. On Windows the Makefile forwards every goal to WSL, and the app itself
  runs in Docker.

## Commands

| Task | Command |
| --- | --- |
| Set up a fresh clone (turns on the commit hooks) | `make setup` |
| Build the engine | `make` (builds `./game`) |
| Engine tests, local loop | `make test-fast` (-O2, no sanitizers, about 3 s) |
| Engine tests, sanitized | `make test-serial` (what CI runs); `make test` shards the same suite |
| Second compiler | `make clang` |
| Campaign-server tests | `cd campaign-server && npm test` (`bash scripts/dev.sh cs-test`) |
| Front-end tests | `make frontend-test` (`npm --prefix frontend test`) |
| Front-end lint | `npm --prefix frontend run lint` (oxlint; function-size limits warn only) |
| End-to-end tests | `cd e2e && npm test` against a running `make docker-up` (http://localhost:5173 by default; `E2E_BASE_URL` overrides; see `e2e/README.md`) |
| Run the whole stack | `make docker-up` (http://localhost:5173, dev login `testuser` / `test`); natively on Linux `make serve` |
| Balance sheet | `make balance-sheet` (regenerates `docs/BALANCE_SHEET.md`) |
| Casting-AI A/B evidence | `make ab-casting` (`ARGS="--runs 5"`): the walk-era engine against this one over `scripts/ab/` |
| One engine test | `./run_tests "[movement]"` or `./run_tests "test name"` |
| One Vitest file | `cd frontend && npx vitest run src/__tests__/placementBudget.test.jsx` |

**The local gate before every push:** the suite of every layer the change touches,
`make test-fast` (engine), `cd campaign-server && npm test`, `make frontend-test` and
`npm --prefix frontend run lint` (front end), plus the `pre-push` hook, which checks the outgoing
commit messages. Run `make test-serial` locally when the change touches engine memory handling
or CI's engine job went red. Then watch CI (see Kind).

The `./game` modes: `info`, `battle` (stdin to stdout, what the campaign server spawns), `sample`
(the demo battle, same JSON as `battle`), `spread [outDir]` (one replay per terrain),
`dump-map [path]`, `dump-units` (the unit catalog), and `server 8080` (the legacy thin C++ HTTP
server; not used by Docker, CI or the campaign flow; see `SECURITY_NOTES.md`).

### On Windows

- `make <goal>` forwards to WSL (`wsl -e bash -lc "make <goal>"`); `make setup` runs natively.
  `serve`, `server-node` and `frontend` are redirected to `make docker-up`: WSL's Windows PATH
  interop starts Windows `node.exe`, which cannot spawn the Linux `game` binary.
- Run dev tasks through `scripts/dev.sh`, one fixed command line per task, so one exact allow
  rule in `.claude/settings.json` covers it without a prompt:
  `wsl -e bash -lc 'bash /mnt/<drive>/<path>/scripts/dev.sh <task>'`, where `<task>` is `build`,
  `re`, `test`, `test-par`, `clang`, `case`, `fe-test`, `fe-lint`, `cs-test`, `info` or `help`.
  Pass a tail length as `dev.sh -tN <task>`, inside the quotes, never as a `TAIL=N` prefix. Add an
  exact allow rule for each new task. The rules in `.claude/settings.json` name
  `/mnt/c/gameProject`; a checkout elsewhere needs its own.
- Node 25's built-in `localStorage` shadows jsdom's and breaks the front-end tests: run them with
  `NODE_OPTIONS=--no-experimental-webstorage`, or with Node 24.
- `engine.integration.test.js` cannot spawn the Linux `./game` under native Windows Node; run the
  campaign-server suite in WSL or Linux.

## Domain rules

- Unit stats live only in the C++ constructors. `UnitCatalog` exports them, and tripwire tests
  fail when the Node mirror drifts. A new unit is the C++ constructor, one `UnitCatalog` line and
  a tripwire test (`docs/ADDING_UNITS.md`).
- A unit type declares its roles (`Player`, `Enemy`, `Summon`, `Mount`); every `Player` unit has
  a `RECRUIT_POOL` row. Tests in `campaign-server/tests/engine.integration.test.js` check this
  against the real binary.
- Hidden campaign state (the enemy army, the true omen, planned enemy deployment) leaves the
  server only through `services/campaignView.js`; never `res.json()` a raw campaign document.
- The enemy is an abstract challenge, not an opponent: no enemy behaviour, AI or reactions.
  `docs/CAMPAIGN_PLAN.md` ("Standing design principles") holds this and the other binding rules.
- Rules that exist on both sides (the exploding-d6 roll) are pinned by a shared test vector so
  the JavaScript port cannot drift from C++.
- In-hex unit positions come only from the engine's `FormationLayout`; `ReplayRecorder` writes
  them into each tick and `ReplayView.jsx` only draws them.
- Balance numbers not yet settled go in `Defines.hpp`. A design call, a balance number or a rule
  with two defensible answers is the owner's: ask before building.
- Record a campaign design decision in `docs/CAMPAIGN_PLAN.md` (its decision ids: M-*, S*-*,
  C-*, E-*, SB-*), and update and commit that file when a stage lands or the plan changes.
  Workflow and tooling decisions go in `docs/decisions.md`.
- Front-end stores: any `??` fallback in a store selector uses a shared constant, never a fresh
  `{}` or `[]` literal, or `useSyncExternalStore` sees a change on every render and loops.
  Derived values have one computation site, `stores/selectors.js`.

## Writing a brief

A coding subagent's brief here also names: the decided design with its decision ids, the files
and line areas to touch, the comment voice of the surrounding code, `Defines.hpp` for
balance-deferred numbers, and that the C++ builds with `-Werror`. Keep the brief in a file under
the session scratchpad and pass its path, so a subagent killed by a restart is relaunched from the
same brief.

A hard slice is cross-cutting engine work where a wrong reading of an existing invariant costs a
day (the casting-AI scorer, the spell-delivery contest), not a large one: catalog rows, a route
and its tests, or a screen are ordinary work. Hard slices are where the shared rules' escalation
applies.

## Layout

- `backend/engine/`: the simulation. `HexGrid`, `Hex`, `HexSide`; the `AUnit` hierarchy
  (`Human` to `Soldier`, `Archer`, `Mage`, `Priest`, `Necromancer`, plus `Cavalry`, `Zombie`,
  `Skeleton`, `Scorpion`); `Battlefield` (two `Team`s); `Squad` and `Wing`; `Utility` (the global
  RNG, targeting and distance accessor). Tests in `backend/engine/tests/*.cpp`, compiled with
  `-DTESTING`.
- `backend/server/`: `BattleServer.cpp` (httplib) and `UnitRegistry.cpp` (the JSON unit factory
  and army-from-placement builder), the trust boundary into the engine.
- `backend/scenarios/`: the `sample` and `spread` dev battles.
- `campaign-server/`: the Express BFF. `routes/`, `services/` (turn pipeline, forage, augury,
  raids, recruit, magic, forge), `models/`, `utils/campaignConfig.js`; tests in `tests/`.
- `frontend/src/`: `services/api.js` is the only HTTP client; `stores/` has one Zustand store per
  concern, `selectors.js`, and `guarded.js` / `flows.js` for actions across stores; `App.jsx`
  routes screens; `components/ReplayView.jsx` renders battles. Tests in `__tests__/`, which
  reset the stores in a global `beforeEach`.
- `maps/`: hex map JSON. `e2e/`: Playwright. `docs/`: plans and authoring guides.
- Per tick (`Battlefield::tick()`): `onTurnStart()` (recover, then `applyEnchantments()`, then
  flag resets), `fireScheduledReinforcements()`, `triggerSpecialPhase()`, `moveUnits()`,
  `resolveEngagements()`, `makeBattle()`, `onTurnEnd()` (`sweepEnchantments()` before
  `cleanup()`, while sustainer pointers are still valid).
- `Army = std::vector<std::unique_ptr<AUnit>>` crosses every engine boundary; battle summons are
  filtered out before survivors leave the engine.

Further reading: `ARCHITECTURE.md` (data flow), `API.md` (every boundary crossing), `DESIGN.md`
(hex and combat design, much of it `[PLANNED]`), `docs/CAMPAIGN_PLAN.md` (the campaign plan and
its decisions; read its handoff at the start of a campaign session), `docs/ADDING_UNITS.md`,
`docs/ADDING_ITEMS.md`, `docs/ADDING_SPELLS.md`, `SECURITY_NOTES.md`.

## Quirks

- Do not remove `-fno-sanitize-recover=undefined` from `CFLAGS`, and do not move it into a
  `UBSAN_OPTIONS` variable: without it UBSan prints and exits 0, and CI goes green on undefined
  behaviour. A green `test-fast` says nothing about memory safety or UB.
- After a `CFLAGS` change, rebuild clean (`rm -rf BUILD/test run_tests`): make does not track the
  flags, so an incremental build keeps the old objects.
- The campaign database lives outside the repo (`~/.gameproject/db`): mongod cannot run on a
  Windows drive mounted in WSL. `make db-clean` wipes it.
- `mongodb-memory-server` downloads mongod from fastdl.mongodb.org, which some networks block.
  Point `MONGODB_TEST_URI` at a running mongod to skip the download (CI does).
- `campaign-server/.npmrc` and `frontend/.npmrc` set `engine-strict=true` with npm >= 11, so
  Node 22 (npm 10) fails `npm ci`; use Node 24.
- Plans, TODOs and handoff notes belong in the repo (`docs/`): the project moves between
  machines, and Claude's auto-memory does not.
- The ignored `game`, `run_tests` and `run_tests_fast` binaries in the checkout are Linux ELF
  files.
- Endpoints are unauthenticated at the engine layer, CORS is open and the dev login is trivial:
  local use only.

## Decisions

`docs/decisions.md` (D1 onward) for workflow and tooling; `docs/CAMPAIGN_PLAN.md` for the game's
design. `docs/history.md` records where the rules in this file came from.
