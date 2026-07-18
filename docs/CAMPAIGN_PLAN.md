<!--
  This is a WORKING PLAN + SESSION HANDOFF, committed to the repo on purpose so it
  travels between machines via git (unlike Claude's auto-memory, which lives outside
  the repo — see "Handoff" below).
-->

# Campaign Mode — Working Plan & Session Handoff

## Handoff — read this first (especially on a new machine)

**What this file is:** the living plan for the campaign-mode feature, plus the context a
fresh session needs to continue it. It exists in the repo so that moving to another
computer needs nothing but a normal `git clone` — no manual copying required.

**Where Claude's auto-memory normally lives (and why it's not here):** in a default setup my
per-project memory sits *outside* this repo, at
`~/.claude/projects/c--gameProject/memory/` (a `MEMORY.md` index + one file per fact) and
the interactive plan at `~/.claude/plans/whimsical-greeting-snail.md`. That folder name
(`c--gameProject`) is derived from the project's absolute path (`c:\gameProject`). So on a
new machine that memory is only auto-loaded if you (a) put the project at the *same path* and
(b) copy `~/.claude` over. **This committed file is the fallback that doesn't depend on any of
that** — if the auto-memory isn't present, treat this file + `CLAUDE.md` + `git log` as the
source of truth.

**To pick up the work cold:** read `CLAUDE.md` (build/test/architecture), then this file, then
`git log --oneline -15` to see which stages have actually landed. Don't trust the "done"
notes below over the git history if they ever disagree — the commits win.

### Project state (as of 2026-07-05)

- **Branch:** `feature/campaign-mode`. Turn length = **two weeks** (`DAYS_PER_TURN = 14`,
  final). Campaign schema version is **4** — bump `CAMPAIGN_SCHEMA_VERSION` on every
  incompatible campaign-model change (there is no back-compat; mismatched docs are deleted).
- **Merged to `main`:** Stages 0–1 (merge `5fbbb9d`), Stage 2 foraging + Docker stack
  (merge `b6d2a40`).
- **Done & committed on `feature/campaign-mode`:** Stage 5 augury rework (`77ee3ef`),
  deployment orders panel (`002fb73`), `make frontend-test` fix (`395bc34`), in-game bug
  reports (`71ac20f`), 2026-07-05 playtest fixes (placement roster filter, immediate
  battle-annihilation defeat, **augury v4** — see below), **renderer-layout unification
  (2026-07-06** — see the SHIPPED bullet below**)**.
- **First playtest happened 2026-07-05** (Docker stack on the Windows/Docker-Desktop
  machine) and drove a full day of fixes/features, ALL landed and deployed same day:
  - **Replay/SFML parity shipped**: `ReplayRecorder` emits per-unit `squad` (name),
    `side` (HexDirection 0–5) and `rank` when engaged (omitted otherwise);
    `ReplayView.jsx` renders one glyph per unit (5 Mages = MMMMM), colors by squad
    (SFML `SQUAD_PALETTE` mirror, name-hashed), lays engaged units along their hex side
    by rank, and has geometry tests (side direction, rank depth, squad coloring) — the
    React replay is the assertable window into engine formation behavior.
  - **Campaign squads**: `buildSquadsFromArmy` (UnitRegistry) groups same-hex same-type
    placement stacks into engine `Squad`s in `./game battle` — formation movement +
    SFML squad colors now apply to campaign battles.
  - **Full-deployment rule**: Fight requires the whole non-foraging army on the field
    (client gate + "N still in camp" counter + server-side 400).
  - **Build-stamp save wiping**: the Docker image stamps `/app/BUILD_VERSION` after all
    content COPYs (fresh on any changed build, no manual bump); campaigns record
    `buildVersion` and the listing route purges saves from other builds. Client
    recovers from the resulting mid-session 404s by reloading to the start screen.
  - **Battle window hold**: `BATTLE_HOLD_WINDOW=1` (set only by
    `docker-compose.display.yml`) keeps the SFML window open at battle end until the
    player closes it; result JSON prints after close. Headless/CI unchanged.
    In-window REWIND is still open — needs rendering from recorded ticks, not live
    `Battlefield` state; the web replay covers scrubbing meanwhile.
  - Open augury debug flag: `AUGURY_DEBUG_SHOW_TRUTH=true` shows truths at consult;
    flip to false for the final reroll-gated reveal. Duplicate visions across slots
    (two Traders) are possible and accepted for now.
  - **Renderer-layout unification SHIPPED (2026-07-06 session).** The 2026-07-05
    duplication flag is resolved: in-hex formation layout is one pure engine function,
    `layoutHexFormation()` (`backend/engine/src/FormationLayout.cpp`), returning
    normalized offsets (ox, oy, sz ∈ hex-radius units) per alive unit in draw order.
    `BattleRenderer` consumes it live; `ReplayRecorder` writes ox/oy/sz onto every
    unit of every tick (3-decimal rounding); `ReplayView.jsx` just draws
    `center + offset × HEX_SIZE` (web axes are transposed vs engine flat space:
    ox→web y, oy→web x) and its side/rank geometry is DELETED — side/rank stay in
    tick docs as queryable FACTS only. Parity is pinned by
    `test_formation_layout.cpp` (geometry contract) + a recorder test asserting
    recorded offsets == the function's output. **Gotcha found on the way: the
    campaign-server `Tick` unit schema is strict — new engine fields MUST be added
    to `models/tick.js` or Mongo silently strips them** (caught by driving the real
    stack; now pinned by a battles.test assertion). Layout decisions from this
    session's visual pass (user): battle-line ranks 1–3 all draw at the SAME size
    (no shrinking for standing in the second line; depth = position + SFML alpha);
    squad palette colors stay as the unit color override for visual debugging until
    sprites land (team reads from the hex tint), and SFML now hashes the squad NAME
    (same function as the web) so a squad wears one color in both views and across
    runs. Reminder while playtesting: every redeploy needs a hard browser refresh —
    a stale bundle is the usual "feature missing" culprit.
- **SFML retirement — Phase 1 SHIPPED (2026-07-07).** The browser `ReplayView` is now the
  ONLY renderer. Landed as four commits on `feature/campaign-mode`: (1) headless battle
  path (`runBattleFromJson`/`runBattleLoop`/`runSampleBattle`/`runSpreadTest`/`main.cpp` drop
  the `BattleRenderer`; the `BATTLE_HOLD_WINDOW` window-hold is gone); (2) browser replay made
  lossless — `ReplayRecorder` writes per-unit `broken`/`cast`, `tick.js` schema + fixtures
  gain them, `ReplayView` ports the SFML cues (casting yellow, broken orange with broken
  winning, `RANK_ALPHA {140,255,200,160}` dimming keyed on recorded `side`/`rank`); (3) SFML
  deleted — `backend/render/` gone, `Utility` font/`load()` and `HexGrid`'s render-only
  `hexToPixel`/`getHexSize`/`_origin`/`_hexSize` removed (the last SFML in the engine + test
  binary), Makefile/Dockerfile/CI/`docker-entrypoint.sh`/`docker-compose.display.yml`/
  `docker-up-display`/vendored font all stripped; (4) `sample`/`spread` run headless and each
  WRITES a replay JSON (same `{map,cols,rows,ticks}` shape as a campaign battle) to a path
  arg or default `replays/` (user steer: reuse the campaign's own replay format, take a file
  arg or default path). Verified in WSL: `make` links `game` with zero SFML (`ldd` clean),
  `make test-serial` green (308 cases), campaign-server + frontend vitest green.
  **GOTCHA for anyone touching the loop:** the plan's `while (field.tick()) record` sketch
  DROPS the final tick (which does a full turn's work before returning false) — the shipped
  loop records after EVERY `tick()` so a `max_turns=N` battle yields `N+1` ticks and stdout
  stays byte-compatible.
- **Phase 2 SHIPPED (2026-07-08): the sample battle rides the real battle pipeline.** Design
  steer (user): don't build a bespoke replay-file loader — the browser renderer requires the DB
  (that's the whole point of retiring SFML), so the sample must be *run and stored* like any
  battle, then rendered from the DB. So `./game sample` now prints the SAME
  `{winner, *_survivors, replay}` envelope as `./game battle` (shared tail `runAndEmitBattle` in
  `BattleServer.cpp`; the old `replays/*.json` file write is gone — `spread` keeps its file
  output). Campaign server: `engine.runSample()` + `battleRunner.runAndPersistSample()` (persist
  extracted into a shared `persistBattleResult` so battle/sample/skirmish share one DB path;
  demo battle is ownerless, `user: null`). New **unauth** `POST /api/sample-battle` runs +
  persists + returns the summary. Frontend: a **"Watch a battle"** button on the login screen
  (`launchSampleBattle`) → the existing `ReplayView(battleId)` autoplays it, fetching ticks from
  the DB via the public `/api/battles/:id/ticks` route — the one and only renderer. `ReplayView`
  gained two additive props (`autoPlay`, `backLabel`); nothing forked. No new Makefile rule (the
  `sample` mode already lives in `./game`). Tests: `campaign-server/tests/sampleBattle.test.js`
  (route + persist + ownerless + ticks fetchable + 502) and
  `frontend/src/__tests__/sampleBattleDemo.test.jsx` (button → ReplayView → getTicks). **Build
  status (verified 2026-07-08): campaign-server + frontend vitest green; C++ `make re` +
  `make test-serial` green (308 cases, 3653 assertions) via the new `scripts/dev.sh` wrapper —
  the WSL permission prompt is resolved. Phase 2 fully verified.**
- **Stage 3 SHIPPED (2026-07-08): materials sink + real fortifications.** Landed as four commits
  on `feature/campaign-mode` (engine seam → campaign-server → frontend → dev.sh fe-lint tooling):
  - **Engine seam** (`55a1f7a`): `HexSide.fortDurability` (placeholder — set/serialized/shown, NOT
    yet consumed; the [[todo-combat-score-per-hexside]] erosion step makes it live). `HexGrid`
    toJson/fromJson round-trips it (`fortified_sides` entries become `{dir,durability}` when
    durability≠0, else the plain string — existing maps byte-identical). File-static direction
    parsers promoted to public `hexDirName`/`hexDirFromName`/`isHexDirName`. New
    `applyFortifiedSides(json, grid)` in BattleServer applies an optional battle-input
    `fortified_sides [{q,r,dir,durability?}]` array after the map loads (default durability
    `DEFAULT_FORT_DURABILITY=100`); wired into `runBattleFromJson`. The combat penalty already
    existed — this only feeds the dynamic level in. 315 C++ cases green.
  - **Campaign-server** (`a70765c`): `fortificationLevel` (0–2) + `militiaBoughtToday` on the
    model, `CAMPAIGN_SCHEMA_VERSION` 6→7. `campaignConfig`: `FORTIFY_COST_BASE=50 × (level+1)`,
    `FORTIFICATION_MAX_LEVEL=2`, `FORTIFICATION_PRESETS` (tier-gated player-front SE/SW sides of
    row-7 hexes on sample_battle), militia costs. `services/fortification.js`
    (`fortifiedSidesFor`/`fortifyCost`/`atFortCap`). Battle route injects `fortified_sides` for the
    level; new `POST /:id/spend` (`fortify` cost/cap-gated + `militia` food+materials, per-turn
    capped). `materials` event effect + quarry/tool_rot events. View exposes
    `fortification {level,atCap,nextCost,sides}`. 134 JS tests green.
  - **Frontend** (`f8c8b52`): `CampPanel` (fortify + militia, gated on view cost/cap) in the war
    council; `api.spendCampaign` + `useCampaign` fortify/buyMilitia; HUD fort-level readout
    (materials now shown raw, a spend currency); `HexGrid` draws a rampart per walled side from
    `campaign.fortification.sides` (perpendicular-bisector geometry, robust to the axis swap) so
    the player deploys behind the wall. 122 frontend tests green; oxlint clean.
  - Also added a `dev.sh fe-lint` task + allow-rule (`afbe495`) so oxlint runs prompt-free.
- **Stage 4 — scouting + raids: ✅ COMPLETE 2026-07-14** (finalized plan in the Stage-4 block
  below; 1a–1b shipped 2026-07-13, 1c–1d and Part 2 raid opportunities shipped 2026-07-14 —
  see the per-slice handoff entries). Open decisions recorded in the finalized block stand:
  raid-vs-main-battle sequencing (independent for now), staged deployment commits.
- **Movement-speed rework: ✅ SHIPPED 2026-07-14** (was a deferred-backlog TODO; see the
  "SHIPPED — movement-speed rework" record in the deferred backlog for the numbers and the
  campaign-seam normalization).
- **Then (NEXT):** **combat-score-per-hexside** ([[todo-combat-score-per-hexside]] — make
  `HexSide.combatScore` erode `fortDurability` mid-battle so the placeholder goes live),
  resequenced AFTER scouting/raids (user, 2026-07-13) — that's now.
- **Balance stays rough** until the full campaign loop exists (plausible numbers suffice
  while features land).
- **Raid double-assignment fix + real Militia unit type: ✅ SHIPPED 2026-07-16** — see the
  dated entries under the Stage-4 block and "Follow-ups" below. Not a new stage, bug fixes +
  a follow-up item landing early.
- **Frontend Zustand refactor: ✅ SHIPPED 2026-07-16, all 5 stages.** Decided: yes, introduce
  Zustand, as its own deliberate 5-stage refactor (one commit per stage, tests green before
  each — see git log for the 5 `frontend:` commits). `frontend/src/stores/` now holds
  `useAuthStore`/`useNoticeStore`/`useCampaignStore`/`usePlacementStore`/`useUiStore` (state),
  `selectors.js` (derived values — the actual fix for the scattered-re-derivation bug class:
  one canonical computation site instead of App.jsx recomputing `roster`/`availableRoster`/etc
  inline every render), `guarded.js`+`flows.js` (cross-store orchestration, replacing App.jsx's
  local closures). `hooks/useCampaign.js` is deleted (folded into `useCampaignStore`).
  `HexGrid.jsx`'s prop surface shrank from 11 props to 2 (`info`, `map`) — it now reads
  placements/roster/squads/etc straight from the stores; `ReachMenu.jsx` is untouched (only
  ever needed hex-scoped slices HexGrid computed for it). `RaidPanel`/`CampPanel`/
  `ForagePanel`/`AuguryPanel`/`CampaignHUD` (stage 5, user chose full adoption over stopping at
  stage 4) now read their campaign-derived data straight from the stores too —
  `CampaignHUD` takes no props at all; the others keep only local draft state (militia input,
  assignment/parties drafts) and action callbacks (still `guarded()`-wrapped in App.jsx).
  `App.jsx` is now a thin composer (649 → ~456 lines): screen routing + wiring flow functions +
  mounting children with minimal data props. Manually verified in the browser post-refactor
  (full turn: forage → augur → place incl. squad → fight → end day) — works.
  Two gotchas hit and fixed along the way, worth knowing if touching `stores/` again: (1) Vitest
  `setupFiles` run before a test file's own `vi.mock('../services/api', ...)` is
  hoisted/applied — a static top-level import of the stores barrel in `__tests__/setup.js`
  bound the stores to real, unmocked axios calls, fixed by making that import dynamic inside
  `beforeEach`; (2) a zustand selector whose `??` fallback returns a fresh `{}`/`[]` literal
  creates a new object every call, which `useSyncExternalStore` reads as "changed" on every
  render → infinite render loop — fallbacks now use a shared module-level empty constant.
  Zustand stores are also module singletons, so `stores/index.js` exports `resetAllStores()`,
  wired into a global `beforeEach` in `__tests__/setup.js`, to keep test-to-test isolation the
  old per-mount `useState` gave for free. (The `tutorial` prop-threading noted here earlier as
  "optional future polish" is **already done** in the shipped code — `CampPanel`/`ForagePanel`/
  `RaidPanel` read `useUiStore((s) => s.tutorial)` directly and only forward it to
  `TutorialIntro`'s `enabled` prop; single source of truth, no App→panel fan-out to remove.)

### Fates come to pass at the tent — reveal + choices moved mid-turn ✅ SHIPPED 2026-07-18 — handoff

Playtest follow-up to the reveal/choices work below: the player loses every main battle
(balance is rough by design), so an end-of-turn-only reveal was untestable in real play — and
the user wanted the drama beat *"after you reroll, before you've forgotten why you rerolled."*
So the fates now resolve at the **augur's tent**, not at End Turn. Two commits on `main`
(schema v11→**12**).

**User design (this session):** reveal + choices happen in the augury phase via a new
**"Accept the Fates"** action (usable with the reroll unspent — that IS the skip-reroll
option). Effects apply **immediately by default**; deferral to end-of-turn is the EXCEPTION,
used only when there's a *reason* — concretely a still-unresolved `counter_event` raid
targets that slot, so the fate must stay counterable. ("Simpler if things normally happen
straight away and only later if there is a reason.") Forage/upkeep/enemy stay at End Turn
(foragers are assigned before battle and sit it out, unchanged).

- **Commit 1 (`bfa7871`, server, schema v12): `POST /:id/augury/accept`.** New
  `acceptFates()` in `dayResolution.js` seals `augury.accepted` and, per slot: countered →
  averted; plain fate → `applyEffect` NOW (an accepted fate can end the campaign on the spot,
  `checkAnnihilation` after the loop); choice-fate → pend as today. **Deferral**: a slot a
  live `counter_event` opportunity targets (`reward.slot`) is NOT applied — its rung is
  recorded on `slot.firedRungName` (new `rungOf(event, rungName)` in `events.js` looks up a
  rung BY NAME, so the recorded rung lands at End Turn even if the band shifted since) and the
  reveal slot is flagged `deferred`. A deferred choice-fate records `slot.chosenChoice` at
  pick time (the choose route branches on the new `pendingChoices[].deferred`), applied at End
  Turn. `endDay` step 3 now has two arms: **accepted** (only `firedRungName` slots still owe
  anything; no `report.augury` reveal — the tent played it) and **not-accepted** (the old
  end-of-turn resolution verbatim — the fallback the existing 1c/choices suites still pin).
  Reroll 400s once accepted; `auguryView` exposes `accepted`. TDD: 7-test acceptance describe
  red→green; 250/250. (Gotcha: campaign creation deals RANDOM day-1 raids — a stray
  counter_event deferred a slot and broke exact-arithmetic asserts; those tests now clear the
  raid deck first.)
- **Commit 2 (`597c710`, frontend): the tent's "Accept the Fates".** `AuguryPanel`'s exit is
  `accept-fates` while `!augury.accepted`, else `Muster for Battle`; new `acceptFates` flow
  posts, sets `dayReport {kind:'fates', …}`, shows `EventRevealScreen` (title "The Fates Come
  to Pass"; a `deferred` slot renders `fate-deferred` "your raiders may yet unmake it").
  Continue → council → Muster. `musterForBattle` safety net: a consulted-but-unaccepted
  council (reload) accepts first instead of marching. `consultedAugury` fixture gains
  `accepted:true` so muster-flow tests pass through unchanged. TDD: `auguryAccept.test.jsx`
  red→green; 207/207, oxlint clean.
- **Effect-timing consequences (immediate by default):** `enemy_advance` accepted at midday
  sets `offering_battle` for TODAY's battle; `enemy_reveal` opens the enemy for today; a
  choice branch lands the moment it's picked. All intended.
- **Playwright E2E harness — SHIPPED (2026-07-18).** New top-level `e2e/` Playwright package
  (`playwright.config.js`, `tests/`, `helpers.js`, own `.gitignore`/`README`). Design decision:
  **attach to an already-running stack**, never boot one — config reads `E2E_BASE_URL`
  (default `http://localhost:5173`; CI points it at the Docker image on `:3001`). Locally on
  Windows/WSL the browsers can't run (no system libs, no sudo), so tests run from the official
  `mcr.microsoft.com/playwright:v1.61.1-jammy` container on the stack's docker network.
  `campaign-loop.spec.js` drives a **full turn in a real browser** — login → forage → augur
  consult/reroll → Accept the Fates (mid-turn reveal) → muster → End Turn → next council — all
  against the live server+engine, no mocks; **passing**. New CI `e2e` job (build image → boot
  stack on `:3001` → `npm ci` + `npx playwright install chromium` → `npm test`, report uploaded
  on failure). `demo-battle.spec.js` smokes the login-screen "Watch a battle" → ReplayView
  render path (engine → Mongo → browser); **passing**, but note the sample battle is a heavy
  ~1400-unit, necromancer-summoning simulation whose wall time is RNG/CPU-variable (~70–150s on
  a clean stack, much longer under host CPU contention), so it carries a wide 240s assertion
  ceiling + 300s per-test budget — it resolves the instant ReplayView mounts, so the ceiling
  only costs wall time on the pathological-slow path. **Caveat for whoever tends CI flakes:** a
  timed-out demo battle leaves its subprocess still burning the container's core, which can
  starve a retry (a re-run death-spiral seen only when hammering a stale local stack); a fresh
  stack runs the one demo battle cleanly. If it ever proves flaky in CI, a bounded/seeded demo
  battle in the app is the real fix (don't just bump the timeout).

### Phased turn structure — one screen per phase (design direction, 2026-07-18) — SLICE 1 SHIPPED

**User direction (playtest):** the turn should run as a sequence of distinct **phases**, each its
own screen, so things happen strictly one after another and the pipeline stays clear. Today the
`setup` "War Council" screen bundles everything at once — forage assignment, scout report, raid
assignment, augury access, and the camp (fortify/militia) panel — which muddles ordering and, in
particular, breaks the *legibility* of the counter_event raid (see the finding below). The fix is
structural: split `setup` into ordered, single-purpose screens the player advances through.

**First and most important reorder: EVENTS (augury) must come BEFORE raider assignment.** The
augury/"Accept the Fates" beat gets its **own screen**, shown *before* raids. That screen displays
troop counts and resource stores (read-only context) but **no actions unrelated to the augury** —
nothing to click except reading/rerolling/accepting the fates. Only once the fates are known does
the player move on to assign raiders.

**Why this is a real bug, not just polish — the counter_event raid finding:**
- The mechanic itself is correct in the model: a `counter_event` raid is dealt at day-start
  (`endDay` step 7, `dayResolution.js:257`) keyed off the freshly *drawn* augury, its hidden
  `reward.slot` naming a bad fate; winning it flips `slot.countered = true`
  (`raid.js:152`), and both `acceptFates` and `endDay` then log "Averted …" and never fire that
  fate. That logic is sound.
- The problem is **ordering/visibility**: the augury is drawn but *not consulted* when the War
  Council first renders, so the player assigns raiders **blind to the fates**. A card like
  "Riders Massing — strike the muster first and it never falls" has no *visible* fate to cancel,
  and winning it silently sets `countered` with no change the player can see on the raids list
  (consulting the augur doesn't — and shouldn't — change the raid count, so "2 before, 2 after"
  is expected, but reads as broken). Committing raiders to counter a bad omen is meant to be an
  *informed* choice; right now it's a blind one. Sequencing events first is what makes the
  counter decision legible — the user's instinct is correct.

**Phase order — DECIDED (user, 2026-07-18): Prepare → Omens → Raids → Deploy → Battle → Report.**
1. **Prepare** — forage assignment + camp (fortify/militia), with the scout report; plan supplies
   & defenses while stores are full.
2. **Omens** — the augur (consult/reroll/**Accept the Fates**), on its own screen showing troop
   counts + resource stores as read-only context and **nothing else to act on**. The fates-reveal
   plays here (already does). This is the events-before-raiders fix.
3. **Raids** — assign & launch raiders, now that the fates are known (the counter-raid decision is
   finally informed).
4. **Deploy** — placement (unchanged).
5. **Battle** (unchanged) → 6. **Report** — end-of-turn reveal (unchanged).

**Implementation is mostly frontend** — the server actions (forage / spend / augury consult+accept
/ raids launch / battle / end-day) already exist as independent endpoints, so the reorder is App's
phase state machine + splitting the `setup` "War Council" render into sequential single-purpose
screens; the counter_event legibility comes for free from the ordering. Slice it (small batches,
TDD): (1) phase scaffolding + Prepare/Omens/Raids screens with Next/Back wiring so events precede
raiders; (2) trim each screen to its own actions (Omens read-only context only); (3) update
flow/tests + a live click-through. No schema bump expected.

**Slice 1 SHIPPED (2026-07-18, frontend + one server line) — the reorder + events-before-raiders.**
Uncommitted on `main` (on top of the E2E commit `8df52da`); no schema bump.
- **App phase machine** split into `prepare → omens → raids` (was the bundled `setup` + separate
  `augury`). `prepare` (`App.jsx`) = the War Council: forage + camp + scout, with a single
  **"Read the Omens"** (`to-omens`) exit — the old bundled RaidPanel and augury tri-state button are
  gone. `omens` = the augur's tent (AuguryPanel) plus a **read-only** troop/stores line
  (`omens-context`) and nothing else to act on; its continue (`toRaids`) leads to `raids`. New
  `raids` screen ("Targets of Opportunity") holds the RaidPanel + a **"Deploy for Battle"**
  (`to-deploy`) exit → placement. The **fates reveal from the tent now continues to `raids`**
  (App's report `onContinue` branches on `dayReport.kind === 'fates'`); the End-Turn report still
  opens the next council (`prepare`).
- **Stores/flows**: default/reset/recovery phase `setup`→`prepare` (`useUiStore`, `flows.js`,
  `guarded.js`); AuguryPanel's post-accept button relabeled "On to the Raids"; the raid-replay back
  label is "Back to the raids". `musterForBattle` is now the Deploy action (its accept-first safety
  net is harmless there).
- **Server**: `models/bugReport.js` `SCREENS` gained `prepare`/`omens`/`raids` (kept `setup`/
  `augury` for old clients) so reports keep their screen context.
- **Tests**: shared `__tests__/helpers/nav.js` (`marchToRaids`/`marchToDeployment`) walks the new
  screens; ~11 flow tests migrated off the single "Muster for Battle" click; new raidPanel test
  pins "raids appear only after the omens, never on the council/tent." **206/208** green under a
  contended full run (the 2 failures were `beforeEach` hook timeouts from CPU starvation — the demo
  battle's orphaned `./game sample` process, per the E2E session — and both pass in isolation).
  Minimal CSS added for `.phase-omens`/`.phase-raids`.
- **NOT yet done**: a live browser click-through (Windows serves the built Docker bundle, so it
  needs a rebuilt image or a Linux `make serve` to see these source changes); slices 2–3 (further
  per-screen action trimming beyond what landed; any Next/Back polish). Commit A when ready.

### Event reveal screen + events with choices ✅ SHIPPED 2026-07-17/18 — handoff

The deferred-backlog pair (see the backlog entry, now marked shipped) landed as two commits
on `main`, planned in one session (user decisions: **resolve-then-choose** timing, **full
ceremony** reveal scope, **descriptive words, no numbers** on choice options).

- **Commit 1 (`1e6930c`, frontend only): `EventRevealScreen.jsx` replaces `DayReport.jsx`.**
  The one-shot end-day report is dealt out one card per click — forage (posture, harvest,
  clash lines) → each fate (`reveal-beat-fate-<i>`; prophecy vs came-to-pass, scout/countered
  badges ported) → upkeep → enemy stance → summary card with the log entries and the continue
  button (`reveal-next` advances; revealed cards stay up). `TutorialIntro id="reveal"`. Same
  `report`/`onContinue` seam, phase `'report'` unchanged, `flows.js` untouched. Tests:
  `eventReveal.test.jsx` (sequencing), `dayReportRungs.test.jsx` reworked to the new testids,
  `campaignFlow`/`battleVictory` click through the deal.
- **Commit 2 (`6efa1c4`, schema v10→11): events with choices, resolve-then-choose.**
  - `EVENT_POOL` events/rungs may carry `choices: [{id, label, description, effect}]`; the
    fired rung's set rides out of `firedRung`. Two starter fates authored (plain, not
    recon-sensitive): **Refugees at the Palisade** (sev 1, neutral; turn_away = none /
    take_in = −3 t food + 20 Militia) and **Plague in the Baggage Train** (sev 2, bad;
    quarantine = −4 t food / march_on = all_roster ×0.98). Option text is phrases only —
    NO digits (augury.test.js tripwires). A choice event stores the `{type:'choice'}`
    sentinel effect (slot schema requires one; it never applies) and DECLARES `valence`;
    new `eventValenceFor(event)` (pool lookup by id, falls back to `eventValence(effect)`)
    feeds `visionCard` and the raid counter_event draw.
  - **Model v11:** `pendingChoices: [{slot, eventId, rung, day}]` — deliberately minimal and
    self-contained (step 7 redraws `augury.slots` before the player sees the reveal); options
    come from the pool at view/choose time (sealed-fate rule, like rung ladders). endDay
    step 3 pends instead of applying (report slot gains `pendingChoice.options` cards);
    step 6 clears pendings on game over.
  - **Routes:** `rejectIfChoicePending` 409-gates end-day / battles / raids/launch / spend /
    augury consult+reroll (forage stays open — planning state). New
    `POST /:id/choices/:slot {choice}` applies the branch via `applyEffect`, logs, clears
    the entry, re-runs `checkAnnihilation` (a branch can end the campaign — pendings die
    with it). `campaignView.pendingChoices` = `{slot, title, description, options}` only;
    `expectNoHiddenInfo` pins those key sets and bans `"choices"`/`"eventId"` raw.
  - **Frontend:** fate cards with an unresolved `pendingChoice` swap the advance control for
    option buttons (`choice-<id>`; `reveal-next` disabled until chosen, outcome line after);
    `postCampaignChoice`/`useCampaignStore.resolveChoice` (guarded). **Reload recovery:** App
    renders a choices-only `EventRevealScreen` overlay off `campaign.pendingChoices` whenever
    they exist without a live report; it yields to the council when the last one resolves.
  - **TDD both layers** (user steer this session, now a standing preference): server tests
    red first (16 new), then green; frontend the same (3 new). Verified: campaign-server
    243/243, frontend 204/204, oxlint clean. No engine change, no C++ run.
- **Superseded by the 2026-07-18 "fates at the tent" work above** — the reveal + choices moved
  mid-turn (End Turn was untestable since the player always loses the main battle). The browser
  click-through is now trivially reachable. Possible follow-ups still NOT built: choices on
  recon rungs are supported by the code but none are authored; no multi-day choice chains; the
  non-choice End-Turn report is still one-shot (lost on reload, by design).

### Upkeep pass 2026-07-17 (deferred review items + npm pin + test-quality audit) — handoff

Cleared the 07-16 "not-yet-done" list. On the laptop (LAPTOP-FGJQ8QNB), on `main`.

- **npm pinned (the durable lockfile-drift fix):** `"packageManager": "npm@11.16.0"` +
  `"engines": { "npm": ">=11" }` in BOTH `frontend/package.json` and
  `campaign-server/package.json`, enforced by `engine-strict=true` in a committed `.npmrc`
  next to each — an old npm now fails loudly at install instead of silently rewriting the
  lock. Both lockfiles reconciled with npm 11.16.0 (3-line `engines` mirror each; the
  campaign-server one also had a stale `"peer": true` npm-10-ism normalized away).
  Dockerfile copies `frontend/.npmrc` into the frontend-build stage (its npm 11 passes);
  campaign-server's `.npmrc` is deliberately NOT copied before that stage's `npm ci` — the
  runtime stage installs with NodeSource node 22 (npm 10), which only *consumes* the lock;
  the floor is for machines that *write* it. **Machine note:** each dev machine's WSL needs
  npm ≥ 11 once: `sudo npm install -g npm@11.16.0` (done on the laptop this session; the
  desktop will hit the engine-strict wall on its first `npm install` until upgraded).
- **Panel selector `?.` pass (deferred review item — done):** `s.campaign.X` →
  `s.campaign?.X` in `AuguryPanel` (+ `?? EMPTY_OBJECT`), `ForagePanel` (+ fallback-safe
  body: `forage.rings ?? []`, `forage.kgPerUnit?.[type]`), `RaidPanel` (body was already
  `raid?.`-safe). Matches `selectors.js`/`HexGrid`; a selector can now never throw during
  the transient null-campaign window (e.g. logout while a panel is mounted).
- **Two review items closed as no-change-needed:** the `useNoticeStore` module timer IS
  cleaned up — `reset()` delegates to `clear()` (cancels the timeout) and `resetAllStores()`
  resets the notice store first for exactly this reason; with a singleton store under a
  single never-unmounted root there is no unmount to hook. `useInCamp`'s double-subscribe
  with App's own `usePlacedCount`/`useSquadPlacedCount` is inherent to composing zustand
  hooks; App needs both the parts and the whole, and inlining the subtraction in App is the
  re-derivation the refactor banned. Cost is a few reduces per placement change.
- **Test-quality audit (07-16 item 3 — DONE, via 3 parallel read-only subagents over
  campaign-server Vitest, engine Catch2, frontend component tests).** Headline: **no mock
  theater anywhere** — all three suites mock only at real trust boundaries (the `./game`
  subprocess, `services/api.js`) and assert real behaviour; the campaign-server suite in
  particular is exemplary (real HTTP + real in-memory Mongo + dice queue seam). The
  fix/coverage batch below **LANDED later the same session** (3 parallel fix subagents, then
  verified serially: engine test-par all green, campaign-server 227/227, frontend 198/198,
  oxlint 0/0). New engine files `test_cohesion/test_elevation/test_archer/test_corpses.cpp`;
  new campaign-server `enemyAi.test.js`/`enemyPlacement.test.js` + rate-window expiry, token
  expiry, and an engine↔JS stat-parity check driven by a shared `tests/fixtures/engineStats.js`;
  new frontend `battleVictory/watchReplay/connectionError.test.jsx` + replay auto-play +
  impassable-hex tests and the flagged deletions/tightenings. **The parity check paid for
  itself immediately: the hand-copied Warhorse defence was 12, the real engine says 13** —
  exactly the drift class it exists to catch. Original findings list (now applied):
  - *Weak/redundant tests to tighten or delete:* `test_main.cpp` getter/setter round-trips
    (:207,336,342,353,358), addWeapon "accumulates" that doesn't accumulate (:244), rally
    RNG-loop redundancy (:93); `test_squad.cpp` Wing getName (:336); empty husk
    `test_known_failures.cpp` (0 TEST_CASEs — delete file + stale pointer comment at
    `test_movement.cpp:1-6`); `routes.test.js` info-route test title claims caching it
    never tests (rename to mount-smoke); `fortification.test.js` cost test restates the
    constant (assert literal 50/100); frontend: `placementBudget.test.jsx:210` (assert
    exact clamp =2, not ≤2), `:266` redundant, `zoneEnforcement.test.jsx:81,88,121`,
    `campPanel.test.jsx:242` (fixture echo posing as militia-muster behaviour),
    `:276,284`, `deploymentOrders.test.jsx:132` (static tutorial copy).
  - *USER DECISIONS — resolved later the same session:* (1) squad collective morale
    (`updateMoraleState()`/`moraleModifier()`/`attemptRally()`, zero production callers) is
    **confirmed unwired — an unfinished feature, not doc-drift**; `Squad.hpp`'s lifecycle
    comment now marks the morale/rally steps `[PLANNED — unwired]`, unit tests stay. Wiring
    it into the tick pipeline is future feature work (goes with the cohesion/morale
    missing-coverage items). (2) squad `_prestige` is a **placeholder for the roguelite
    carry-over — kept**, tests stay. (3) the corpse red/blue asymmetry was **ruled a BUG
    and fixed**: it was refactor drift (blue pruned by a hand-rolled counting loop, red by
    the extracted non-counting `Team::pruneDeadUnits()`). `pruneDeadUnits()` now returns
    the non-undead dead it pruned and `cleanup()` adds BOTH teams' into the shared corpse
    pool; `test_corpses.cpp` flipped from pinning the asymmetry to asserting symmetry.
    Engine suite + campaign-server 227/227 re-verified against the rebuilt `./game`.
  - *Top missing coverage (backlog, ranked):* engine — squad cohesion bonus in combat
    (the main mechanical reason squads exist; zero assertions), elevation effects, archer
    target-scoring internals, corpse economy from real deaths; campaign-server — enemy
    stance machine + withdrawal win (`services/enemyAi.js`, `dayResolution.js:117-120`),
    bug-report rate-window expiry, `spreadPlacement` overstack property, engine↔JS stat
    parity for `capabilities.test.js`'s hand-copied unit stats (violates the no-hand-copied
    unit facts rule), token expiry issuance; frontend — battle VICTORY continuation flow,
    replay auto-play/Play button, watch-replay round trip, connection-error screen,
    impassable-hex behaviour.
- 191/191 frontend tests, oxlint clean (one pre-existing test-file warning, queued in the
  fix batch). C++ suite untouched this session.

### Upkeep pass 2026-07-16 (post-refactor code review + CI fix) — handoff

Session after the Zustand refactor. **On `main`, all pushed.** Two commits:

- **`fix(ci)`** — the docker CI build failed at `npm ci`: the committed
  `frontend/package-lock.json` (written on another machine / older npm) was missing the hoisted
  top-level `@emnapi/core`+`@emnapi/runtime` entries (optional wasm deps of
  `@rolldown/binding-wasm32-wasi`), which CI's npm 11.16.0 rejects. Regenerated the lock with
  npm 11.16.0; reproduced the failure and confirmed `npm ci` passes. **Root cause is
  cross-machine lockfile drift** — see "not-yet-done" below.
- **`frontend: fix test-isolation bug + cleanups`** — from a `/code-review` of the refactor.
  - *Real bug:* `__tests__/setup.js` cleared `localStorage` **after** `resetAllStores()`, but
    `useUiStore.reset()` re-reads `localStorage` for the tutorial flag — so a test that left
    `tutorialEnabled='off'` leaked `tutorial=false` into the next test. Now clears first. Added
    `__tests__/storeIsolation.test.js` (verified it fails on the old ordering, passes on the new).
  - *Cleanups (no behaviour change):* shared `EMPTY_ARRAY`/`EMPTY_OBJECT` exported from
    `selectors.js` (HexGrid imports it); `useTotalAvailableCount` composes `useTotalUnits`;
    `reset`→`clear` delegation in `useNoticeStore`/`usePlacementStore`; `useUiStore` initial+reset
    state from one `initialState()` factory.
  - 191/191 frontend tests, build + lint clean.

**Not-yet-done (start here next session):**
1. **Pin the package manager** to stop the lockfile drift recurring — add
   `"packageManager": "npm@11.16.0"` (or match CI) to `frontend/package.json`, consider
   `engine-strict`. This is the durable fix for the CI failure above.
2. **Deferred review items** (all latent/low-severity, left to avoid scope-creep mid-CI-fix):
   panel selectors deref `s.campaign.X` without `?.` (safe under App's guard, but inconsistent
   with `selectors.js`/`HexGrid`'s `?.` — a focused consistency pass, mind the render fallbacks);
   `useNoticeStore` module-timer has no unmount cleanup (harmless single-root); `useInCamp`
   double-subscribes to `usePlacedCount`/`useSquadPlacedCount` that App also calls (negligible).
3. **Test-quality audit** — the original upkeep ask (mock tests that don't test real behaviour)
   was only partially reached; the code review covered the Zustand store surface. Still worth a
   dedicated sweep of `campaign-server` + engine Catch2 tests.

### Playtest 2026-07-13 — pending items (Docker-on-Windows stack)  ✅ ALL DONE

First campaign playtest on the new Docker-only Windows flow (`make serve` → auto `docker-up`;
Makefile OS shim + boot login banner landed on branch `chore/windows-docker-makefile`). Sample
battle runs + rewatches fine. Five items found, **all ✅ DONE** (items 5, then 3 & 4, then 1, all
on branch `chore/windows-docker-makefile`; item 2 last, on `main`, unblocked by item 1).

1. **Campaign squads — ✅ DONE 2026-07-13** (`CAMPAIGN_SCHEMA_VERSION` 8 → 9). Persistent,
   player-facing, mixed-type squads with full identity, reusing the engine's existing `Squad`
   mechanics (name/banner/leader/collective morale/cohesion/squad-level hold order) almost
   as-is — confirmed by reading the code that a broken/routed unit already calls `leaveSquad()`
   (`Battlefield.cpp`), so the only engine gap was a persistent identity tag that survives a
   rout, distinct from the live `Squad*` pointer (**enum/tag outside combat, pointer inside** —
   user steer).
   - **Engine seam:** `AUnit` gains `squadId`(int)/`squadName`(string), untouched by
     `leaveSquad()`/`setBroken()`/`setAlive()`. `buildArmyFromPlacement` parses optional
     `squad_id`/`squad_name` per placement entry (`UnitRegistry.cpp`). `buildSquadsFromArmy`
     groups by `(hex, squadId)` instead of `(hex, symbol)` when tagged — this is what makes a
     squad **mixed-type** — and sets the squad's hold order once from the tagged entries;
     untagged stacks keep the original ad hoc same-type grouping unchanged. Battle output gains
     `blue_squads`/`red_squads`: `{"<id>": {survivors: {type:count}, wiped: bool}}`
     (`squadSurvivorJson`, exposed non-static in `BattleServer.hpp` for unit tests, matching the
     existing `isSafeMapName`/`applyFortifiedSides` pattern). **`wiped` is derived with no new
     Battlefield bookkeeping:** a survivor's `getSquad() != nullptr` means it's still attached to
     the live in-battle Squad (the formation held) — `wiped = true` only when every tagged
     survivor already left the squad (broke and fled), which is exactly how the campaign layer
     tells "regroup" from "stragglers only, disband." Tests: `test_squad.cpp` (tag survives a
     break/leaveSquad/death), `test_server_api.cpp` (mixed-type grouping, lone-tagged-unit squad,
     squad-level hold, `squadSurvivorJson` wiped/not-wiped). Verified live: hand-built `./game
     battle` JSON with a mixed `squad_id` group produced the exact designed `blue_squads` shape.
   - **Campaign-server:** `squads: [{id, name, composition}]` on the model — `composition` is
     always a subset already reflected in `roster` (the economy SSOT is unchanged; "loose" count
     per type = `roster − Σ squads.composition − forage.assignment`, computed client-side the
     same way forage availability already is). `STARTING_SQUADS` (`campaignConfig.js`) seeds
     three named squads sized to fit one hex (`Hex::CAPACITY`) from `STARTING_ROSTER` — 1st
     Cohort (40 Soldier), Skirmishers (30 Archer), Vanguard Riders (6 Cavalry + 6 LightCavalry,
     the mixed-type exercise). Battle route (`routes/campaigns.js`) validates any `squad_id` in
     `player_placement` belongs to the campaign's own squads (400 otherwise); after battle,
     reconciles each fielded squad from `summary.blue_squads` — regroups with survivors
     (including stragglers who broke but lived) or disbands if wiped (its survivors still land in
     the flat roster via the existing per-type reconciliation, only the squad's organized
     identity is lost). `red_squads` is deliberately never forwarded past `battleRunner.js` — the
     enemy has no persistent squad concept, so it's dropped rather than becoming a hidden-info
     leak surface with no use. `campaignView` exposes `squads` verbatim (own info). Tests: 6 new
     cases in `campaigns.test.js` (seeding, regroup, disband-on-wipe, untouched-if-left-in-camp,
     reject-foreign-squad-id, `red_squads` never leaks).
   - **Frontend:** `ReachMenu` gains a "Squads" section above "Troops" — place/move a squad onto
     a hex and set its one hold order, applied immediately (no per-type quantity to type, unlike
     loose stacks). `HexGrid` renders squad markers on their hex and passes the new props through.
     `App.jsx` tracks `squadPlacements` (`{squadId: {col,row,holdTurns}}`) alongside the existing
     `placements`; `startBattle` expands each placed squad into one tagged entry per member;
     "loose" roster (what "Troops" can offer) and the "N still in camp" gate both account for
     squad-committed troops. Tests: `squadPlacement.test.jsx` (ReachMenu unit tests),
     `squadPlacementFlow.test.jsx` (full War Council → muster → place → Fight! → payload,
     mirroring `holdOrderFlow.test.jsx`).
   - **Scope, deliberately:** no squad create/split/merge/rename UI yet (seeded squads only — a
     later pass can add an editor); the **per-hex hold order for loose units stays per-type**
     (unchanged) — that rework is item 2, sequenced after this because it depends on squads
     existing to draw the "only a squad carries its own order" line.
   - **Not yet run:** a real browser click-through (place a squad, fight, watch it regroup) —
     every layer is unit/integration-tested (C++ `make test-serial`, `campaign-server npm test`,
     `frontend npm test`, all green) plus one hand-built engine battle verified live, but the
     Docker-on-Windows browser loop itself is next for a playtest session.
2. **Hold-order granularity — ✅ DONE** (`components/ReachMenu.jsx`, `components/HexGrid.jsx`).
   Previously each hex/"square" showed a hold order **per unit type** (screenshot: Soldier/Archer/
   Mage… each "Hold (turns) 0"). Now only a **squad** carries its own hold order (unchanged); every
   non-squad unit placed on a square shares **one** hold order for the whole square — `ReachMenu`
   keeps a single `holdTurns` number (seeded from any existing placement on the hex, since Place
   always writes the same value to every type) instead of one per type, and applies it to every
   placed type on commit. The single control only renders once something is placed
   (`data-testid="hold-turns"`, replacing the old per-type `hold-turns-<Type>` ids). `HexGrid`'s
   on-map hold badge follows suit — one `hold-badge-<col>-<row>` per hex instead of one per stack
   (squad hold badges are unchanged, drawn separately per squad). Tests:
   `holdOrder.test.jsx` (ReachMenu unit tests, rewritten for the single control),
   `holdOrderFlow.test.jsx` (testid update only), `deploymentOrders.test.jsx` (badge tests
   rewritten for one-per-hex). All 160 frontend tests + oxlint green.
3. **Militia UX polish — ✅ DONE 2026-07-13** (`components/CampPanel.jsx`, commit `d9e654e`). The
   count input now clamps to the most the camp can pay for — `clampMilitia` caps at
   `min(floor(food/2), floor(materials/1), floor(workersFree/1))` (workers added since the plan was
   written), so the previewed cost never outruns the stores (it used to accept `99999999`); the
   disabled button gains a `title` naming the short resource, mirroring the fortify button. Server
   per-turn cap stays the real guard. Tests in `campPanel.test.jsx`.
4. **Omen header vs shown flavor — ✅ DONE 2026-07-13** (commit `3238cd2`). **Finding that resolved
   the design:** sourcing severity "from the displayed omen" was already true and a no-op — the decoy
   is drawn from the SAME severity tier as the truth (`augury.js` `drawSlot`), so shown/true severity
   are always equal. The real defect was that the words (gentle/troubling/**dire**) carry good→bad
   *valence* while severity is pure *magnitude*, so a bad minor card ("Harsh Weather") read as "a
   gentle omen". Fix (user chose "match the shown flavour", + asked for neutral events too): new
   `eventValence(effect)` in `services/events.js` → `good|bad|neutral` (the ONE classifier the
   leak-guards and the header share); `campaignView` exposes it per vision card (derived, no leak);
   `AuguryPanel` maps `(valence, severity)` → wording. Added a real third mood **neutral** with three
   `type:'none'` no-op events (quiet fortnight / rains that foul both sides / passing comet — one per
   magnitude) so all three neutral labels appear; `applyEffect` gains a `none` branch. No schema bump
   (`effect` is Mixed, nothing new persisted). Future option noted: genuinely *mixed* (+food/−materials
   in one event) neutral fates would need multi-effect support. Tests: `augury.test.js` (valence
   classifier + neutral tripwire), `auguryLabel.test.jsx`, `campaignFlow.test.jsx`.

5. **Fortification playtest aid + workers-resource — ✅ DONE 2026-07-13** (`CAMPAIGN_SCHEMA_VERSION`
   7 → 8; done out of order, before 1–4, on branch `chore/windows-docker-makefile`).
   - **Fortification testing aid.** `STARTING_MATERIALS` bumped `0 → 200`
     (`campaign-server/utils/campaignConfig.js`) so a fresh campaign can build the full fort
     progression (L0→1=50, L1→2=100) from turn 1 and see the walls on the map + in battle.
   - **Fort-buy button always visible + affordability colour.** `CampPanel` fortify button now
     carries a state class — `affordable` (green, clickable) / `unaffordable` (red, disabled but
     still showing the cost so it's a save-toward goal) / `maxed` (neutral). CSS `--success` added.
   - **Workers = NEW resource (civilians, off the campaign map).** `workers { total, used }` on the
     model; `available = total − used`, shown as **`available / total`**. **Militia costs 1 worker
     each** and **fortifying costs workers too** (`fortifyWorkerCost`: L0→1=500, L1→2=1000, scaling
     like materials) — both server actions (`routes/campaigns.js` `spend`) gate on and debit
     workers, both cost lines + `canFortify`/`canBuyMilitia` (`CampPanel.jsx`) include workers.
     `campaignView` exposes `workers {total,used,available}` + `fortification.nextWorkerCost`.
     Config: `STARTING_WORKERS = 2000`, `FORTIFY_WORKER_COST_BASE = 500`, `MILITIA_WORKER_COST = 1`.
   - **Layout:** `CampPanel` is now a right-side sticky stack (`.camp-side`) — a Workforce readout,
     a Fortifications box, and a Militia box; the War Council split into `.council-main` (left) +
     `.camp-side` (right), stacking below on `<760px`.
   - **DEFERRED (still open):** worker replenishment + workers eating food — see
     [[TODO — worker replenishment + workers eating food (paired)]] in the Deferred design
     backlog below (kept there, not duplicated here, so there's one place to update).

### Stage 4 sub-piece 1a — scouting coverage/band foundation ✅ SHIPPED 2026-07-13

First slice of the finalized Stage-4 plan (see the "PLAN FINALIZED 2026-07-13" block in
Stage 4 below). No schema bump — the band is derived at view time like `foodNeedPerTurn`.

- **Engine:** signed `reconTag` on `AUnit` (default 0; **LightCavalry +4**, **Warhorse −2**,
  set in their ctors), exported in `unitCatalogJson()` stats — same SSOT workflow as
  `ballisticSkill` (tripwires in `test_unit_catalog.cpp`: field-shape, live-instance match,
  pinned per-type values). `buildInfoJson()` placement units now also export **`speed`**
  (`UnitRegistry.cpp`) for the upcoming raid party-builder; tripwire in `test_server_api.cpp`.
- **Campaign-server:** `unitType.js` statsSchema += required `reconTag`; fixture catalog
  updated (values match the engine pins). `capabilities.js`: unused `scoutValue` REPLACED by
  `reconValue(stats) = speed² + ⌊ballisticSkill/2⌋ + reconTag`, plus
  `scoutingCoverage(army, catalog) = Σ(count·reconValue) / Σ(count·size)` (the ÷size
  denominator is the anti-blob rule) and `scoutingBand(playerCov, enemyCov)` →
  Overwhelming/Superior/Contested/Outmatched/Blind via `SCOUTING_BAND_THRESHOLDS`
  (`campaignConfig.js`: 2.0 / 1.3 / 0.75 / 0.4; both-zero → Contested, enemy-zero →
  Overwhelming). `campaignView` exposes `scouting: {band}` — ONLY the label crosses the
  hidden-info boundary; `campaigns.test.js`'s `expectNoHiddenInfo` now also rejects raw
  `"coverage"`/`"ratio"` keys and pins `scouting` to exactly `{band}`.
- **Starting-armies sanity:** player 1494/4000 ≈ 0.374 vs enemy 2882/7410 ≈ 0.389 → ratio
  ≈ 0.96 → **Contested** from turn 1 (pinned in the create-campaign test).
- **Verified 2026-07-13 (this machine, WSL via dev.sh):** C++ `make test-serial` green (332
  cases, 3705 assertions); campaign-server vitest 160/162 (the 2 `engine.integration` fails
  are the documented Windows-node ENOENT, and `./game dump-units`/`info` were hand-verified
  to export `reconTag`/`speed` correctly — CI/Docker covers the sync); frontend 160/160.
- **Next Stage-4 slices:** 1b graduated enemy reveal / 1c event rungs / 1d forage posture
  (any order), then Part 2 raids — one per fresh session, per the finalized block.

### Stage 4 sub-piece 1b — graduated enemy reveal ✅ SHIPPED 2026-07-13

Second Stage-4 slice (same session pattern as 1a). No schema change — the reveal is derived
in the view from the 1a band; `campaignView.js` stays the single leak gate.

- **Campaign-server:** new `enemyView(enemy, band, catalog)` in `campaignView.js` — keys
  ACCUMULATE with band rank (`SCOUTING_BANDS` ladder exported from `capabilities.js`):
  Blind → `{stance, battleOffer}` (as before); Outmatched/Contested → + `strength` (bucketed
  `armyTotal` phrase, `ENEMY_STRENGTH_BANDS`) and `supplies` (turns-of-food left =
  `enemy.supplies ÷ armyFoodPerTurn`, `ENEMY_SUPPLY_BANDS` — both descending `{min,label}`
  tables in `campaignConfig.js`, phrases only, nothing invertible); Superior → + `composition`
  (category → rounded headcount %); Overwhelming → + `units` (exact counts) and `placements`
  (the REAL `enemy.plannedPlacement`, aggregated per hex to `{type,q,r,count}` — the model
  field's reserved "HIDDEN until a scouting reveal" moment). Default turn-1 read (Contested):
  "a large host" (721) / "well-provisioned" (~4.1 turns).
- **Tests:** `campaigns.test.js` `expectNoHiddenInfo` now pins the enemy view's key set per
  band (`ENEMY_KEYS_BY_BAND`) on every response — including day-report summaries (stance-only)
  — and a new "scouting-graduated enemy reveal (1b)" describe forces each band by pinning
  armies on the doc and asserts each tier's exact fields (placement reveal checked against the
  stored plan, aggregated).
- **Frontend:** new `ScoutReport.jsx` (war council + placement screen) renders the band plus
  ONLY the intel fields present on `campaign.enemy` — same component serves every band.
  `HexGrid.jsx` takes optional `enemyPlacements` (axial `{type,q,r,count}`) and draws red
  stacked glyphs on the enemy-zone hexes via the inverse-axial offset (`toOffset`); App passes
  `campaign.enemy.placements ?? []`. Fixture updated to the Contested shape.
- **Verified 2026-07-13 (this machine, WSL via dev.sh):** campaign-server vitest 166/168 (the
  2 fails are the documented Windows-node `engine.integration` ENOENT); frontend 169/169;
  oxlint clean (one pre-existing unused-var warning in an untouched test). No engine change,
  so no C++ run needed.
- **Deferred within 1b (per the finalized block):** staged/sequential deployment commits —
  the Overwhelming `plannedPlacement` reveal IS the tempo mechanic for now; revisit only if
  it doesn't satisfy once played.

### Stage 4 sub-piece 1c — recon-sensitive event rungs ✅ SHIPPED 2026-07-14

Third Stage-4 slice (same session pattern). No schema-version bump: rung ladders live in
`EVENT_POOL` (looked up by event `id` at apply time — the augury slot schema stores display
fields only, so a mid-campaign pool edit changes rungs, never a sealed fate); the only model
touch is the additive, defaulted `enemy.revealedUntilDay` (old v9 docs read 0 = no reveal).

- **Campaign-server:** recon-sensitive events (`reconSensitive: true` + `rungs.{warned,
  anticipated}` — the base event IS the Blind rung) per the blueprint: **Enemy Ambush**
  (warned = same `enemy_advance`, different telling — no surprise mechanic exists yet;
  anticipated = Counter-Ambush, `enemy_losses` ×0.93), new **Forage Raiders** (sev 2; blind =
  multi food −4t/materials −20/Soldier ×0.97; warned = food −1t; anticipated = destroy the
  detachment, `enemy_losses` ×0.95), new **Night Raid** (sev 2; blind = multi food −2t/Soldier
  ×0.98; warned = food −0.5t; anticipated = `enemy_reveal`). New `applyEffect` arms:
  `enemy_losses` (floors every enemy line; log is a PHRASE — no numbers leak), `enemy_reveal`
  (sets `revealedUntilDay = day + 1`), and `multi` (bundled parts, recursing — this is the
  multi-effect support the 1b omen work predicted). `eventValence`: enemy_losses/enemy_reveal
  → good; multi = its parts' shared mood, mixed → neutral. `firedRung(event, band)` in
  `events.js` + `EVENT_RUNG_BY_BAND` in `campaignConfig.js` (Blind → blind; Outmatched/
  Contested → warned; Superior/Overwhelming → anticipated). `dayResolution` step 2.5 reads
  the band once (same derivation as `campaignView`); step 3 applies the fired rung, logs
  `Came to pass: <fired title>.` + `Your scouts saw it coming.` when intervened, and attaches
  `fired {title,description,rung}` + `scoutsIntervened` to the report's augury slots
  (recon-sensitive fates only — plain events carry no rung machinery). The **augur still
  foretells the Blind rung** (visions/reveal `actual` untouched — knowledge vs agency).
  `campaignView`: a live free-reveal window widens `enemyView` to the full Overwhelming tier
  with a `revealed: true` flag; `scouting.band` keeps reporting the real contest.
- **Tests:** `augury.test.js` — valence arms, multi bundles, applyEffect arms (incl.
  no-digits-in-log leak guard), `firedRung` per band, EVENT_POOL ladder tripwire (blind rung
  bad, anticipated not bad, complete cards); `campaigns.test.js` — new 1c describe (warned at
  the Contested default, blind full-bad, anticipated Counter-Ambush thins the DB army only,
  free reveal lasts exactly one turn then expires, augur foretells blind at Superior, plain
  events unadorned), `expectNoHiddenInfo` now allows exactly Overwhelming-keys + `revealed`
  when `enemy.revealed` is set.
- **Frontend:** `DayReport` shows the FIRED rung as "what came to pass" (`slot.fired ??
  slot.actual`) + a `scout-intervened` badge; `ScoutReport` explains an open book via
  `scout-revealed` ("prisoners have betrayed the enemy camp"). New
  `dayReportRungs.test.jsx`.
- **Verified 2026-07-14 (WSL via dev.sh):** campaign-server vitest 181/183 (the 2 fails are
  the documented Windows-node `engine.integration` ENOENT); frontend 175/175. No engine
  change, so no C++ run needed.
- **Next Stage-4 slices:** 1d forage posture multipliers, then Part 2 raids (per the
  finalized block). The forageValue/screenValue/reconValue overlap check rides with 1d.

### Stage 4 sub-piece 1d — forage posture multipliers ✅ SHIPPED 2026-07-14

Fourth and last Part-1 slice (same session pattern). No schema change — the posture is the
1a band applied as two passive multipliers in the existing forage math; the player never
micro-manages group size.

- **Campaign-server:** `FORAGE_YIELD_BY_BAND` (Overwhelming→Blind: 1.25 / 1.1 / 1 / 0.85 /
  0.7) + `FORAGE_CLASH_DAMPER_BY_BAND` (0.5 / 0.75 / 1 / 1.25 / 1.5) in `campaignConfig.js`
  — Contested is exactly the pre-1d numbers, and Outmatched/Blind can STILL forage, just
  less of it. `forage.js`: `forageYieldMultiplier(band)` (unknown/absent band degrades to
  ×1, the usual guard convention) and `effectiveForageCapacityKg(assignment, catalog, band)`;
  `resolveForaging` now takes the band and scales the player capacity — so allocation,
  contention pressure AND ring depletion all follow (clumped defensive columns reach less
  land) — and the clash chance becomes `min(CLASH_CAP, (CLASH_BASE + pressure) × damper)`.
  The forage report block gains `posture`. **The `endDay` band read moved from step 2.5 to
  0.5** (before foraging): the posture must be the same band `campaignView` showed while the
  player was committing the assignment (pre-clash rosters, same derivation — view and
  resolution can't disagree); the 1c event rungs now also key off this dawn band, identical
  in practice unless a forager clash itself swings the band. `campaignView` scales
  `forage.capacityKg` (via the shared `effectiveForageCapacityKg`) and `kgPerUnit` (rounded
  per type) by the SAME multiplier — the ForagePanel preview the player plans against is
  what end-day delivers.
- **Tests:** `forage.test.js` — a table tripwire (both tables carry exactly the five
  `SCOUTING_BANDS`, Contested neutral, unknown → ×1), Blind/Overwhelming yield + depletion
  math, and a damper contrast pair pinning the direction (the same d1000 roll springs a
  clash at Contested but is screened off at Superior; a roll safe at Contested still springs
  at Blind). `campaigns.test.js` — Blind posture scales the view preview (`kgPerUnit`
  21 = round(30 × 0.7), `capacityKg` floor-scaled), and an end-day pipeline test pinning
  `report.forage.posture: 'Blind'` plus the exact harvest/upkeep arithmetic.
- **Frontend:** no code change — the panel's preview math flows entirely from the view's
  values ("server owns the formulas").
- **Capability-overlap check (non-blocking, per the finalized block):** all three knobs
  share `speed`, but each is dominated by a distinct term — forage = pure mobility
  (`2×speed`), recon = mobility² + senses + designer tag, screen = armour-led. Fixture
  readout: LightCavalry 17 recon / 6 forage / 6 screen vs heavy Cavalry 6 / 4 / 8 — the
  intended identity split (light cavalry wins the field: eyes + sweep; heavy escorts) holds,
  and 1d itself now couples the knobs at the band level (recon superiority buys forage
  efficiency and safety). **Verdict: no consolidation needed yet.** If/when it happens
  (deferred backlog item 3, unchanged), derive `forageValue` from the same mobile-arm scalar
  as `reconValue`'s speed term — one mobile-arm value + one combat-screen value.
- **Verified 2026-07-14 (WSL via dev.sh):** campaign-server vitest 187/189 (the 2 fails are
  the documented Windows-node `engine.integration` ENOENT); frontend 175/175. No engine
  change, so no C++ run needed.
- **Next:** Part 2 — raid opportunities (schema v9→10, real short engine battles through the
  existing pipeline; full spec in the finalized block).

### Stage 4 Part 2 — raid opportunities ✅ SHIPPED 2026-07-14

Final Stage-4 slice, per the finalized block (schema v9→10). Raids are real short engine
battles through the one battle pipeline — watchable in ReplayView, that's the point.

- **Model (v10):** `raid.opportunities []` of `{id ('d<day>-<i>'), type: destroy_detachment|
  loot_supplies|rescue_troops|counter_event, title, description, targetForce (Map, HIDDEN),
  strengthBand, capacity, reward (Mixed, HIDDEN — a counter_event's `{slot}` would out which
  vision is true), resolved, outcome}`; augury slots gain `countered` (default false).
- **Generation** (`services/raid.js`, dealt at campaign creation AND end-day step 7 beside
  buildEnemyPlacement, keyed off the band recomputed from the post-attrition hosts + the
  FRESH augury): count = `RAID_OPPORTUNITIES_PER_DAY` (Blind/Outmatched 1, Contested/Superior
  2, Overwhelming 3); `targetForce` = jittered `RAID_TARGET_FRACTION` (0.05) slice of
  `enemy.army`, NOT pre-subtracted; `capacity` = target size-points × `RAID_CAPACITY_RATIO`
  (1.25); `strengthBand` from new detachment-scale `RAID_STRENGTH_BANDS`; a counter_event is
  dealt exactly when some slot's sealed truth is bad (`eventValence === 'bad'`), reward
  naming that slot. Generation uses Math.random (drawSlot rule — never the dice queue).
- **Capacity seam:** `raidCapacityCost(stats, size) = max(0, size × (40 − speed) / 40)` in
  `utils/capabilities.js` with the movement-speed-rework TODO comment on it (user formula
  kept literally; cost ≈ size until speeds rescale).
- **Placement:** `buildEnemyPlacement`'s zone-spread core extracted to shared
  `spreadPlacement(army, {rowMin,rowMax,width,hexCapacity}, sizeOf)` — both raid sides are
  auto-placed with it (no raid placement UI in v1).
- **Route** `POST /:id/raids/:raidId/launch {party}`: guards mirror the battle route (roster
  minus foragers, placeable-only, Σcost ≤ capacity); input `{map, both spreads, max_turns:
  RAID_MAX_TURNS (60)}`, NO fortified_sides; `runAndPersistBattle`; party reconciled to
  survivors; on WIN `applyRaidReward` (destroy → subtract targetForce clamped ≥0; loot →
  +food/materials; rescue → +roster; counter → `slots[slot].countered = true`); resolved +
  `outcome {winner, battleId}`, battle pushed to `campaign.battles`, `checkAnnihilation`
  (a destroy can win the campaign), log, `{...summary, campaign: view}`. NO battleFoughtToday
  gate — raid/main-battle sequencing stays the recorded open decision.
- **End-day:** a countered slot SKIPS its effect at every rung ("Averted: … your raiders
  unmade it."); `auguryReveal` carries `countered` per slot to the report.
- **campaignView:** `raid.opportunities` stripped to `{id,type,title,description,
  strengthBand,capacity,resolved,outcome(resolved-only)}`; `expectNoHiddenInfo` now rejects
  `"targetForce"`/`"reward"` and pins that exact key set on every response.
- **Frontend:** `RaidPanel.jsx` in council-main beside ForagePanel — band label header,
  one card per opportunity (strength phrase + budget), per-card party-builder clamped live
  vs roster−foragers and the capacity budget (client mirrors the cost formula off
  `info.units` speed/placementSize, the 1a export made for this), Launch via new
  `postCampaignRaid`/`useCampaign.launchRaid`; resolved cards show outcome + "Watch the
  raid" → App fetches `getBattle(battleId)` for tickCount and plays the one `ReplayView`
  (raid replay takes over the screen, Back returns to the council).
- **Tests:** `tests/raid.test.js` (20: cost formula pins, generation scaling/completeness,
  counter_event conditionality both ways, capacity/roster/forager/malformed 400s, per-type
  reward application with mocked engine, loss path, end-day redeal + band scaling, hidden
  info) + `raidPanel.test.jsx` (6). One existing pin updated: the end-day report's augury
  slots now carry `countered: false`.
- **dev.sh:** new `-tN` tail override INSIDE the single-token command line (`dev.sh -t60
  cs-test …`) — a `TAIL=N wsl …` env prefix breaks the exact permission rule and prompts
  (user-flagged this session); never use the prefix form.
- **Verified 2026-07-14 (WSL via dev.sh):** campaign-server vitest 207/209 (the 2 fails are
  the documented Windows-node `engine.integration` ENOENT; raid.test.js red-first, then
  green); frontend 181/181; oxlint clean (one pre-existing warning in an untouched test).
  No engine change, so no C++ run needed.
- **Next:** combat-score-per-hexside (fortDurability erosion), per the resequenced backlog.

### Working conventions (carry these to the new machine)

- **Build is Linux-only.** On Windows use **WSL (Ubuntu)** or Docker. One dev machine has WSL
  but no Docker; the other (2026-07-05 playtest machine) runs the stack via **Docker Desktop**
  (`make docker-up-display` puts SFML battle windows on the Windows desktop via WSLg; GNU make
  installed via `winget install ezwinports.make`).
- **Docker-Desktop machine specifics (learned 2026-07-06, UPDATED 2026-07-15):** its WSL
  Ubuntu has g++/make, so engine build/tests run directly in WSL. **Docker is currently NOT
  available in its WSL** (`docker` not found — Desktop gone or integration off); that's fine:
  `make serve` is the fully native path (nothing in it touches Docker), and docker-only
  targets now fail fast via the Makefile `docker-check` guard. **WSL now HAS working node**
  (2026-07-15: campaign-server suite green incl. `engine.integration`, frontend suite green,
  all run via plain `npm test` in WSL) — the 2026-07-06 "no native node / PowerShell +
  NODE_OPTIONS" dance is obsolete on this machine; the 2 `engine.integration` tests still
  fail only under native *Windows* node (can't spawn the Linux `./game` ELF).
- **2026-07-15 zombie-server incident (resolved; guards ported onto latest main as
  `feature/frontend-resilience`, commits `c6c0b96` + `aca8008`):** a root-owned
  campaign-server from an old checkout (01:32, own mongod + own `/root/.gameproject/db`)
  squatted port 3001; the fresh boot sat beside it as a silent lame duck. Symptoms: demo
  battle 404 (`/api/sample-battle` absent in the old code) and a login crash
  (`campaign.augury.consulted` of undefined — foreign campaign shape). Guards now in:
  EADDRINUSE kills the boot loudly, banner prints pid + the REAL mount table, frontend
  retries through the boot window, error screen advises `make serve` (not the retired
  `./game server`) with a Retry button, and an ErrorBoundary shows render crashes readably.
  Lesson: leftover backgrounded processes also hold the mongod dbpath lock — if a boot dies
  on Mongo, `ps aux | grep -E 'node index.js|mongod'` and kill leftovers first.
  **Verified server-side 2026-07-15:** clean boot, `POST /api/sample-battle` → 201, full
  battle persisted. **PENDING user retest in browser:** demo-battle button + login.
  These guards were first written on the now-dead `feature/campaign-mode` laptop branch
  (`d4c4e60` + `0aa7852`) and cherry-picked onto main @ `47613bc`; the old branch's third
  commit (this handoff text) was carried by hand — do not merge that branch.
- **Node 25 gotcha:** its built-in `localStorage` shadows jsdom's and breaks the frontend
  tests (`window.localStorage.clear is not a function`). Run them with
  `NODE_OPTIONS=--no-experimental-webstorage` (the pinned nvm node in `make frontend-test`
  doesn't need it).
- **Engine:** build/test via WSL. Use `make test` (parallel) locally; `make test-serial` is
  CI's job. `./game dump-units` prints the unit catalog (SSOT lives in the C++ constructors).
- **campaign-server / frontend:** Node via the pinned nvm (`v24.11.1`) or plain `npm` (node is
  also at `/usr/bin`, v22). `make frontend-test` now uses plain npm.
- **Workflow:** small batches — easy fixes + tests first, clear context, **one feature per
  fresh session**; propose a split when scope grows.
- **Hidden-info discipline:** every campaign response goes through `services/campaignView.js`;
  never `res.json()` a raw campaign document. Tests assert this.
- **New unit workflow:** stats in the C++ ctor + one `UnitCatalog` line + a tripwire test;
  C++ is the single source of truth, nothing hand-maintained in JS.

---

# Rendering: retire SFML — the browser becomes the single battle renderer

**Decision (2026-07-07, user):** delete the SFML renderer; the browser `ReplayView` is the
only renderer. Re-adding SFML later is easy given the single source of truth — recover the
code from git: `backend/render/` and the SFML plumbing exist through commit **`5e8fb21`**, so
`git checkout 5e8fb21 -- backend/render` (and cherry-pick the Makefile/Utility bits) revives it.
No attic copy is kept — git history is the archive.

**Why.** The battle sim never needs SFML: `./game battle` just loops `field.tick()`, records
ticks, prints JSON — SFML was only the live window. Battle data already round-trips
C++ → DB → browser, so rendering in C++ buys zero speed and creates the only surface where
real-time (SFML) and history (browser replay) can diverge. Unit *positions/sizes* already come
from one pure engine function (`layoutHexFormation`) that BOTH the recorder and the old
renderer called; the only real difference was cosmetic styling. NOTE: the "in-window rewind"
task that spawned this already exists — the browser `ReplayView` has scrub/play/step. Nothing
functional is lost; we only port the visual cues so the browser is lossless.

**Architecture as found (all confirmed by reading the code):**
- `./game battle` (subprocess from `POST /api/battle`) opens an SFML window and runs
  `runBattleLoop` (`SampleBattle.cpp`): each iteration `field.tick()` → `onTick` records a tick
  → `renderer.render(field.hexGrid)` draws LIVE `Battlefield`. At end, `BATTLE_HOLD_WINDOW=1`
  holds the window (`BattleServer.cpp` ~232-254). Prints `{result, replay:{ticks}}` on stdout.
- `ReplayRecorder` (`backend/server`) writes per unit per tick: `q,r,ox,oy,sz,hp,type,team`,
  `squad`, and when engaged `side,rank` — offsets from `layoutHexFormation`. It does NOT record
  `broken`/`cast`.
- `ReplayView.jsx` draws `center + (ox,oy)*HEX_SIZE` at size `sz`, squad/team color. Applies NO
  rank-alpha dimming and NO cast/broken color. Already has the scrub/play/step controls.
- SFML-only surface: `backend/render/` (BattleRenderer); `main.cpp` window + `Utility::load()`;
  `Utility::font` + `Utility::load()` — the ONLY thing pulling SFML headers into the engine +
  test binary; `runBattleLoop`/`runBattleFromJson` renderer params; Makefile SFML
  download/link/font + `-I$(SFML_DIR)`; Dockerfile xvfb + X11/GL/freetype libs; docker-
  entrypoint.sh Xvfb/DISPLAY; `docker-compose.display.yml` + Makefile `docker-up-display`.
- `sample`/`spread` (`SpreadTest`/`SampleBattle`) are SFML visual dev scenarios. `sample` is
  the user's visual combat-FEEL debugger — it MUST return to the browser in Phase 2.

## Phase 1 — kill SFML, browser is the only renderer  ✅ SHIPPED 2026-07-07

**Done** — see the "Phase 1 SHIPPED" bullet in Project state above for what landed and the
byte-compat gotcha. The original plan (kept below for reference) was followed, with two
deviations worth remembering: the tick-recording loop is a do-while (records the final tick,
unlike the `while (field.tick())` sketch), and `sample`/`spread` write their replay JSON to a
path arg / default `replays/` in the campaign's own replay shape (user steer) rather than an
unspecified file.

Delete SFML LAST so the tree keeps building throughout. Suggested commit series on
`feature/campaign-mode`:

1. **Headless battle path.**
   - `runBattleFromJson` (`BattleServer.cpp` ~133): drop the `BattleRenderer&` param; replace
     the `runBattleLoop(...)` call AND the `BATTLE_HOLD_WINDOW` hold loop with
     `recorder.recordTick(field); field.setMaxTicks(maxTicks); while (field.tick())
     recorder.recordTick(field);`. Output JSON must stay byte-identical.
   - `runBattleLoop` (`SampleBattle.cpp` ~20): reduce to a headless version (no renderer,
     window, pause, or sleep) — or inline into callers. Scenarios still call it.
   - `main.cpp`: remove `sf::RenderWindow`, `BattleRenderer`, `Utility::load()`; `battle`/
     `sample`/`spread` call headless entries.
2. **Browser replay = lossless** (before deleting SFML, so old styling is still reference-able).
   - `ReplayRecorder::recordTeam`: add `broken` (bool) + `cast` (int `getCast()`) per unit.
   - `campaign-server/models/tick.js`: add `broken`/`cast` to the unit sub-schema — the STRICT
     schema silently strips unknown fields (pinned by `battles.test`). Extend fixtures.
   - `ReplayView.jsx`: port SFML cues from `BattleRenderer::renderUnitsInHex` — rank-alpha
     `RANK_ALPHA[4]={140,255,200,160}` indexed by `rank` when `side` present (solid 255 when not
     engaged); `cast`→yellow; `broken`→orange (broken wins). Add vitest for styling.
3. **Delete SFML.**
   - Remove `backend/render/`; strip `sf::Font font` + `load()` + the SFML include from
     `Utility.hpp/.cpp` (decouples engine + tests from SFML entirely).
   - Makefile: drop SFML download/link/rpath, `-I$(SFML_DIR)`, font copy — from
     CFLAGS/CLANG_FLAGS/test flags and all prereqs.
   - Dockerfile: drop xvfb + X11/GL/freetype + SFML lib copy + font. `docker-entrypoint.sh`:
     drop Xvfb/DISPLAY. Delete `docker-compose.display.yml` + Makefile `docker-up-display`.
4. **sample/spread headless + docs.**
   - `sample`/`spread`: run the scenario headless and write its replay JSON to a file (e.g. a
     `replays/` dir); print a result summary to stderr. NO browser viewer yet — Phase 2 wires
     it. Disconnected but data-producing.
   - Update `CLAUDE.md` (build/test/docker: no SFML, battles headless), `ARCHITECTURE.md`, this
     file.

**Verify (WSL — Linux-only build):** `make && make test-serial` (engine builds with ZERO SFML);
`./game battle < in.json > out.json` byte-compatible result+replay; `cd campaign-server &&
npm test` (tick schema incl. broken/cast); frontend `npm test` (replay styling); then drive a
real turn and eyeball the browser replay dimming/colors. Reminders: `make test` CRLF-fails on
the WSL box — use `make test-serial`; frontend/campaign-server tests run from PowerShell with
`NODE_OPTIONS=--no-experimental-webstorage`.

## Phase 2 — reconnect the visual combat-feel debugger  ✅ SHIPPED 2026-07-08

**How it actually landed (differs from the original file-loader sketch below).** The key user
steer: the browser renderer *requires the DB* now (SFML is gone), so a standalone replay-JSON
loader would be a second, DB-less render path — exactly the divergence Phase 1 removed. Instead
the sample battle **rides the real battle pipeline**: run it like any battle, store it, render
it from the DB. Only the battle-data SOURCE differs (the C++ scenario vs stdin JSON).

- **Engine:** `./game sample` prints the same `{winner, *_survivors, replay}` envelope as
  `./game battle` via a shared `runAndEmitBattle(field, mapName, title, maxTicks)` tail in
  `backend/server/src/BattleServer.cpp` (both `runBattleFromJson` and `runSampleBattle` call it).
  Dropped the `replays/sample.json` file write; `spread` still writes files (multi-replay tool).
- **Campaign server:** `services/engine.js` `runSample()` = `runEngine('sample')`;
  `services/battleRunner.js` extracts `persistBattleResult(result, {input, userId})` shared by
  `runAndPersistBattle` and the new `runAndPersistSample()` (ownerless, `user: null`); new
  **unauthenticated** `POST /api/sample-battle` (`routes/sampleBattle.js`) runs + persists +
  returns the summary. The ticks come back through the existing public
  `GET /api/battles/:id/ticks`.
- **Frontend:** `api.launchSampleBattle()`; a "Watch a battle" button on the logged-out screen
  in `App.jsx` launches it and renders the existing `ReplayView(battleId)` with new additive
  props `autoPlay`/`backLabel`. No forked viewer, no makefile rule.
- **Tests:** `campaign-server/tests/sampleBattle.test.js`, `frontend/src/__tests__/sampleBattleDemo.test.jsx`.
- **Verified 2026-07-08:** C++ `make re` + `make test-serial` green (308 cases) via
  `scripts/dev.sh` (WSL permission prompt resolved); JS suites green. Phase 2 complete.

<details><summary>Original sketch (superseded)</summary>

`./game sample` → browser: add a dev path in the React app to load a scenario replay JSON into
`ReplayView` (file drop / dev route / `?replay=` param) so watching how combat "feels" uses the
SAME renderer as real battles. One feature per fresh session.
</details>

---

# Campaign Mode: Foraging, Materials, Scouting, Augury Rework

## Context

The campaign layer today is React state in `frontend/src/App.jsx` (day, food, augury %, roster) — nothing persisted, enemy army is a hardcoded engine default, and the "augury" just shows 3 shuffled cards whose clicked effect applies (no roll, no true/decoy logic, no reroll). Goal: simulate ancient-warfare shadowing — both armies foraging the area dry, forager clashes, scouting mattering, imperfect omens — with a roguelite feel. All work on a new branch `feature/campaign-mode`.

**Locked decisions (user):**
- Campaign state moves **server-side** (Mongo `Campaign` model + campaign-server routes); hidden info (true event, enemy army/placement) never leaves the server.
- Forage area = **distance rings** (near/mid/far) around the shared camp; near depletes first; clash chance rises with distance + contested pressure. No regrowth.
- Augury = prediction only. Two events drawn (true + decoy); exploding roll decides if the shown prediction is true. **One reroll replaces the true event itself** (fresh pair + fresh prediction roll); design for >1 rerolls later. True event applies at end-of-day regardless (unless rerolled away). Event base accuracy **bonuses** for now (severe events = lower bonus; maluses later). Mage bonus from roster; character bonus placeholder.
- Campaign unit values are **derived from combat stats**, not hand-set: implement `movementSpeed` for real in the engine, add **ballistic skill** (exported ranged accuracy). Scouting value ≈ f(speed, ballistic) — archers/skirmishers/fast units good; fast animals auto-flagged by low ballistic. Add a **LightCavalry** unit; heavy Cavalry's role is screening/protecting foragers.
- Building materials = one merged resource (wood/metal split later), sinks: fortification stub + militia purchase.
- Every new screen gets a short intro behind a React `tutorial` flag (content pass can lag; hook-point ships).

**Cross-cutting choices:**
- Exploding dice ported to JS (`campaign-server/utils/dice.js`), mirroring `Utility::throwDice()` exactly (value d6 + *separate* explosion d6, recursive). Injectable RNG queue for tests, like `pushDiceRoll`. Shared test vector pins JS to C++ semantics (queue `[4,6,3,2]` → 7).
- Hidden info gated by one serializer `campaignView(campaign)` — never raw Mongoose `toJSON`.
- Forager clashes: cheap abstract formula first; engine-backed skirmish battles later behind the same interface.
- Extract battle run/persist logic from `campaign-server/routes/battles.js:15-58` into `services/battleRunner.js` for reuse (existing route becomes thin wrapper; its tests must keep passing).

---

## Stage 0 — Engine: movement speed, ballistic skill, LightCavalry

Demoable via `./game dump-units` + battles where cavalry actually outruns infantry.

**Movement speed (real implementation):**
- `backend/engine/src/Battlefield.cpp` `moveTeam()` (~line 590): loop each unit's movement decision up to `getMovementSpeed()` times per tick, re-evaluating target/engagement/preferred-range between steps; stop early when engaged, holding, at preferred range, or move-cost debt (`setSpentMove`) kicks in. Squad pre-pass: squad moves at **min member speed**. Flee: broken units flee at full speed.
- Set per-unit speeds in ctors: Foot 1, Cavalry 2 (heavy), LightCavalry 3, Horse/Warhorse/Scorpion 2 (values tunable).
- Update engine tests that implicitly assume 1 hex/tick; add movement-speed tests (unit with speed 3 covers 3 hexes on open terrain, stops on engagement, respects terrain cost debt).

**Ballistic skill (attack-skill scale — 10 = average trained human, matching melee `attackPWR` ~11):**
- New `int ballisticSkill` on `AUnit` + getter, set in ctors on the melee-like baseline: Archer 10, Mage 12, Soldier/Pikeman ~4 (some throwing familiarity), LightCavalry 8, animals/undead 1–3. Clear baseline makes new troops easy to stat.
- The existing 0–100 `accuracy` field (`AUnit.hpp:304`) becomes **derived**: `accuracy = ballisticSkill × 5` (Archer 10→50, Mage 12→60 — today's combat behavior identical; hit roll ≤ accuracy on d100, aimed range = accuracy/10 = BS/2). Set it in the `AUnit`/`Human` ctor from BS so the ranged pipeline is untouched; the full accuracy rework is deferred and this derivation is the single seam to change.
- Export `stats.ballisticSkill` in `unitCatalogJson()` (`backend/engine/src/UnitCatalog.cpp:103-110`); tripwire asserts export == live getter.

**LightCavalry:**
- `backend/engine/include/units/LightCavalry.hpp` + `src/units/LightCavalry.cpp`: MountedUnit like `Cavalry` but light loadout (e.g. `MeleeWeapons::Shortsword`, no shield, LIGHT armour), speed 3, decent ballistic (javelin-flavored even if melee-only for now), unique symbol (verify unused; suggest `'l'`).
- `UnitCatalog.cpp` table: `{"LightCavalry", true, true, makeT<LightCavalry>}` + include.
- Tripwire `backend/engine/tests/test_unit_catalog.cpp`: expected-names list, placeable set, live-instance stat equality (now incl. `ballisticSkill` + real speeds), symbol lookup.

**Campaign-server mirror:**
- `campaign-server/models/unitType.js`: add `ballisticSkill` to `statsSchema` (strict mirror — sync aborts boot on drift, intended).
- `campaign-server/tests/fixtures/catalog.js`: extend fixtures.
- New `campaign-server/utils/capabilities.js` — derived campaign values from catalog stats (all constants in one place, tunable):
  - `scoutValue = speed * 3 + floor(ballisticSkill / 3)`  (BS on the 10-average scale)
  - `forageValue = speed * 2` (min 1 for Foot)
  - `screenValue = floor(armour / 2) + floor(attack / 6) + speed` (heavy cav high)

**Verify:** WSL `make && make test`; `./game dump-units` shows LightCavalry + ballisticSkill + speeds; `cd campaign-server && npm test`; frontend placement shows LightCavalry automatically (flows via `/api/info`).

---

## Stage 1 — Server-side campaign foundation

Moves the loop into Mongo + routes; ships with the existing simple pick-a-card augury ported verbatim (replaced in Stage 5) so the game stays playable. Enemy army becomes per-campaign server state (fixes the engine-ignored `enemy_preset`).

**Model `campaign-server/models/campaign.js`:**
```js
Campaign {
  user: ref User (indexed), status: 'active'|'won'|'lost',
  day: Number, battleFoughtToday: Boolean,
  resources: { food, materials },
  roster: Map<String,Number>,            // validated against unittypes
  auguryScore: Number,                   // legacy, dies in Stage 5
  events: { drawn: [{id,title,description,effect,isReal}], picked: Boolean }, // isReal NEVER serialized
  forage: {...},                         // Stage 2
  scouting: {...},                       // Stage 4
  enemy: {
    army: Map<String,Number>,            // HIDDEN; seed incl. LightCavalry
    supplies: Number,
    stance: 'camp'|'shadowing'|'offering_battle'|'withdrawing',
    plannedPlacement: [{unit_type,q,r}]|null,   // HIDDEN unless revealed (Stage 4)
  },
  character: { type: Mixed, default: null },    // placeholder; augury reads character?.auguryBonus ?? 0
  battles: [ref Battle], log: [{day, entries:[String]}],
}
```
Starting values in `campaign-server/utils/campaignConfig.js` (STARTING_ROSTER + `LightCavalry: 12`, food 100, enemy comp, upkeep divisor) — retires the `App.jsx:61` hardcode.

**Services:** `battleRunner.js` (extracted); `events.js` (EVENT_POOL moved from `App.jsx:11-20`; `enemy_advance` now sets `enemy.stance='offering_battle'`); `enemyAi.js` (supplies upkeep `ceil(size/10)`; stance machine: camp → shadowing after day 3 → offering_battle on low supplies or every 5th day → withdrawing = campaign won at <20% strength); `enemyPlacement.js` (random spread over enemy zone from cached `getInfo()`, axial conversion `q = col - floor(row/2)` as `App.jsx:126`); `dayResolution.js` — ordered pipeline, stages append steps:

0.5 scouting band read (S4; as of 1d it precedes forage — it sets the forage posture AND picks event rungs) → 1. forage (S2; × posture yield, S4 1d) → 2. clashes (S2; × posture damper, S4 1d) → 3. apply true event (S5; in S1 effect applies at pick time) → 4. enemyTurn (upkeep, stance, tomorrow's offer + forage plan) → 5. playerUpkeep (`food -= ceil(units/10)`; food 0 → 10% desertion, making `App.jsx:202` real) → 6. checkEnd → 7. newDay (draw events, regenerate plannedPlacement).

**Routes `campaign-server/routes/campaigns.js`** (all `userExtractor`, ownership → 404):
```
POST /api/campaigns                     → 201 campaignView
GET  /api/campaigns , /:id              → campaignView(s)
POST /api/campaigns/:id/events/pick     {eventId}   (Stage-1 stopgap)
POST /api/campaigns/:id/battles         {player_placement} → battle summary
     (server injects map + enemy_placement from plannedPlacement; survivors → roster / enemy.army)
POST /api/campaigns/:id/end-day         → dayReport {event, upkeep, enemy:{stance,battleOffer}, day, status}
```

**Frontend:** `api.js` gains campaign calls; new `hooks/useCampaign.js`; `App.jsx` keeps phase machine/auth/placements/replay + `tutorial` flag state, sheds day/food/augury/roster/events logic; "Start Campaign" screen; `components/TutorialIntro.jsx` shell (title + bullets, gated on flag, dismissal in localStorage). `CampaignHUD` reads campaign view.

**Tests:** frontend — extend `vi.mock('../services/api')` with a campaign fixture (auth/replay/placement tests keep assertions); add `campaignFlow.test.jsx`. Server — `tests/campaigns.test.js` using existing `helpers/db.js`/`auth.js`, engine mocked as in `battles.test.js`; **hidden-info test: no response ever contains `enemy.army`, `isReal`, or `plannedPlacement`**.

**Verify:** both `npm test`; curl smoke (login → create → pick → battle → end-day); two-day browser loop; Mongo doc has hidden fields, responses don't.

---

## Stage 2 — Foraging (rings + abstract clashes)

**Model:** `forage: { rings: [{ring, richness, initialRichness}] (300/500/800), assignment: Map<type,count>, enemyPlan: Number }`. No regrowth — depletion is the campaign clock.

**`services/forage.js`:**
- Player capacity `C = Σ assignment[type] × forageValue(type)` (from `utils/capabilities.js` — capability-driven, a future Flyer just works).
- Near-first allocation with spill; both sides allocate against start-of-day richness, subtract simultaneously, pro-rata on shortfall. Enemy plan computed by `enemyAi` from its own army, same formulas.
- Yield: `food += 0.8 × harvested`, `materials += 0.2 × harvested` (constants in `campaignConfig.js`).
- Clash per contested ring: `p = base[ring] (0.05/0.12/0.25) + 0.3 × min(P,E)/(P+E)`, cap 0.6.
- `services/skirmish.js` — `resolveClash(playerParty, enemyParty, ring) → {playerLosses, enemyLosses, yieldLostPct, log}`: strength = Σ count × (attack/4 + screenValue) + `throwDice()` per side (swingy on purpose); loser 2–6% detachment casualties (high-screen units die last), winner 1–2%, loser forfeits 50% of ring yield. Interface fixed so engine-backed skirmishes can swap in later.

**Route:** `POST /api/campaigns/:id/forage {assignment}` (≤ roster, before end-day). Assigned units are unavailable for today's battle — server subtracts assignment in the battle route's budget check; HexGrid gets roster-minus-assignment.

**Frontend:** `components/ForagePanel.jsx` (ring gauges, per-type steppers, projected yield/risk) + TutorialIntro; `CampaignHUD` depletion indicator. Tests: allocation/spill/contention as pure-function server tests with queued-RNG; `forageAssignment.test.jsx`.

**Verify:** deterministic math tests; curl assign → end-day → report; browser: ring 0 depletes over ~4 days, clash rate climbs.

---

## Stage 3 — Building materials (materials sink + real fortifications)  ✅ SHIPPED 2026-07-08

**Done** — see the "Stage 3 SHIPPED" bullet in Project state above for the four commits and what
landed at each layer. The design below was followed as written; the one nuance worth remembering is
that the map-file `fortified_sides` format was extended to accept either a plain dir-name string
(durability 0) or a `{dir, durability}` object, keeping existing map files byte-identical. Militia
buys `Soldier` for now (distinct `Militia` unit type still a later SSOT run). Next up is the
`fortDurability` erosion step ([[todo-combat-score-per-hexside]]) that makes the placeholder live.

**Militia = spear militia (user, 2026-07-08 — NOT scheduled yet).** When the distinct `Militia`
unit type lands (its own SSOT run, sequenced AFTER the combat-score/`fortDurability` erosion step —
do not build it before then), it should be **spear-armed** (a cheap levy: `MeleeWeapons::Spear`,
light/no armour, foot speed). Follow the standard new-unit workflow (C++ ctor + one `UnitCatalog`
line + tripwire test; campaign-server mirror). Until then `POST /spend {action:'militia'}` keeps
adding `Soldier` (`MILITIA_UNIT` in `campaignConfig.js` — flip it to `Militia` when the unit exists).

**Design decided 2026-07-08 (user):** fortifications are **abstract levels that fortify the
battle map at preset locations** — spending materials raises a campaign `fortificationLevel`,
which walls a wider span of the player's front deployment edge with engine `fortified` hexsides.
This turns the plan's old "combat effect = logged stub" into a **real** combat effect with
almost no engine work, because the engine already implements fortifications end-to-end.

**What already exists in the engine (confirmed by reading the code — do NOT rebuild it):**
- `HexSide.fortified` + `fortifiedDefender` (`hex/HexGrid.hpp`). `fortifiedDefender` is the hex
  whose occupants are protected; the attacker *crossing into* that side eats
  `FORTIFIED_ATK_PENALTY` (`Defines.hpp`, currently **1** — same magnitude as an elevation edge)
  in `AUnit::computeAttackBonus` (`AUnit.cpp` ~262).
- Fortified is **assaultable**: it only adds a combat penalty, it never blocks movement (only the
  separate `blocked` flag does — `Battlefield.cpp` ~96/135). So ramparts slow an assault, they
  never stalemate the battle. **Decision: ramparts only, no `blocked` walls** (user).
- Map JSON already round-trips `fortified_sides` per hex (`HexGrid.cpp` toJson ~322 / fromJson
  ~428). But campaign battles pass a fixed **map NAME** (`MAP_NAME`) and the engine loads
  `maps/<name>.json` from disk (`campaigns.js` ~205, `BattleServer.cpp` ~168-187) — the file is
  static, the level is dynamic, so the level can't be baked into the map file.

**Locked decisions (user, 2026-07-08):**
- Level scales **coverage, mostly** (wider walled span per level), engine penalty stays the flat
  constant for now. **Only levels 1–2** (cap `fortificationLevel` at **2**, not 3). A per-side
  strength bump ("a bit of both") is deferred — it arrives naturally with the degradation step:
- **Per-side durability placeholder (added this stage, user 2026-07-08):** the fortified hexside
  gains a **`fortDurability`** (int) "durability/strength" score. In THIS stage it is a *placeholder*
  — set at battle start, serialized, and shown, but **not yet consumed** (nothing erodes it). It
  exists now so the schema/data path is in place before the erosion logic lands.
- **Forward path (soon, not this stage — TODO: "combat score per hexside"):** per-hexside
  `combatScore` (the field already exists, documented in `HexGrid.hpp` ~60-68) will **erode**
  `fortDurability` as the enemy generates score against the side — an abstraction for pushing
  through / battering down the works; at 0 durability the side reverts to unfortified mid-battle.
  That step is what makes `fortDurability` live (and where per-level *strength* scaling — the "bit
  of both" — really bites). Safer still once maps are generated dynamically.

**The one engine seam (small):**
- Add `int fortDurability = 0;` to `HexSide` (`hex/HexGrid.hpp`), next to `fortified`/
  `fortifiedDefender`. Round-trip it in `HexGrid` toJson/fromJson alongside `fortified_sides`
  (so hand-authored map works can set it too). Placeholder — no combat/tick code reads it yet.
- `runBattleFromJson` (`BattleServer.cpp`): after `field.hexGrid.fromJson(mapContent)`, if the
  battle-input JSON has an optional `fortified_sides` array (entries `{q, r, dir, durability?}`),
  apply each to the grid — set `side->fortified = true; side->fortifiedDefender = <that {q,r}
  hex>; side->fortDurability = durability (default e.g. 100)` — mirroring the existing map-file
  `fortified_sides` loader (`HexGrid.cpp` ~428). ~20 lines + a round-trip test. This is the
  *whole* C++ change for now; the combat penalty is already there, the durability is inert. Keep
  the same `dir` string names (`NE/E/SE/SW/W/NW`) the map loader uses.

**Campaign server:**
- `models/campaign.js`: add `fortificationLevel` (Number, 0–2, default 0). Bump
  `CAMPAIGN_SCHEMA_VERSION`.
- `utils/campaignConfig.js`:
  - `FORTIFY_COST_BASE = 50` → fortify cost `FORTIFY_COST_BASE × (level+1)` (L0→1 costs 50, L1→2
    costs 100).
  - `FORTIFICATION_PRESETS` keyed by map name: an ordered, **tier-gated** list of player-front
    hexsides, `{ q, r, dir, tier, durability }` (tier 1 or 2). `fortificationLevel = N` activates
    every preset with `tier ≤ N`. Author these along the enemy-facing edge of the player deployment
    zone (`player_zone_rows` top edge of `maps/sample_battle.json`), `fortifiedDefender` = the
    player-side hex. Level 1 = a short center span; level 2 = a wider span, and its sides carry a
    higher `durability` (the "mostly coverage, a bit of strength" steer — durability is inert until
    the combat-score erosion step, so it's forward-looking data for now). `durability` flows into
    the battle input's `fortified_sides` entries. (Structured so it can migrate to a map-file
    `fort_presets` field later, but lives in config now — single fixed map.)
- New `services/fortification.js`: `fortifiedSidesFor(mapName, level)` → the `fortified_sides`
  array for the battle input (pure, from `FORTIFICATION_PRESETS`). Injected into the battle input
  at `campaigns.js` ~204 (`input.fortified_sides = fortifiedSidesFor(MAP_NAME, campaign.fortificationLevel)`).
- Spend route `POST /api/campaigns/:id/spend` (userExtractor, ownership → 404):
  - `{action:'fortify'}` → cost `FORTIFY_COST_BASE × (level+1)` materials; insufficient → 400;
    already at cap (2) → 400; else `materials -= cost`, `fortificationLevel++`, log entry.
  - `{action:'militia', count}` → 2 food + 1 material per Soldier, daily cap (distinct `Militia`
    unit type = later SSOT run). (Unchanged from the original plan.)
- `services/events.js`: add `materials`-type effects (quarry +25, tool rot −15).
- `services/campaignView.js`: expose `fortificationLevel` + derived `fortifyCost`/`atCap` (own
  info, not hidden). No enemy fortification info leaks.

**Frontend:**
- `CampaignHUD`: materials + fortification level readout.
- `components/CampPanel.jsx` + TutorialIntro: fortify button (shows cost, disabled when
  materials < cost or at cap); militia purchase.
- **Placement `HexGrid`:** draw the active `fortified_sides` on the player edge so the player can
  see the wall and knows to deploy behind it (positional — fortification only helps troops the
  enemy must assault across a walled side). Reuse `fortifiedSidesFor` output via the campaign view.

**Tests:**
- Server: spend validation (insufficient materials → 400; cap at 2 → 400; happy path debits +
  increments); `fortifiedSidesFor` returns the right sides per level (0 → [], 1 → tier-1 set, 2 →
  tier-1+2); the battle route injects `fortified_sides` matching the campaign's level; hidden-info
  test still passes (no enemy fort/army leak).
- Engine: C++ round-trip — a battle input with `fortified_sides` marks exactly those sides
  fortified (and a combat test asserting the attacker penalty applies across a fortified side).
- Frontend: `campPanel.test.jsx` (fortify button gating on cost/cap); placement renders the
  walled sides.

**Verify:** WSL `make && make test-serial` (round-trip + combat); `campaign-server npm test`;
`frontend npm test`; curl fortify twice (2nd at cap → 400) then fight a battle and confirm the
replay tick-0/side data shows the fortified sides; browser: fortify, deploy behind the wall, watch
the enemy assault eat the penalty.

---

## Stage 4 — Scouting (coverage → cavalry-superiority gauge)

> ### ✅ PLAN FINALIZED 2026-07-13 (user-approved, NOT yet implemented) — READ THIS FIRST
> The 2026-07-09 revision below was resolved in a planning session on 2026-07-13 and an
> implementation plan was **approved by the user**. It supersedes both the old Stage-4 body
> (which stays below as the detailed reference for Phases A/B/C — still the design being
> executed, just keyed off the new scouting band) and the open questions in the revision block.
> Work ships as **two parts, four sub-pieces**, each independently shippable (one per fresh
> session); 1a must land first, 1b/1c/1d in any order, Part 2 (raids) after 1a.
>
> **1a. Scouting coverage/band foundation. ✅ SHIPPED 2026-07-13** (see the handoff entry
> "Stage 4 sub-piece 1a" above for what landed and the verified test runs).
> - Engine: signed stat `reconTag` on `AUnit` (default 0; LightCavalry positive, Warhorse/heavy
>   negative), exported in `unitCatalogJson()` — same SSOT workflow as `ballisticSkill`
>   (tripwire in `test_unit_catalog.cpp`). ALSO add `"speed"` to `buildInfoJson()`'s placement
>   units (`UnitRegistry.cpp` ~56-62; currently type/symbol/placementSize/category/
>   forbiddenTerrain) — the raid party-builder needs per-unit speed client-side; tripwire in
>   `test_server_api.cpp`.
> - Campaign-server: `unitType.js` statsSchema += `reconTag`; fixtures updated. In
>   `capabilities.js`: replace unused `scoutValue` with
>   `reconValue(stats) = speed² + floor(ballisticSkill/2) + reconTag`, add
>   `scoutingCoverage(army, catalog) = Σ(count·reconValue) / Σ(count·size)` (armyFoodPerTurn's
>   Map-or-object pattern). `scoutingBand(playerCoverage/enemyCoverage)` →
>   Overwhelming/Superior/Contested/Outmatched/Blind, thresholds `SCOUTING_BAND_THRESHOLDS` in
>   `campaignConfig.js`. `campaignView` exposes `scouting: {band}` — ONLY the band label ever
>   crosses the hidden-info boundary (never raw ratio/enemy composition); no schema change
>   (derived at view time like foodNeedPerTurn).
> **1b. Graduated enemy reveal. ✅ SHIPPED 2026-07-13** (see the handoff entry "Stage 4
> sub-piece 1b" above) = old Phase A keyed off the 1a band: Blind → stance only (as
> today); Outmatched/Contested → + strength band (bucket `armyTotal(enemy.army)` into named
> ranges) + supplies trend; Superior → + composition by category % (reuse the catalog `category`);
> Overwhelming → + exact counts AND `enemy.plannedPlacement` (the model field's reserved "HIDDEN
> until a scouting reveal" moment; no schema change). All band-conditional logic in
> `campaignView.js` (the single leak gate). Frontend: `HexGrid.jsx` optional `enemyPlacements`
> prop → red glyphs on enemy-zone hexes (inverse axial `col = q + floor(r/2)`). NOTE the tempo
> insight: revealing plannedPlacement at the top band IS the "worse intel commits first"
> mechanic (the enemy's placement is already fixed at new-turn; a well-scouted player reacts to
> it) — literal staged/sequential deployment commits were considered and DEFERRED (needs
> multi-round placement plumbing; revisit only if 1b doesn't satisfy once played).
> **1c. Recon-sensitive event rungs. ✅ SHIPPED 2026-07-14** (see the handoff entry "Stage 4
> sub-piece 1c" above) = old Phase B keyed off the band: `EVENT_POOL` entries get
> `reconSensitive: true` + a 3-rung ladder (Blind → full bad; Warned = Outmatched/Contested →
> lesser; Anticipated = Superior/Overwhelming → neutral/reversed-positive; new `applyEffect`
> arms `enemy_losses` + free-reveal). `dayResolution` step 3 picks the rung; the augur still
> foretells the Blind rung; day report names the FIRED rung + "scouts intervened" flag. The
> blueprint events below (Enemy Ambush / Forage Raiders / Night Raid) stand.
> **1d. Forage posture multipliers ✅ SHIPPED 2026-07-14** (see the handoff entry "Stage 4
> sub-piece 1d" above) = old Phase C: band-keyed `FORAGE_YIELD_BY_BAND` +
> `FORAGE_CLASH_DAMPER_BY_BAND` tables in `campaignConfig.js`, applied as two `×` insertions in
> `forage.js` yield + `skirmish.js`/forage clash chance. Includes the
> forageValue/screenValue/reconValue overlap check (non-blocking; verdict recorded in the 1d
> handoff — no consolidation needed yet).
>
> **Part 2 — RAID OPPORTUNITIES (new, user design 2026-07-13). ✅ SHIPPED 2026-07-14** (see
> the handoff entry "Stage 4 Part 2" above for what landed and the verified runs; the open
> decisions at the end of this block stand). A raid phase: capacity-limited
> parties hit scouted targets, resolved as REAL short engine battles through the existing
> pipeline (watchable in ReplayView — that's the point; NOT the abstract resolveClash formula).
> - **Model** (`CAMPAIGN_SCHEMA_VERSION` 9→10): `raid.opportunities []` of `{id, type:
>   destroy_detachment|loot_supplies|rescue_troops|counter_event, title, description,
>   targetForce (Map, HIDDEN), strengthBand (shown), capacity, reward (Mixed), resolved,
>   outcome {winner, battleId}|null}`.
> - **Generation** (`services/raid.js`, called in dayResolution step 7 beside
>   buildEnemyPlacement): count/quality scales with scouting band (`RAID_OPPORTUNITIES_PER_DAY`
>   by band, Blind→1 … Overwhelming→3 — raids stay somewhat random; the OTHER benefits above are
>   deterministic by level, per user steer). `targetForce` = random slice of `enemy.army`
>   (`RAID_TARGET_FRACTION`), NOT pre-subtracted — becomes real only on a win. `counter_event`
>   generates only when some augury slot's trueEvent has `eventValence(effect) === 'bad'`
>   (reuse the existing classifier); reward `{slot}`; description stays vague about which event.
> - **Party capacity**: `raidCapacityCost(stats, size) = max(0, size × (40 − speed) /
>   RAID_CAPACITY_SPEED_SCALE)` with scale 40 (user formula, kept literally even though speed is
>   1–3 today — the movement-speed rework in the deferred backlog makes it meaningful; the TODO
>   comment lives on this one function).
> - **Placement**: extract `buildEnemyPlacement`'s zone-spread core into shared
>   `spreadPlacement(army, zone, sizeOf)`; auto-place BOTH sides of a raid (no manual raid
>   placement UI in v1).
> - **Route** `POST /:id/raids/:raidId/launch {party: {type:count}}`: guards like existing
>   routes; validate party vs `roster − forage.assignment` + Σcost ≤ capacity; battle input
>   `{map: MAP_NAME, player_placement: spread(party, playerZone), enemy_placement:
>   spread(targetForce, enemyZone), max_turns: RAID_MAX_TURNS}`, NO fortified_sides;
>   `runAndPersistBattle`; reconcile roster like the battle route; on WIN apply reward
>   (destroy → subtract targetForce from enemy.army clamped ≥0; loot → +food/materials;
>   rescue → +roster; counter_event → `augury.slots[slot].countered = true`, new schema flag);
>   mark resolved + outcome, log, return `{...summary, campaign: view}`.
> - **dayResolution step 3**: a `countered` slot SKIPS applyEffect, logs "averted";
>   `auguryReveal` reports the flag.
> - **campaignView**: unresolved opportunities strip `targetForce` to `strengthBand` only;
>   resolved ones show outcome/battleId (the replay is the reveal).
> - **Frontend**: `components/RaidPanel.jsx` in `council-main` beside ForagePanel (phase
>   'setup'); party-builder clamps live vs capacity using the new `speed` on info.units;
>   "Watch the raid" = existing `ReplayView(battleId)`; scouting band label shown in
>   HUD/RaidPanel (banded label, no raw odds — house style).
> - **Tests**: `campaign-server/tests/raid.test.js` (generation scaling, counter_event
>   conditionality, capacity/roster 400s, per-type reward application with mocked engine,
>   hidden-info: targetForce never leaks pre-resolution); `raidPanel.test.jsx`; extend the
>   campaigns.test.js hidden-info sweep to `raid`.
> **Open decisions recorded, NOT resolved:** (1) raid-vs-main-battle turn sequencing — for now
> INDEPENDENT (same units may raid and fight the main battle the same turn, no battleFoughtToday
> gate; explicitly a placeholder — might become a distinct raiding phase / multiple raid turns
> before the main battle); (2) the movement-speed rework (see deferred backlog); (3) staged
> deployment commits (see 1b note). Enemy-reinforcement detection stays deferred (needs the
> reinforcement mechanic first, see below).
>
> **Playtest finding (2026-07-15) — troops joining MULTIPLE raids the same turn: ✅ FIXED
> 2026-07-16.** Not the same thing as open decision (1) above (raid-vs-MAIN-battle, independent on
> purpose): the launch route validated the party against `roster − forage.assignment` only, so
> units already committed to an earlier raid this turn were never subtracted and one detachment
> could fight every opportunity.
>
> **Fix**: `campaign.raid.assignment` (`models/campaign.js`) is a new persisted Map — the raid
> twin of `forage.assignment` — incremented by every raid party's committed troops (win or lose)
> and cleared at `newDay` alongside `forage.assignment`. The single-raid launch route
> (`POST /:id/raids/:raidId/launch`) is replaced by a **batch** route,
> `POST /:id/raids/launch` (`{parties: {raidId: {type:count}}}`), which validates the WHOLE
> batch's combined troop usage against `roster − forage − raid.assignment` before running any
> battle (all-or-nothing — battles are external subprocesses that can't be rolled back once
> started) and only then resolves each raid in turn. The frontend's `RaidPanel.jsx` computes one
> shared pool across every still-open opportunity card (roster − forage − raid.assignment − every
> OTHER card's current draft) so two cards can never be drafted with overlapping troops in the
> first place, and a single combined "Launch raids" button submits every drafted party together —
> but the server re-validates independently regardless of what the frontend sends (illegal-attempt
> tests hit the route directly on both sides: `campaign-server/tests/raid.test.js`'s "raid
> double-assignment is rejected" block, `frontend/src/__tests__/raidPanel.test.jsx`'s shared-pool
> clamp test).

> ### ⚠️ PENDING REVISION (2026-07-09, user) — resolved by the 2026-07-13 finalized plan above;
> kept for the reasoning. Original steer:
>
> **Split the single gauge into TWO tied-but-distinct systems.** The Stage-4 body below collapses
> "scouting" and "cavalry superiority" into one band (Overwhelming → **Blind**). That's wrong:
> being *blind* is an information state, losing the cavalry contest is a field-control state, and
> **lack of cavalry must NOT mean blind** — especially in a fantasy setting (a scrying mage, a
> flyer, or a ranger sees without a single horse). Light cavalry feeds *both*, which is its
> identity; heavy cavalry feeds field control only; a flyer/mage feeds recon only. That divergence
> is exactly why the two are separable and worth separating.
>
> - **Cavalry Superiority = control of the open ground** (a *comparison* → band; fed by the mobile
>   combat arm, infantry ≈ 0). Governs foraging/security only:
>   - **Forage posture** — superiority → forage in small dispersed parties (cover more ground,
>     higher yield); inferiority → large escorted columns (less ground, must self-defend).
>   - **Supply-line tax** — weaker cavalry ⇒ more troops you must *detach to guard the supply line
>     / escort foragers*, i.e. fewer bodies in the battle line (legible cost, not just a multiplier).
>   - **Forager clash outcomes** — whether your foragers survive contact and whether you screen theirs.
> - **Scouting = information / reconnaissance** (fed by light cavalry **AND** fantasy recon —
>   scrying mage / flyer / ranger). Governs knowledge only:
>   - Locating isolated enemy troops; **raid timing** (hit them when their foragers are out);
>     forage intel (how many enemy units forage vs. camp).
>   - **Deployment reveal** — see terrain, and (more) see enemy troops before you commit placement.
>   - **Information initiative (tempo)** — the side with *less* scouting **commits its choices
>     first** (forage assignment, maybe deployment); the superior side reacts with knowledge.
>     Information = the right to move last. (Strongest idea: makes scouting matter even when nothing
>     is "revealed" on screen.)
> - **How they interlock:** light cav feeds both; the forage loop consumes both at different steps
>   (cav = how efficiently/safely you forage + supply tax; scouting = what you know + who reacts);
>   a **raid = scouting × cavalry** (scouting gives the opportunity, cavalry decides if it succeeds).
>
> **Divergences from the body below to resolve when rewriting:**
> 1. "Blind" is no longer the bottom cavalry band — cavalry bands mean *field control* (secure ↔
>    exposed); scouting gets its own scale.
> 2. **Reveal moves from automatic-by-band toward (partly) spendable.** User wants to "spend
>    scouting points to see terrain, more to see enemy troops." That reverses the body's explicit
>    "passive ratio, no point pool" decision — likely a **hybrid**: passive scouting *strength*
>    (comparison → drives the initiative mechanic + what you passively know) *accrues points* you
>    *spend* at deployment for reveals.
> 3. **Two derived unit values, not one** — a *mobile field-control value* (cavalry superiority) and
>    a *recon value* (scouting). Light cav high on both; heavy cav control-only; flyer/mage recon-only.
>    Engine `reconTag` still feeds the recon value.
> 4. **Event transforms (old Phase B) split by theme** — forage-raid/supply events key off cavalry
>    superiority; "you knew it was coming / night-raid warning" events key off scouting.
>
> **Open decisions still to settle (before rewriting the body):**
> - Scouting: pure comparison, or comparison + spendable points (hybrid)?
> - Supply-line tax: hard troop lock-out, or a yield/efficiency penalty?
> - Does cavalry superiority also gate the initiative/tempo mechanic, or is that scouting's alone?
> - Fantasy recon sources at launch — just light cav (+ "a flyer later"), or a mage/scrying
>   contribution from the start so "no cavalry ≠ blind" is demonstrable on the starting roster?

**Supersedes the earlier points/intel-tier draft.** Decisions this session: scouting is a
**passive coverage ratio**, not a spendable point pool; there is no intel "shop." The whole
stage hangs on **one derived number** — *control of the ground between the armies* — read as a
banded **cavalry-superiority gauge**. That single gauge drives everything: what you see, whether
recon-sensitive events land or get reversed, and how safely/efficiently you forage. It unifies
scouting and foraging instead of building two parallel systems.

**Design decisions locked (this session):**
- **Coverage ratio** for scoring (÷ own army size), **passive** (composition-driven, no UI
  friction, no assignment). Reveal is *consumed at deployment* — you see terrain + enemy forces
  when you go to deploy for battle.
- Big army must **not** auto-win scouting. Two independent mechanisms enforce it: the ÷size
  denominator (a blob dilutes its own coverage) **and** the relative comparison to the enemy
  (infantry contributes ≈0 to the mobile arm, so amassing it doesn't buy superiority).
- Scouting **transforms** recon-sensitive events, it is **not** a prerequisite gate — see the
  event-transform sub-section. (Event *prerequisites/chains* remain separate, later work.)

**Scoring (revises the Stage 0 `scoutValue`):**
- Per-unit `reconValue` goes **super-linear in mobility + a signed designer tag**:
  `reconValue = speed² + floor(ballisticSkill / 2) + reconTag` (rough, tunable). Line infantry
  ≈ small constant, light cavalry high, a future flyer highest (speed² dominates), a bare
  fast-but-blind animal net-negative via the tag. Squaring alone does **not** fix the size
  problem (300 infantry still out-*sum* 12 cavalry) — it only sets the marginal incentive; the
  normalization below is what kills it.
- New **engine stat `reconTag`** (signed; default 0; e.g. LightCavalry/hunter/ranger positive,
  Warhorse/heavy negative) on `AUnit`, exported in `unitCatalogJson()`, mirrored in
  `unitType.js` `statsSchema` + fixtures + tripwire — **same workflow as `ballisticSkill` in
  Stage 0** (C++ stays SSOT; nothing hand-maintained in JS). Keeps the new-unit workflow intact.
- **Coverage** (per side) `= Σ(count · reconValue) / Σ(count · size)` — "scouting per unit of
  army you must screen." Sanity numbers on the starting roster ≈ 0.39; drop the infantry and it
  jumps to ~0.82; *double* the infantry and it falls to ~0.35 (quality up, blob down).
- **Cavalry superiority** `= playerCoverage vs enemyCoverage` → bands
  **Overwhelming · Superior · Contested · Outmatched · Blind** (ratio thresholds in
  `campaignConfig.js`). Enemy coverage is computed from the hidden `enemy.army` — no new state.

**Model:** essentially **zero new schema for the gauge** — coverage and the band are *derived*
(from `roster` + `enemy.army`) in `campaignView` and `dayResolution`, the same way foodNeed and
forage capacity already are. No `scouting` subdoc, no `points`/`intelLevel`/`revealForDay`. (The
only later schema touch is enemy reinforcements — deferred below.)

**The one gauge drives three things:**

*Phase A — graduated enemy reveal (ship first).* `campaignView.enemy` exposes more by band, the
serializer staying the single leak gate: Blind → stance only (as today); Outmatched/Contested →
rough strength band ("a large host") + supplies trend; Superior → composition by category %;
Overwhelming → exact counts **and** `plannedPlacement` (the deployment preview already reserved
"HIDDEN until a scouting reveal"). Surfaced on the placement/deploy screen.

*Phase B — event transforms.* Recon-sensitive events (thematic only: ambush/raid/night-attack —
never plague/weather) carry a **3-rung ladder** keyed to the band: **Blind → full bad; Warned →
lesser bad; Anticipated → neutral or reversed to positive.** `dayResolution` step 3: if
`event.reconSensitive`, apply the rung the band selects; else apply the flat effect as today.
The **augur foretells the Blind rung** (the fate if you do nothing) — prophecy tells you what's
coming, scouting decides whether it lands (knowledge vs. agency). **Never invisible:** the day
report names the *fired* rung's own title + a "scouts intervened" flag, so the payoff is felt and
a mitigated threat is the same event downgraded, never a silent swap. Needs a couple of new
`applyEffect` arms for the positive rungs (`enemy_losses`, capture→free-reveal). Blueprints (not
a spec — clone these):
```
Enemy Ambush   Blind → enemy forces battle on their terms
               Warned → they advance, but you meet them in order (no surprise penalty)
               Anticipated → Counter-Ambush: you bait the trap, enemy takes casualties  (+)
Forage Raiders Blind → lose food/materials + forager casualties
               Warned → escorts intercept: losses cut sharply
               Anticipated → you destroy the raiding party: enemy loses the detachment  (+)
Night Raid     Blind → small food loss + a little desertion
               Warned → pickets catch them: negligible loss
               Anticipated → prisoners taken → free enemy reveal this turn  (+)
```

*Phase C — forage posture.* The band applies two **passive multipliers** to the existing forage
math: a **yield multiplier** (dispersed efficient sweeping vs. clumped defensive columns) and a
**clash-risk damper** in `forage.js`/`skirmish.js`. "Small groups vs. large escorted groups" is
the *fluff* for the numbers — the player doesn't micro group size. Preserves the tradeoff:
Outmatched you can *still* forage, just less of it. This gives **light cavalry a distinct
identity** (wins the field: recon + forage security) vs. heavy cavalry (battle shock). **Cleanup
to do here:** `forageValue` / `screenValue` / `reconValue` now overlap — consolidate toward one
"mobile-arm" value + one combat-screen value so cavalry's worth doesn't fragment across three
uncoordinated knobs.

**Deferred within scouting (own mini-stage, has a prerequisite):** *enemy reinforcement
detection* requires first **building an enemy reinforcement mechanic** (a schedule on `enemy` —
today the host only shrinks). Once that exists, the top superiority bands reveal *incoming*
reinforcements. Sequence after Phase A–C.

**Frontend:** `HexGrid.jsx` optional `enemyPlacements` prop → red unit symbols on enemy-zone
hexes (inverse conversion `col = q + floor(r/2)`) instead of the empty red tint, shown at the
top band; a **superiority gauge** readout (band label, no raw ratios — matches the "no odds in
UI" ethos) on the council/HUD; `DayReport` shows the fired event rung + scout-intervention badge;
TutorialIntros.

**Tests:** coverage math (blob lowers it, cavalry/fliers raise it, negative `reconTag` bites);
band thresholds; **the marquee hidden-info test — `campaignView` leaks graduated enemy info
*only* at the right band, and `plannedPlacement` only at Overwhelming**; event-rung selection by
band incl. the augur foretelling the Blind rung; forage multipliers; a coverage/band unit test
mirrored C++↔JS if any reconValue math is shared.

**Verify:** deterministic coverage/band tests; curl at three different rosters shows the reveal
tiers widen; **diff replay tick-0 enemy positions against the top-band placement reveal — must
match exactly**; browser loop watching an ambush get reversed as you swing superiority.

---

## Stage 5 — Augury rework (true + decoy, exploding roll, reroll)

Replaces the Stage-1 port; deletes `POST .../events/pick` and `auguryScore`.

**Model:**
```js
augury: {
  trueEvent: {id,title,description,severity,baseAccuracy,effect},   // HIDDEN until applied
  decoyEvent: {...},                                                 // HIDDEN
  prediction: { eventId, roll, threshold, accurate } | null,         // 'accurate' HIDDEN
  consulted: Boolean,
  rerollsRemaining: Number,   // config REROLLS_PER_DAY = 1; loop-safe for >1
}
```
Event pool gains `severity` (1–3) and `baseAccuracy` **bonus** (+0…+3; severe = lower bonus; maluses later per user).

**`services/augury.js`:**
- Draw at newDay: distinct trueEvent + decoyEvent.
- Consult: `roll = throwDice() + trueEvent.baseAccuracy + mageBonus + characterBonus`; `mageBonus = min(3, floor(sqrt(roster.Mage ?? 0)))`; `characterBonus = campaign.character?.auguryBonus ?? 0`. `accurate = roll >= 7`. Shown = trueEvent if accurate else uniform pick of the two. Response: predicted card + raw roll (exploding rolls are fun to show) — never `accurate`.
- Reroll: decrement `rerollsRemaining`; **redraw both events fresh (old true event will not fire)**; fresh prediction roll.
- Day resolution step 3 applies `trueEvent.effect` unconditionally; dayReport reveals `{predicted, actual, wasAccurate}` — the dramatic beat.

**Routes:** `POST /api/campaigns/:id/augury/consult`, `POST .../augury/reroll` (403 if none left / not consulted).

**Frontend:** `EventCards.jsx` → `components/AuguryPanel.jsx` (one prophecy card, roll flourish, "Reroll the bones (1)"); `DayReport` shows predicted vs actual; TutorialIntro ("the augur may lie; severe omens are hardest to read; a reroll changes fate itself"). Tests: queued-RNG determinism incl. explosion chain; reroll-replaces-truth (old true event id never applies); hidden-field discipline; `augury.test.jsx`.

**Verify:** curl consult/reroll/end-day; rigged RNG shows severe events mispredict more; full browser day with a lying augur.

> **Status note:** Stage 5 shipped early (commit `77ee3ef`, schema v3) ahead of Stages 3–4.
> The augur now foretells the Stage-4 "Blind rung" of recon-sensitive events (see Stage 4).

> **Superseded by augury v6 (2026-07-05 playtest; schema v4 → v5 → v6 in one session).**
> User redesign: each turn holds **three independent fate slots**, each a hidden
> `{trueEvent, falseEvent}` pair. Consulting reads each slot with the user's formula:
> `points = throwDice() (exploding d6) + AUGURY_BASE_POINTS (2) + mageBonus +
> character?.auguryBonus (placeholder 0) + trueEvent.baseAccuracy (legibility 0–3)`;
> `odds = clamp(points × 0.05, 0.05, 0.9)` rounded to whole percent. **The odds are SHOWN
> on the vision card** — the reroll minigame is judging a dire omen at 30% (probably
> noise) against one at 90% (near-certain doom) — and the vision is one d1000 `chanceRoll`
> against exactly that number (≤ odds×1000 → true event shown, else the false one). The
> 5% floor keeps a bungled reading worth something. **All three true events apply at
> end-of-turn**; the day-report reveal is per-slot (predicted card + odds vs actual).
> Clicking a shown vision rerolls **that slot only** (fresh pair, fresh reading,
> `POST .../augury/reroll {slot}`), spending the turn's single reroll (config
> `AUGURY_REROLLS_PER_DAY`). The old "UI never states odds" rule is deliberately
> reversed. `services/augury.js`, model subdoc (`augury.slots[]`, `odds` null until
> consulted), `campaignView` (`visions` array with `odds`), `AuguryPanel` (three
> clickable cards showing "% true"), `DayReport` (per-slot reveal) all reworked; tests
> pin the math at every layer (queue order per slot: throwDice chain, then the d1000
> vision roll).

---

## Deferred design backlog (user, 2026-07-05 — ideas only, NOT scheduled, no implementation)

**~~TODO~~ ✅ SHIPPED 2026-07-17/18 — event reveal screen + events with choices.** Both halves
landed (commits `1e6930c` + `6efa1c4`, schema v11) — see the dated handoff entry near the top
for the full record (resolve-then-choose model, pendingChoices gate, choices-only reload
overlay, phrase-only option cards).

**TODO — worker replenishment + workers eating food (paired).** From the Stage-5 playtest-item
notes (2026-07-13): `workers` (civilian labour pool, `campaignConfig.js` `STARTING_WORKERS =
2000`) currently only ever shrinks (`used` grows permanently on militia/fort spend, never
resets) and never eats food — both intentionally deferred, and intentionally paired:
- **Workers eating food** (planned: 1/3 the per-unit upkeep rate) is NOT wired because at a
  2000-pool it would eat ~22 t/turn — more than the whole fighting army's 12.4 t/turn need —
  and instantly starve any campaign.
- **Worker replenishment** doesn't exist yet either (no natural growth, no event-driven influx).
  User is leaning toward **events or per-turn growth**, undecided.
Wire them together, not separately: eating without replenishment is an unwinnable drain: revisit
once the replenishment mechanism is chosen.

**TODO — combat score per hexside (fortification erosion).** Make `HexSide.combatScore`
accumulate the net pressure the enemy exerts on a fortified side each combat phase, and have it
**erode `fortDurability`** (the placeholder added in Stage 3); at 0 the side reverts to
unfortified mid-battle — the abstraction for the enemy pushing through / battering down the works.
This is the step that makes `fortDurability` live and where per-level fortification *strength*
scaling really bites. Sits directly after Stage 3 fortifications; see the Stage 3 "Forward path"
note. (Mirrored as an auto-memory todo, but this repo entry is the SSOT — it travels between
machines; the memory pointer may not.)

**✅ SHIPPED 2026-07-14 — movement-speed rework (points bank + per-hex terrain cost).**
`movementSpeed` is now **movement points banked per tick** (capped at that base); every unit —
loner or squad member — spends each entered hex's terrain cost from the signed `_movePoints`
bank, going into debt on the step that empties it (the old lone-unit `spentMove` terrain debt is
gone; `spentMove` survives only as the archer's fire-recovery tick counter). User-chosen numbers:
**human 10, giant Scorpion 18, Horse/Warhorse 28** (Cavalry AND LightCavalry both ride a standard
Horse → 28; the heavy/light gap returns when **barding** charges heavies movement/defence/enc
costs — that's the deferred armor-cost follow-up). Terrain: **Open 12, Forest 24, Marsh 36
(Beast/Skirmisher 24), Rubble 24, climbing +12** (`TERRAIN_COST_*`, still terrain-derived — no
authored per-hex cost field). Deliberate pacing signature: foot moves 5 ticks out of 6 in the
open (10 vs 12 — visible correctness check); a horse rides a 3/2/2 three-tick cycle. Squad aid
(3:1) now fires once per tick before moving, so a squad can pay off a straggler's debt but never
outpace its slowest walker. Campaign seams: `raidCapacityCost` uses **raw** points (the 40-scale
was designed for this — foot ¾·size, rider ³⁄₁₀·size); recon/forage/screen normalize via
`speedFactor = speed / 10` in `utils/capabilities.js` (one seam, values shift only where 28/18
don't map onto old 2/3 — e.g. LightCavalry forage 90→84 kg); retuning those formulas to exploit
the finer granularity is deferred until a playtest wants it.

**TODO — raid vs. main-battle turn sequencing (open DECISION, could go either way).** For the
first raid implementation, raiding is INDEPENDENT of the main battle — the same units may raid
and fight the main battle in one turn, and raids aren't gated by `battleFoughtToday`. This is
explicitly the simplest placeholder, not a decision: the real turn cycle (e.g. one or more
raiding turns/phases BEFORE the main battle, or raids consuming the turn's battle slot, or a
forage-style carve-out) is deferred until the full loop is playtested with raids in it.

**Morale overhaul (battle↔campaign).** Two morale tracks per army on a 1–1000 scale: a
**starting/max** value and a **current** value. Unit deaths damage the max a little and the
current more, so armies grind down over a campaign even between battles. If both armies are
still in decent shape when the battle turn limit hits, offer a **"fight another day"** option:
the battle ends, max resets — but takes a penalty for having been fought. (Note when designing:
the engine already has squad-level morale *states* — Confident/Normal/Scared/Broken with
casualty-triggered tests — this layers a persistent numeric army-level track on top; decide the
interaction, don't duplicate.)

**Battle events as cards (orders/leadership interactivity).** Make in-battle orders/leadership
interactive via event cards drawn/played during a battle. Examples: troops out foraging are
absent at battle start but can *arrive mid-battle* from an event card; rally cards; stronger
cards gated on a leader being present. Ties into the character system; also a natural consumer
of the engine's mid-battle-reinforcement support (the replay recorder already handles units
appearing mid-battle).

**Units-as-data restructure (user design 2026-07-05, planned in `docs/UNITS_AS_DATA_PLAN.md`).**
Units become pure stat rows: all attacks delivered by the unit's weapon vector (melee
already works this way), spells from a requirement-gated roster (paths later), boolean
capability tags (flying) on AUnit, and finally a UnitSpec table replacing the subclass
zoo. Staged R0–R4 in that doc; first candidate for a post-playtest engine session.

**Restructuring candidates (assessed 2026-07-05; none scheduled — all post-playtest).**
1. *Split `Battlefield.cpp` by tick phase* — movement / engagements / combat into separate
   translation units with `Battlefield` staying the owner/coordinator. Mechanical and fully
   pinned by the engine suite + `make clang`; do it BEFORE the DESIGN.md frontage/formation
   system lands there, since that work will otherwise bloat one already-large file.
2. *Retire the `Utility::getBattlefield()` process-global* (pass `Battlefield&`/context
   explicitly; same for the RNG queue). This global is why tests shard across processes
   instead of threads and why a process can only ever host one battle. Sizeable, engine-wide —
   schedule it together with the engine-backed-skirmish follow-up, which is exactly the
   feature that wants many cheap in-process mini-battles.
3. *`capabilities.js` consolidation* (forage/screen/recon values → one mobile-arm + one
   combat-screen value) — already part of Stage 4 Phase C, no separate action.
Design steer as the roster grows: prefer stat/tag-driven unit variation (the `reconTag`
pattern) over new subclasses; the catalog+tripwire SSOT is the thing to preserve, not the
class count.

## Follow-ups (out of scope now)
Engine-backed skirmishes via `battleRunner` on a small map (`max_turns: 30`, watchable replays); tutorial content pass; region map; wood/metal split; flying scout/forager unit; enemy harass duty; character system; **enemy reinforcement schedule + its scouting detection** (prerequisite for the Stage 4 "reinforcement detection" mini-stage); richer event system (prerequisites/chains — distinct from Stage 4's event *transforms*).

**Playwright E2E harness — ✅ SHIPPED 2026-07-18.** First real end-to-end coverage: a browser
driving login → council → forage → augur consult/reroll → **Accept the Fates** → muster → End Turn
against the live Docker stack. Fixture decision: **attach to a running stack** (no boot) —
`E2E_BASE_URL` (default `:5173`, CI `:3001`); tests run from the official Playwright container on
Windows/WSL since browsers can't run natively there. Full-turn spec `campaign-loop.spec.js`
passing; login-screen demo-battle render smoke `demo-battle.spec.js` passing (heavy RNG-variable
sample battle → wide 240s ceiling). CI `e2e` job wired. See the "fates at the tent" entry above for
the full harness detail + the demo-battle flakiness caveat.

**`Militia` unit (spear-armed levy): ✅ SHIPPED 2026-07-16.** Real, distinct C++ unit type per
`docs/ADDING_UNITS.md` — `backend/engine/{include,src}/units/Militia.{hpp,cpp}` (models `Human`,
`MeleeWeapons::Spear` reach 3, `LIGHTARMOUR`, base 10/10 attack/defence — weaker than Soldier's
boosted 11/12, one reach step short of Pikeman's `Pike`), registered placeable+spawnable in
`UnitCatalog.cpp`. `campaignConfig.js`'s `MILITIA_UNIT` now points at it instead of `'Soldier'`.
Catalog sync is fully automatic (confirmed via `engine.integration.test.js`'s dump-units→DB
round-trip) — no frontend hand-editing needed; `RaidPanel`/`HexGrid`/`ForagePanel`/`CampaignHUD`
all already derived their unit-type lists reactively from `roster`, so Militia appears everywhere
immediately once purchased. Resolves the 2026-07-16 "militia can't be assigned" bug note below —
the root cause was this placeholder, not a functional defect (Soldiers were always fully usable;
they just weren't distinguishable from "real" Soldiers, which is what read as broken).

**Bug (2026-07-16): freshly-bought militia can't be assigned — ✅ RESOLVED, see the Militia unit
note above.** Turned out to be two things, not one: (1) the "can't be assigned" reports were the
Stage-3 placeholder above — militia were fully usable, just invisibly folded into Soldier; (2) a
real, separate bug surfaced alongside it — the workforce accounting. `campaignConfig.js`'s own
comment said "each militiaman IS a worker taken off the civilian pool," but the route did
`campaign.workers.used += workerCost`, so workers never left `workers.total`, they just
accumulated forever under `used` (2000 total, 50 raised as militia showed "1950 free / 2000
raised" instead of "1950 free / 1950 raised"). **Fixed**: `routes/campaigns.js`'s militia branch
now does `campaign.workers.total -= workerCost` instead — those workers left the workforce
entirely to become roster soldiers. Fort labour is unchanged (`workers.used += workerCost`): a
fort worker is still around, just permanently busy, which is the correct model for that case, just
not for militia. `CampPanel.jsx`'s "committed" line reworded to "N committed to fortification
work — gone for good" (dropped "& militia" — only fort labour lives in `used` now).

**Deferred test-infra cleanup:** extract the stationary-enemy dummy (`movementSpeed = 0`) into one shared test header/cpp under `backend/engine/tests/` and migrate the current copies onto it — `ImmobileDummy` now lives independently in both `test_movement.cpp` and `test_battle_length.cpp`, and `test_main.cpp` has a near-identical `HighArmorDummy`. Convention: tests that need the enemy to sit tight use this dummy rather than holding a real unit.

**Deferred — frontend rendering/integration test coverage (user, 2026-07-07).** Now that rendering lives entirely in the browser (SFML retired), revisit test coverage with the JS test libraries already in place: broaden `ReplayView`/`HexGrid` **rendering** tests (styling cues, layout, terrain) and add **integration** tests where plausible (e.g. a full campaign loop through the campaign-server routes, or a battle → recorded replay → `ReplayView` round-trip). Ideas only, not scheduled; fold into whichever session touches the relevant surface. Pairs naturally with Phase 2 (the scenario-replay dev route is itself a testable render path).

## Independent assessment: weapons in C++ vs DB
**Keep weapons as C++ `constexpr` source of truth — do not move to DB.** Unit ctors reference weapons by identity (`addWeapon(MeleeWeapons::Pike)`); the engine is a self-contained stdin/stdout subprocess, and the DB is *populated from* the engine — a DB-sourced weapon table would invert that into a cycle and complicate the trust boundary. SSOT is about direction, not location: nothing downstream duplicates weapon data today, so there is no drift risk. Worthwhile later & cheap: extend `dump-units` to export each unit's weapon list read off a live instance (name, reach, shield, pen) for UI tooltips, optionally a `weaponCatalog()` + tripwire mirroring the unit pattern, synced to a display-only collection. No engine behaviour change.

## Verification (overall)
Per stage as listed. Cross-stage: WSL `make test` (engine tripwire + movement tests), `campaign-server npm test`, `frontend npm test`, then a full manual campaign: create → forage → scout reveal → battle → end-day with lying augur → materials spend → repeat until a ring runs dry.
