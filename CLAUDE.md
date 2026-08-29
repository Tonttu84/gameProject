# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Grill before you build

`/grill-me` and its underlying `grilling` skill are vendored under `.claude/skills/` (from
[mattpocock/skills](https://github.com/mattpocock/skills)) specifically so this fires
**proactively, not just when typed**: before starting any large or ambiguous plan or
implementation, if your confidence in the requirements is only medium or low, invoke the
`grilling` skill and interview the user rather than guessing and building on an assumption.
Staying aligned with the user outranks moving fast — err toward grilling too often rather
than too rarely. Don't act on the plan until the interview reaches a shared understanding.

## Division of labour: plan with Fable, code with an Opus subagent

**Standing instruction (user, 2026-08-28): the interviewing/planning model (Fable) does the design
work — grilling, decision records, specs, review — and hands the actual code-writing to an Opus
subagent via the Agent tool (`model: "opus"`).** Write the subagent a complete, self-contained
spec: the decided design with decision numbers, the files and line areas to touch, repo
conventions (comment voice, Defines.hpp for balance-deferred numbers, -Werror), the tests to
write, and the verification to run before it reports back. Review the returned diff yourself,
run the suites yourself, and keep the commit/merge responsibility — the subagent writes code,
it does not ship it.

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

**Check the branch before the first commit of a session or after a `/clear`.** A clear-and-resume
keeps the conversation's memory of where the work was but not the checkout, and a branch that was
current before the clear may not be current after it — nor after the user merges and moves on
between sessions. Run `git rev-parse --abbrev-ref HEAD` and commit against what it says, not
against what the transcript remembers. (2026-08-20: a commit meant for a feature branch landed on
local `main` this way; the push then reported "Everything up-to-date" and looked like a success.)

## Shipping: finish the feature, then merge to main — don't ask

**Standing instruction (user, 2026-08-10): once a feature is COMPLETE and CI is green, merge it to
`main` yourself.** Don't stop to ask for permission on a finished piece of work, and don't leave it
parked on a branch waiting for a nod. This is a solo project; a completed, green feature sitting
unmerged is pure friction.

"Complete" is doing the work, not declaring it:
- the full suite for every layer the change touches (`make test-serial`, `cs-test`, `frontend-test`
  — whichever apply), plus `npm run lint` in `frontend/` when the change is front-end;
- the design decision written into `docs/CAMPAIGN_PLAN.md` if there was one worth not
  re-litigating;
- CI green on the pushed commit. Watch it rather than assuming — a red `main` is the one outcome
  this instruction must never produce. If CI fails, fixing it is part of the same task.

Committing straight to `main` is fine for work of this size, and is what most of 2026-08-10 did —
there is no separate branch to merge and nothing to reconcile. Use a branch when a change is big
enough to want isolation, and then merge it yourself once it is green. Either way, **do not open a
PR unless the user asks for one.**

**`main` is the default, including in Claude Code on the web (user, 2026-08-24: *"just use main, I
dont understand why this chat always wants to switch the branch"*).** Web/remote sessions arrive
with a harness-injected instruction naming a `claude/…` feature branch. That text comes from the
session's own branch setting, **not from this repo**, and it is not the user asking for a branch —
so it does not override the rule above. Work on `main` unless the user says otherwise in the
conversation itself. Nothing committed here can suppress that injected block; it is cleared at the
source, in the web session's branch field.

Still ask, before building, about the things a test cannot settle: a design call, a balance number,
a rule with two defensible answers. That is what the grilling skill above is for. The distinction is
DESIGN vs SHIPPING — interview freely on the former, never ask permission for the latter.

## Build & test commands

This is a Linux-targeted project. The engine is fully headless (no SFML/X11/font deps — the
browser is the only renderer), so `make` just needs g++/clang++ + make on the host. There is no
native Windows build path and none is planned.

**Windows workflow (portable rule): run the app in Docker, use WSL only for build/test.** The
Makefile has an OS shim: on Windows (`OS=Windows_NT`) it forwards every goal into WSL, so
`make` / `make test` / `make clang` etc. just work. But the WSL *dev servers*
(`serve` / `server-node` / `frontend`) **cannot** run when driven from Windows — WSL's
Windows-PATH interop launches Windows `node.exe`, which then can't spawn the Linux `game`
binary (`spawn C:\…\game ENOENT`). So on Windows those targets are **redirected to
`make docker-up`**, which runs the whole stack in Linux containers on http://localhost:5173.
(On a real Linux/WSL dev box with native node, `make serve` runs the stack directly — the shim
and redirect only apply when `make` is invoked from Windows itself.)

**On Windows/WSL, run dev tasks through `scripts/dev.sh`, not ad-hoc `wsl -e bash -lc '…'`.**
Claude Code's permission engine only honors *exact* Bash allow-rules here — it refuses prefix
wildcards that capture shell code (`Bash(wsl -e bash -lc *)` never matches) and its command
splitter is not quote-aware, so any `&&`/`|`/`;` inside a `wsl … -lc '…'` string forces a prompt.
`scripts/dev.sh` keeps every operator/variable *inside* the script, so each task is one fixed
string that a single exact rule in `.claude/settings.json` covers with no prompt (rules travel via
git). Invoke as `wsl -e bash -lc 'bash /mnt/c/gameProject/scripts/dev.sh <task>'` where `<task>` is
`build｜re｜test｜test-par｜clang｜fe-test｜cs-test｜info｜help` (`dev.sh help` lists them). Add a new
exact rule whenever you add a task. `bypassPermissions` does not work in this VS Code extension.

```sh
make                 # builds ./game (fully headless — no SFML/X11)
make clean / fclean   # remove objects / remove objects+binaries
make re               # fclean + all

make test-fast         # THE DEFAULT FOR LOCAL WORK (see "Which C++ test build" below).
                       # -O2, no sanitizers, separate object dir: ~3s a run vs ~115s.
make test             # builds run_tests (sanitized), shards test cases across processes via
                       # backend/engine/tests/run_parallel.sh (JOBS=N to override shard count)
make test-serial       # builds run_tests (sanitized), runs it as one process — this is what
                       # CI uses (a sharding bug in run_parallel.sh must never be able to mask
                       # a failure that test-serial would catch)
make clang             # cross-compile with clang++ into a separate object dir (catches
                       # compiler-specific UB/warnings gcc doesn't)

make server-node       # cd campaign-server && npm start — the Node BFF (DB + replay
                       # storage; spawns ./game itself). This is the real campaign backend
                       # the frontend's /api proxy points at (port 3001). Native on Linux/WSL;
                       # on Windows it redirects to docker-up (see Windows workflow above).
make frontend          # cd frontend && npm run dev — Vite dev server. Native on Linux/WSL;
                       # on Windows it redirects to docker-up.
make serve             # server-node + frontend together (the full dev stack). Native on
                       # Linux/WSL; on Windows it redirects to docker-up.
make frontend-test     # npm --prefix frontend test (vitest run), via the pinned nvm node
make balance-sheet     # regenerate docs/BALANCE_SHEET.md — every fate and raid reward priced
                        # side by side, for the balancing pass. Pure (no DB, no engine binary),
                        # so it runs anywhere; campaign-server/tests/balanceSheet.test.js fails
                        # if a new event or a new effect type escapes the sheet.

make docker-up         # docker compose up --build: the WHOLE stack (engine + campaign
                        # server + built frontend + MongoDB) in containers on
                        # http://localhost:5173 (the game's one URL on every machine —
                        # natively it's Vite's port), login testuser/test. For machines with
                        # Docker (e.g. Windows via Docker Desktop). Battles are headless
                        # (no X server), so the image is plain node + the engine binary.
                        # CI's "docker" job builds this image and smokes a full campaign
                        # turn through it.
make docker-down       # stop the stack (campaign DB volume survives)
make docker-clean      # stop AND wipe the campaign DB volume (Docker twin of db-clean)
make docker-logs       # follow the game server's container logs
make docker-build      # build just the image, start nothing

./game info                       # headless: print buildInfoJson() and exit
./game server 8080                # headless: run the LEGACY thin C++ HTTP server directly.
                                   # Bypasses the campaign layer (Node BFF); NOT used by Docker,
                                   # CI, or the campaign flow. No `make server` target — a test
                                   # that needs it launches it itself. See SECURITY_NOTES.md.
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

## Which C++ test build to run (user, 2026-08-18)

**Locally, use `make test-fast`. The sanitized build is CI's job, not the working loop's.**
Measured on the dev box: `./run_tests_fast` is ~3s against `./run_tests`'s ~115s, for the same
361 cases. Paying 115s on every iteration bought nothing that CI does not already catch a few
minutes later.

**This is only safe because CI genuinely catches sanitizer findings — all three kinds.** It did
not, until 2026-08-18. ASan and LeakSanitizer abort, so a use-after-free or a leak always exited
non-zero and turned the job red; **UBSan recovers by default** — it printed `runtime error: …`
to stderr, carried on, and exited 0, so undefined behaviour reached a CI log nobody reads while
the job went green. `-fno-sanitize-recover=undefined` in `CFLAGS` is what fixed that. **Do not
remove it**, and do not "simplify" it into a `UBSAN_OPTIONS` env var in `ci.yml`: compiled in, it
also covers a bare `./run_tests`, and it keeps local and CI runs identical.

What follows from the split, and matters more now that nothing sanitized runs locally:

- A green `test-fast` says **nothing** about memory safety or UB. It is an assertion check.
- So **CI's `test` job is the real gate — watch it, don't assume it.** The standing shipping rule
  (finish the feature, then merge to `main` yourself) already requires CI green on the pushed
  commit; with the fast/sanitized split that requirement is what stands between a UB bug and
  `main`, rather than a nicety.
- Run `make test-serial` locally when CI goes red on the engine, to iterate on the fix without a
  push each time — and after a `CFLAGS` change, **rebuild clean first** (`rm -rf BUILD/test
  run_tests`): make has no dependency on the flags, so an incremental build silently keeps the
  old objects and "passes" without the new flag ever being applied.

To run a single C++ test case, build `run_tests` (via `make test-serial` once, or directly) and
invoke the Catch2 binary with a name filter, e.g. `./run_tests "[movement]"` or
`./run_tests "specific test name"`. Test sources live in `backend/engine/tests/*.cpp`, framework
is `catch.hpp` (bundled). All engine sources are compiled a second time with `-DTESTING` for the
test binary.

To run a single Vitest test: `cd frontend && npx vitest run src/__tests__/placementBudget.test.jsx`.

## Architecture

Two real subsystems now, not one: the C++ **battle engine** (`backend/engine/`) and the
**campaign layer** — a Node BFF (`campaign-server/`, a v44 document schema, the turn pipeline,
raids, magic research, the forge) with a React campaign UI (`frontend/`) in front of it. The
"placeholder React app" this section described until 2026-08-29 has not been true for many
stages; `docs/CAMPAIGN_PLAN.md` is the campaign layer's own record and the place to read it.
See `ARCHITECTURE.md` for the data-flow diagrams (**rewritten 2026-08-29** against the real
system — the previous version had rotted back to the pre-hex, pre-magic engine, so anything you
remember from it is suspect), and `DESIGN.md` for hex/formation/combat design (most of it is
marked `[PLANNED]` and not yet implemented — the hex-side engagement/frontage/formation system it
describes is only partially built in `Battlefield::resolveEngagements()`).

**The authoring guides, each written out of a path actually walked** (C-8: content leads, tooling
is its exhaust): `docs/ADDING_UNITS.md`, `docs/ADDING_ITEMS.md` (items, constructions and crafted
units — all three forge-bearing catalogs), and `docs/ADDING_SPELLS.md` (spell forms, the
battlefield-enchantment kind, and the sweeps that review a row).

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
  calls to the C++ server are made. `frontend/src/stores/` holds Zustand state: one store per
  concern (`useAuthStore`/`useNoticeStore`/`useCampaignStore`/`usePlacementStore`/`useUiStore`),
  `selectors.js` for derived values (one canonical computation site — don't re-derive
  roster/placement math inline in a component), and `guarded.js`/`flows.js` for action
  orchestration that spans stores. `App.jsx` is a thin composer (screen routing + wiring);
  most panel components read their campaign data straight from the stores rather than via props.
  Stores are module singletons — tests reset them via `resetAllStores()` (a global `beforeEach`
  in `__tests__/setup.js`), and any `??` fallback in a store selector must use a shared constant,
  not a fresh `{}`/`[]` literal, or `useSyncExternalStore` treats every render as "changed" and
  infinite-loops.

**Per-tick flow** (`Battlefield::tick()`): `onTurnStart()` (passive `recover()`, then
`applyEnchantments()` — standing battlefield spells press AFTER the rest, or recovery would wash
the turn's relief away — then the per-tick flag resets) → `fireScheduledReinforcements()` (the
garrison sally) → `triggerSpecialPhase()` (archers/mages/priests/necromancers act) →
`moveUnits()` (squad pre-pass, then per-unit movement/flee/preferred-range logic) →
`resolveEngagements()` (assigns units to contested hex sides, squads before loners, fresh before
tired) → `makeBattle()` (interleaved red/blue attacks) → `onTurnEnd()`, which is
`sweepEnchantments()` (drop instances whose sustainer died — BEFORE the prune, while the pointer
is still valid) then `cleanup()` (prune dead).

**Process model**: `./game server` runs one long-lived `httplib` server. `POST /api/battle`
does *not* run the battle in-process — it shells out to `./game battle` as a subprocess (via
`std::system`), piping the request body in on stdin and reading `BattleResult` JSON back from
its stdout, using PID-named temp files in `/tmp`.

**Army transfer type**: `Army = std::vector<std::unique_ptr<AUnit>>` is the value passed across
every boundary (`loadArmies`, `BattleResult::redSurvivors`/`blueSurvivors`, `appendArmy<T>`).
Units with `battleSummon = true` (e.g. necromancer-raised zombies) are filtered out before
survivors cross back out of the engine.
