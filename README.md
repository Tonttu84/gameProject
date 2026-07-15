# Fantasy Warfare — tactical battle engine + strategic campaign

A hobby/portfolio project: a **headless C++ battle simulator** for fantasy hex-grid combat,
wrapped in a **Node campaign layer** and a **React front end**. Armies of soldiers, archers,
mages, cavalry and undead fight autonomously on a hex battlefield; a strategic layer on top adds
foraging, fortifications, omens (augury) and — over a campaign — attrition between battles.

The battle is a pure simulation: you compose and *deploy* an army, then watch it play out. Every
battle is recorded tick-by-tick and rendered in the browser as a scrubbable replay.

> **Status:** work in progress, built for learning and as a portfolio piece — not a finished game.
> The C++ engine is the mature subsystem; the campaign layer is being built stage by stage (see
> [docs/CAMPAIGN_PLAN.md](docs/CAMPAIGN_PLAN.md)). There is **no authentication hardening** yet —
> run it locally only (see [SECURITY_NOTES.md](SECURITY_NOTES.md)).

---

## What's interesting here (for reviewers)

- **A fully headless simulation core.** The engine has *no* graphics or windowing dependency — it
  reads a battle as JSON on stdin and writes the result plus a full replay as JSON on stdout. The
  browser is the only renderer. This keeps the sim testable, deterministic under a seeded RNG, and
  trivial to run in CI and Docker.
- **Single source of truth, enforced by tests.** Unit stats live only in the C++ constructors; a
  `UnitCatalog` exports them as JSON and *tripwire tests* fail the build if the Node mirror drifts.
  Game rules that exist on both sides (e.g. the exploding-dice roll) are pinned by a shared test
  vector so the JavaScript port can't diverge from the C++ semantics.
- **A clean trust boundary.** All hidden campaign state (the enemy army, the "true" omen, planned
  enemy deployment) is gated behind one serializer — tests assert it never leaks over the wire.
- **Deterministic replays.** In-hex unit positions come from one pure engine function
  (`FormationLayout`); the recorder writes them into each tick, and the React `ReplayView` just
  draws them. What you see in the browser is exactly what the engine computed.

See [ARCHITECTURE.md](ARCHITECTURE.md) for data-flow diagrams and [API.md](API.md) for every
boundary crossing.

---

## Tech stack

| Layer | Tech | Notes |
|---|---|---|
| **Battle engine** | C++20, `make` (g++/clang++) | Headless. Bundled `httplib` + `nlohmann/json`; Catch2 tests. No SFML/X11/font deps. |
| **Campaign server** | Node, Express 5, Mongoose 8 / MongoDB | BFF: auth (JWT + bcrypt), campaign state, runs the engine, stores per-tick replays. Vitest + `mongodb-memory-server`. |
| **Front end** | React 19, Vite 8 | Placement UI + browser replay renderer. oxlint, Vitest + Testing Library. |
| **Packaging** | Docker Compose | One command brings up engine + server + built front end + MongoDB. |

**Build target is Linux.** On Windows, use WSL (Ubuntu) or Docker — there is no native Windows
build path for the engine.

---

## Repository layout

```
backend/engine/     C++ simulation core: HexGrid, AUnit hierarchy, Battlefield, Squad/Wing,
                    FormationLayout, combat/movement/targeting. Fully headless.
backend/server/     httplib HTTP server + JSON unit factory (the engine's outward face).
backend/scenarios/  Hardcoded dev battles (sample / spread), run headless to emit replays.
campaign-server/    Express BFF: routes, services (forage, augury, enemy AI, fortification…),
                    Mongoose models, MongoDB persistence. This is what the front end talks to.
frontend/           React (Vite) app: army placement, campaign UI, and ReplayView (the renderer).
maps/               Hex map JSON (terrain / elevation / deployment zones / fortified sides).
docs/               Living plans & design notes (campaign plan, rendering, adding units…).
Makefile            Engine build + test targets, plus docker-* and serve helpers.
```

Key reading: [CLAUDE.md](CLAUDE.md) (build/test/architecture cheat-sheet), [DESIGN.md](DESIGN.md)
(hex/formation/combat design), [docs/CAMPAIGN_PLAN.md](docs/CAMPAIGN_PLAN.md) (campaign roadmap).

---

## Running it

### Option A — Docker (whole stack, one command)

The simplest way to see the game end-to-end. Requires Docker (Docker Desktop on Windows).

```sh
make docker-up          # or: docker compose up --build
```

Then open **http://localhost:5173** and log in as **`testuser` / `test`** (a dev-only seeded
login). Battles run headless inside the container and stream back to the browser replay.
(5173 is also where the Vite dev server runs natively — the game URL is the same everywhere.)

```sh
make docker-down        # stop (campaign DB volume survives)
make docker-clean       # stop AND wipe the campaign database
make docker-logs        # follow the server logs
```

### Option B — from source (dev loop)

Three moving parts: the C++ engine binary, the Node campaign server, and the Vite front end.

**1. Build the engine** (Linux / WSL):

```sh
make                    # builds ./game (headless, no graphics deps)
```

**2. Start MongoDB** (any local instance, or the `mongo` service from the compose file).

**3. Run the campaign server** (serves the API on port **3001**, spawns `./game` for battles):

```sh
cd campaign-server
npm install
npm start               # or: npm run dev  (node --watch)
```

**4. Run the front end** (Vite dev server; proxies `/api` → `localhost:3001`):

```sh
cd frontend
npm install
npm run dev
```

Open the URL Vite prints. From `frontend/` you can also run `npm start` to launch the campaign
server and Vite together via `concurrently`.

### The engine on its own

The `./game` binary is useful standalone — it's a self-contained stdin/stdout program:

```sh
./game info                        # print build/catalog metadata as JSON
./game battle < in.json > out.json # run one battle, print result + recorded replay
./game sample                      # run the built-in demo battle, print the same JSON
./game server 8080                 # a thin direct HTTP server (bypasses the campaign layer)
./game dump-map [path]             # export the sample map's terrain to JSON
./game dump-units                  # print the unit catalog (stats SSOT lives in the C++ ctors)
```

---

## Tests

```sh
make test               # C++ engine tests, sharded across processes (Catch2)
make test-serial        # same suite as one process — this is what CI runs
make clang              # cross-compile with clang++ to catch compiler-specific issues

make frontend-test      # frontend Vitest suite

cd campaign-server && npm test   # campaign server Vitest suite (uses in-memory MongoDB)
cd frontend && npm test          # frontend Vitest suite
```

> On Windows/WSL, engine build/test tasks are wrapped in `scripts/dev.sh` for a prompt-free dev
> loop — see [CLAUDE.md](CLAUDE.md). Node tests run through the pinned toolchain there.

---

## What's included today

**Battle engine — implemented:**

- Hex grid with terrain, elevation, impassable hexes, and fortified/blocked hex *sides*.
- Unit roster: Soldier, Pikeman, Archer, Mage, Priest, Necromancer, (Light/heavy) Cavalry with
  mounts, plus Zombie / Skeleton / Scorpion — a mix of melee, ranged, casters and summoners.
- Per-tick simulation: special abilities (shoot / cast / heal / raise dead) → movement (with real
  movement speed, fleeing, squad formations) → engagement resolution across hex sides → interleaved
  melee → cleanup. Morale states (Confident → Broken) with casualty-triggered tests.
- Weapons/armour, reach & shields, ranged accuracy (ballistic skill), and an exploding-d6 dice
  system used throughout.
- Full replay recording and a browser renderer with scrub / play / step.

**Campaign layer — in progress (stage by stage):**

- Server-side campaign state in MongoDB, per-user, with a hidden-info trust boundary.
- Foraging over distance rings with forager clashes; a materials economy and real map
  fortifications you deploy behind; an augury/omen system (true + decoy events, exploding-roll
  legibility, rerolls).
- **Next up / planned:** fortification erosion, a distinct militia unit, and a scouting + cavalry
  superiority system. Roadmap and rationale live in [docs/CAMPAIGN_PLAN.md](docs/CAMPAIGN_PLAN.md).

---

## Notes & caveats

- **Local use only.** Endpoints are currently unauthenticated at the engine layer and the dev
  login is intentionally trivial; CORS is wide open. Do not expose the stack publicly. See
  [SECURITY_NOTES.md](SECURITY_NOTES.md) for the known issues (path handling, input validation).
- **Balance is deliberately rough** while the campaign loop is still being assembled — plausible
  numbers stand in until the full loop exists.
```