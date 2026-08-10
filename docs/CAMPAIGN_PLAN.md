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

## Standing design principles

Durable constraints on the campaign layer — these outlive any one stage. **They are deliberately
NOT in the rolling "Where the work stands" handoff below, which gets rewritten every stage.**
Add to this section only decisions meant to bind future work; record what merely *happened* in the
stage write-ups instead.

### 1. The enemy is an abstract challenge, not an opponent

> *"We don't have any enemy behavior at least for now, the enemy is an abstract challenge in
> roguelite fashion rather than a reactive opponent."* — user, 2026-08-09

The shadowing host has no behaviour, no AI and no reactions. It is a **modelled pressure the
player pushes against**: it consumes a fixed amount, takes what the shared land still offers, and
its numbers follow from arithmetic — never from a decision.

**What this rules out.** Do not propose, design or build "the enemy responds to X" — it forages
harder when hungry, moves camp, forces the battle early, counter-raids, adapts to the player's
posture. None of that is deferred work; it is **out of scope by design**, and its absence is not
a gap to be helpfully filled.

**What it licenses.** Dials the player pushes on, and consequences that follow mechanically from
the world state: the supply balance (S4), the forage rings emptying, the boss-fight meter,
raid-board pressure. A consequence is fine; a *choice* is not.

**Evidence this is settled, not an oversight:** `enemy.stance` (a genuine behaviour machine) was
deleted outright in v19 — that deletion applied this principle rather than awaiting a
replacement. S4's supply system is a gauge plus an attrition rate with no agency anywhere.
`services/enemyAi.js` was renamed `enemyHost.js` in 2026-08-09 because the old name was a
standing invitation to build the thing this principle forbids.

### 2. Units declare their roles; every player unit is buyable

> *"anything that is meant for player use should also have a recruit event … and the others
> should be marked that they are summons or enemy etc so the units are easier to upkeep and it
> gets easier to add new units"* — user, 2026-08-10

The engine catalog row for a unit type carries a **composable set of `UnitRole` flags** —
`Player`, `Enemy`, `Summon`, `Mount` — naming every channel through which that type may
legitimately enter play. This replaced the `placeable`/`spawnable` booleans, which stated the
same fact twice and could express nonsense (`placeable && !spawnable`). Both are now derived:
`placeable == Player`, `spawnable == Player | Enemy`.

**Roles are composable and descriptive, not exclusive.** A type lists every role that applies.
Scorpion is `Enemy | Mount` — a ridden mount that an enemy host may also field on its own legs;
that case is *why* roles are a set rather than a single kind (user, 2026-08-10). Soldier, Archer
and LightCavalry are `Player | Enemy` because `ENEMY_ARMY` really does field them.

**The binding rule: a `Player` unit the player cannot buy is a bug.** Every `Player`-role type
must have a `RECRUIT_POOL` row — no exemptions, casters included. Four tests in
`campaign-server/tests/engine.integration.test.js` enforce role↔config agreement against the
**real binary**; see `docs/ADDING_UNITS.md` §5.

**Where the line falls.** Roles are battle-layer access control (who may stand on a
battlefield) and belong to the engine. Recruit costs, the promotion ladder and army
compositions are campaign design data and stay in `campaign-server`. The dependency runs
**campaign → engine, never back** — the engine knows nothing about recruiting and must not.
Tests spanning the two therefore live campaign-side, since only that layer can see both.

### Where the work stands (2026-08-10) — START HERE

Everything below this block is history; this is the live front. Branch **`main`**, tree clean,
schema version **31** (unchanged — everything since has retuned constants and views, not the
schema). **Everything through `4d885e1` is merged to `main` and CI-green** — nothing is in flight,
so a new session starts from a clean `main`. (A stale `claude/…` branch may exist on the remote
with zero unique commits; it is harness leftover, not work.)

**Read `CLAUDE.md`'s "Shipping" section first.** Standing instruction as of 2026-08-10: finish a
feature, get it green, merge it to `main` — do not ask permission to ship. Interviewing the user
about DESIGN is still expected and welcome; asking whether to merge finished work is not.

**2026-08-10, in order.** Nine player-facing changes, each with its own section below — plus a
tenth, structural one:
- **Unit roles + Pikeman is recruitable** — the catalog's `placeable`/`spawnable` booleans became
  a composable `UnitRole` set (see standing principle 2 above), and **Pikeman** — player-placeable
  since forever but in neither `RECRUIT_POOL` nor `STARTING_ROSTER`, i.e. unobtainable — gained a
  recruit row: 15 for 50 food / 20 materials, trained from Militia. It is deliberately still
  absent from the starting roster, so it must be built toward. Accepted balance consequence: the
  Militia tier is now three options wide (Soldier/Archer/Pikeman) against a 2-slot daily draw, so
  each is rarer. Widening the draw was considered and rejected — the draw width is a global knob,
  and turning it to fix one unit's visibility changes every future unit's economics too.
- **The tent names the fate a raid can still unmake** (`4d885e1`) — a deferred fate showed its
  PREDICTED card, which may be the bluff, while the raid board's counter card read `trueEvent`: the
  two screens disagreed about what the player knew while they chose a raid between them. The tent
  now names the true threat and its cost and drops the decoy. Not a loosened gate — the truth is
  already public at accept, so the strip was out of step, not protective. The VERDICT (whether it
  lands, whether scouts turn it, the effect) still waits for end-day, which is what leaves a raid
  able to unmake it. **`AUGURY_DEBUG_SHOW_TRUTH` is now `false`** — the early-playtest window is
  over, and leaving it on made every bluff transparent on consult, collapsing the reroll.
- **"Screening", not "Scouting"** (`2eb3c1e`) — the slider's other end. Player-facing text only;
  identifiers and the persisted field keep the old name. `scouting.band` and the HUD's "Recon" line
  were deliberately NOT renamed: those measure how well you SEE the enemy, which really is
  reconnaissance. Two ideas had been sharing one word.
- **The rule, audited card by card** — every event and every raid walked and read. Raids were
  clean; the fate REVEAL card was the one gap and now states its outcome. See "The rule, audited
  card by card".
- **Turns-to-breach** — the forage panel reads the meter as time the walls have left, not a raw
  "+80" against a scale the player cannot see. See "Turns-to-breach" below.
- **Fates and raid cards say what they cost** (`a6c7912`) — `describeEffect`, the counter-raid
  `threat`, and the one `auguryTruthRevealed` gate. See "What a fate costs you, in numbers".
- **Every card states its reward — the rule, not another instance** — the standing rule finished:
  the raid `payoff` field, `optionCard`, and direction-only lines for `garrison`/`schedule`. See
  "No card shows flavour alone" below.
- **The recruitment ladder** (`c7cf253`) — workers → Militia → Soldier/Archer → Cavalry, each rung
  promoted out of the one below. See "The recruitment ladder".
- **The forage slider commits itself** (`33f552b`) — debounced, no confirm button.
- **The shipping instruction** (`0b6a4ed`) — into `CLAUDE.md`.

**2026-08-09, still worth knowing.** The `randomPlaceArmy` wrap-scan fix (`375306e`), the enemy's
fixed-headcount supply swing (`f218da2`), the reinforcement tick-order decision (`f94237c`), two
RNG-shaped test fixes (`115a3ab`, which had turned `main` red, and `c141022`), and the RNG seed
logging that makes the next such hunt a one-line replay. Read the testing convention below before
touching an RNG-adjacent test — both of those flakes were assertions that measured survival while
claiming to measure something else.

**All three of the previous handoff's open questions are now ANSWERED** (below). Two were design
calls the user made; one turned out to be a non-bug hiding a real bug next door.

**The forage panel's meter readout ✅ SHIPPED 2026-08-10** — see "Turns-to-breach" below for what
was built and the two traps it had to avoid.

**What is actually open:**
- **The enemy host's opening size (721) is unbalanced** against the player's roster — the user's
  words, and the per-turn swing that was retuned on 2026-08-09 was only half of that complaint.
  `ENEMY_ARMY` is untouched and wants a playtest before anyone picks a new number. **Note this is
  now entangled with the recruitment ladder:** promotions consume the rung below, so the player's
  army grows more slowly than it did on 2026-08-09. Judge 721 against the NEW curve, not the old
  one, and playtest the two together rather than retuning either alone.
- **Two counter-raid cards can still share a title.** Raid flavour is per TYPE, so a turn with two
  bad fates deals two cards both called "Riders Massing". They are now told apart by their `threat`
  line, so this is cosmetic — it wants per-instance flavour variants, which is content authoring
  rather than a mechanism. The augury itself no longer repeats an event (2026-08-10).
- **The DB-backed campaign-server tests need ONE environment setting to run in a cloud session —
  it is a config gap, not a law of nature (investigated 2026-08-10).** `mongodb-memory-server`
  downloads mongod from `fastdl.mongodb.org`, and a cloud environment on the default **Trusted**
  network level denies it (403 on CONNECT). 12 of 23 files then fail at setup — on a clean tree
  too, so it is never a regression.

  **The fix is one line of environment config, not code.** A Claude cloud environment has a
  **Custom** network access level with an editable allowed-domains list: claude.ai/code → the cloud
  icon *in the row above the message box* (there is no settings page or direct URL for it) → hover
  the environment → gear → **Network access: Custom** → add `fastdl.mongodb.org` (and
  `downloads.mongodb.org` for version metadata), and **tick "Also include default list of common
  package managers"** or you lose npm and GitHub. The container is provisioned with the policy in
  force at session start, so the change lands in NEW sessions, not the one you edit it from.

  **VERIFIED WORKING 2026-08-10: `cs-test` runs in a cloud session — 23/23 files, 521/521 tests,
  64s.** (Before the allowlist: 11 files / 261 tests, with 12 files dead at setup.) The fix took
  effect in the *same* session that edited the environment, so the session-start pinning above is
  softer than the docs imply — but the tell is subtle, so know what you are looking at: a denied
  host fails as `curl: (56) CONNECT tunnel failed` with code **000** (the proxy refuses the tunnel),
  whereas an allowed host returns a real status **from the origin**. `fastdl.mongodb.org/linux/`
  answering **403** is SUCCESS — that is S3 declining a directory listing through an open tunnel,
  not the policy. Fetch an actual `.tgz` to confirm rather than trusting a directory URL.

  **Dead ends — do not re-investigate, all four were checked on 2026-08-10:**
  - **"No Docker daemon" was wrong.** `/usr/bin/dockerd` is present and starts fine
    (`dockerd --iptables=false --ip6tables=false --bridge=none --storage-driver=vfs`). Docker is
    still unusable, but for a different reason: `mongo:7`'s manifest resolves and then the *blob*
    download 403s, because Docker Hub's CDN (`production.cloudfront.docker.com`) is off-allowlist.
    Adding that domain would presumably also work; the mongod allowlist is the smaller ask.
  - **Every MongoDB-owned host is denied**, not just fastdl: `repo.mongodb.org`,
    `downloads.mongodb.com`, `downloads.mongodb.org`.
  - **Ubuntu's archive is reachable but useless** — newest `mongodb-server` there is **3.6.3**, and
    the installed driver is `mongodb@6.21` (mongoose 8), which needs server 4.0+.
  - **No npm package bundles a mongod**; they all download from the blocked hosts.

  **Vendoring the binary into the repo was considered and REJECTED (2026-08-10).** Measured, not
  estimated: the extracted `mongod` is **175.7 MB** — comfortably over GitHub's 100 MiB hard
  per-file limit — and even the upstream `.tgz` is **81.8 MB**. So it could only go in compressed,
  plus a decompress-at-setup step. That is ~20× this repo (GitHub reports 4 MB; the largest tracked
  file is 0.9 MB), permanent in history, re-cloned every remote session, and stacked again on every
  version bump. It would also be the only binary the tree tracks — `game`,
  `run_tests`, `game_clang` and `BUILD/` are all gitignored — and this repo is **public**, so
  shipping mongod is SSPL redistribution. `git-lfs` is not even installed in the sandbox and its
  backend (`github-cloud.s3.amazonaws.com`) is 403, so LFS is not an escape hatch either.
  Swapping MongoDB out was rejected for the same reason: the query surface is tiny (one file uses
  aggregate/bulkWrite) but `models/campaign.js` is 499 lines of nested document, and the motivation
  would be a sandbox networking quirk rather than anything wrong with Mongo for this domain.

  The older escape hatch still stands: set `MONGODB_TEST_URI` (see `tests/helpers/db.js`) to point
  at a real mongod. CI is unaffected either way — its `mongo:7` service container runs these suites
  properly. **If you are in an environment without the allowlist, verify DB-path changes in CI and
  say so rather than claiming a green local run.**

**Reproducing a random failure (2026-08-09).** The seed stays RANDOM every run — a fixed one would
be green and blind, and both flakes chased that day were rare-draw bugs a pinned seed would have
hidden for months — but it is now **chosen once and logged**, so a failure is replayable:

```sh
./run_tests                       # prints "[rng] seed=1814267557" to stderr at startup,
                                  # and on failure repeats it with the replay command
GAME_RNG_SEED=1814267557 ./run_tests   # same seed → same draw sequence
GAME_RNG_SEED=42 ./game sample         # works for the engine binary too
```

`Utility::rngSeed()` holds it; `GAME_RNG_SEED` overrides it. Verified end to end — the same seed
produces a byte-identical 15 MB replay, different seeds differ, and an unseeded run still varies.
Two caveats: the startup line is printed BEFORE the run because ASan/UBSan abort the process and an
end-of-run listener would never fire; and `std::uniform_int_distribution` is not specified to map
identically across standard libraries, so a seed reproduces on the same toolchain but a CI failure
may not replay on a different libstdc++.

### The rule, audited card by card (2026-08-10) ✅ SHIPPED

The standing rule ("no card shows flavour alone") was **verified by walking every card the game
can deal**, rather than trusting the `describeEffect` sweep — which asserts the POOL can be
described, not that the card the player reads says anything. Both halves were dumped and read:
all 39 `EVENT_POOL` entries with their rungs and branches, and all six raid types generated for
real and rendered through `campaignView`.

**Raids: clean, all six.** `loot_supplies` food/materials/gold ranges · `seize_horses` horses ·
`rescue_troops` a roster range · `destroy_detachment` gold **plus** "The enemy host is the thinner
for it" · `counter_event` the named `threat` with its effect · `garrison_sortie` its payoff (the
thins-enemy one) or its stores (`sortie_grand`'s materials). The persistent forage-pressure card
states both the kill and the lift. Nothing to fix.

**Events: one real gap, now closed.** Every card that PROMISES showed its figures — the augur's
tent, the choice branches, the raid board. The card that REPORTS did not: `auguryReveal`'s
`card()` picked `{id, title, description, severity}`, so the beat where a fate actually lands
read as prose alone. "Forage Raiders — enemy riders fall on your foraging parties" named no
figure anywhere on the card; the −4 t, −20 materials and −3% of the Soldiers reached the player
only in the flat "fortnight, in full" list a beat later, mixed in with upkeep, foraging and the
enemy's turn. Whether a fate's prose carried its own number was pure authoring accident —
`quarry` says "+25 materials", `forage_raiders` says nothing.

Fixed by adding `effect: describeEffect(...)` to the reveal card and to `attachFired`'s rung card
(the beat renders `fired ?? actual`, so the rung needed it too, or "Raiders Intercepted — a few
sacks lost, nothing more" is the whole account of a tonne), rendered by a new `FateEffect` in
`EventRevealScreen`. Three properties held on purpose:

- **The raw effect still does not cross** — described lines only, the same contract
  `describeEffect` has everywhere else. The old assertion that `actual.effect` is `undefined` was
  the rule this violated, and it is now the narrower "no `{type, delta}` machinery".
- **The DEFERRED strip still holds.** `acceptFates` rebuilds a counter-raided slot from
  `predicted`/`odds` alone, so the blow that has not fallen still states nothing. `predicted`
  keeps its line — that is the card the tent already showed.
- **The fired rung's figure, not the blind one's.** A warned Night Raid says −0.5 t, not the −2 t
  it was spared.

**A formatting wart fell out of it:** a zero delta printed "Food −0 t", a loss that isn't one.
Unreachable from today's pool (a nothing-event is `type: 'none'` → "No consequence"), but the
reveal card now prints these lines on every fate, so `sign()` gives 0 no sign at all.

Green: campaign-server 612/612 (24 files), frontend 274/274, oxlint clean.

### Turns-to-breach — the forage panel's meter readout (2026-08-10) ✅ SHIPPED

**The complaint:** the panel showed "+80 to the boss-fight meter". The threshold
(`BOSS_FIGHT_METER_THRESHOLD`, 1000) is server-side, so 80 could be a tenth of the siege or the
whole of it — a number against an invisible scale, on the one slider whose cost the player is
supposed to be weighing. **Now: "Walls breached in 27–47 turns at this effort."**

The meter itself STAYS, and it is not a turn-end tick unrelated to foraging — the numbers settle
that: `fill = CEILING − FLOOR × (inCamp/total)` with `inCamp = (total − raiders) × (1 − share)`, so
all-scouting fills 50/turn and all-foraging 100. The slider DOUBLES the fill rate end to end. It is
the cost side of foraging and the main lever on when the boss fight lands. "+80" was exactly
share 0.6.

**What was built.** `remainingBracket(estimate)` in `services/meter.js`, surfaced as
`meter.remaining` in the campaign view; `breachReadout()` in `ForagePanel.jsx` divides the
already-interpolated fill into it.

**The two traps, and how each is closed** — both are the kind that pass a casual read:

1. **The remainder IS the hidden counter.** Turns-to-breach needs `threshold − value`, and the
   threshold is a constant: hand over the true remainder and the player subtracts it from 1000 to
   get `meter.value` exactly, undoing recon R2 in one step. So `remaining` is derived from the
   **displayed `estimate` bracket**, never from `meter.value` — null exactly when the estimate is
   null (Blind), inheriting exactly the width recon has bought, with no second gate to keep in
   step. It inverts on the way through (a higher value is *less* wall left, so `estimate.high` sets
   `remaining.low`) and floors at 0, since a wide bracket can run past the threshold. Note the HUD's
   `WALLS_METER_THRESHOLD = 1000` mirror is for scaling a bar and must not be reused for this.
2. **Turns is hyperbolic in `share`.** The fill is linear, which is why the panel may interpolate it
   between `meterFillAtNoForage`/`AtFullForage`; `remaining / fill` is not. Interpolating two *turn*
   endpoints agrees at both ends of the track and is wrong across the whole middle — which is where
   the player actually sits. The guarding test is deliberately a MIDPOINT: fills 10/20 and a 400–700
   remainder read 27–47 at share 0.5, where endpoint-interpolation would say 30–53. An end-of-track
   assertion cannot catch this.

**What the player sees**, in the four cases: a range that narrows with recon ("in 27–47 turns"); one
number once the bracket is a point at the top level ("~20 turns"), read the same way `format.js`
`estimate` reads a collapsed bracket; "the walls are breached" when the remainder is gone; and while
**Blind**, a purely RELATIVE line — "Walls fall about 1.5× as fast as holding everyone back", or "as
slowly as they can" at share 0. That fallback uses only the two endpoint fills, both already public,
so it needs no gate at all and names no absolute number anywhere.

Ceil, then floor at 1: a part-turn still has to be taken, and the meter fills at end of day, so the
soonest any breach can land is next turn.

Green: campaign-server 609/609 (24 files), frontend 269/269, oxlint clean. No schema change — this
is a view field and a readout.

### The recruitment ladder (2026-08-10)

**workers → Militia → Soldier/Archer → Cavalry/LightCavalry.** Only Militia is raised from the
workforce. Everything above it carries `from` in `RECRUIT_POOL` and is a **promotion**: 15 Soldier
consumes 15 Militia, 5 Cavalry consumes 5 Soldier. The militiaman IS the soldier, drilled and
equipped, so those rows cost no workers at all — only food and materials (and horses for the
mounted ones). User's reason was fluff; the mechanical effect is that Militia stops being a
throwaway tier and becomes the pipeline everything else draws on.

Before this, `requires: {hasUnit: 'Militia'}` was presence-only — a single militiaman standing in
camp let you buy fifteen Soldier straight out of the worker pool. That gate STAYS (it decides what
is offered); `hasTrainees` is the separate question of whether the offer can be paid for.

Consumption is 1:1 with the RESOLVED count, deliberately not a cost key: a boosted hire doubles the
count, so it must eat double the trainees, and tying them together means a future boost rule cannot
forget to scale it. `applyHire` clamps to what the roster actually holds and grants only what it
consumed, so a stale offer can neither drive a line negative nor mint the shortfall. The client
gets `from` and greys the card when the rung below is too thin — the resource-only check would
otherwise arm a button the server would then silently under-fill.

### What a fate costs you, in numbers (2026-08-10)

**The complaint:** raid cards and omens were pure flavour — "the benefits are extremely vague". A
`counter_event` card was the worst of it: its reward is `{slot}`, no loot, so `rewardParts()` came
back empty and the card showed no benefit line at all. You could not price it against a 500-point
party budget.

**What was actually broken underneath.** Counter cards are generated from `slot.trueEvent`, so the
muster always genuinely exists — nobody was ever raiding a phantom. The real fault was the mirror
image: **the card list leaked the truth.** A card existing said "this slot is truly bad" whatever
vision you were shown, and a frightening omen with no card said "that reading was false" — handing
away the augury's uncertainty for free.

**The decisions (interviewed, do not re-litigate):**
1. **The true/false uncertainty exists to price the REROLL, and nothing else.** It lifts the moment
   that decision is over — by either route, reroll spent OR fates accepted. One predicate,
   `auguryTruthRevealed`, because the augur's cards and the raid board must never disagree about
   what the player may know. Accepting-with-reroll-unspent used to leave you unable to read your own
   counter cards; it no longer does.
2. **Accept reveals the true fate for every slot**, so a counter card can name what it unmakes.
3. **Cards state the threat AND its mechanical cost** — `Prevents: Night Raid — Food −2 t`. The
   VERDICT (whether it lands, whether the scouts turn it) still waits for end-day: that is the
   2026-07-18 deferral, and naming a threat is not the same as calling its outcome.
4. **Effects read as the MATH, never a rolled result** (`describeEffect`, one formatter, server-side
   so no component can format a raw effect and sidestep the rules). It was deliberately SILENT on
   `flag`/`schedule`/`garrison` — hidden state the prerequisite gates read — and keeps enemy figures
   as phrases, except a multiplier like `The enemy host ×0.5`, which discloses force but not
   headcount. It fails closed on an unknown effect type. `tests/describeEffect.test.js` pins the
   silences, because "just print every field" would look like an improvement while unpicking three
   gates at once. (**The silence has since narrowed to `flag` alone** — `garrison` and `schedule`
   now give a DIRECTION with no figure. See the next section for why that is not a widening.)
5. **No duplicate omens.** `drawAugury` threads the ids already claimed (truth AND decoy) through
   each draw, and a reroll steers away from the other slots — spending the turn's only reroll to be
   handed a thread you are already reading is the worst version of it. A PREFERENCE, not a
   guarantee: with a gated pool the unused set can run dry, and a repeated reading beats a missing
   one.

**Still vague, deliberately not fixed:** two counter cards still share the title "Riders Massing"
(flavour is per-TYPE). They are now told apart by the threat line, so this is cosmetic — it wants
per-instance flavour variants, which is content authoring rather than a mechanism.

### No card shows flavour alone — the rule, finished (2026-08-10)

**The standing rule (user):** *every raid and every event must state its reward, at some level.*
The three fixes before this each treated one instance (the counter-raid `threat`, the fates'
`effectText`, the forage pressures). This pass audited every card type and closed the rest, so a
NEW card written with nothing to say now fails a test instead of shipping as prose.

**The guard is structural, not another instance.** `tests/describeEffect.test.js` sweeps the whole
`EVENT_POOL` — every fate's effect, every rung's, every branch's — and fails if `describeEffect`
comes back empty. It is a `it.each` over the pool, so a fate added next month is covered the day
it is written. The one legitimate silence, a bare `flag`, is exempted deliberately and by name.

**Three gaps were real:**
1. **`garrison_sortie` showed NO reward line at all.** A sortie's reward rides on the event, and
   `raid.js` strips `thinsEnemy` out of it as a control flag — so "A Coordinated Sally", whose
   entire payoff IS the besiegers' losses, arrived at `rewardParts()` with an empty object and
   promised to catch them between two fires while listing no benefit.
2. **`destroy_detachment` named the coin and not the kill** — it stated the gold picked off the
   field afterwards and never the thing the card is named for.
3. **Choice branches carried prose alone.** `pendingChoices` options crossed as
   `{id, label, description}`, so every decision in the game — including "spend 1.5 t of food" —
   could only be made on tone.

**What was built:**
- **`payoff`, a new public field on a raid opportunity**: the half of a reward that isn't loot, as
  phrases. Today: the host is thinned, and a persistent card's standing forage pressure is ended
  (the pressure's own bite, through `describeEffect`, so an enemy-side one stays a phrase exactly
  as it is on the forage panel). `reward` keeps the numbers and the scouting reveal mini-game;
  `threat` keeps a counter_event. It is the third deliberate widening in
  `tests/helpers/publicShape.js` and is argued there.
- **`thinsEnemyHost(opportunity)`** in `raid.js`, replacing the open-coded
  `type === 'destroy_detachment' || thinsEnemy` at the launch site. Two places ask — the site that
  BOOKS the casualties and the card that PROMISES them — and they must not drift.
- **`optionCard(choice)`** in `events.js`, the one builder for a branch card, now used by both
  `dayResolution`'s `pendChoice` (the tent) and `campaignView`'s `pendingChoices` (the owed
  decision). They built the same card separately before, so the two screens could have disagreed.
  The raw `effect` still never crosses — the branch is re-looked-up by id at choose time.

**The one judgement call: `garrison` and `schedule` now speak.** Both described as nothing, and
that silence was reasoned for `applyEffect`'s LOG, where naming a scheduled follow-up spoils a beat
the player never chose. It was over-broad as a CARD rule: every such effect in the pool sits on a
choice the player is being asked to make, and each option's own prose already promises the thing
("the blow will fall a fortnight hence", "does not forget who stayed in camp"). Five branches were
priceable only by tone. They now give a direction and nothing else —
`Karrowgate thinks the worse of you`, `Sets a fate in motion, to come to pass in a later turn`.

**No number crosses, and that is the part to keep:** no resolve delta (the track is what
`minResolve`/`maxResolve` gate on), no scheduled event id, no target day. `flag` stays silent
outright — it moves no resource and opens no priceable choice, so describing it would leak chain
structure for nothing. **Resolve is likewise still absent from a sortie card**: the sally's stated
payoff is the losses it inflicts, and its standing is felt, not read.

**Still open, unchanged:** two counter cards can share the title "Riders Massing" — cosmetic, and
content authoring rather than a mechanism.

**Testing convention — rigging the RNG (2026-08-09).** A bad seed shows up as "passed on one run,
failed on the next". Two rules came out of chasing exactly that twice in one day:
- **Assert invariants that hold for EVERY roll.** Both garrison-sally flakes were assertions that
  looked like they were about firing or landing but actually measured whether a unit *survived* the
  tick. The fix each time was structural — assert the thing where it genuinely holds (the tick log,
  or a direct spell cast with no combat), not a tighter statistical tolerance.
- **Rig `Utility::pushDiceRoll` only for a clear reason, and then sweep rather than sample.**
  Pinning one roll to make a *universal* claim pass quietly narrows it to "works for this roll" —
  the failure mode is a green test that no longer means what its name says. Where a branch is
  genuinely unreachable without controlling the draw (`randomPlaceArmy` picks its own scan start,
  so the mock queue is the only seam), enumerate the whole space instead of picking a lucky point:
  see "randomPlaceArmy finds the one free hex from EVERY random start", which sweeps all 64
  free-hex × start combinations.

**Answered — do not re-litigate:**
1. ~~**The enemy grows 3%/turn while the near ring holds.**~~ **ANSWERED 2026-08-09 — the rates are
   gone.** The swing is now a FIXED headcount: `+ENEMY_REINFORCE_HEADCOUNT` (5) fed,
   `−ENEMY_DESERTION_HEADCOUNT` (10) starving, steady untouched. No compounding, and asymmetric
   because desertion is meant to be the easier lever. The three supply bands STAY — one grows the
   host, one shrinks it, and the middle is a deliberate no-op (asked and confirmed), which is what
   makes "which ring have you stripped them back to" the whole of the enemy's supply state. See the
   S4 stage write-up below for the derivation. **Still open: the host's opening size** (721) is
   unbalanced against the player's roster and wants a playtest of its own — the per-turn swing was
   only half of that complaint.
2. ~~**Should a reinforcement wave be able to MOVE on the tick it arrives?**~~ **ANSWERED
   2026-08-09 — yes, and the current order stays.** `tick()` runs `fireScheduledReinforcements()`
   before `triggerSpecialPhase()`/`moveUnits()`, so a garrison sally lands and immediately acts.
   A tick is an abstraction rather than a stopwatch, and "it arrived during the turn" is answer
   enough. Holding a wave for a tick would buy a marginal bit of fiction for a real chunk of
   machinery — an arrival flag to set, honour and clear across four phases — so it is not worth
   the complication. Recorded as a comment at the `tick()` call site too, because that is where
   someone would otherwise "fix" it. **No code change; do not revisit.**
3. ~~**`randomPlaceArmy: zone is full` still prints during the C++ suite.**~~ **ANSWERED — the
   warning is not a bug.** It comes from exactly one test, the deliberate `SECURITY_NOTES.md #6`
   regression case ("returns false without terminating when zone is too full"), which overfills a
   single-hex zone on purpose (70 Soldiers × size 10 = 700 > capacity 640) to prove the function
   returns `false` rather than calling `exit(1)`. Run that case alone and the line appears; run the
   other 350 and the suite is silent. No units were failing to arrive. **Leave the warning alone** —
   it is the function correctly reporting a zone that really is full.

   Chasing it did, however, turn up a *real* bug next door, now fixed: `randomPlaceArmy`'s
   wrap-around scan skipped a band. The forward pass starts mid-zone at `(wIter, hIter)` and runs
   to the end; the wrap pass then covered only rows `hStart..hIter-1`, so the columns **left of
   `wIter` on row `hIter` itself** were never scanned. The function could report a full zone with a
   hex still free — and `BattleServer.cpp` turns that `false` into a rejected battle request. Fixed
   by extending the wrap to `h <= hIter` with the last column clamped to `wIter - 1` on that row.
   Pinned by "randomPlaceArmy wraps onto the columns left of its random start", which forces the
   scan start via `Utility::pushDiceRoll` and fails against the old code.

**Recent cleanups worth not re-litigating:** `services/enemyAi.js` → `enemyHost.js` (the old name
invited the behaviour the standing principle forbids); the 42/Hive ASCII headers are stripped from
all 19 files that carried them; `bandLabel` and `PUBLIC_OPPORTUNITY_KEYS` each live in exactly one
place now, after both had been duplicated and both had caused a red CI run.

- **2026-08-09 (latest) — "starve the enemy" S1 landed.** The enemy host now feeds itself off the
  shared rings and is judged turn by turn (no stockpile): near ring = surplus and it grows, mid =
  break-even, far = starving and it bleeds men. Stripping the inner rings is now a real attack on
  their supply. Schema **v31** (`enemy.supplies` → `enemy.supplyState`). See the stage write-up
  below for the derivation and what was deliberately deferred.

- **2026-08-09 (later) — THE EFFORT-SLIDER EPIC IS COMPLETE. S1+S2+S3 are merged to `main`
  (`1e5b25b`, fast-forward), CI green on all six jobs, `cs-test` 498/498 confirmed twice over
  (CI's `mongo:7` service AND the reference laptop, independently).** `main` had been 11 commits
  behind, so that merge landed S2 as well as S3 — schema went **v28 → v30 in one step**, which
  by the no-back-compat rule deletes every stored campaign from an older build on next listing.
  Expected, but it means existing saves are gone.
  - **There is NO S4 in this epic.** The stage list ends at S3, followed by "Deferred, noted not
    built" (optional food sinks; enemy supplies reacting to its own foraging and to a stripped
    countryside; forager-clash flavour re-expressed as events). A session told to "do S4" should
    ask which epic is meant, or pick from that deferred list — do not invent one.
  - **Fixed the trap that made S3's CI go red:** the public raid-opportunity key list was
    copy-pasted into `campaigns.test.js` and `raid.test.js`, so adding one legitimate view field
    (`persistent`) failed 45 tests across two suites and needed two edits. It is now ONE exported
    constant, `PUBLIC_OPPORTUNITY_KEYS` in `tests/helpers/publicShape.js`. **Widening the public
    shape is now a one-line diff there** — and it should stay a deliberate, visible choice.
  - **The remote-session blind spot is structural, plan around it.** Claude's web/remote
    container can run neither `mongodb-memory-server` (mongod download 403s through the agent
    proxy) nor Docker (no usable daemon), so the 12 DB-backed server files CANNOT run there —
    only the 10 DB-free ones.
    **[SUPERSEDED 2026-08-10 — it is not structural.** The blocker is the environment's network
    allowlist, and "no usable daemon" is simply wrong: `dockerd` starts fine. See the live handoff
    at the top of this file for the one-line fix and the full list of dead ends.**]** This has now cost one red CI run on both S2 and S3. Mitigations
    that worked: push DB-independent logic into pure exported functions (S3 extracted
    `ageForageModifiers` out of DB-only `resolveDay` for exactly this), and before pushing a
    change that adds a field to `campaignView`, grep the pinned key sets.

- **2026-08-09 — CI is GREEN on all five jobs (`00c6518`), and `cs-test` now runs there for the
  first time: 475/475.** Getting there took peeling three nested problems, each hidden by the one
  above it: a missing CI job hid a broken test helper, which hid a stale assertion. Read this
  block before trusting any "CI is the check" note below. **S3's gate ("run the full `cs-test`
  for real before touching S3") is now SATISFIED** — S3 is unblocked.
  1. **S2 broke both stack jobs** and the failure was sitting on `9f0184d` unnoticed. S2 replaced
     `POST /:id/forage {assignment}` with `POST /:id/effort {share}` and rewrote `ForagePanel` as
     the slider, but nothing outside the unit suites was updated: the **`docker`** job's smoke
     still POSTed `/forage` (404 → `curl -fs` prints nothing → the piped `jq -e` exits **4**, the
     bare "exit code 4" in the log), and the **`e2e`** job still drove `forage-input-*` /
     `forage-submit` / "Foragers assigned", none of which exist any more. Both now drive the
     slider (`effort-slider` arrowed in its 10% steps → `effort-submit` → "Effort set") and the
     `/effort` route. **Lesson for the next route/panel rename: `.github/workflows/ci.yml` and
     `e2e/tests/` are the two call sites the vitest suites cannot catch — grep them.**
  2. **CI HAD NO `cs-test` JOB — now it does (`campaign-server`).** The `test` job is
     `make test-serial` (C++ only); `docker`/`e2e` smoke the running stack. The campaign-server
     vitest suite had **never run in CI**, which is why "verify it in CI before S3" was never a
     real option and S1/S2 both shipped on hand-arithmetic. The new job runs `make` (so
     `engine.integration.test.js` — which self-SKIPS without `./game` — actually checks the
     engine↔schema contract) then `npm test` against a **`mongo:7` service container**.
     `tests/helpers/db.js` gained one escape hatch for it: **`MONGODB_TEST_URI`**, which replaces
     `mongodb-memory-server` with a real mongod and clears the DB on entry (a shared external DB
     carries over what the previous FILE left; `fileParallelism: false` keeps that race-free).
     Default is unchanged — a plain `npm test` still spins up the in-memory server, no setup.
     Deliberately NOT the app's own `MONGODB_URI`, which switches the *server* to a persistent DB.
  3. **A remote/web session still cannot run `cs-test` locally** *(as of 2026-07; **superseded
     2026-08-10** — an environment on **Custom** network access with `fastdl.mongodb.org`
     allowlisted runs it fine, and `dockerd` does start. See the live handoff up top.)*:
     `fastdl.mongodb.org` is
     **403 by egress policy** (so `mongodb-memory-server` can't fetch mongod) and these containers
     have **no docker daemon** (so a local `mongo:7` and `make docker-up` are both out). A remote
     session gets its DB-backed coverage from **CI** now; only a local box can run it directly.
  4. **The first real run of `cs-test` immediately caught a broken S1 helper.** `endTurn(id)` —
     the helper S1 routed **~47 end-day call sites** through — was committed as:

     ```js
     const endTurn = async (id) => {
       await Campaign.findByIdAndUpdate(id, { phase: 'recruit' })
       return endTurn(id)        // ← calls ITSELF; never posts to /end-day
     }
     ```

     Infinite async recursion, in **all three** copies (`campaigns`/`enemyAi`/`raid`.test.js).
     Every test that ends a turn spun until vitest's 30s timeout: `campaigns.test.js` alone ran
     **20 minutes and failed 38 of 122**. Fixed to
     `return auth(api.post(\`/api/campaigns/${id}/end-day\`)).send({})`, which is what the diff
     replaced. **So S1's end-day coverage never actually ran — treat every end-day assertion as
     first-verified by the run that follows this fix, not by S1.** This is precisely the failure
     the missing CI job allowed: S1 shipped noting "cs-test was still running — CI is the check",
     and CI had no such check.
  5. **With the helper fixed, the suite is 474/475 in ~56s — and the one failure was a stale S2
     assertion, exactly the risk flagged below.** `campaigns.test.js`'s end-day test still
     asserted `rings[0].richness === 20000 - 9084`, i.e. the PRE-S2 near ring and the retired
     `enemyForagePlanKg`. The engine returned **71000 = `FORAGE_RINGS[0]` (80000) −
     `ENEMY_DRAIN_KG_PER_TURN` (9000)** — S2's documented design, behaving correctly; only the
     test was stale. Now reads both constants instead of restating them. The adjacent
     `forage.clashes` assertion was stale too (S2 deleted clashes outright) and had simply never
     been reached. **No game math was changed** — this was S2's hand-arithmetic finally being
     checked, and the code side of it held.
  6. **The frontend is in CI too now (`frontend` job).** `fe-lint` (oxlint) + `fe-test` (vitest,
     **36 files / 249 tests**) had been local-only commands, the same gap one directory over.
     node 24 again (`frontend/.npmrc` carries the identical engine-strict floor). `npm run build`
     is deliberately not repeated — `docker`/`e2e` already build the real bundle inside the image.
     **Every test suite in the repo now runs in CI**: `make test-serial`, `cs-test`, `fe-test`,
     `fe-lint`, the docker smoke, and the Playwright e2e.

- **Last session (2026-08-08) — three playtest bug fixes, no new feature.** Details are in the
  dated bullets under `### Squad-centric overhaul`; the short version:
  1. **Raid parties now fight as squads** (`e0d9e8f`). The auto-placer scattered a squad one unit
     per hex and the engine groups formations by **(hex, squad_id)**, so raids fielded N
     one-member "squads". New `makeZonePlacer.addBlock` puts one squad on one hex, the
     server-side twin of what the frontend does for the main battle.
  2. **The pitched battle is no longer offered every turn** (`f6777b8`). Recruiting's exit is
     `breakCamp`: deployment only on the pitched-battle day, "End the Turn" otherwise. Same
     commit **dropped the `ambush` fate and the whole `enemy_advance` effect** — it set
     `bossFightDue` outright and could end a campaign on turn 2. **The wall meter is now the only
     thing that sets `bossFightDue`**, pinned by an `augury.test.js` guard over every pool effect.
  3. **Tooling:** native `bash scripts/dev.sh …` permission rules (`8396bf1`).
- **Still not playtested:** everything from S8 onward, now including the changed turn shape above
  (a quiet turn ends at Recruiting and never shows the deployment grid). Play a full campaign
  before building on it — these three fixes all came out of playing, not out of the suites.

- **Active feature: Stage E — the Recruit phase** (`### Recruit phase — hiring troops` further
  down is the SSOT for the design and every slice's handoff). Shipped so far, one commit each:
  S1 pool + pure mechanics (`9d887b5`), S2 route + day-offer + `campaignView` (`79adbff`),
  S3 frontend screen (`a522827`), S4 old militia-purchase mechanic removed (`a99c767`),
  S5 raid gold rewards (`23edf6b`), S6 garrison gold event (`ea64d2a`), S7 horses' earn source
  (`1a880ea`), S8 lazy draw + phase lock + the Travellers card (`339f4aa`).
  **Stage E is COMPLETE** — every entry in `RECRUIT_POOL` is reachable, both new resources
  have earn sources, and no open design question is left in it.
- **Next up / ACTIVE: the effort slider** (`### Effort slider — one points pool, split between
  foraging and scouting`, immediately below, is the SSOT). Designed and grilled 2026-08-08;
  three stages, in order. **S1 (the server-owned one-way phase machine) is DONE** — schema **28**.
  **S2 (the slider itself) is DONE** — schema **29**. **START HERE: S3** — forage modifiers +
  persistent raid opportunities (see the stage list below).
  - **S2 landed on a remote/web session with `mongodb-memory-server`'s binary download BLOCKED by
    egress policy** (`fastdl.mongodb.org` 403) — every DB-backed campaign-server suite
    (`campaigns.test.js`, `raid.test.js`, `enemyAi.test.js`, `routes.test.js`, `models.test.js`,
    `auth.test.js`, `battles.test.js`, `catalogSync.test.js`, `devSeed.test.js`,
    `sampleBattle.test.js`, `bugReports.test.js`, `engine.integration.test.js`) could only be
    checked by careful hand-arithmetic against the new formulas, NOT actually run. Pure-logic
    suites (`forage.test.js`, `capabilities.test.js`, the rest of `cs-test`'s non-DB files) are
    green (221/221 passing, same 12-suite mongod gap as any fresh remote session), `fe-test` is
    green (249/249 — one file renamed `forageAssignment.test.jsx` →
    `effortSlider.test.jsx`), `fe-lint` clean, `make test-serial` green (347/347). **Run the full
    `cs-test` for real before touching S3 — now possible in CI via the `campaign-server` job added
    2026-08-09 (see the block at the top), or on any machine with mongod reachable** — the
    creation/effort-route/harvest numbers in `campaigns.test.js` and `enemyAi.test.js` were
    re-derived by hand from the real engine's `./game dump-units` stats, not observed passing.
  - **Numeric choices S2 had to make that the design doc left approximate** (flagged "~"/"≈" in
    the decisions below), picked for internal consistency and documented in
    `utils/campaignConfig.js` rather than re-grilled: `FORAGE_KG_PER_POINT` 15→**16** (exact
    break-even math against the real starting pool, ≈1112.4 pts — matches decision 6's "≈16"
    almost exactly once real engine stats are used instead of the doc's rough ≈1092); `FORAGE_RINGS`
    scaled **4×** (`[80000,140000,220000]`, was `[20000,35000,55000]`) to last a 10–20 turn
    campaign; `ENEMY_DRAIN_KG_PER_TURN` **9000** (close to the old `enemyForagePlanKg`'s ~9,084 at
    the starting enemy host, now flat/independent of army composition); **`DEFAULT_FORAGE_SHARE`
    = 0** (all-scouting) — continues the pre-slider default exactly (old `forage.assignment`
    started empty) and keeps the whole existing meter/garrison/wall-slow test suite's
    hand-computed idle-army-at-FLOOR arithmetic valid with zero changes. All four are playtest-
    tunable, not load-bearing design decisions — revisit if a real campaign feels off.
- **Backlog** (was "next up" before the slider was designed). The nearest candidates:
  1. **Worker replenishment + workers-eat-food** — paired, deferred, blocked on picking a
     mechanism. Recruit's worker drain (every troop-lane hire permanently shrinks
     `workers.total`) raises its priority; now that Cavalry/LightCavalry are actually reachable
     there is one more sink pulling on it.
  2. **Fervor-moving events** — `recruit.fervor` starts at 0 and NOTHING moves it yet, so the
     boost path is dead content today. Same additive shape as the S9 resolve-gated fates.
  3. **Nomad allies** (new, from the S7 grill) — an ally that supplies horses, as an event or a
     raid card. Deliberately left for later; no design done.
  4. Fortification-durability erosion (blocked on morale design).
- **Also still open, unrelated to Stage E:** worker replenishment + workers-eat-food (paired,
  deferred, blocked on picking a mechanism — Recruit's worker drain raises its priority but
  doesn't gate it); fortification-durability erosion (blocked on morale design).
- **Test baseline (2026-08-09, CI's `campaign-server` job, run `00c6518`): `cs-test`
  21 files / 475 tests, ALL GREEN in ~57s.** This is the first baseline actually observed rather
  than hand-derived. `make test-serial` green, `docker` + `e2e` green.
  - Correction to the older note below: a missing `./game` does NOT produce 3 failures —
    `engine.integration.test.js` **self-SKIPS** (`describe.skipIf`) and prints
    "engine contract tests SKIPPED". So a local run without `make` goes green with the
    engine↔schema contract UNCHECKED; CI builds the engine first precisely so it is checked
    (verified: that warning is absent from the green run).
  - `fe-test` **249/249** (36 files, ~21s) and `fe-lint` clean — verified locally 2026-08-09 and
    now pinned by CI's `frontend` job.
- **Superseded (2026-08-08, Linux box WITH a compiled `./game`):** `cs-test` **472/472**,
  `fe-test` **247/247**, `fe-lint` clean. Run everything through `scripts/dev.sh`
  (see `CLAUDE.md`).
- **Not yet playtested:** S8 changed the shape of a turn (Recruit is now a one-way door that
  closes the camp, and a hire is mandatory), and 2026-08-08 changed it again (a quiet turn ends
  at Recruiting). The suites cover the mechanics, but see the "still not playtested" bullet at
  the top of this block — play it before building on top of it.

### Effort slider — one points pool, split between foraging and scouting (DESIGNED 2026-08-08, grilled)

**Status: designed, nothing built yet.** Grilled end-to-end with the user before writing (per
`CLAUDE.md`); every decision below is a confirmed answer, not an assumption. This section is the
SSOT for the feature — three stages, S1 first.

**The idea.** Per-type forager assignment is replaced by a single slider. The whole roster
produces ONE points pool from ONE formula; the slider splits the **results** between food and
eyes. It splits results, never troops: no unit is ever assigned to a "forage pool" or a
"scouting pool", and nothing moves units between them. Raiding stays the only thing that
genuinely sends squads away; which activity a raiding squad "came from" is fluff.

**Confirmed decisions.**
1. **One formula, one pool.** `fieldPointValue(stats) = (ballisticSkill × ACCURACY_PER_BALLISTIC
   / BASELINE_ACCURACY) × speedFactor + reconTag` — today's `scoutingPointValue`, renamed and
   now feeding both tracks. `forageValue` is deleted. Chosen over the forage formula because it
   already carries `reconTag` (LightCavalry +4, Warhorse −2) as the "ranging ahead is this
   unit's job" lever, and because it leaves the delicately-tuned recon ladder untouched.
   Starting roster ⇒ `P ≈ 1092` pts/turn (verified against the real engine's `./game dump-units`
   stats during S2: **1112.4** exactly — close enough that every other approximation in this
   section keyed off ≈1092 still holds). Snapshot at newDay from the start-of-turn roster.
2. **Foraging goes passive.** No assignment map. Foragers are no longer absent from the pitched
   battle — deployment availability subtracts raiders only (`selectors.js`, `routes/campaigns.js`).
3. **Forager clashes are deleted**, along with forage's only use of `skirmish.js`. If that
   flavour is wanted back it returns as an EVENT, not as a forage sub-system.
4. **The enemy no longer forages or scouts for real.** `forage.enemyPlan`, `enemyForagePlanKg`,
   ring contention (the pro-rata scale-down), `ENEMY_FORAGE_FRACTION`, `CLASH_*` and
   `FORAGE_CLASH_DAMPER_BY_BAND` all go. The enemy instead drains the rings by an abstract
   per-turn `enemyDrainKg` and gains nothing from it.
5. **Three rings survive as a real curve.** Distance yield penalty (~×1.0 / ×0.8 / ×0.6),
   filled near-first — without contention the rings would otherwise be one pool wearing three
   gauges. The enemy drain also eats near-first.
6. **Exchange rate: break-even at ~70% forage** — `FORAGE_KG_PER_POINT ≈ 16` against the
   starting army's 12.4 t/turn appetite. Feeding the army is the default burden; scouting is
   bought with hunger. `FORAGE_FOOD_SHARE`/`FORAGE_MATERIALS_SHARE` (0.8/0.2) unchanged.
7. **The land covers a whole campaign.** `FORAGE_RINGS` scales up (today's ~81 t effective
   would strip in ~5 turns against a 10–20 turn meter). Optional food SINKS are the intended
   way to make the food economy interesting — later work, deliberately not in these stages.
8. **The band → yield loop stays.** `FORAGE_YIELD_BY_BAND` (Blind ×0.7 … Overwhelming ×1.25)
   still multiplies forage yield, so scouting pays back as food and an all-forage turn decays.
9. **Recon costs unchanged.** `RECON_LEVEL_THRESHOLDS [200,700,2000,4500]` and the raid scout
   costs (200/50) stay: at a break-even 70/30 turn (~328 pts) that reads Contested ~turn 3,
   Superior ~turn 7 — scouting is now an investment rather than free income.
10. **Raiders get no scouting credit.** They already contributed to the pool; "recon in force"
    is fluff only.
11. **The meter reads the slider.** `inCamp = (roster − raiders) × (1 − forageShare)` — sliding
    toward food speeds the walls' collapse. Foraging is "out of camp", scouting is the army near
    Karrowgate.
12. **Turn flow becomes one-way, server-owned.** `campaign.phase`
    (`prepare → omens → raids → recruit → deploy`), advanced forward-only; every mutating route
    asserts its phase and 409s otherwise — generalising the `recruit.drawnDay` lock that already
    exists. Passed phases stay viewable **read-only**. Because the split seals on leaving
    Prepare, no scouting-spend tracking is needed. Also fixes the mid-turn-reload wart (the
    `recruitDrawn`/`setPhase` hack in `App.jsx` goes).
13. **Slider UX:** 10% steps, sticky across turns, live preview of food/materials tonnage,
    scouting points, and the pitched-battle effect.
14. **Enemy supplies: minimum hooking.** Keeps draining by upkeep, gets no forage credit. Add an
    always-present HUD line (contents still recon-gated at Outmatched+, "unknown" below) so the
    unhooked gauge stays visible as a reminder. `enemyDrainKg` is the seam a later "starve the
    enemy" system hangs off — that system will be player-driven (raids, events), not enemy AI.
15. **Migration: none.** Mismatched campaigns are deleted, so this is just
    `CAMPAIGN_SCHEMA_VERSION` → **28**.

**Stages** (each committable and testable on its own; tests travel with the stage):

- **S1 — the phase machine. ✅ LANDED 2026-08-08** (schema **v28**). `campaign.phase` +
  `POST /:id/phase` (forward-only, ONE step at a time), a phase guard on every mutating route,
  read-only rendering of passed phases, client phase state read from the server.
  - **Guard shape (decided while building):** `rejectIfPhasePassed` refuses a write only when the
    turn has moved PAST that route's phase — acting EARLY is deliberately left alone. The client's
    screens are sequential so it can't happen there, and nothing later has happened yet, so an
    early write can't be informed by information the player wasn't meant to have. The abuse being
    stopped is the opposite one: going back to re-decide after the fates are read or the raids
    resolved.
  - **Double-resolution (user, 2026-08-08: the backend must make it impossible):** every mutating
    route already refused a second resolution by its own state (`augury.consulted`/`accepted`,
    `recruit.hiredToday`, `battleFoughtToday`, the pendingChoices lookup) — end-day was the one
    gap, so it gained the mirror guard `rejectIfPhaseBefore(…, 'recruit')`. Since end-day resets
    the phase to 'prepare', a double submit now 409s instead of resolving two fortnights.
  - `rejectIfRecruiting` is DELETED — the general guard subsumes it (`recruit/open` just stamps
    the phase); those refusals are 409s now, not 400s.
  - Frontend: `App.jsx` routes screens off `campaign.phase` and syncs FORWARD only from another
    turn screen (a UI-only screen — report/placement/result/replay — is never yanked out from
    under the player); a `locked` prop makes Forage/Camp/Augury/Raid panels read-only behind the
    turn, with a `phase-committed` banner whose only button leads forward again. The old
    `recruitDrawn`/`setPhase` reload hack is gone — the reload wart is fixed by the server field.
    `breakCamp` marches to `deploy` through the server.
  - Tests: new `the one-way turn phase machine` suite (ladder, refusals, double-end-day, newDay
    reset); ~47 end-day call sites routed through a new `endTurn(id)` helper that stamps the phase
    first; frontend suite **247/247 green**, oxlint clean. **cs-test was still running when this
    was committed — and "CI is the check" was WRONG at the time: CI had no `cs-test` job until
    2026-08-09 (see the block at the top), so S1's ~47 rerouted end-day call sites went unverified
    by any real run until that job's first green.**
- **S2 — the slider. ✅ LANDED (schema v29).** `fieldPointValue`/`fieldPointsFor` (renamed from
  `scoutingPointValue`/`scoutingPointsFor`; `forageValue` deleted), `campaign.forage.pool`
  (snapshot) + `campaign.forage.share` (sticky, default 0), ring distance penalty
  (`FORAGE_RING_YIELD`), abstract `campaign.forage.enemyDrainKg` (flat, recon-gated in
  `campaignView`, replaces `enemyPlan`/`enemyForagePlanKg`), the meter formula (`meterFillAtShare`
  in `services/meter.js`), all the deletions in decisions 2–4 (`services/skirmish.js` removed
  outright — forager clashes are gone), `POST /:id/forage {assignment}` → `POST /:id/effort
  {share}`, `ForagePanel` rewritten as the split-slider control (a `range` input, live
  client-side preview off server-provided scalars — pool/kgPerPoint/foodShare/materialsShare/the
  meter's two share-endpoint fills — never a formula duplicated in the client), an
  always-present "Enemy foraging: N t/turn / unknown" HUD line gated the same way the enemy view
  is. `forage.test.js` rewritten (no more catalog fixture — pure pool/share math);
  `capabilities.test.js` / `campaigns.test.js` / `raid.test.js` / `enemyAi.test.js` updated;
  `selectors.js`'s deployment-availability hooks now subtract raiders only
  (`useRaidAssignment` replaces `useForageAssignment`); frontend `forageAssignment.test.jsx` →
  `effortSlider.test.jsx`. See the "Where the work stands" block above for the DB-test caveat
  (couldn't run `mongodb-memory-server` on the session that built this) and the four numeric
  choices (`FORAGE_KG_PER_POINT`, `FORAGE_RINGS`, `ENEMY_DRAIN_KG_PER_TURN`,
  `DEFAULT_FORAGE_SHARE`) the design doc left approximate.
- **S3 — modifiers + persistent raids. ✅ LANDED (schema v30).**
  `campaign.forage.modifiers: [{id, label, target: 'enemyDrain'|'playerYield', factor, deltaKg,
  turnsLeft, raidable}]` with `turnsLeft: null` = permanent (the default). Raid opportunities
  gained `persistent` + `modifierId`: the newDay redeal drops ordinary unresolved cards as before
  but CARRIES persistent ones over with their already-rolled `targetForce`/`reward` *and their
  bought reveal levels*, and only resolving one removes it — which is also what lifts its linked
  modifier.

  Five things the one-paragraph spec didn't settle, decided while building (all reversible):
  1. **What creates one.** Events, via a new `forage_modifier` `applyEffect` case; raids only
     *lift*. Without a source this would have been dead plumbing, the exact complaint this doc
     already makes about `recruit.fervor`. Two fates ship with it so both targets are live:
     `foraging_riders` (a choice — buy the problem off with a permanent ×0.85 escort tax, or take
     ×0.6 and a card you can beat) and `enemy_supply_depot` (`enemyDrain` +4000 kg, raidable).
  2. **Link direction:** the card carries `modifierId`, mirroring `counter_event`'s `reward.slot`
     — the card points at what it unmakes. The lift is generic, outside the type switch, so ANY
     future card type can carry one.
  3. **Composition:** `base × Π(factor) + Σ(deltaKg)`, floored at 0 — multiply-then-add, so the
     result never depends on array order.
  4. **Visibility:** `playerYield` is the player's own foraging and always shown (label + term);
     `enemyDrain` sits behind the SAME Outmatched recon gate as `enemyDrainKg`, label included —
     and the effect deliberately writes no log line for one, since the log would walk past the
     gate. The bend reaches the client as *coefficients* (`kgPerPoint` carries the folded factor,
     new `flatKg` the additive half), not a finished total, because the slider preview
     interpolates as it moves.
  5. **`turnsLeft`** counts down at newDay AFTER the day it was in force resolved, and BEFORE the
     raid redeal, so an expired modifier's card is dropped with it. Extracted as
     `ageForageModifiers` so it's unit-testable outside DB-only `resolveDay`.

  **Tests:** 31 new pure (DB-free) cases — `forage.test.js` extended, new
  `tests/forageModifiers.test.js` covering the effect, the spawn/carry/drop lifecycle, the lift,
  and the countdown — plus 4 frontend cases in `effortSlider.test.jsx`. **Observed green:
  cs-test 498/498 and frontend 254/254**, CI all six jobs (the docker job smokes a full campaign
  turn through the stack), independently reproduced on the reference laptop. Sweeping every pool
  fate through `applyEffect` caught one real bug on the building session: the new case assumed
  `campaign.forage` exists, now guarded like the `flag` branch.

  The building session again could not run the 12 DB-backed files (mongod download 403s through
  the proxy, no usable Docker either — the same block as S2), and that gap cost one red CI run:
  `persistent` widened the raid opportunity's public shape from 13 keys to 14, and the exact-key
  assertion that guards against hidden-info leaks failed 45 times across `campaigns.test.js` and
  `raid.test.js` — one assertion, not 45 problems, and the game code passed the DB suites either
  side of it. **That list is duplicated, not shared** (`expectNoHiddenInfo` in campaigns.test.js,
  `PUBLIC_OPPORTUNITY_KEYS` in raid.test.js), so every stage that adds a view field must edit
  both. Worth collapsing into one exported constant next time either file is touched.

**Deferred, noted not built:** optional food sinks; forager-clash flavour re-expressed as events.

### "Starve the enemy" — S1 ✅ LANDED (schema v31, 2026-08-09)

Grilled down by the user from the sprawling version briefed earlier: **fixed consumption, one
per-turn comparison, three states, NO running total.** ("Either they have too much, enough or not
enough … we don't need to keep track of the running total just turn by turn.")

**The model.** The host now FEEDS ITSELF from the rings it drains — reversing S2 decision 4
("gets no credit"), which was always the placeholder this stage existed to replace. Its income is
the kg it actually took, weighted by the same `FORAGE_RING_YIELD` curve the player is credited by
(`resolveForaging` → `forage.enemyIncomeKg`). That is measured against a FIXED
`ENEMY_CONSUMPTION_KG_PER_TURN`, and the ratio picks a band.

The constant is **derived, not tuned**: `ENEMY_DRAIN_KG_PER_TURN × FORAGE_RING_YIELD[1]`
(9000 × 0.8 = 7200) — i.e. break-even IS the mid ring, by construction. The user's spec then
falls straight out of the arithmetic, which is why no tuning pass was needed:

| host draws from | income | ÷ 7200 | state |
|---|---|---|---|
| ring 0 (near) | 9000 | 1.25 | `well-provisioned` |
| ring 1 (mid)  | 7200 | 1.00 | `steady` |
| ring 2 (far)  | 5400 | 0.75 | `near starving` |

Retuning the drain or the yield curve moves break-even with it. The bands carry a ±10% dead zone
so a mixed-ring draw does not flicker on rounding.

**Why this makes the slider a weapon.** Rings deplete near-first and are SHARED, so stripping the
inner ring yourself pushes the enemy outward into thinner ground. Player foraging is now an attack
on their supply, exactly as asked — and the S3 `enemyDrain` modifiers (burn the depot, etc.) feed
in for free, because they change what the host takes at all.

**Consequences (v2, 2026-08-09 — a FIXED headcount, not a rate):** surplus → `+ENEMY_REINFORCE_
HEADCOUNT` (5) men; starving → `−ENEMY_DESERTION_HEADCOUNT` (10); steady → untouched. Exactly one
band grows the host and one shrinks it; the middle is a deliberate no-op, not an unfinished case.

v1 scaled every type by 3%/5%, which **compounded**: a fed host grew ~+34% over ten turns and grew
faster the bigger it got, a difficulty curve nobody designed. Flat numbers are linear and legible —
ten fed turns is ten times one fed turn — so stripping the rings is worth the same whenever you get
round to it. The two figures are **asymmetric on purpose** (user, 2026-08-09: "easier to get troops
to desert than to hire them"): hunger empties a camp faster than rations fill it, so a starved host
drains at twice the rate a fed one trickles up.

The headcount is split across unit types in proportion to the host's current composition, by
largest-remainder, so the fixed number lands EXACTLY — v1's per-type flooring was fine for a rate
but would silently lose men from a count that is supposed to be exact. A draft this small does
round to nothing for the thin lines (11 Necromancers, 20 LightCavalry), which is the right answer:
the big formations carry the swing. Desertion is clamped so a host cannot bleed past zero. Log
lines stay PHRASES: the log is player-visible and the host's numbers are recon-gated intel.

**A broken host does not recruit.** CI caught a real bug, not a stale assertion: reinforcement
ran BEFORE the near-annihilation check, so a shattered host sitting on a full near ring grew 3%
back over `ENEMY_WITHDRAW_FRACTION` and **stole a withdrawal win the player had already earned**.
Growth is now barred below that line — fresh swords join a going concern, not a rout — while
starvation still applies below it, so the collapse is one-way. Two regression tests pin both
halves. Anything added later that can INCREASE the host must respect the same rule.

**Schema v31.** `enemy.supplies` (the stockpile: seeded once, drained by upkeep forever, never
replenished, no consequence at zero) is GONE, replaced by `enemy.supplyState` — this turn's
verdict only, recomputed each end-day. `ENEMY_SUPPLIES` deleted with it.

**UI.** The view key stays `supplies` behind the SAME Outmatched+ recon gate, so `ScoutReport`
and every pinned recon key-set kept working — only the meaning and the labels changed. It is
**accurate, never bracketed or fuzzed** like `count`: the gate decides whether the player learns
it at all, and above the gate it is the truth (user's ask: "always accurate but requires a
minimum scout level"). Copy reworded to "Their host looks …" since it describes the host's
condition now, not the size of a wagon train.

**Also deduped:** `bandLabel` was defined privately and identically in BOTH `campaignView.js` and
`raid.js`; S4 would have made it three copies, so it now lives once in `utils/campaignConfig.js`
beside the band tables. Same lesson as `PUBLIC_OPPORTUNITY_KEYS`.

**Watch out when asserting exact enemy counts.** End-day now moves the host every turn unless it
is exactly break-even, so any test that pins an enemy number after a turn is silently testing two
mechanics at once. `campaigns.test.js` exports `STEADY_RINGS` ([0, 140000, 220000] — near ring
stripped, host on the break-even mid ring) for exactly this; two event tests needed it.

**Tests.** 23 pure cases in `forage.test.js` (income per ring depth, mid-sweep splits, modifier
interaction, the state bands, the derived break-even identity) — all runnable anywhere. The
DB-backed `enemyAi.test.js` supply describe was rewritten from stockpile arithmetic to the four
behaviours that matter: near ring feeds and grows the host, stripped land starves and bleeds it,
mid ring holds exactly, and the state RECOVERS the moment the land does (which a stockpile model
could not do). `campaigns.test.js` now covers both sides of the recon gate.

**NOT deferred — OUT OF SCOPE BY DESIGN: the enemy does not react.** (User, 2026-08-09: *"We
don't have any enemy behavior at least for now, the enemy is an abstract challenge in roguelite
fashion rather than a reactive opponent."*) So "the host forages harder / moves camp / forces the
battle early when hungry" is not a future stage — do not write it, and do not treat its absence
as a gap. This is the same principle that retired `enemy.stance` in v19; that deletion was
deliberate, not cleanup awaiting a replacement.

What the enemy IS: a set of dials the player pushes on. It consumes a fixed amount, takes what the
shared land still offers, and its numbers answer arithmetic — never a decision. S4 is built that
way on purpose (a gauge and an attrition rate, no agency anywhere), and anything added later
should be too. **`services/enemyAi.js` has been renamed `services/enemyHost.js`** (and
`tests/enemyAi.test.js` → `tests/enemyHost.test.js`) — the old name was a standing invitation to
build the very thing the principle forbids. Older references to `enemyAi.js` further down this
file are historical and accurate to their date; leave them.

**Still deferred from the slider epic** (genuinely deferred, not out of scope): optional food
sinks; forager-clash flavour re-expressed as events.

### Project state (as of 2026-07-05)

> **⚠ HISTORICAL SNAPSHOT — do not read as current state.** Kept for the record; two lines
> below were true in July and are actively misleading now. **Current state: the integration
> branch is `main`** (`feature/campaign-mode` was merged and DELETED — it no longer exists on
> the remote), and the campaign schema is **v30**, not v4. For where the work actually stands,
> read the "Where the work stands" block and the effort-slider stage list above.

- **Branch:** `feature/campaign-mode`. Turn length = **two weeks** (`DAYS_PER_TURN = 14`,
  final — still true). Campaign schema version is **4** — bump `CAMPAIGN_SCHEMA_VERSION` on
  every incompatible campaign-model change (there is no back-compat; mismatched docs are
  deleted). *(The bump rule still holds; the version number is long superseded.)*
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
- **Boss-fight campaign loop — Stage A (meter core) ✅ SHIPPED 2026-07-20** (committed `4680c43`;
  see the dated handoff entry right after the Stage A TDD breakdown for the full detail). Raid
  scouting mini-game Stage 3 landed committed (`556335e`) first, per the prerequisite noted below.
- **Boss-fight campaign loop — Stage B (gate the battle) ✅ SHIPPED 2026-07-20** — server-only,
  all four steps (see the dated handoff after the Stage B TDD breakdown).
- **Boss-fight campaign loop — Stage C (meter reveal) ✅ SHIPPED 2026-07-20 — but SUPERSEDED
  same day** by the recon rework (committed `e618104`; `reveal_meter` scout action). The user
  redesigned it: the meter is camp-troop-driven and NOT tied to scouting, so the manual point-buy
  is replaced by an automatic, graduated recon system — see **"Recon rework"** below. Stage C's
  `reveal_meter` will be reverted in recon R2.
- **Boss-fight campaign loop — Stage D (`destroy_detachment` rework) ✅ SHIPPED 2026-07-20** —
  committed `794a5e3` (casualties always, pursuit + prestige stub on win). See the Stage D handoff.
- **Recon rework — R1 ✅ COMPLETE** (source `ba1ec33`; tests finished + verified green this session).
  R1 source: `campaign.recon.points` (schema **v15**), `reconLevel`/`reconBand`
  (`RECON_LEVEL_THRESHOLDS = [100,300,700,1400]`), end-of-turn accrual of leftover scouting points,
  all 3 band consumers swapped to `reconBand`, and `scoutingCoverage`/`scoutingBand`/`reconValue`
  deleted. R1 tests: `capabilities.test.js` + `campaigns.test.js` rewritten to the recon band and
  **99/99 green** (user-run; `capabilities` + `campaigns` files). The test churn was pure
  expectation updates from ONE behavior change — a fresh campaign now scouts **Blind** (0 recon
  points), not Contested, so its forage posture is Blind's ×0.7: the create-response `kgPerUnit`
  preview asserts the scaled values (21/59), and the raw-number capacity/harvest tests pin
  `Contested` via the new `pinBand` helper (sets `recon.points` to a band's threshold + zeroes the
  leftover pool so an intervening end-day's accrual doesn't drift the band). No source change was
  needed to make tests pass.
- **Recon rework — R2 ✅ COMPLETE 2026-07-21** (server-only; full `cs-test` suite **302/302 green**
  locally this session — mongo behaved for once). Numeric estimate brackets for the enemy total
  count + the boss-fight meter value; Stage C `reveal_meter` reverted. See the R2 SHIPPED handoff
  in the "Recon rework" section below for the full detail.
- **Recon rework — R3 ✅ COMPLETE 2026-07-21** (frontend readout; frontend vitest **230/230
  green**). `CampaignHUD`/`ScoutReport` rewired off the removed `meter.revealed`/`meter.value`
  onto `meter.estimate` + `enemy.count`, and the recon band (level) surfaced. **The recon rework
  is now fully landed end-to-end.** See the R3 SHIPPED handoff in the "Recon rework" section for detail.
- **Boss-fight campaign loop — frontend wiring ("pitched battle") ✅ SHIPPED 2026-07-21** (frontend
  only; vitest **235/235 green**, oxlint clean). This is the Stage-B/C frontend follow-ups that
  were flagged unwired: the server-side loop (Stages A–D) was already live, but the browser still
  rendered **Fight!** unconditionally and never surfaced the decisive-fight state. User steer: the
  meter stays **recon-estimated, never fully revealed** (already the R2/R3 behavior — no change),
  and the roguelite "boss fight" is renamed **"pitched battle"** in all player-facing copy (it's the
  full decisive battle thematically). Landed in `App.jsx` + `CampaignHUD.jsx`:
  - **Fight! is gated on `bossFightDue`** — hidden entirely on a quiet day (there is no full-army
    battle pre-threshold; the button would only hit Stage B1's raw 400). On the pitched-battle day
    it appears with the existing full-deployment `disabled` rules.
  - **The pitched battle is mandatory in the UI too:** the "End Turn (no battle)" escape is
    withheld while `bossFightDue && !battleFoughtToday` (server B4 already 400s it) — after the
    fight the campaign is `won`/`lost`, which the existing generic `status !== 'active'` game-over
    screen already handles (decisive win/loss routing needed NO new work).
  - **The player is warned the pitched battle is due** on the **Council, Raids, and Deploy** screens
    (`pitched-battle-warning`/`-raids`/`-deploy` testids), so forage/raid commitments that day are
    made knowing the decisive fight is coming (the user's explicit requirement — allocation depends
    on knowing the final fight is here). The Council warning replaced the old `enemy.battleOffer`
    one (battleOffer ⟺ bossFightDue).
  - **HUD meter relabelled** `Meter:` → `Pitched battle:` (band or recon estimate as before;
    `now!` once due). Tutorial/stance copy reworded to "pitched battle".
  - Tests: new `bossFightGate.test.jsx` (quiet day = no Fight!/no warning/End Turn stays; pitched
    day = Fight! + mandatory, warnings on all three screens); `bossFightDue: true` threaded through
    the fight-flow fixtures (battleVictory/Defeat, watchReplay, squad/holdOrder flows);
    `campaignFlow` reached-deployment landmark moved off the now-conditional Fight! to `end-day`;
    `campaignHud` meter-label assertions updated + a `now!` case. **Still unwired:** nothing new —
    Stage C's `reveal_meter` button is moot (reverted in recon R2; the meter is recon-driven, not
    point-bought). **NEXT: Stage E (hiring troops, still design-only)** or the deferred
    `enemy.stance`/`battleOffer` cruft-removal pass.
  Stage E (hiring troops) stays design-only. **combat-score-per-hexside**
  ([[todo-combat-score-per-hexside]] — make `HexSide.combatScore` erode `fortDurability`
  mid-battle so the placeholder goes live) is still open but pushed further down the queue
  behind the loop.
- **Balance stays rough** until the full campaign loop exists (plausible numbers suffice
  while features land).
- **Event prerequisites (chains, part 1 of 2): ✅ SHIPPED 2026-07-20.** First half of the
  "richer event system (prerequisites/chains)" follow-up. Events may now carry a declarative
  `requires` block (`services/events.js`), tested by one `eventEligible(event, ctx)` predicate
  against a duck-typed context `{day, roster, eventFlags}` (Mongoose Map on the live doc, plain
  object at creation/in tests). Supported clauses, all ANDed: `minDay`/`maxDay`, `flags`
  (all set), `notFlags` (none set), `hasUnit` (roster holds ≥1). `eligiblePool(ctx)` is the
  filtered draw pool; `augury.js`'s `randomSlot`/decoy pick both draw from it, so a gated fate
  reaches the player as **neither truth nor decoy** until its trigger is met. State is written by
  a new `flag` effect type (`applyEffect`: `value` sets / `delta` increments / default 1, NO
  player-visible log line — hidden bookkeeping) into a new hidden `eventFlags: Map` on the
  campaign (authored v13; **landed as schema v17** — reconciled with recon-R2's v16 during the
  integration rebase). **Load-bearing invariant** (augury.test.js tripwire): the
  *unconditional* events alone keep every severity tier legible (≥2 + mixed valence), so
  prerequisites are purely additive and the same-pool pairing can never collapse — no runtime
  collapse guard needed. Proof event: `horse_sickness` (severity 2, `requires:{hasUnit:'Cavalry'}`
  — a murrain that can only befall an army that fields mounts). **The tier/legibility minigame is
  untouched:** a gated fate still has a severity, still reads by `POOL_LEGIBILITY`, still pairs
  with a same-tier decoy — smaller fates stay easy to read, majors stay murky.
  - **Integrated 2026-07-21** (the branch sat unmerged for a day while main moved 21 commits
    ahead). Rebased onto main — clean except the one-line `CAMPAIGN_SCHEMA_VERSION` collision
    (v13 vs main's v16), reconciled to **v17**; `augury.js`/`events.js` had no overlap with
    main's recon/boss-fight work. Merged via **PR #2** (`37c5db3`); `feat/event-prerequisites`
    retired (local + remote). **Rode along:** a stale-e2e fix (`d8941bf`) — main's `ab7398a`
    (pitched-battle gate) had gated `Fight!` on `bossFightDue` and updated the vitest fixtures
    but left `e2e/tests/campaign-loop.spec.js` asserting `Fight!` visible on Turn 1 (a quiet
    day, button correctly absent → red CI); switched to the `end-day` deploy landmark, matching
    campaignFlow.test.jsx. Unrelated to prerequisites; committed straight to main first.
- **Event chains (part 2 of 2): ✅ SHIPPED 2026-07-21.** Second half of the "richer event system"
  follow-up — the `schedule` primitive for a GUARANTEED follow-up fate (part 1's `flag`/`requires`
  already covered *randomly-eligible* gated follow-ups). Landed server-only, schema **v17→v18**:
  - **`schedule` effect** (`services/events.js` `applyEffect`): `{type:'schedule', event, delay}`
    pushes `{eventId, day: campaign.day + (delay ?? 1)}` onto a new hidden `scheduledEvents` queue
    on the campaign (model, alongside `eventFlags`). NO log line — scheduling is hidden state, like
    `flag`; the beat announces itself when it lands. Works inside a `multi` and from any effect
    site (plain fate, choice branch, deferred pick) since they all funnel through `applyEffect`.
  - **Queue drain at `drawAugury`** (`services/augury.js` new `drainScheduled(ctx)`): every entry
    whose `day <= ctx.day` becomes a FORCED slot — the scheduled event as truth + a same-tier
    *eligible* decoy — and is removed from `ctx.scheduledEvents` (reassigned so a Mongoose
    DocumentArray tracks it). Forced slots take the first slots; the rest fill normally
    (`DEV_AUGURY` force ?? random). Entries not yet due, beyond the turn's slot capacity, or whose
    id is gone from the pool are handled (kept / kept / dropped). This is the one intended side
    effect of `drawAugury` — called only from `dayResolution` step 7 (which saves after) and the
    creation route (empty queue → no-op).
  - **`chained:true`** (`services/events.js`) excludes an event from `eligiblePool` outright — a
    follow-up beat is never a random draw or a decoy, only ever surfaced by the schedule queue.
  - **Proof chain:** `captured_courier` (a severity-2 CHOICE, unconditional) → `sprung_ambush`
    (severity 2, `chained:true`, `enemy_losses ×0.9`). Reading the courier's dispatches
    (`read_dispatches` branch, effect `{type:'schedule', event:'sprung_ambush', delay:1}`) sets a
    trap that springs the next turn; ransoming him (`ransom_courier`, food) schedules nothing — the
    chain is the player's own choice echoing forward. **Timing nuance:** in the canonical tent flow
    (consult → accept → choose on day N → end-day) the follow-up surfaces on N+1; if the choice is
    instead resolved on the *never-accepted* path (choice pends at end-day, resolved on the new day
    N+1) the schedule reads `campaign.day` = N+1 → follow-up on N+2. Both are correct ("a fortnight
    hence" from when you decide).
  - **Tripwire updated:** the augury.test.js "unconditional events alone keep every pool legible"
    invariant now excludes `chained` too (base = `!requires && !chained`) — the collapse guarantee
    must hold from the always-random-drawable set alone.
  - **Tests:** `tests/augury.test.js` (+13 pure-service: `schedule` effect incl. inside `multi`,
    `eligiblePool` excludes chained, `drawAugury` drains due/keeps not-due/drops unknown-id/no-op
    on absent queue, chain wiring) — **68/68 green locally** (no DB). `tests/campaigns.test.js` new
    `event chains (part 2)` describe (+2 route: full read→schedule→drain-next-turn through real
    routes; ransom schedules nothing) — verified green via the user's own run / CI (sandbox mongo
    unreliable here, see [[reference_laptop_mongo_tests]] / [[feedback_no_manual_cs_test]]). NOT yet
    click-tested in the live browser. **NEXT:** Stage E (hiring troops, design-only) or the deferred
    `enemy.stance`/`battleOffer` cruft-removal pass; more authored chains as content lands.
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

### Boss-fight campaign loop (meter + decisive battle) — Stages A–D + recon rework SHIPPED; Stage E (hiring) still deferred

> **Status (2026-07-21):** the core loop is BUILT and in `main` — Stage A (meter core), Stage B
> (gate the battle + decisive win/loss), Stage C (meter reveal, later superseded by the recon
> rework), Stage D (`destroy_detachment` casualty rework), and the whole recon rework (R1–R3) all
> shipped, plus the `enemy.stance`/`battleOffer` removal (2026-07-21, see the DONE note below).
> What remains: **Stage E — hiring troops**, now DESIGN LOCKED (2026-08-02, not yet implemented) —
> see "Recruit phase — hiring troops" below, a new turn phase folding in the old Militia-purchase
> mechanic, with a `gold`/`horses` economy and a Recruiting Fervor stat. The **narrative siege
> reframe** (Karrowgate walls gauge + intro + the Vael)
> ✅ shipped 2026-07-21 — see its handoff below; only the deferred **themed/scripted siege events**
> flavor-rework remains of it. The per-stage SHIPPED handoff blocks below are the source of truth;
> this section was designed up front, so read the ✅/DEFERRED tags per bullet, not just the heading.

Grilled end-to-end with the user before writing anything down (per the `grilling` skill rule in
`CLAUDE.md`); this section **supersedes** the old `[[todo-multi-turn-campaign-loop]]` and
"raid vs. main-battle turn sequencing" backlog stubs (both now point here). Staged for
one-thing-at-a-time implementation, but the whole loop is designed up front per user request —
"having a plan for the whole loop even if it has unimplemented features is helpful."

**Framing (user):** roguelite-style — events, raids, and hiring troops turn-by-turn, building up
to one decisive **"boss fight."** A lot of the persistence groundwork already exists and needed
no new work: `campaign.enemy.army` already carries real survivors across turns
(`campaigns.js:312`, `red_survivors`), already shrinks from forage clashes/raids/events, and
`checkAnnihilation` already ends the campaign at 0 either side. What's actually missing is (1) a
mechanic that turns "fight any day, always full army" into "several turns of raiding/foraging/
events, THEN one decisive fight," and (2) raiding actually costing something against that fight.

**1. The meter.** New hidden per-campaign field, `campaign.meter` (name TBD at implementation
time), 0 → **1000** threshold.
- **Fills at end-of-day resolution** (same place `enemyTurn`/`enemyAi.js` already runs), by
  `100 − 50×(troopsInCamp / totalRoster)` — **floor 50** when every non-forage/non-raid troop
  sat idle in camp, **ceiling 100** when none did (everyone raiding/foraging). `troopsInCamp`
  reuses the existing carve-out already used for the full-deployment gate: `roster −
  forage.assignment − raid.assignment`.
- At 100/turn (worst case for the player, i.e. best case for speed) that's 10 turns minimum to
  fill; at 50/turn (everyone held back) it's 20 — "several turns" falls out of the formula
  itself, no separate floor needed.
- **Design intent, stated by the user:** camp troops slow the meter, so a player will normally
  hold troops back — "likely the player will save troops unless there is a good raid that makes
  a greedy play justified." The tension is deliberate: raiding/foraging is faster meter growth
  (closer to the boss fight) traded for readiness on the day it lands.
- **✅ SHIPPED 2026-07-21 — narrative siege reframe (frontend copy + server band labels; ZERO
  mechanics).** Grilled the fiction end-to-end with the user before writing (per the grilling rule),
  then a pure-fluff pass. The setting: you command a **relief army** racing to save **Karrowgate**,
  the one bridge-city across the **river Marn** (by the **Warden of the Marches**' old edict, no other
  bridge may stand — so the frontier funnels through one crossing). A fast enemy **vanguard** has
  rushed ahead of its main host to seize the bridge; too weak to meet it head-on, you shadow and
  harass it (it can't chase you off without abandoning the assault and losing its race), digging in
  beside the siege lines. The meter is now **Karrowgate's walls** under assault, and the bands were
  renamed `calm/restless/imminent → **intact/damaged/breached**` (`METER_BANDS`,
  `utils/campaignConfig.js` — the label is display *and* lookup key, so `enemyAi.test.js` band
  expectations moved with it). Landed:
  - **HUD walls gauge** (`CampaignHUD.jsx`): the meter renders as a **draining** integrity bar
    (green→amber→red) + status word, *inverting* the server value for display
    (`WALLS_METER_THRESHOLD` = display-only mirror of the server threshold; integrity = 1 −
    value/threshold). Stays **coarse (3 band steps) while Blind** — the exact value is what recon
    sells, so it's never leaked — and only shows a numeric **integrity range** (`~40–55% sound`) once
    a recon estimate exists. `bossFightDue` ⇒ `BREACHED — give battle!`.
  - **Reveal/council prose** reframed to intact/damaged/breached walls (`EventRevealScreen.jsx`
    `BAND_LINES`/`EnemyBeat`, `App.jsx` council line + the pitched-battle warning). The band→prose
    map keeps the PLAYTEST flag (revisit once meter pacing is felt).
  - **One-time intro screen** (`CampaignIntro.jsx`): the full "Relief of Karrowgate" scene-setter,
    shown on turn 1 before the council, **not** tutorial-gated (story, everyone sees it once);
    dismissal is session-only UI state (`useUiStore.introSeen`, reset by `startCampaign`), gated in
    `App.jsx` on `day === 1 && !introSeen`, "Take command" enters. The narrative doubles as the
    mechanic's *why* (too weak to fight → shadow; reserves slow the walls' fall; the breach forces
    the one decisive pitched battle).
  - **Augur = the Vael** (`AuguryPanel.jsx` hints + the omens `TutorialIntro`): a proper invented
    magic. Fate is unfixed, stirring in the **Vael** (the unsettled deep of days-to-come); the augur
    reads it and, while it's still soft, **troubles a thread** to raise another — which is exactly
    why a reroll *changes* the fate rather than clarifying it. Mechanics wrapped inside the flavor.
  - **Light siege flavor** on the Forage/Camp/Raids tutorial intros (one lead line each).
  - **Tests:** new `campaignIntro.test.jsx` (2), rewritten `campaignHud.test.jsx` meter cases (walls
    gauge + integrity range), `eventReveal`/`campaignFlow` copy/flow touch-ups, `setup.js` defaults
    `introSeen: true` so App tests bypass the intro. **Frontend vitest 237/237 green, oxlint clean.**
    Server side is a label rename only (`enemyAi.test.js` updated) — **hand `cs-test` to CI** per the
    sandbox-mongo caveat. NOT yet click-tested in a live browser.
- **DEFERRED — themed siege events + scripted per-turn beats (user, 2026-07-21).** Events are the
  vehicle for injecting story into the game loop, authored in a **later flavor-rework pass** (NOT in
  the reframe above). Direction: **forced/scripted events on specific turns** with heavier fluff +
  **narrative choices**, plus reworking the existing pool to match the siege fiction (relief column,
  sortie from the walls, siege lines, etc.). Reuses the existing `schedule`/`requires`/choice
  primitives and existing effect types — **no mechanic change** (nothing touches the meter directly;
  there is no meter-delta effect and adding one would be a mechanic change).
  - **Pool flavor-rework — partially landed (2026-07-22, UNCOMMITTED — sitting on `main`, needs a
    branch before commit).** The
    generic `EVENT_POOL` prose was reworked into the Karrowgate siege fiction (`services/events.js`,
    strings only — every `id` and `effect` unchanged, so DEV_AUGURY seeds + pinned tests still hold).
    **Perspective correction (user, 2026-07-22):** you are the RELIEF ARMY (mobile, outside, harassing
    the vanguard that besieges Karrowgate), **not** the besieged garrison — so "a wagon slips through
    the line into camp" is wrong; supply comes from foraging/seizing enemy supply columns/river trade
    from friendly country. `supply` → "Wagons Bound for the Siege" (seize an enemy supply column);
    `traders`/`plague`/`tool_rot`/etc. de-besieged. Also added the `relief_rider → relief_column_arrives`
    chain (relief-HOST cooperation, existing `schedule`/`chained` primitive). Augury 71/71, full
    cs-test 329/329 green. **An earlier ad-hoc `sortie`/`garrison_signal`/`garrison_trust` arc was
    BACKED OUT** — garrison cooperation must be a designed mechanism, not `enemy_losses` bolted on a
    flavor card (see the Garrison Resolve design below).
- **DESIGN (locked 2026-07-22, NOT yet built — user said "just write the plan") — Garrison Resolve:
  the one mechanism all garrison cooperation hangs off.** The gap it fills: **the walls meter today
  only ever fills — the player has no lever to push the breach back.** Karrowgate's garrison is the
  natural home for that lever (every fortnight they hold is a fortnight you prepare / wait for the
  Warden's host). One relationship track, three payoffs all sourced from it (so nothing is a bolted-on
  effect), fed by events carrying any of three credible costs.
  - **The track:** hidden per-campaign `garrison.resolve`, **0→100, starts ~40** — the standing
    between your relief army and the besieged garrison. It is the single number every garrison event
    moves. New sub-state on the campaign model (alongside `enemy`/`augury`/`meter`); **bump
    `CAMPAIGN_SCHEMA_VERSION`** when it lands.
  - **New effect primitive `garrison`:** a bounded delta on `resolve` (clamped 0..100), hidden-state
    like `flag` — **no player-visible number in the log** (a leaked number would cheapen the fiction).
    Handled in `applyEffect` (`services/events.js`); classified `neutral` by `eventValence` (it's a
    relationship move, not a gain/loss — the event's *other* effects carry its valence). This is the
    thing cooperation events award.
  - **Payoff 1 — passive wall-slow (THE centerpiece; user-confirmed 2026-07-22).** Higher resolve
    slows the wall-meter's end-of-turn fill: heartened, coordinated defenders hold better. **This is
    the flagged mechanic change** — one hook in day resolution where the meter fills:
    `fill × (1 − f(resolve))`, `f` mapping resolve→[0, ~0.4] (exact curve TBD at build; keep the
    floor honest so a maxed garrison can't freeze the clock outright). This is what makes the track
    matter every turn and is the lever the game currently lacks. Ties both ways: **decay** — resolve
    slips a step when the walls cross a damage band (the garrison feels abandoned).
  - **Payoff 2 — the sally (threshold, boss fight).** At the decisive battle, `resolve ≥ THRESHOLD`
    → the garrison sallies from the gates: a wave on your side / `enemy_losses` applied at battle
    start. One boss-fight hook keyed on the threshold.
  - **Payoff 3 — eyes on the enemy (event).** Cooperation events may also pay immediate
    `enemy_reveal`/`enemy_losses` (existing effects, no change) — the garrison signals what it sees
    from the walls.
  - **Resolve as an event GATE (`requires`, user 2026-07-22).** Resolve doesn't only get awarded and
    read for payoffs — it also **gates which garrison fates can appear**, via the existing
    prerequisite machinery. Extend `eventEligible`'s `requires` vocabulary with **`minResolve` /
    `maxResolve`** clauses and thread `resolve` into its duck-typed `ctx` (alongside `day` / `roster`
    / `eventFlags`, sourced from `campaign.garrison.resolve`). Then author gated content: **high-resolve**
    fates the garrison offers only a trusted ally (a joint sortie, betraying the enemy's dispositions,
    a runner slipped out with supplies for you), and **low-resolve** fates when the bond has soured
    (the garrison spurns your signals, or a crisis on the walls you're powerless to answer). This is
    ADDITIVE like every other `requires` gate — the augury legibility invariant already holds on the
    unconditional base pool, so resolve-gated events only ever widen a tier (augury.test.js tripwire).
    Cheap to build (one predicate clause + `ctx` field) and it makes the whole garrison pool feel
    like a relationship that opens and closes doors rather than a flat list.
  - **The events (each a different credible cost, all feeding the one track):** (a) **committed
    troops** — a coordinated sortie as a raid-style troop assignment → `+resolve`, cost = battle-day
    readiness (reuses the raid/forage assignment carve-out); (b) **supplies** — a lifeline smuggled
    over the wall (spend food/materials) → `+resolve`, cost = economy; (c) **opportunity** — a
    recurring "the garrison calls" choice → `+resolve` vs. tending your own army.
  - **HUD:** a garrison-standing readout beside the walls gauge (coarse word while Blind, like the
    walls meter — the exact number is hidden state).
  - **Slice plan (TDD, one per session per the small-batches rule):**
    1. **✅ SHIPPED 2026-07-22 (branch `feat/garrison-resolve`).** `garrison.resolve` sub-state
       (model **schema v20→v21**, default `GARRISON_RESOLVE_START` 40) + the `garrison` bounded-delta
       effect (`applyEffect`, clamped 0..100, hidden-state like `flag` — no leaked number) + the
       `requires` `minResolve`/`maxResolve` gate (`eventEligible`, reads `ctx.garrison?.resolve`,
       defaults to START for a creation-time draw) + `garrison`→neutral in the valence classifier.
       Config: `GARRISON_RESOLVE_MIN/MAX/START` + `GARRISON_BANDS` (faltering/wary/steadfast/devoted);
       `services/garrison.js` `garrisonBand(resolve)`. Three cooperation events: `garrison_call`
       (choice — spend food to raise resolve, or keep stores), `garrison_lookout` (gated
       `minResolve:60`, an `enemy_reveal` the trusting garrison hands you), `garrison_spurned` (gated
       `maxResolve:20`, a soured-relationship morale slip). View exposes `garrison:{band}` (coarse
       word only — raw resolve stays server-side); HUD `hud-garrison` readout. Tests: augury **82**
       (pure, +11) incl. effect/gate/events; frontend `campaignHud` garrison readout. **Full cs-test
       340/340, frontend green in isolation.** NO meter hook yet (slice 2).
    2. **✅ SHIPPED 2026-07-22 (branch `feat/garrison-resolve`) — the mechanic change.** Passive
       wall-slow + band-cross decay in day resolution. **No schema bump** (pure logic on existing
       `garrison.resolve`/`meter.value`). The end-of-day meter fill (`dayResolution.js` step 4) is now
       `+= Math.round(meterFillAmount × (1 − wallSlowFactor(resolve)))` — a heartened garrison holds
       the walls, the player's ONE lever to push the breach back. `wallSlowFactor(resolve)`
       (`services/garrison.js`) is **linear**, `GARRISON_WALL_SLOW_MAX × clamp(resolve)/MAX`, capped at
       **0.4** so a devoted (100) garrison slows the fall 40% and a maxed one can NEVER freeze the clock
       (the honest floor). **Band-cross decay:** the meter only rises, so a changed `meterBand` after the
       fill means the walls were battered into a WORSE band (intact→damaged→breached) → resolve slips
       `GARRISON_BAND_CROSS_DECAY` (**10**), hidden state like the `garrison` effect (player sees only the
       band word drop); resolve is read BEFORE the decay so the turn's slow reflects the garrison as it
       stood. **Refactor:** `adjustResolve` (init+clamp, the single resolve writer) + `clampResolve`
       extracted to `garrison.js`; the `garrison` event effect (`events.js`) now routes through it (DRY,
       one clamp site). Numbers (`WALL_SLOW_MAX 0.4`, `BAND_CROSS_DECAY 10`) are the "open at build time"
       curve/floor/step — plausible, tunable; fresh-campaign resolve 40 → 0.16 slow → idle floor fill
       50→**42**/turn. Server-only (view already exposed `garrison:{band}` from slice 1 — HUD needs
       nothing). Tests: pure `wallSlowFactor`/`adjustResolve` in `augury.test.js` (**87**, +5); the 3
       existing enemyAi meter tests retuned to the 42 fill; a new enemyAi route describe (devoted-vs-broken
       slow, band-cross decays / in-band doesn't, decay clamps at 0). **Full cs-test 348/348 green
       locally.** NEXT: slice 3 (boss-fight sally hook).
    3. **✅ SHIPPED 2026-07-22 (branch `feat/garrison-resolve`) — payoff 2, the sally.** Boss-fight
       hook: a **devoted** garrison (`resolve ≥ GARRISON_SALLY_THRESHOLD` **75**, the `devoted` band
       floor — only a garrison that trusts you to the last risks a sortie) sallies from Karrowgate's
       gates as the decisive battle opens, thinning the hidden enemy host by `GARRISON_SALLY_FACTOR`
       (**0.85** → kills ~15%) BEFORE the fight. **No schema bump** (reads existing
       `garrison.resolve`). `garrisonSallies(resolve)` predicate (`services/garrison.js`, clamps then
       compares). Wired into `POST /:id/battles` (`routes/campaigns.js`) just before the battle input
       is built: scale `campaign.enemy.army` by the factor and **rebuild** `enemy.plannedPlacement`
       from it (the placement, not `enemy.army`, is what the input carries — so the engine fields the
       thinned host), then a player-visible sally **log line** (phrase only, no numbers). Read once,
       on the decisive battle only. Both constants tunable (`campaignConfig.js`), balance stays rough.
       Tests: pure `garrisonSallies` in `augury.test.js` (**90**, +3: threshold on/off, fresh-resolve
       no-sally, clamp); two route cases in `campaigns.test.js` (devoted → thinned `enemy_placement` +
       sally log line; starting-resolve → placement untouched, no line). NO frontend change (HUD band
       readout from slice 1 already surfaces the standing). NEXT: slice 4 (committed-troop sortie).
    4. **✅ SHIPPED 2026-07-22 (branch `feat/garrison-resolve`) — payoff/cost (a), the committed-troop
       sortie.** The third resolve-feeding cost: committed troops. A new **`garrison_sortie` raid
       opportunity type** the garrison offers only once it trusts you — a coordinated sally that rides
       the ENTIRE existing `/raids/launch` flow (squad party, capacity, real short engine battle, squad
       reconciliation, and — the point — the `raid.assignment` carve-out, so the troops are unavailable
       for the pitched battle that day). Grilled the shape with the user first (per the grilling rule):
       real battle (not a forage-style no-battle commit); surfaced **as events gated by garrison
       trust**; reward varies per version (thin the enemy OR pay other loot, user 2026-07-22).
       - **Bridge, events→raid board (schema v21→v22):** authored `GARRISON_SORTIE_EVENTS`
         (`services/events.js`, exported) — NOT in `EVENT_POOL`, so never an augury vision/decoy. They
         are *events* purely to reuse the `requires` prerequisite machinery (`eventEligible`): each is
         `requires.minResolve`-gated on the garrison's own standing. `generateRaidOpportunities`
         (`raid.js`) spawns one `garrison_sortie` opportunity per event whose gate the campaign
         currently clears (campaign doc IS the `requires` ctx — same as the augury draw), so the OFFER
         is the raid, never a vision. **Both gates are ABOVE the 40 start** (probe `minResolve:50` =
         steadfast, grand `minResolve:75` = devoted), so a fresh/wary campaign offers no sortie and the
         existing raid-board tests + boards are byte-unchanged — the sorties are purely additive, earned.
       - **Two versions (`sortie_probe` / `sortie_grand`)** carrying a `sortie:{resolve, …}` block:
         probe `{resolve:10, thinsEnemy:true}` (a spoiling sally — the enemy-reduction IS its reward),
         grand `{resolve:14, materials:250}` (throw the gates for the siege park — loot instead, so
         `thinsEnemy:false`). `buildOpportunity` reads the event's flavour as the card and its `sortie`
         block as the (hidden) reward + a new **`thinsEnemy` opportunity flag** (model field, default
         false; the launch route's casualty step now fires on `type==='destroy_detachment' ||
         opportunity.thinsEnemy`, booking real casualties win-or-lose but **no pursuit** — a sortie is a
         spoiling attack, distinct from destroy_detachment's whole-slice kill).
       - **Reward on a WIN** (`applyRaidReward`): `adjustResolve(campaign, reward.resolve)` — hidden
         bookkeeping, **no number in the log**, only a sally phrase — plus any loot (materials/food/
         roster). `resolve` never enters `rewardRange`/`rewardView` (they only key on food/materials/
         roster), so it stays server-side; `thinsEnemy` isn't in the view whitelist either. NO view or
         frontend change (the Raids panel renders any opportunity generically; the HUD band readout
         from slice 1 already surfaces the standing).
       - **The trust progression** this creates: a wary (40) start offers no sortie → climb to steadfast
         (50) via `garrison_call` (supplies) to unlock the probe → sorties (troop cost) climb you toward
         devoted (75), which opens the grand assault AND arms the boss-fight sally. ⚑ Note: today the
         only resolve lever available AT the wary start is the random `garrison_call` augury choice — if
         it never draws, resolve can stall below 50. Fine for now (content/balance, tunable); flagged.
       - Tests: pure gen/reward in `augury.test.js` (**98**, +8: gate below/at steadfast/at devoted,
         flavour+thinsEnemy+hidden-reward, win raises resolve with no leaked number, loot version, clamp);
         three route cases in `raid.test.js` (thins-enemy win → resolve↑ + real casualties + assignment
         carve-out + no leak; loot win → resolve↑ + stores + host untouched; loss → no resolve, thins
         still books casualties). **augury 98/98, raid 41/41, full cs-test 364/364 green locally.** NO
         frontend change; NOT yet click-tested in a live browser. **NEXT:** the Garrison Resolve design is
         now fully built (slices 1–4) — remaining garrison work is content (more resolve-gated fates via
         the `minResolve`/`maxResolve` doors) + the deferred themed/scripted siege-event flavor pass; the
         bigger open items are Stage E (hiring troops, design-only) and combat-score-per-hexside.
  - **Open at build time:** ~~the exact `f(resolve)` curve + wall-slow floor~~ (RESOLVED slice 2:
    linear, `WALL_SLOW_MAX 0.4`, `BAND_CROSS_DECAY 10` — all tunable); ~~the sally THRESHOLD and
    its battle-start effect magnitude~~ (RESOLVED slice 3: `SALLY_THRESHOLD 75` = devoted-band floor,
    `SALLY_FACTOR 0.85` = ~15% enemy losses at battle start — both tunable); naming shown to the
    player ("Garrison Resolve" / "Karrowgate's Resolve" / "the garrison's faith").

### Garrison-support epic (redesign, grilled + locked 2026-07-24) — S5–S9

> The garrison track from slices 1–4 (shipped) gets **reworked and extended** into a visible,
> three-level relationship with a **second loss condition** and **graduated battle support**.
> Grilled end-to-end with the user (2026-07-24) before writing. This SUPERSEDES the "shown only
> as a coarse band word / hidden number" visibility rule for the garrison track (the walls meter
> stays recon-gated; the garrison is now openly visible — you're in signalling contact with them).
> Plus the two content passes that kicked this off (scripted siege spine + resolve-gated fates)
> land as the last two slices, so they build on the settled model. **Build order S5→S9, one slice
> per session per the small-batches rule.** The content (S8/S9 — the user's original "tasks 1 & 2")
> is deliberately LAST: gating fates against thresholds that are about to move would be rework.

**The redesign (user, 2026-07-24):**
- **Three levels replace the four bands.** `faltering/wary/steadfast/devoted` → **low / normal /
  determined**. Thresholds: **low = 1–33**, **normal = 34–66**, **determined = 67–100**. Start
  **45** (mid-normal — real buffer both ways). All tunable; balance stays rough.
- **0 (or below) = the garrison surrenders = campaign LOST**, regardless of the walls meter. A
  second, parallel failure clock: neglect the garrison and Karrowgate opens its gates before the
  walls ever breach. Makes the whole resolve track load-bearing every turn (beat-2 refusal,
  `garrison_spurned`, band-cross decay all now have terminal stakes).
- **The garrison is SHOWN as a visible meter** — a HUD gauge (proportional bar + level word),
  always visible (NOT recon-gated, unlike the walls). Raw integer still hidden (the bar + word is
  the read, matching the walls gauge's coarse display).
- **Graduated pitched-battle support by level** (replaces slice 3's binary devoted→sally): **low →
  no help**, **normal → some troops**, **determined → more troops**. The troops **enter the battle
  as allied reinforcements from the enemy's rear at turn X** (user), modelled as an **auto-cast
  spell** (see S6).

**S5 — model rework (server + frontend). ✅ SHIPPED 2026-07-24 (branch `feat/garrison-resolve`,
commit `1979774`; cs-test 371/371, fe 237/237 green solo — the mongo-startup flake needs a solo
run, and running fe+cs concurrently starves the machine into timeout flakes, so run them one at a
time).** No engine work.
  - Config (`campaignConfig.js`): `GARRISON_RESOLVE_START` 40→**45**; `GARRISON_BANDS` → the 3
    levels above; add `GARRISON_SURRENDER_FLOOR = 0`; re-point `GARRISON_SALLY_THRESHOLD` 75→**67**
    (the determined-level floor — keeps the interim enemy-thinning sally firing for any determined
    garrison until S7 swaps in the reinforcement spell).
  - `services/garrison.js`: rename `garrisonBand`→**`garrisonLevel`** (labels are now levels); add
    **`garrisonSurrendered(resolve)`** = `clampResolve(resolve) <= GARRISON_SURRENDER_FLOOR`.
    `wallSlowFactor`/`adjustResolve`/`clampResolve`/`garrisonSallies` unchanged (sally re-points via
    the constant).
  - `services/dayResolution.js`: end-of-day **surrender loss check** in step 6 (end conditions),
    after the band-cross decay has settled resolve — `status === 'active' && garrisonSurrendered(...)`
    → `status = 'lost'` + a player-visible entry ("Karrowgate throws open its gates…"). Follows the
    annihilation/withdraw pattern (status + entry, NO new `endReason` field — the day report carries
    the narrative, same as those paths).
  - `services/campaignView.js`: `garrison: { band }` → `garrison: { **level** }`.
  - `frontend/CampaignHUD.jsx`: replace the plain `Garrison: {band}` text with a **gauge** (bar +
    level word) in the walls-gauge style; coarse fill per level (low/normal/determined), green/amber
    /red. testid stays `hud-garrison`.
  - **NO `CAMPAIGN_SCHEMA_VERSION` bump** — no stored-shape change (`garrison.resolve` already
    exists; START/labels/surrender are behavior + display, and an old v22 doc loads and behaves
    correctly under the new rules). The sortie event `requires` gates (probe 50 / grand 75) stay
    RAW resolve values (they work regardless of level boundaries) — align to levels later if wanted.
  - Tests: pure `garrisonLevel`/`garrisonSurrendered`/re-pointed `garrisonSallies` in `augury.test.js`
    (the old faltering/wary/steadfast/devoted band tests get rewritten to the 3 levels); a
    `dayResolution` surrender-loss route case; `campaignHud.test.jsx` garrison-gauge cases.

**S6 — engine: garrison-sally reinforcements as an auto-cast spell (C++ engine + server). ✅
  SHIPPED 2026-07-24 (branch `feat/garrison-resolve`).** The sally is `Spells::castGarrisonSally`
  (`SpellList.cpp`), modelled on `castRaiseDead`: it summons `r.count` allied units of `r.unitType`
  (via `makeUnitByName`), marks them `battleSummon` (so `extractResult` filters them out — they
  never cross back as survivors), and places them at the **enemy's rear edge** — the far rows of
  the enemy's home end (Red flees south → Blue's sally lands rows ≥ height-3; derived from
  `3 - team`), reusing `randomPlaceArmy` with a rear `PlacementZone`. **The casterless wrinkle:**
  unlike the roster spells it takes no `AUnit&` caster — a garrison has no mage on the field — so it
  is a free function (still in `SpellList`, so a future manual-cast path can call the same body),
  invoked by a new **team-level tick scheduler**: `Battlefield::_reinforcements`
  (`std::vector<Reinforcement>`, cleared by reset()/loadArmies like the tick log) +
  `scheduleReinforcement()` + `fireScheduledReinforcements()` called at the top of `tick()` (after
  `onTurnStart`, before the special phase, so arrivals act that turn). A wave fires **exactly once**,
  on the first turn where `tick <= _ticksRun+1`. `BattleInput` gained a validated, attacker-clamped
  `reinforcements: [{tick, team, count, unit_type, message}]` array (`runBattleFromJson`,
  `MAX_REINFORCE_COUNT` 500), scheduled AFTER `loadArmies`.
  - **Deviation from the plan's literal spec, flagged:** the log line is **caller-supplied** (the
    `Reinforcement.message`), not the hardcoded "Karrowgate…" string — the engine stays free of
    campaign fiction (its ethos everywhere else), logging a generic "Reinforcements storm the enemy's
    rear!" when `message` is empty. The **campaign/server layer supplies the Karrowgate wording** via
    the BattleInput `message` field (S7), and the replay still SHOWS it (verified end-to-end:
    `echo '{...,"reinforcements":[{...,"message":"Karrowgate garrison sallies!"}]}' | ./game battle`
    emits the line into `tick.log`). If the user wants the literal string baked into the engine
    instead, it's a one-line default change.
  - Tests: `backend/engine/tests/test_garrison_sally.cpp` (3 cases: wave summons allies at the
    enemy's rear on its turn / battleSummon units don't cross back as survivors / fires exactly once)
    — named distinctly from `test_reinforce.cpp` (that's reserve *redistribution* between hexes, an
    unrelated concept). **Full suite 347 cases / 3783 assertions green; `./game` links clean.**
  - **NEXT: S7** — translate garrison level → sally spec at the decisive battle and feed it into the
    BattleInput `reinforcements` (server-only); **remove** the interim slice-3 enemy-thinning sally
    (`campaign.enemy.army` scaling + placement rebuild in `routes/campaigns.js`), keeping the
    day-report sally log line.

**S7 — wire pitched-battle support by level (server). ✅ SHIPPED 2026-07-24 (branch
  `feat/garrison-resolve`).** At the decisive battle the garrison's support is now GRADUATED by
  level and delivered as S6 reinforcements, replacing slice 3's enemy-thinning.
  - **Graduated sally count:** `garrisonSallyTroops(resolve)` (`services/garrison.js`) →
    `GARRISON_SALLY_TROOPS[garrisonLevel]` = `{low:0, normal:40, determined:80}` (config; tunable).
    `garrisonSallies` (the determined-threshold boolean) is retained as a pure predicate but is no
    longer the battle trigger — normal now sends troops too.
  - **Fed into the BattleInput** (`routes/campaigns.js` battle route): a `>0` count becomes one
    `reinforcements: [{ tick: GARRISON_SALLY_TICK (4), team: 2 (BLUETEAM), count, unit_type:
    'Soldier', message: GARRISON_SALLY_BATTLE_MESSAGE }]` entry — the S6 casterless spell then
    storms the enemy's rear at that turn. The Karrowgate replay wording lives in `message` (config),
    keeping the engine fiction-free (per the S6 deviation).
  - **Interim slice-3 sally REMOVED:** the `campaign.enemy.army` ×`GARRISON_SALLY_FACTOR` scaling +
    `plannedPlacement` rebuild are gone (config const `GARRISON_SALLY_FACTOR` deleted); the enemy
    host is no longer pre-thinned — the reinforcements do their damage in the fight. The day-report
    sally log line is KEPT (gated on `sallied = count>0`), reworded off "the enemy host is thinned"
    to "its men storm the enemy's rear to fight at your side."
  - Tests: pure `garrisonSallyTroops` (augury.test.js, +3: determined/normal/low); the slice-3 route
    pair rewritten into 3 (campaigns.test.js: determined → larger wave + enemy untouched + sally
    narrated; normal → smaller wave; low → no reinforcements + no line). **Full cs-test 375/375
    green; C++ suite 347 green (unchanged).** NOT yet click-tested in a live browser.
  - **NEXT: S8** (scripted siege spine — 3 guaranteed `chained` beats seeded at creation) or **S9**
    (resolve-gated pool fates). Both are the content passes, deliberately last. Frontend still shows
    the garrison gauge (S5) but nothing surfaces the sally pre-battle — a "the garrison will sally"
    hint on the Deploy screen is possible polish, not required.

**S8 — scripted siege spine (server; the user's task 2). ✅ SHIPPED 2026-07-25 (branch
  `feat/garrison-resolve`).** Three GUARANTEED beats, seeded onto `campaign.scheduledEvents` at
  creation (`routes/campaigns.js`), each authored `chained: true` so it never enters a random
  augury draw — `drainScheduled` forces it into a slot on its day. All EARLY turns (before a
  meter-driven breach can plausibly land) so no clash with the walls gauge. The spine is the
  **garrison relationship's on-ramp** (fixes the flagged "resolve can stall at the wary start if
  `garrison_call` never draws"). Landed:
  - **The beats (all `chained: true` choice fates in `EVENT_POOL`, severity 2 so the schedule
    drain always finds a same-tier decoy; numbers inline + tunable, balance rough):**
    - **Turn 2 `siege_lines_close`** — `send_working_party` (`−1.5 t food` + `+15 resolve`, the
      guaranteed early lever) vs. `hold_stores` (`none`).
    - **Turn 5 `breach_threatens`** — `into_the_breach` (`−2 t food`, `Soldiers ×0.98`,
      `+15 resolve`) vs. `cannot_spare` (`−10 resolve` — the bond frays).
    - **Turn 8 `wardens_van`** — `pin_the_van` (`schedule relief_van_arrives`, delay 2) vs.
      `husband_strength` (`+2 t food`).
    - **`relief_van_arrives`** — `chained` follow-up, `+25 Soldiers` (mirrors `relief_column_arrives`).
  - **The schedule** is the exported `SIEGE_SPINE` const (`services/events.js`), seeded at creation
    as `scheduledEvents: SIEGE_SPINE.map(...)`. Rides the exact `chained`/`scheduledEvents`
    machinery an event chain uses — but guaranteed from turn 1 rather than a player choice. The
    creation-time day-1 draw never sees the queue (ctx has no `scheduledEvents`), so the beats
    surface only on their days.
  - **Schema `CAMPAIGN_SCHEMA_VERSION` 22→23** — no stored-shape change (`scheduledEvents` already
    exists), but bumped so fresh campaigns actually carry the spine (old docs are wiped, per the
    no-back-compat norm). NO frontend change — `scheduledEvents` is hidden state (not in
    `campaignView`), and the spine's choice beats render through the existing tent/choice UI like
    any other choice fate.
  - Tests: augury.test.js `siege spine (S8)` describe (+8 pure: schedule shape, each beat
    chained/choice/out-of-pool with a same-tier decoy, branch effects, follow-up, drain-on-day-2);
    campaigns.test.js `siege spine (S8)` route describe (seeded at creation; ending T1 drains the
    T2 beat, later two stay queued). Fixed the two pre-existing event-chains-part-2 tests to clear
    the now-seeded spine in their `setup` (test isolation). **Full cs-test 384/384 green locally
    (mongo cooperated this session); C++ unchanged.** NOT yet click-tested in a live browser.
  - **NEXT: S9** (resolve-gated pool fates — the last garrison-support content slice). Then the
    bigger opens: Stage E (hiring troops, design-only) and combat-score-per-hexside.

**S9 — resolve-gated pool fates (server; the user's task 1). ✅ SHIPPED 2026-07-25 (branch
  `feat/garrison-resolve`).** More garrison fates via the `requires` minResolve/maxResolve doors,
  so the pool feels like a relationship opening/closing doors. Additive (augury legibility tripwire
  holds on the unconditional base pool — every new fate carries `requires`). Gates aligned to the
  S5 level thresholds (`garrisonLevel`: low 1–33 / normal 34–66 / determined 67–100). Landed in
  `services/events.js` (`EVENT_POOL`), pure content — NO schema bump (adding gated pool fates +
  tweaking one gate value is no stored-shape change; an existing v23 doc draws them from the shared
  pool once its resolve qualifies):
  - **Determined (≥67) opens two trust-gifts:** `garrison_stores` (sev 1, `+2 t food` — a runner
    lowers the garrison's own stores over the wall) and `garrison_night_sally` (sev 3,
    `enemy_losses ×0.92` — the defenders sally on their own to maul the siege lines, distinct from
    the player-committed `garrison_sortie` raid).
  - **Low (≤33) opens the soured band:** `garrison_recovery` (sev 2 choice, valence neutral —
    `mend_the_bond` spends `−2 t food` for `+15 resolve`, or `turn_away` frays it `−10 resolve`),
    and the existing `garrison_spurned` gate was **realigned `maxResolve` 20→33** (the low-band
    ceiling) so the two soured fates share the whole low level. (`garrison_lookout` stays at its
    slice-1 `minResolve: 60` and the sortie gates stay raw 50/75 — deliberately not swept into the
    realign; only the S9 fates + their direct pair moved.)
  - Tests: augury.test.js `garrison resolve-gated pool fates (S9)` describe (+5 pure: determined
    gifts gated at the determined floor with eligibility flips at 66/67; the supplies food-boon +
    the autonomous enemy blow; the recovery choice's mend/turn-away branches gated to the low band
    with flips at 33/34; the realigned spurned pairing). **augury 118/118 green; full cs-test
    running (expected green — S9 is additive pool content, route tests keep resolve at the normal
    start where none of the new fates are eligible).** NOT yet click-tested in a live browser.
  - **The garrison-support epic (S5–S9) is now fully built.** Remaining garrison work is pure
    content authoring (more resolve-gated fates as desired) + the deferred themed/scripted
    siege-event flavor pass. **NEXT (bigger opens): Stage E (hiring troops, design-only — needs the
    `gold` resource + numbers decided) and combat-score-per-hexside.**
- **✅ DONE 2026-07-21 — remove `enemy.stance`/`battleOffer` entirely** (schema **v18→v19**,
  branch `cleanup/remove-enemy-stance`). The whole stance concept is gone: the `stance` field on
  `enemy` (model + creation route), `enemyView`'s `stance`/`battleOffer` keys (Blind now returns
  `{}`), the `enemyTurn`/`enemyAi.js` transition machine (now just supplies + forage plan), and the
  `ENEMY_KEYS_BY_BAND` `stance`/`battleOffer` entries in both server test files. The two
  behavior-carrying pieces were preserved, not dropped: (1) the near-annihilation **withdraw win**
  is now a direct `armyTotal < initialStrength × ENEMY_WITHDRAW_FRACTION` check in
  `dayResolution.js` step 6 (no longer routed through a `stance === 'withdrawing'` flag); (2) the
  `enemy_advance` event effect now sets `campaign.bossFightDue = true` (what `offering_battle` used
  to mean). The day-report enemy summary is `{ band, bossFightDue }` (was `{ stance, battleOffer }`);
  the frontend battle-offer gating already keyed off top-level `bossFightDue`, so `battleOffer` was
  pure redundancy. **Enemy-movement flavor re-derived from the meter band** (option A, user 2026-07-21):
  `App.jsx`'s council line + `EventRevealScreen`'s `EnemyBeat` narrate from `meter.band` +
  `bossFightDue` (calm→camp, restless→shadowing, imminent→massing, bossFightDue→offers battle).
  **⚑ FLAGGED FOR PLAYTEST** (user: "I don't completely understand it… we'll see how it works"):
  the band→prose mapping is a first pass — revisit once the meter's pacing is felt in play.
  Verified: frontend vitest **235/235** + oxlint clean; server tests updated (`enemyAi`/`campaigns`/
  `augury`, incl. a new `enemy_advance`→`bossFightDue` applyEffect case) — **CI green on `main`
  `8737ea1`** (local `cs-test` is unreliable here — sandbox-mongo flake — so CI is the gate). NB:
  this removes the last "stance still EXISTS" caveat the recon R2 handoff flagged (`METER_BANDS`
  comment updated).
- **Visibility:** hidden by default, shown only as a banded phrase (mirrors
  `ENEMY_STRENGTH_BANDS`/`ENEMY_SUPPLY_BANDS` — e.g. calm / restless / imminent). The exact
  number can be bought: spending **leftover scouting points, just before they expire/refresh at
  turn start** (see "Raid mini-game (scouting-points economy)" below — `raid.scoutingPoints` is
  an army-derived per-turn pool that already expires unused), reveals the exact value. Small
  value ("better than just wasting points") rather than a dedicated new spend — reuses the
  existing scouting-points economy instead of adding a new currency for this alone.

**2. Before the meter is full: no voluntary full-army battle exists.** The current
`POST /:id/battles` (always full-army, always available once/day) is gone as a standing option
pre-threshold. The only ways to fight the enemy before the boss fight are raids (partial forces,
`POST /:id/raids/launch`) and forage clashes (`forage.js`) — this is what makes the loop read as
build-up to ONE fight rather than a battle every day.

**3. When the meter crosses 1000** (checked at the same end-of-day point it's incremented),
`campaign.bossFightDue` flips true. **The boss fight is due the NEXT day, not that instant** —
preserves the deliberate-formation moment (Prepare→Omens→Raids→Deploy, unchanged screens).
- **Raiding, foraging, and events are all still allowed** on the boss-fight day — the user was
  explicit: don't lock the screens out. **Correction after reading the actual route** (was
  slightly wrong above): `campaigns.js:285-293`'s "whole army must take the field" check
  ALREADY carves foragers out of `inCamp` (`n − forage.assignment − placed`) — it just never
  learned about `raid.assignment`, so a raided unit both dodges the check AND can be
  double-placed into the battle in the same day (the exact bug the old backlog TODO named). The
  400 itself doesn't go away: idle camp troops must still fight (that's the whole point of the
  tradeoff). The fix is narrower — add `raid.assignment` as a carve-out term everywhere
  `forage.assignment` already is: the per-type placement budget (~line 263) and the `inCamp` sum
  (~line 289), mirroring forage exactly. A greedy raid on boss day is then a real, informed risk:
  fewer troops on the field for the fight that decides the campaign, but idle troops can't skip it.
- Ending the boss-fight day now requires the battle to actually have been fought
  (`battleFoughtToday`) — End Turn is gated the same way other actions already 400 on
  preconditions elsewhere in `campaigns.js`.

**4. The boss fight is decisive both ways — new explicit win/loss check, not `checkAnnihilation`:**
- **Winner `blue`** (engine result) → campaign **victory immediately**, regardless of
  `red_survivors` count. No longer needs `enemy.army` to hit exactly 0.
- **Winner `red` or stalemate** → campaign **defeat immediately**, regardless of player
  survivors. This is what actually makes it "decisive" — losing has a real, final consequence
  distinct from ordinary battle casualties.
- Both reuse the existing Victory!/Defeat game-over screens (already built, see the 2026-07-18
  tutorial-pass entry) — just a new trigger into the same end state.

**5. `enemy.stance` gets rewired to be driven BY the meter**, not the independent
`ENEMY_WITHDRAW_FRACTION`/`ENEMY_OFFER_EVERY`/`ENEMY_LOW_SUPPLIES` thresholds in `enemyAi.js`
today (those don't gate anything currently — pure flavor text that could contradict the real
mechanic once one exists). New mapping: `offering_battle` ⟺ `bossFightDue`; `camp`/`shadowing`
reflect the meter's fraction toward 1000 (low/mid); `withdrawing` is kept for the existing
near-annihilation case (`size < initialStrength × ENEMY_WITHDRAW_FRACTION`), which stays
orthogonal to the meter. One coherent signal instead of two systems that could disagree.

**6. Raid rework — `destroy_detachment` only, other types untouched.** Today it's all-or-nothing:
`sliceTargetForce` builds a hidden slice of `enemy.army`, a real mini-battle is fought against
it, but the ACTUAL casualties (`summary.red_survivors`) are thrown away — only a full win
subtracts the whole slice (`applyRaidReward`), a loss touches nothing. Fix: **every
`destroy_detachment` raid applies its real battle casualties to `enemy.army`, win or lose** —
`enemy.army -= (targetForce − red_survivors)`. On a **win**, additionally wipe whatever's left
(pursuit of the routing remainder) and grant a **prestige stub** (unimplemented value — reuses
the existing unwired `_prestige` placeholder on squads, see the test-quality-audit note and the
`[[todo-squads-persistent-unit]]` backlog entry below). Explicitly scoped narrow: `loot_supplies`/
`rescue_troops`/`counter_event` stay reward-on-win-only, no casualty tracking — their target
forces are narrative dressing, not tracked attrition.

**7. Hiring troops — planned in full, implementation explicitly DEFERRED to a later stage.**
- Converts idle `workers` (the existing, currently-unwired labour pool, `STARTING_WORKERS` in
  `campaignConfig.js`) into roster troops.
- Cost: **materials** (existing resource) + a **new `gold` resource** (to be added to the
  economy — earn sources TBD, likely raid/event rewards) + **horses** for mounted unit types
  (at minimum; exact resource shape TBD).
- Also supports recruiting a **new unit/squad slot** that then absorbs already-idle, unassigned
  roster troops rather than requiring fresh bodies — this is the same shape as the
  squads-absorbing-replacements idea in the `[[todo-squads-persistent-unit]]` backlog entry
  below; the two should be designed together when this stage is picked up, not independently.
- No numbers, caps, or UI decided — this is a placeholder stage, captured so the loop reads as
  complete, not a spec to build from yet.

**Scope boundary (user, explicit):** "we will start with A [single boss fight ends the run,
win or lose] and work towards B [win → new chapter: fresh persistent enemy, meter resets, loop
repeats] eventually but not in this refactor." Build for A; don't foreclose B, but don't design
it now.

**Suggested implementation staging** (one thing at a time, per user preference — order is a
recommendation, not fixed):
- **Stage A — meter core.** Schema field(s) + `CAMPAIGN_SCHEMA_VERSION` bump, the fill formula,
  threshold check, `bossFightDue` flag, `enemy.stance` rewire, banded view exposure. No battle
  behavior change yet — a landable, testable slice on its own.
- **Stage B — gate the battle.** Gate `POST /:id/battles` on `bossFightDue` (no battle exists
  before it); add `raid.assignment` as a carve-out term alongside the existing
  `forage.assignment` one in the battle route's budget/`inCamp` checks (see the correction
  above). **Resolved:** once Stage B1 lands, `POST /:id/battles` is ALWAYS the boss fight (there
  is no other kind left) — so its existing `checkAnnihilation(campaign)` call
  (`campaigns.js:338`) is replaced outright by the new decisive winner===blue⇒won /
  else⇒lost check, unconditionally. `checkAnnihilation` itself is untouched and keeps running
  everywhere else it does today (forage clashes, raid launches, augury accept) — that's the
  pre-boss ambient path (e.g. the enemy raided down to 0 before the meter ever fills). Also wire
  the mandatory boss-fight day: End Turn 400s while `bossFightDue && !battleFoughtToday`
  (same shape as the existing `rejectIfChoicePending` gate).
- **Stage C — meter reveal.** Spend-leftover-scouting-points action, wired to the existing
  `raid.scoutingPoints` pool/expiry.
- **Stage D — `destroy_detachment` raid rework.** Casualty-proportional on loss, pursuit + a
  prestige stub on win.
- **Stage E — hiring troops.** DESIGN LOCKED 2026-08-02 — see "Recruit phase — hiring troops"
  below (a new turn phase, not a spend action; supersedes the "deferred piece above" description).
  Not yet implemented. No longer waiting on workers-eating-food (resolved as non-blocking during
  grilling — see that section's status note).

#### TDD implementation breakdown (2026-07-20) — Stages A–D, one commit-sized step at a time

Per [[feedback_tdd]] (standing preference: tests alongside the behavior change, not after) and
the "no mock theater" convention this codebase already follows — campaign-server tests hit real
HTTP routes + a real in-memory Mongo (`mongodb-memory-server`, `tests/helpers/db.js`), so every
step below is a route/service-level red test, not a unit mock. `tests/campaigns.test.js` is
where almost all of this lands (it already has per-route `describe` blocks); a new
`describe('boss-fight meter', ...)` block holds the Stage A/B-specific cases. Stage E has no
steps yet — still design-only, picked up later.

**Stage A — meter core (no player-facing behavior change to battles; safe standalone commit)**
1. **Schema + config.** `models/campaign.js`: add `meter: { value: {type:Number, default:0},
   revealed: {type:Boolean, default:false} }` and `bossFightDue: {type:Boolean, default:false}`;
   bump `CAMPAIGN_SCHEMA_VERSION` 13→14 with a one-line comment. `utils/campaignConfig.js`: add
   `BOSS_FIGHT_METER_THRESHOLD = 1000`, `BOSS_FIGHT_METER_FLOOR = 50`,
   `BOSS_FIGHT_METER_CEILING = 100`, and a `METER_BANDS` table (same `{min, label}` shape as
   `ENEMY_STRENGTH_BANDS`, e.g. calm/restless/imminent). Mechanical — the existing generic
   "campaign schema versioning" tests (`campaigns.test.js:480`) already cover any version bump
   with no new case needed; no red test for this step itself, it just unblocks the next ones.
2. **RED→GREEN: fill formula.** New `meterFillAmount(campaign)` (pure function — new
   `services/meter.js`, or alongside `armyTotal` in `enemyAi.js`) computing
   `troopsInCamp = rosterTotal(roster) − rosterTotal(forage.assignment) − rosterTotal(raid.assignment)`
   and `BOSS_FIGHT_METER_CEILING − BOSS_FIGHT_METER_FLOOR × (troopsInCamp / rosterTotal(roster))`,
   floored at `BOSS_FIGHT_METER_FLOOR`. Test first: call it directly (it's a pure function, no
   route needed) with a few roster/forage/raid combinations — all-idle → 50, none-idle → 100,
   half → 75. Then wire it into `dayResolution.js` end-day BEFORE step 7 clears
   `forage.assignment`/`raid.assignment` (their pre-clear values are the formula's input) —
   natural home is right alongside step 4's `enemyTurn` call, since both read the same
   pre-reset state. Route-level test: `POST /:id/end-day` on a fresh campaign, assert
   `campaign.meter.value` (read via `Campaign.findById` in the test, same pattern the schema
   tests use) increased by the expected amount.
3. **RED→GREEN: threshold → `bossFightDue`.** Test: drive `meter.value` to just under 1000 via
   repeated `end-day` calls (or seed it directly with a raw Mongo update, matching the
   `makeLegacy`-style raw-driver pattern already used for schema tests, to avoid a slow multi-turn
   loop), then one more end-day crosses 1000 → assert `bossFightDue === true` in the next
   `campaignView`. Implementation: the threshold check runs right after the fill, same step.
4. **RED→GREEN: `enemy.stance` rewire.** First **read `tests/enemyAi.test.js`** — it very likely
   pins the OLD `ENEMY_OFFER_EVERY`/`ENEMY_LOW_SUPPLIES` transitions being replaced; those cases
   need rewriting, not just addition. New behavior: `stance === 'offering_battle' ⟺ bossFightDue`;
   `withdrawing` unchanged (still the independent near-annihilation fraction check); `camp`/
   `shadowing` now reflect the meter's fraction toward 1000 instead of `ENEMY_SHADOW_DAY`. Delete
   `ENEMY_OFFER_EVERY`/`ENEMY_LOW_SUPPLIES` from `campaignConfig.js` once nothing reads them.
5. **RED→GREEN: banded view exposure.** `campaignView.js`'s `enemyView` (or a new top-level
   `meter` key — `battleOffer` already exists off `stance`, a raw `meter.value` should never
   reach the client) gains a banded phrase from `METER_BANDS`, `revealed:false`. Test: extend
   whatever hidden-info discipline test already pins the campaign response's key set (grep
   `campaigns.test.js`/`raid.test.js` for `expectNoHiddenInfo` or similar) to assert
   `meter.value`/raw number never appears pre-reveal, only the band phrase.

#### Stage A (meter core) ✅ SHIPPED 2026-07-20 — handoff (uncommitted at write time)

All five steps above landed as described, plus the HUD convenience bullet below (done same
session, not deferred). campaign-server's raid scouting mini-game Stage 3 (`556335e`) was
confirmed already committed first, satisfying the "once committed" prerequisite noted earlier
in this file.

- **Schema/config** (`models/campaign.js`, schema v13→**14**): `campaign.meter = {value, revealed}`,
  `campaign.bossFightDue`. `utils/campaignConfig.js`: `BOSS_FIGHT_METER_THRESHOLD=1000`,
  `_FLOOR=50`, `_CEILING=100`, and `METER_BANDS` (`calm` <334, `restless` <667, `imminent` ≥667 —
  thirds of the threshold, not user-specified exactly, just a reasonable split of the example
  band names from the design). `ENEMY_SHADOW_DAY`/`ENEMY_OFFER_EVERY`/`ENEMY_LOW_SUPPLIES`
  deleted (nothing reads them anymore); `ENEMY_WITHDRAW_FRACTION` stays, independent of the meter.
- **New `services/meter.js`**: `meterFillAmount(campaign)` (pure — `CEILING − FLOOR ×
  (troopsInCamp/totalRoster)`, floored at `FLOOR`, guarded against a 0-roster divide) and
  `meterBand(value)` (the same descending-table lookup convention `campaignView`'s local
  `bandLabel` already uses, exported so `enemyAi.js` and `campaignView.js` share ONE band
  decision instead of two that could disagree — the design's explicit goal).
- **`dayResolution.js`**: meter fill + threshold check now run at step 4, BEFORE `enemyTurn` (so
  stance reads the fresh `bossFightDue`/value) and BEFORE step 7 clears `forage.assignment`/
  `raid.assignment` (the fill formula's input). Pipeline docstring updated.
- **`enemyAi.js` stance rewire**: `withdrawing` check unchanged (first, independent);
  `bossFightDue` ⇒ `offering_battle`; else `meterBand(meter.value) === 'calm'` ⇒ `camp`, else
  ⇒ `shadowing`. `tests/enemyAi.test.js`'s old "battle offer" + "stance cadence" describe blocks
  (pinned to the deleted supply/calendar thresholds) were rewritten wholesale into one "the
  boss-fight meter drives stance" block using a new `pinMeter(id, value)` raw-doc helper (same
  convention as the existing `pinEnemy`) — idle-army floor-fill, calm→camp/restless→shadowing,
  and crossing 1000 sets `bossFightDue` + offers battle same day. The supply-depletion and
  withdraw-threshold blocks needed NO changes (their arithmetic/priority was untouched by the
  rewire) — confirmed by reasoning through the meter math, not by a full suite run (see below).
- **`campaignView.js`**: new top-level `meter: {band, revealed, value}` (`value` null pre-reveal)
  and `bossFightDue` (own info — it's what unlocks Stage B's battle, not a secret). Both
  `campaigns.test.js` and `enemyAi.test.js`'s `expectNoHiddenInfo` extended to pin the meter's
  key set and that `value` stays null pre-reveal.
- **HUD convenience** (done this session per the note below, not deferred): `CampaignHUD.jsx`
  gained `hud-meter` (band, or exact value once revealed) and `hud-scouting`
  (`raid.scoutingPoints`, floored) spans; `__tests__/fixtures/campaign.js` gained matching
  `meter`/`bossFightDue`/`raid.scoutingPoints`/`raid.scoutCost` fields; new
  `campaignHud.test.jsx` (3 tests, direct-render pattern like `auguryLabel.test.jsx` — no full
  `App` mount needed).
- **Verification status:** `enemyAi.test.js` alone: **6/6 green**. Full frontend suite: **228/228
  green**. The full `campaign-server` suite (`cs-test` with no file filter) was NOT completed
  locally this session — this sandboxed shell's `mongodb-memory-server` instance died mid-run
  (`ECONNREFUSED`) under the same Flatpak/VS-Code resource contention
  [[reference_laptop_mongo_tests]] already describes, and a second attempt on `campaigns.test.js`
  alone also stalled. User call: skip the full local run, since GitHub CI runs the suite anyway.
  **Whoever picks this up next: run `bash scripts/dev.sh cs-test` for real green/red on
  `campaigns.test.js`/`enemyAi.test.js` before trusting this stage further**, or check CI on the
  branch/PR that carries this commit.
- **`scripts/dev.sh`**: the Flatpak-sandbox branch (already gating `MONGOMS_DISTRO`/
  `--no-file-parallelism`) now also widens vitest's hook/test timeout to 60s
  (`--hookTimeout=60000 --testTimeout=60000`) — the default 10s was tripping on contention alone
  even where the run would otherwise have passed (confirmed: `enemyAi.test.js` alone hit this
  exact timeout once, then passed clean on retry with the wider window).

**Stage B — gate the battle (the real behavior change; expect to touch existing battle tests)**
1. **RED→GREEN: gate on `bossFightDue`.** `routes/campaigns.js` `POST /:id/battles`: add
   `if (!campaign.bossFightDue) return res.status(400).json({error: '...'})` near the top
   (alongside the existing `battleFoughtToday`/`status` guards). This BREAKS every existing test
   in the `'POST /api/campaigns/:id/battles'` describe block (`campaigns.test.js:747`) — they all
   currently fight on a fresh campaign where `bossFightDue` is false. Add a small test helper
   (`tests/helpers/` or a local fixture in that describe block) that force-sets
   `bossFightDue: true` via a raw Mongo update (same pattern as `makeLegacy`), and thread it
   through every existing case's setup — this is the "red" step: run the suite, watch everything
   in that block fail on the new 400, then fix each one. Add one new case: battle attempted with
   `bossFightDue: false` → 400.
2. **RED→GREEN: raid carve-out parity.** Add `− (campaign.raid.assignment.get(type) ?? 0)` next
   to the existing `− foraging` term in both the per-type budget check (~line 263) and the
   `inCamp` sum (~line 289) — mirrors `forage.assignment` exactly, no new concept. Test: a unit
   sent on a raid earlier the same day (`raid.assignment` populated) — (a) can no longer also be
   placed into the boss battle beyond what's left in camp (400 if over-committed), and (b) does
   NOT count toward `inCamp` (battle succeeds without that unit placed). Both cases need
   `bossFightDue: true` from step 1's helper.
3. **RED→GREEN: decisive win/loss.** Replace the battle route's `checkAnnihilation(campaign)`
   call (`campaigns.js:338`) with the new unconditional check: `summary.winner === 'blue'` →
   `campaign.status = 'won'`; otherwise → `campaign.status = 'lost'`; clear `bossFightDue` either
   way. Test: engine result `winner: 'blue'` with nonzero `red_survivors` still ends in `'won'`
   (today's `checkAnnihilation` would NOT trigger here since the enemy isn't at 0 — that's the
   behavior actually changing); `winner: 'red'`/stalemate with nonzero `blue_survivors` still
   ends in `'lost'`. **Verified seam to reuse:** `campaigns.test.js` already `vi.mock`s
   `services/engine.js` (the real trust boundary — the `./game battle` subprocess) and sets
   `engine.runBattle.mockResolvedValue(structuredClone(battleResultFixture))` per test, so a
   losing-boss-fight test just clones the fixture and overwrites `winner`/`red_survivors`/
   `blue_survivors` before mocking — no new seam needed.
4. **RED→GREEN: mandatory End Turn gate.** `POST /:id/end-day`: 400 when
   `campaign.bossFightDue && !campaign.battleFoughtToday` (new guard function alongside
   `rejectIfChoicePending`, same shape/style). Test: end-day attempted on a boss-fight-due,
   not-yet-fought day → 400; after the battle resolves (win or lose) `campaign.status !== 'active'`
   already blocks end-day via the existing guard, so no separate "post-battle" case is needed
   there. Regression test: forage assignment and raid launch still succeed normally on a
   boss-fight-due day before the battle is fought (proves the screens aren't locked out, per the
   user's explicit requirement).

#### Stage B (gate the battle) ✅ SHIPPED 2026-07-20 — handoff

Server-only, exactly as the four steps above. One file of behavior change
(`routes/campaigns.js`) + its test file (`tests/campaigns.test.js`); no frontend, model, or
config change. `campaigns.test.js` **87/87 green** (run by the user on their own box — the
sandbox mongo flake in [[reference_laptop_mongo_tests]] makes local `cs-test` unreliable here, so
tests are handed to the user; CI runs the full suite anyway).

- **B1 — gate.** `POST /:id/battles` 400s (`no battle is offered — the enemy is not yet ready to
  fight`) unless `campaign.bossFightDue`, placed right after the `battleFoughtToday` guard so it
  fires before any placement validation. Since post-Stage-A `enemy.stance === 'offering_battle'
  ⟺ bossFightDue` and the frontend already gates its battle warning on `enemy.battleOffer`, the
  client was already consistent — B1 is server-side enforcement (defense in depth).
- **B2 — raid carve-out.** Both the per-type budget check AND the whole-army `inCamp` sum now
  subtract `campaign.raid.assignment.get(type)` alongside the existing `forage.assignment` term —
  mirrors forage exactly. The "not enough" message composes `N out foraging`/`M out raiding`
  parts (keeps the old `/out foraging/` assertion matching while adding raiding). This is the fix
  for the old double-place bug: a unit sent raiding earlier the same day can no longer also be
  fielded, and doesn't count as "still in camp".
- **B3 — decisive win/loss.** The battle route's old `...checkAnnihilation(campaign)` log spread
  is REPLACED by: `campaign.bossFightDue = false; const won = summary.winner === 'blue';
  campaign.status = won ? 'won' : 'lost'` + a decisive log line. So a blue win takes the country
  even with enemy survivors, and a red/stalemate loses even with surviving player troops —
  regardless of counts. `checkAnnihilation` is untouched and still imported/called on the ambient
  paths (raid launch `campaigns.js`, choices, forage clashes in `dayResolution.js`).
- **B4 — mandatory End Turn.** New `rejectIfBossFightUnfought(campaign, res)` guard (same
  shape/style as `rejectIfChoicePending`); `POST /:id/end-day` calls it after the choice-pending
  guard. 400s (`the enemy offers battle — you must take the field before the day can end`) while
  `bossFightDue && !battleFoughtToday`. Post-battle the campaign is `won`/`lost`, so the existing
  `status !== 'active'` guard covers "can't end after the fight" with no extra case.
- **Tests added:** the gate-400 case; two raid carve-out cases (over-commit → 400 `/out raiding/`;
  raided unit carved out of `inCamp` → 201); two decisive cases (blue win w/ enemy survivors →
  `won`; red win w/ player survivors → `lost`); two End-Turn cases (due+unfought → 400; "screens
  not locked out" regression: forage + augury consult still 200 on a boss day while End Turn
  400s). `bossFightDue` was threaded through every existing battle case (folded into
  `shrinkRoster`/`setSquads`, a `dueBossFight` raw-update helper for the `createCampaign`-only
  cases, and the forage-block battle test).
- **Frontend follow-up ✅ DONE 2026-07-21** (see the "frontend wiring (pitched battle)" SHIPPED
  entry near the top of this file): Fight! is now hidden until `bossFightDue`, the mandatory
  boss-day state is surfaced (Council/Raids/Deploy warnings + End-Turn withheld), and the decisive
  win/loss routes into the existing Victory!/Defeat screens (via the generic `status` game-over
  check — no new work). The e2e (`campaign-loop.spec.js`) stays green because it reaches Deploy and
  ends the turn WITHOUT clicking Fight! on a non-boss day (End Turn is still shown on quiet days).

**Stage C — meter reveal via leftover scouting points**
1. **RED→GREEN.** Extend the existing `POST /:id/raids/scout` action dispatch
   (`{action:'add_target'|'reveal'}`) with a third action, e.g. `{action:'reveal_meter'}`
   (no `raidId`/`field` needed) — reuses the one route instead of adding a new endpoint. New
   config constant for its cost (e.g. `METER_REVEAL_SCOUT_COST`). Test: insufficient
   `raid.scoutingPoints` → 400 (matches the existing `add_target`/`reveal` insufficient-points
   tests' shape); sufficient → `meter.revealed = true`, points deducted by the cost, and
   `campaignView` now returns the exact `meter.value` instead of the band. Reset test:
   `meter.revealed` is cleared at the next end-day's step 7 (new turn), alongside
   `raid.scoutingPoints` refilling — one assertion added to whatever test already checks turn-reset
   fields (forage.assignment clearing etc., likely in the end-day describe block).

#### Stage C (meter reveal) ✅ SHIPPED 2026-07-20 — handoff

Server-only, exactly the one step above. `tests/raid.test.js` **40/40 green** (user ran it).

- **Config:** `METER_REVEAL_SCOUT_COST = 5` in `campaignConfig.js` (cheap by design — leftover-points
  spend; rough balance, tunable).
- **Route:** `POST /:id/raids/scout` gains a third action `{action:'reveal_meter'}` (no
  `raidId`/`field`). Order: already-revealed → 400 (`the meter is already revealed`, don't burn
  points twice); insufficient points → 400; else `meter.revealed = true`, deduct the cost. The
  fallthrough message now lists all three actions. `campaignView`'s `meter.value` (Stage A) already
  returns the exact value once `revealed`, so NO view change was needed.
- **Turn reset:** `dayResolution.js` step 7 now clears `campaign.meter.revealed = false` alongside
  the `scoutingPoints` refill — the reveal lasts exactly the turn it was bought.
- **Tests** (in the existing scout `describe` block, mirroring the `add_target`/`reveal` cases):
  reveal pins the exact value (band-only + `value:null` before, `value:500` after); insufficient
  points → 400 unspent + still hidden; refuse-to-rebuy once revealed → 400 unspent; reveal lapses
  at the next end-day (`revealed` false again, `value` null on the wire).
- **Frontend follow-up (NOT done — flag):** no button yet triggers `reveal_meter`. The HUD already
  SHOWS the exact value once `meter.revealed` (Stage A `hud-meter`), but the player can't yet spend
  points to flip it — needs a spend button (likely on the Raids screen) via `api.js` + a store
  action. Same server-first pattern as Stage B's unwired Fight! button.

**Stage D — `destroy_detachment` raid rework**
1. **RED→GREEN: casualties on loss.** `routes/campaigns.js` raids/launch loop: after
   `runAndPersistBattle`, for `opportunity.type === 'destroy_detachment'`, always subtract
   `(opportunity.targetForce − summary.red_survivors)` from `campaign.enemy.army` (per-type,
   floor 0 — same `Math.max(0, ...)` pattern `raid.js:225` already uses), regardless of `won`.
   Test: a LOST destroy_detachment raid (engine `winner !== 'blue'`, but `red_survivors` still
   less than `targetForce` — the mini-battle isn't a total whitewash) → assert `enemy.army`
   dropped by exactly the real casualty count, even though `applyRaidReward` never ran (no
   reward-on-win log lines).
2. **RED→GREEN: pursuit + prestige stub on win.** Change `applyRaidReward`'s `destroy_detachment`
   branch (`raid.js:222-226`) to subtract only the REMAINING `red_survivors` (not the whole
   `targetForce` — step 1 already accounted for the real casualties, this would double-subtract
   otherwise), plus a prestige-stub log line (no real mechanic yet — e.g. `'A prestigious victory
   (not yet tracked).'` or similar, explicitly a placeholder). Test: a WON destroy_detachment raid
   with nonzero `red_survivors` → `enemy.army` ends at exactly `targetForce`'s original count
   fully removed (step-1 casualties + step-2 remainder = the whole slice), matching today's
   all-or-nothing win outcome numerically, but now reachable via two additive steps instead of one.
   Other raid types (`loot_supplies`/`rescue_troops`/`counter_event`) get NO new test — explicitly
   untouched.

#### Stage D (destroy_detachment rework) ✅ SHIPPED 2026-07-20 — handoff

Both steps exactly as above; `tests/raid.test.js` green (user-run).

- **Route** (`routes/campaigns.js` raids/launch loop): after `runAndPersistBattle`, for
  `destroy_detachment` ONLY, always subtract `targetForce − red_survivors` per type from
  `campaign.enemy.army` (floored at 0), win or lose — the real casualties the mini-battle inflicted.
  The stale "a lost raid leaves the host untouched" comment was rewritten. Other raid types still
  never pre-subtract their (narrative) target force, so a lost loot/rescue/counter raid leaves the
  host untouched as before.
- **Service** (`services/raid.js`): `applyRaidReward(campaign, opportunity, redSurvivors = {})`
  gained a third arg. Its `destroy_detachment` branch now subtracts only the surviving remainder
  (`redSurvivors`) — the route already booked the casualties, so this avoids double-counting; the
  two together remove the whole slice on a win. Added a prestige-stub log line ("A prestigious
  victory … prestige not yet tracked") — explicitly a placeholder for the Stage E prestige mechanic.
- **Tests** (in the launch `describe`): a LOST raid drops the host by exactly the real casualties
  with NO reward/prestige log lines; a WON raid with nonzero survivors removes the whole
  `targetForce` (casualties + pursued remainder) and logs the prestige stub. The pre-existing
  "a win subtracts the target force" test still passes unchanged (fixture `red_survivors: {}` →
  step 1 removes the full slice, step 2 removes nothing).
- **Recon interaction to test when recon lands (user, 2026-07-20 — "delicate, add good coverage"):**
  a `destroy_detachment` raid shrinks `enemy.army`, so the recon enemy-count bracket
  (`currentTrue + {floor,ceil}Offset`) must shift the PERCEIVED size DOWN by exactly the casualties
  — same width, floor clamped ≥ 0, no accuracy gained or leaked. Explicit test required in the
  recon work: raid kills N → perceived `[low,high]` both drop by N (not narrower, not wider).

### Recruit phase — hiring troops (redesign, grilled + locked 2026-08-02) — Stage E

> Stage E was left as a design-only placeholder when Stages A–D + the garrison epic shipped (see
> the "Stage E — hiring troops" stub above). Grilled end-to-end with the user (2026-08-02) before
> writing anything down, per the `grilling` skill rule in `CLAUDE.md`. This SUPERSEDES the old
> placeholder bullet ("converts idle workers into roster troops… no numbers, caps, or UI decided")
> with a full mechanic. **S1 (pool + core mechanics, pure service layer) SHIPPED 2026-08-02**, **S2
> (route + day-offer generation + campaignView exposure, server-only) SHIPPED 2026-08-02**, **S3
> (frontend Recruit phase screen) SHIPPED 2026-08-03**, **S4 (old militia-purchase mechanic
> removed) SHIPPED 2026-08-03**, **S5 (raid gold rewards) SHIPPED 2026-08-03**, **S6 (garrison gold
> event) SHIPPED 2026-08-03**, **S7 (horses' earn source) SHIPPED 2026-08-03 — STAGE E IS
> COMPLETE** — see the handoffs
> below. Staged like every
> other feature in
> this doc (build one piece at a time, one commit-sized step per session). NOT blocked on the
> worker-eating-food/
> replenishment pairing (see that backlog entry) —
> Recruit's worker draw is the same permanent-drain shape the already-shipped Militia purchase
> already has, just generalized to more unit types. It DOES drain `workers` faster, which raises
> (doesn't gate) the priority of eventually deciding replenishment.

**Framing:** a new turn phase, **Recruit**, inserted into the existing screen sequence:
`Prepare → Omens → Raids → Recruit → Deploy` (was `Prepare → Omens → Raids → Deploy`). Placed
*after* Raids deliberately — raids resolve synchronously when launched (`applyRaidReward` runs
inside `POST /:id/raids/launch`, not at end-of-day), so gold earned from a raid is spendable the
same turn, giving "raid for gold, then hire" a real same-turn payoff.

**Replaces, not adds:** the existing ad-hoc Militia-purchase mechanic (`CampPanel`'s quantity
slider, `MILITIA_FOOD_COST`/`MILITIA_MATERIAL_COST`/`MILITIA_WORKER_COST`/`MILITIA_DAILY_CAP`,
the militia branch of `POST /:id/spend`) is removed and folded in as the base tier of this system,
rather than living alongside it as a second "buy troops" mechanic.

**Cadence — one hire per day, and it is mandatory.** The phase offers 2 options drawn from the
pool of entries that are currently both *eligible* (prerequisites met) and *affordable*, picked
at random; the player hires one, and that hire is the only thing that resolves the phase. Short
draws are padded with the free **Travellers** card (see below), so the offer is never empty and
never a single take-it-or-leave-it card — which is what lets the hire be mandatory.

> **Revised in S8 (grilled 2026-08-03).** The original design here said the offer was drawn
> ahead of time and that "if nothing is affordable, no choice is shown" — a small free-Militia
> grant fired automatically instead, and the player could skip. All three are gone. The draw
> happens when the phase is *opened*; the free grant became a card you hire; skipping is
> removed. See the S8 slice for why.

**Two lanes in one pool:**
- **Troop lane** — batch/count hires, paid out of the `workers` pool (like Militia purchase today)
  plus food/materials, gated by a prerequisite chain reusing the existing presence-only `hasUnit`
  gate shape (`requires: { hasUnit: 'X' }`, already used by `horse_sickness` in `EVENT_POOL` —
  "own ≥1 of type X," not a minimum count):
  - **Militia** — base tier, no gate.
  - **Soldier**, **Archer** — gated on `hasUnit: 'Militia'`.
  - **Cavalry**, **LightCavalry** — gated on `hasUnit: 'Soldier'`, and additionally COST the new
    `horses` resource (a real spend, not just a gate — see below).
- **Caster lane** — individual (count-1) hires, no tier-presence gate, paid mainly in the new
  `gold` resource: **Mage**, **Priest**.
- Mage/Priest/all 7 `STARTING_ROSTER` types are in scope for v1 — the "smaller subset" that came
  out of grilling ended up being "the full troop tier chain, plus casters as their own simpler
  gold-gated lane," not deferring casters to a later pass.

**New resource — `gold`.** Earned via:
- **Raid rewards (v1)** — a new reward on `destroy_detachment`/`loot_supplies` wins, alongside
  their existing materials/prestige rewards, scaled by raid difficulty. Slots into the existing
  `applyRaidReward` pipeline; no new subsystem.
- **Garrison, as later additive content (not v1-blocking)** — thematically, the besieged garrison
  sits on coin it can't spend inside the walls. A new `requires: { minResolve: 67 }` fate
  (determined band), same shape as the existing `garrison_stores`/`garrison_night_sally` S9 fates.
- Event-granted gold in general (random windfalls, like materials/food events today) can be added
  later the same way; not designed now.

**New resource — `horses`.** Consumed (spent, not just gated on) by Cavalry/LightCavalry hires.
Earn source **decided + shipped in S7** (grilled 2026-08-03): the `seize_horses` raid card ("The
Horse Drove") plus a `horses` effect type whose first use is a new third branch on "A Captured
Herd". Neither is guaranteed — the cavalry lane is optional by design. See the S7 handoff below.

**Recruiting Fervor** — new plain-integer campaign stat (name locked; code identifier TBD, e.g.
`campaign.recruitingFervor`). Starts at **0**. **Uncapped in both directions** — can go negative
(events souring recruitment) and can exceed 100 (guaranteed boosts), unlike the banded
Garrison Resolve model this deliberately does NOT reuse. **1:1 with the percent chance** that a
day's Recruit offer is "boosted": the raw value IS the percent (clamped to 0–100 for the actual
roll only — the stored value itself isn't clamped). **≤0 means never boosted.** Chosen over a
banded (low/normal/high) model specifically because the user wants every point of change to be
visibly meaningful, not clumped behind invisible thresholds — Fervor moves rarely and by
meaningful amounts, so 1:1 legibility matters more than compressing it into tiers.
- **Troop-lane boost:** if affordable, double the count at double the cost; if not affordable,
  same count at a discount (discount % TBD).
- **Caster-lane boost:** if affordable, a bonus SECOND individual hire of a different caster type
  in the same draw (e.g. a Mage-hire draw boosts into "hire a Mage AND a Priest"); if not
  affordable, same discount-fallback pattern as the troop lane.
- **Events that move Fervor** are additive content, added incrementally (same pattern as the S9
  resolve-gated fates) — not an exhaustive list yet, just the mechanism.

**Deferred to implementation (numbers, not structure):** exact food/materials/gold/horses costs
per tier and unit type; the double-vs-discount ratio; the free-Militia fallback amount; the
2-option selection algorithm; horses' earn source; the initial roster of Fervor-moving events.

**S1 — pool + core mechanics (pure service layer, no routes/frontend). ✅ SHIPPED 2026-08-02.**
The "deferred to implementation" numbers above are now picked (all tunable, balance rough, same
convention as every other stage in this doc):
- **Schema (`CAMPAIGN_SCHEMA_VERSION` 23→24):** `resources.gold`/`resources.horses` (both
  `required`, start 0 via new `STARTING_GOLD`/`STARTING_HORSES` in `campaignConfig.js`, wired into
  the creation route and `campaignView`'s `resources` block); `campaign.recruit.fervor` (default
  `RECRUITING_FERVOR_START = 0`). Two existing `campaigns.test.js` cases that replaced a live doc's
  whole `resources` object needed `gold`/`horses` added or `required: true` would fail their
  `.save()` — fixed as part of this slice, not a separate one.
- **`services/recruit.js`** (new, mirrors `events.js`'s `EVENT_POOL`/`eventEligible` shape):
  - `RECRUIT_POOL` — the 7 v1 entries (Militia/Soldier/Archer/Cavalry/LightCavalry/Mage/Priest)
    exactly as designed: troop lane tiered via `requires: {hasUnit}` (reusing `eventEligible`
    directly, imported from `events.js`, rather than duplicating the gate logic), caster lane
    gold-only with no tier gate. Numbers picked: Militia 20/hire (40 food, 20 materials, 20
    workers — a fixed-size version of today's up-to-50/day slider); Soldier/Archer 15/hire;
    Cavalry/LightCavalry 5/hire (+5 horses each); Mage 100 gold; Priest 80 gold.
  - `canAfford`/`eligiblePool`/`affordablePool` — the filtering pipeline a day's offer is drawn
    from.
  - `rollBoost(fervor)` — the 1:1 percent-chance roll, via the existing queueable `chanceRoll`
    (`utils/dice.js`), clamped 0–100 for the roll only.
  - `resolveHire(entry, boosted, ctx)` — pure; computes the actual count/cost/secondUnit for a
    hire without mutating anything. `RECRUIT_BOOST_DISCOUNT = 0.3` (30% off) is the fallback ratio
    for both lanes when the boosted branch isn't affordable.
  - `applyHire(campaign, entryId, boosted)` — the one mutator (mirrors `applyEffect`'s "mutates in
    place, caller saves, returns log lines" contract); `grantFreeMilitia(campaign)` — the
    `FREE_MILITIA_AMOUNT = 5` fallback, no choice shown.
  - `pickDailyOptions(ctx)` — up to 2 distinct options from the affordable pool, ONE boost roll for
    the day (not per-option), via the existing queueable `getRandom` for deterministic tests.
- **Tests:** `tests/recruit.test.js`, 24 pure-function cases (pool shape/gating, afford edge cases
  per resource key, Fervor roll boundaries, troop-lane double-vs-discount, caster-lane
  bonus-hire-vs-discount, `applyHire` deduction+roster growth incl. a Cavalry/horses case, the free
  fallback, `pickDailyOptions`' empty-pool and 2-option paths). Full `cs-test` 410/413 green — the
  3 failures are the pre-existing `engine.integration.test.js` ENOENT (no compiled `./game`
  binary in this environment), unrelated to this change.
- **NOT done yet (next slices):** the Recruit route + day-offer generation + `campaignView`
  exposure; the frontend Recruit phase screen and its slot in `Prepare→Omens→Raids→Recruit→Deploy`;
  removing the old militia-purchase route/`CampPanel` slider (`MILITIA_*` constants in
  `campaignConfig.js` are UNTOUCHED and still live — Militia purchase still works exactly as before
  until the fold-in lands); the raid gold-reward wiring; the garrison gold event; horses' earn
  source.

**S2 — route + day-offer generation + `campaignView` exposure (server-only, no frontend yet). ✅
SHIPPED 2026-08-02.** Mirrors the augury/raid-opportunities wiring pattern exactly (drawn at
creation, redrawn at end-day step 7, looked up fresh from the pool at view/hire time — never a
stored resolved cost/count, which can drift as resources/workers change between draw and hire).
- **Schema (`CAMPAIGN_SCHEMA_VERSION` 24→25):** `campaign.recruit.dailyOptions` (`[String]`, up to 2
  `RECRUIT_POOL` ids), `.boosted` (today's ONE Fervor roll, applies to whichever option is hired),
  `.hiredToday` (the one-hire-per-day cadence spent — by a hire, an explicit skip, or the automatic
  free-Militia fallback).
- **`services/recruit.js` additions:** `drawRecruitOffer(ctx)` — pure wrapper around
  `pickDailyOptions` that shapes the three `campaign.recruit` fields (ids only, never resolved
  cost/count) and reports `freeMilitia` for the caller to apply (kept a separate step, like
  `applyEffect` is separate from picking what fired — `drawRecruitOffer` itself never touches the
  roster). `recruitCtx(campaign)` — derives the ctx (`workersFree` from `workers.total - used`,
  `fervor` defaulted) from a live campaign doc, shared by both call sites below.
- **Wiring (routes/campaigns.js + services/dayResolution.js):** day-1 draw happens before the doc
  exists (same before-the-doc-exists treatment `drawAugury` already gets) — the free-Militia
  fallback, if it fired, is folded straight into the starting roster object literal, since
  `grantFreeMilitia`'s `campaign.roster.set` needs a real Mongoose Map that doesn't exist yet.
  End-day step 7 redraws it from the live doc (`recruitCtx(campaign)`) alongside the augury/raid
  redraws, applying `grantFreeMilitia` for real when the pool comes back empty.
- **`POST /:id/recruit/hire`** (new route, sits next to `/spend`): `{entryId}` hires that option,
  re-validated against `dailyOptions` AND re-checked for affordability against LIVE
  resources/workers (a race guard — the offer may have gone stale since it was drawn, e.g. a
  fortify spend in between); `{skip: true}` declines without hiring. Either way sets `hiredToday`
  and clears `dailyOptions` (unambiguous "nothing left to pick today," rather than leaving a stale
  entry whose `campaignView` preview would recompute against post-hire resources). Coexists with
  the old `/spend {action:'militia'}` route for now — removing it is still a later slice.
- **`campaignView` exposure:** a `recruit: {fervor, boosted, hiredToday, options}` block; each
  option is looked up fresh from `RECRUIT_POOL` by id (the sealed-pool-lookup convention
  `pendingChoices` already uses — an id that left the pool mid-campaign is dropped) and resolved
  through `resolveHire` against LIVE resources/workers, so the client sees the EXACT count/cost/
  secondUnit hiring would produce right now, boost included — never the stale numbers from draw
  time.
- **Gotcha found by the full suite, not by design:** `bugReports.test.js` pre-seeded 4 dice-queue
  values before calling `POST /api/campaigns`, on the (previously true) assumption that campaign
  creation doesn't actually consume the shared `utils/dice.js` FIFO queue (`drawAugury` draws its
  event pairs via `Math.random`, not the queue — only `consultAugury` touches it). S2's day-1
  `drawRecruitOffer` call is the FIRST thing creation does that legitimately consumes the queue
  (`rollBoost` → `chanceRoll` → `getRandom`), so those 4 leftover values — meant for nothing — got
  consumed instead of Fervor's roll and the option-index pick, corrupting the pick (`getRandom`
  ignores its bounds when the queue is non-empty, so a leftover value like `6` against a 1-entry
  pool spliced out-of-bounds → `undefined` → a 500). Fixed by deleting the dead pushes in
  `bugReports.test.js` (the comment claiming consumption was already stale before this change).
  Worth remembering: any FUTURE addition to the creation or end-day pipeline that starts consuming
  the dice queue should audit for the same kind of stale "just in case" `pushRoll` padding
  elsewhere in the suite.
- **Tests:** `tests/recruit.test.js` gained `drawRecruitOffer`/`recruitCtx` cases (10 more, 38
  total); `tests/campaigns.test.js` gained a `describe('Recruit phase ...')` block (day-1 offer
  shape, hire debits + roster growth + cadence, invalid/stale-option rejection, skip, end-day
  redraw) plus `recruit/hire` added to the "every mutating action 409s while a decision is
  pending" table. Full `cs-test` 420/423 green — the 3 failures are the same pre-existing
  `engine.integration.test.js` ENOENT as every other session in this environment.
- **NOT done yet (next slices):** the frontend Recruit phase screen + its slot in
  `Prepare→Omens→Raids→Recruit→Deploy`; removing the old militia-purchase route/`CampPanel` slider;
  the raid gold-reward wiring; the garrison gold event; horses' earn source.

**S3 — frontend Recruit phase screen. ✅ SHIPPED 2026-08-03.** New `Prepare→Omens→Raids→Recruit→
Deploy` slot (was `…→Raids→Deploy`); Recruit sits after Raids so raid gold (once wired) is
spendable the same turn. Militia purchase/`CampPanel` are UNTOUCHED — old-militia removal is
still a separate later slice, not folded into this one.
- **`RecruitPanel.jsx`** (new, mirrors `RaidPanel.jsx`'s option-card shape, not `CampPanel`'s
  slider — the server picks the day's offer, the client doesn't build one): reads
  `campaign.recruit` straight from the store; renders up to 2 option cards (server-resolved
  count/cost/secondUnit, never recomputed client-side) with a Hire button per card plus one Skip
  button; `hiredToday` shows a "done for today" line instead, empty `options` (nothing
  affordable) shows a distinct empty state. Client-side affordability is preview-only (disables
  the button + a title reason, same convention as `CampPanel`'s fort/militia buttons) — the
  server re-validates for real, same race-guard reasoning as the `/recruit/hire` route itself.
- **Wiring:** `services/api.js` `hireRecruit(id, body)` (POST `/:id/recruit/hire`, returns the
  view directly like `spendCampaign`, not wrapped in `{campaign}` like `postCampaignRaids`);
  `useCampaignStore.js` `hireRecruit` action. `App.jsx`: raids screen's exit button renamed
  `to-deploy`→`to-recruit`; new `phase === 'recruit'` block owns the actual `to-deploy` button
  (calls `musterForBattle`, unchanged) plus a `back-to-raids` nav button — the phase-owns-its-nav
  split RaidPanel already uses.
- **HUD:** `CampaignHUD.jsx` gained `hud-gold`/`hud-horses` spans (schema v24 `resources.gold`/
  `.horses` existed since S1 but were never displayed) — needed so a player can see whether a
  caster/cavalry hire is affordable before reaching the Recruit screen.
- **Every place that walked Raids straight to Deploy needed a `to-recruit` click inserted**
  (frontend/src/__tests__/helpers/nav.js `marchToDeployment`, campaignFlow.test.jsx ×2,
  bossFightGate.test.jsx, auguryAccept.test.jsx, e2e/tests/campaign-loop.spec.js) — the fixture's
  default `campaign.recruit` is `{hiredToday: true, options: []}` specifically so
  `marchToDeployment` reaches the deploy exit with one extra click and no hire/skip needed;
  recruitPanel.test.jsx overrides it to exercise the offer itself.
- **Tests:** new `recruitPanel.test.jsx` (9 cases: own-screen placement, Fervor/boosted/cost
  display, caster-boost secondUnit display, hire posts `{entryId}` and refreshes, skip posts
  `{skip: true}`, unaffordable-disabled-with-reason, hiredToday empty state, no-options empty
  state); `phaseNavigation.test.jsx` gained `Recruit → Back to the Raids` and a Recruit
  screen-scope case. Full `fe-test` 247/247 green; `fe-lint` clean. Manually verified against a
  real `make docker-up` stack via the project's own `e2e` Playwright suite (not a throwaway
  script) — both `campaign-loop.spec.js` and `demo-battle.spec.js` pass end-to-end, walking
  Raids→Recruit→skip→Deploy for real.
- **NOT done yet (next slices):** removing the old militia-purchase route/`CampPanel` slider
  (`MILITIA_*` constants + the militia box are UNTOUCHED); the raid gold-reward wiring; the
  garrison gold event; horses' earn source.

**S4 — remove the old militia purchase. ✅ SHIPPED 2026-08-03.** The "replaces, not adds" half of
the design above: buying troops now happens in exactly ONE place (the Recruit phase), with Militia
as `RECRUIT_POOL`'s base tier instead of its own parallel mechanic. Pure removal — no new
behaviour, no balance change beyond losing the old 2-food/1-material/1-worker-per-head trickle.
- **Server:** the `action === 'militia'` branch of `POST /:id/spend` is gone (fortify is the only
  spend action left; a militia body now 400s `unknown spend action`), along with its
  `MILITIA_FOOD_COST`/`MILITIA_MATERIAL_COST`/`MILITIA_WORKER_COST`/`MILITIA_DAILY_CAP`/
  `MILITIA_UNIT` constants in `campaignConfig.js` and the `militiaBoughtToday` document field +
  its `dayResolution` step-7 reset. `FREE_MILITIA_AMOUNT` and everything else `recruit.js` owns
  STAY — those belong to the new phase, not the old mechanic.
- **Schema (`CAMPAIGN_SCHEMA_VERSION` 25→26):** dropping `militiaBoughtToday` is a stored-shape
  change, so it gets the bump per this doc's convention (old docs are deleted on listing, no
  migration).
- **Frontend:** `CampPanel` is fortifications-only — the militia box/input/button, the mirrored
  `MILITIA_*` cost-preview constants, the clamp/reset logic, and the `onBuyMilitia` prop all
  removed; `useCampaignStore.buyMilitia` and its `App.jsx` wiring removed with them. The workforce
  readout is unchanged (both sinks still show there — fort labour in `used`, hires in `total`).
- **Tests:** `campaigns.test.js` swapped its 3 militia-purchase cases for one asserting the action
  is rejected AND nothing is debited, plus a fortify-only version of the "`used` vs `total` are
  tracked independently" case (the `total`-shrinks half is already covered by the Recruit describe);
  `campPanel.test.jsx`'s `camp panel — militia` describe became a "renders no militia box/input/
  button" case, and the muster-shrinks-"raised" case became a render-only readout assertion. Ran
  red first (militia spend still 200, militia box still in the DOM), then green: `cs-test`
  419/422 (the 3 failures are the pre-existing `engine.integration.test.js` ENOENT — no compiled
  `./game` in this environment), `fe-test` 243/243, `fe-lint` clean.
- **NOT done yet (next slices):** the raid gold-reward wiring; the garrison gold event; horses'
  earn source.

**S5 — raid gold rewards. ✅ SHIPPED 2026-08-03.** The v1 earn source for `gold`: a won
`destroy_detachment` or `loot_supplies` raid banks coin, on top of what those types already pay.
- **Sizing, grilled 2026-08-03:** gold = target headcount × a per-type rate × a WIDE independent
  variance roll. `RAID_GOLD_PER_UNIT = {destroy_detachment: 1.2, loot_supplies: 0.8}` (destroy
  pays better per head — spoils off the dead vs a paychest with the wagons),
  `RAID_GOLD_VARIANCE = [0.5, 2.0]`. The user's steer: reward and guard strength must be
  *correlated but loosely* — "part of why scouting should be good is that you should be able to
  find better targets where the reward is large but the guard relatively weak". The variance roll
  is deliberately separate from `sliceTargetForce`'s own size jitter, so at equal guard strength
  one card is a bargain and the next is barely worth the ride. Scale check against the caster
  lane's sinks (Mage 100, Priest 80): a full company (~30 units) pays ~18–72 gold on a destroy.
- **Gold is scoutable intel** (user's pick): it goes through `rewardRangeOf` like food/materials,
  so it shows as a ±25% range that a scouting point pins to exact. Side effect worth knowing —
  `destroy_detachment`'s reward used to be `null`, so those cards had NO buyable reward intel;
  they do now, and `RaidPanel` renders a gold line + Reveal button on them.
- **Code:** `goldFor(type, targetForce)` + `randFloat` in `services/raid.js`; the `reward` build
  gives destroy `{gold}` (was `null`) and loot `{food, materials, gold}`; `rewardRangeOf` and
  `campaignView`'s `rewardView` gained a `gold` key; `applyRaidReward` credits
  `campaign.resources.gold` on both types with its own log line. `rescue_troops`/`counter_event`/
  `garrison_sortie` pay no gold (no rate) — the garrison's coin is its own later slice.
- **No `CAMPAIGN_SCHEMA_VERSION` bump:** `reward` is already `Mixed`, and an in-flight campaign
  whose destroy cards were dealt before this just pays no gold today (`reward?.gold ?? 0`) and
  gets gold on tomorrow's redeal. Nothing stored becomes unreadable.
- **Tests:** `raid.test.js` +6 (which types pay gold; a 10× bigger host pays >5× on average;
  per-guard-unit payoff spreads >2.5× across 200 draws — the bargain-target property itself; a
  won destroy banks + logs its gold; a won loot banks gold alongside stores; a lost raid banks
  none; a destroy card's gold reveals range→exact), and its "destroy has no reward range" case is
  inverted. `raidPanel.test.jsx`'s destroy fixture carries `{gold: [30,50]}` and asserts the card
  shows it with a Reveal button. Red first, then green: `cs-test` 426/429 (3 pre-existing engine
  ENOENT), `fe-test` 243/243, `fe-lint` clean.
- **NOT done yet (next slices):** the garrison gold event (`requires: {minResolve: 67}` fate);
  horses' earn source (still undecided — raids mirror gold, or rework "A Captured Herd").

**S6 — the garrison gold event. ✅ SHIPPED 2026-08-03.** The second earn source for `gold`, and
the piece the design already specified in full ("the besieged garrison sits on coin it can't spend
inside the walls"). Purely additive server content — no schema bump, no route change, no frontend
change (the HUD's gold readout landed in S3, and the client renders no effect types itself; a fate's
gold shows up as its day-report log line like food/materials).
- **New `gold` effect type** in `services/events.js`, handled exactly like `materials`:
  `applyEffect` credits `resources.gold` floored at 0 with a visible `Gold +75.` log line (coin is
  the caster lane's currency — the player must weigh the figure against a Mage at 100 / Priest at
  80, so unlike `garrison`/`flag` it is deliberately NOT hidden), and `eventValence` classifies it
  with food/materials so a gold fate reads `good`/`bad` to the augur's header and the pool leak
  guards.
- **`garrison_paychest`** ("The Garrison's Paychest", severity 1, `{type: 'gold', delta: +75}`,
  `requires: {minResolve: 67}`) — the third determined-band trust-gift, sitting with
  `garrison_stores`/`garrison_night_sally`. Sizing: 75 is just under a Priest (80), so the gift is
  most of a caster but never a free one; severity 1 pairs it with `garrison_stores` as the
  "something handed over the wall" tier. Gated like its siblings, so the unconditional base pool the
  legibility tripwire guards is untouched.
- **Tests:** `augury.test.js` +6 (`eventValence` gold both directions; an `applyEffect — gold`
  describe: credit + visible figure, debit floored at zero, riding inside a `multi`; and in the S9
  describe, the paychest's determined-band gate/effect/valence + not-at-66/yes-at-67, and a firing
  case that banks the coin). Red first (6 new failures), then green: `cs-test` 431/434 — the 3
  failures are the pre-existing `engine.integration.test.js` ENOENT (no compiled `./game` in this
  environment).
- **NOT done yet — the last Stage E slice:** horses' earn source (still undecided; grill first).

**S7 — horses' earn source. ✅ SHIPPED 2026-08-03. Stage E is COMPLETE with this.** The last open
design question in Stage E, grilled end-to-end before writing (per `CLAUDE.md`). Cavalry and
LightCavalry were unreachable pool entries until now — they spend `horses` and nothing granted any.
**Two taps, neither guaranteed: the cavalry lane is optional by design.**
- **Tap 1 — a new raid card, `seize_horses` ("The Horse Drove").** A 4th member of `RAID_POOL`
  beside destroy/loot/rescue, **ungated**. The user's steer: the herd is deliberately NOT the
  enemy's own remounts — it's a dealer's string moving under hired guard, sold to whoever pays — so
  the card draws regardless of what the host is made of, and a guard slice of any composition makes
  sense. Payout is the S5 gold shape exactly: guards × `RAID_HORSES_PER_UNIT` (0.4) ×
  `RAID_HORSES_VARIANCE` ([0.5, 2.0], independent of the size jitter), min 1 — so the
  bargain-target property holds here too. Against the starting host that's ~4–40 horses, typically
  ~18 (≈3–4 hires at 5 horses each), shrinking as the enemy is worn down. **Horses only**, no
  gold/food rider — one clean identity, so the reveal answers exactly one question. **Scoutable**
  like every other numeric reward (`rewardRangeOf` → `rewardView` → RaidPanel's Reveal button);
  since horses are the card's ONLY number, skipping this would have left it with no buyable reward
  intel at all — the gap S5 had just closed on `destroy_detachment`. **Loot-shaped**, so a won drove
  never thins the hidden host (the guard is narrative, not the enemy's strength).
- **Tap 2 — a `horses` effect type + "A Captured Herd" gains a third branch.** The effect mirrors
  S6's `gold` (credits `resources.horses` floored at zero, VISIBLE `Horses +25.` log line — a hire
  costs five, so the figure is what the player counts hires in; classified with food/materials/gold
  in `eventValence`). The Herd is now a three-way fork with **both original branches untouched**:
  mount your veterans now (25 Soldier → Cavalry, −20 materials) / **keep the herd at the horse lines
  (+25 horses)** / sell it (+30 materials, +4 t food). 25 is headcount parity with `mount_veterans`,
  which makes the fork a choice of KIND rather than size: upgrade men you already have, at once,
  versus a stockpile that GROWS the army but spends food, materials and irreplaceable workers a hire
  at a time across ≥5 days of the one-hire cadence. Branch text stays digit-free per the
  `augury.test.js` tripwire; the number lives in the post-resolution log line.
- **Draw-odds consequence, accepted deliberately:** a 4th pool type drops destroy/loot/rescue from
  ~33% to ~25% of the single free base card each turn. Kept as a plain uniform array rather than
  introducing a weighting mechanism — a horse card roughly every fourth turn (more if targets are
  bought) matches "cavalry is optional but real".
- **No `CAMPAIGN_SCHEMA_VERSION` bump:** the raid-type enum gained a value, which leaves every
  stored opportunity readable; in-flight campaigns simply never dealt the card. Same reasoning as
  S5's no-bump.
- **Tests:** `raid.test.js` +10 (a `horses reward` describe: dealt from the ordinary pool AND from a
  pure-infantry host — the ungated property; only the drove pays horses and it pays nothing else;
  payout tracks guard size; per-guard payoff spreads >2.5× across 200 draws — the bargain property;
  the range brackets the truth; mean sized in hires — plus route cases for banking + logging a won
  drove, a lost one banking none, a won drove leaving the host untouched, and the range→exact
  reveal). `augury.test.js` +6 (valence both directions, an `applyEffect — horses` describe, and a
  three-way-fork describe covering the new branch's grant, its whole-hire divisibility, and that
  both original branches survive). `raidPanel.test.jsx` +1 (a drove card lists its horses range with
  a Reveal button). Red first (16 new failures), then green: `cs-test` 447/450 (3 pre-existing
  engine ENOENT), `fe-test` 244/244, `fe-lint` clean.
- **Deferred by the grill, recorded not built:** nomad allies granting horses (as an event OR a raid
  card); horses as a food/upkeep drain; horses returning to the pool when cavalry die.
  Cavalry/LightCavalry hire costs stay at 5 horses.

**S8 — the draw moves into the phase; the phase becomes a one-way door. ✅ SHIPPED 2026-08-03,
grilled first.** Started as a code-review finding and turned into a structural fix. **The bug:**
`pickDailyOptions` filtered by affordability against the state at the *previous* turn's end-day,
so gold won by this turn's raids could never put a caster on this turn's board — exactly the
payoff the `Raids → Recruit` ordering exists to deliver (see the Framing paragraph above). The
first caster was always a turn late.
- **The fix is when, not whether.** The affordability filter stays — an offer you can't pay for
  isn't a legal play, and there is no credit — but it now runs at **`POST /:id/recruit/open`**,
  called when the player enters the phase, after raids have resolved. The draw at campaign
  creation and the one in `dayResolution` step 7 are both **deleted** (with them the
  fold-the-free-Militia-into-the-starting-roster-literal hack). End-day just clears the
  day-state.
- **`recruit.drawnDay` (schema 26→27) is both seal and gate.** Stamped at open, so re-entering
  the phase returns the same offer instead of rerolling it (and rerolling the day's ONE Fervor
  roll with it). It self-resets as the day increments.
- **Opening the phase closes the camp.** `rejectIfRecruiting` — same shape as
  `rejectIfChoicePending` — makes `forage`, all three `augury/*`, `raids/launch`, `raids/scout`
  and `spend` 400 once `drawnDay === day`. Deploy/battle/end-day stay open (they come after
  Recruit in the turn order). **This is what makes the sealed offer honest:** with no way to
  gain resources after the draw, the draw cannot go stale, so no resealing rule or reroll
  surface is needed. Enforced server-side because the phase is client state. The frontend drops
  the "Back to the Raids" button accordingly — deliberately with **no confirmation dialog**
  (the user's call: "player will learn that they cant go back soon enough").
- **The free-Militia auto-grant is gone; `FALLBACK_HIRE` (Travellers) replaces it.** A
  zero-cost, ungated `{id:'travellers', unit:'Militia', count: FREE_MILITIA_AMOUNT}` entry kept
  **out** of `RECRUIT_POOL` so it never competes for a slot: it only pads a short draw up to two
  (2+ affordable → no Travellers; 1 → that plus Travellers; 0 → Travellers alone). Because it
  costs nothing it is affordable in every reachable state, which is what lets the **hire be
  mandatory** — `{skip:true}` and the Skip button are removed, and "Deploy for Battle" is
  disabled until `hiredToday`. It boosts like any other troop-lane entry (double of nothing is
  nothing → 10 free Militia on a Fervor day); left uniform on the user's call, since a high
  Fervor earning that is fine. This also deletes `grantFreeMilitia`, the `freeMilitia` field,
  and the auto-`hiredToday` branch.
- **Two other review findings, fixed in passing:** the hire route's affordability guard checked
  the raw `entry.cost` while `campaignView` and `applyHire` used the *boost-resolved* cost (a
  discounted boosted hire the UI had enabled would 400) — it now resolves through `resolveHire`
  first; and the unguarded `RECRUIT_POOL.find` that would 500 on an id that had left the pool is
  now the single guarded `findRecruitEntry`, shared with `campaignView`.
- **`campaignView` gained `recruit.drawn`** so a client that lost its screen state to a mid-turn
  reload lands back on the Recruit screen instead of on a War Council whose every button 400s.
- **Tests:** red first (24 server, 10 frontend). `recruit.test.js` reworked (Travellers shape +
  its absence from the pool + free-affordability, `findRecruitEntry`, the three top-up cases,
  boosted Travellers, `applyHire` on a free entry); `campaigns.test.js` +10 (no offer before
  open, the day-1 draw, open idempotency, hire-before-open, skip refused, unknown id → 400 not
  500, the boost-resolved guard, end-day not pre-drawing, the fresh next-day draw, and a
  `Recruit phase locks the rest of the turn` describe); `recruitPanel.test.jsx` reworked +
  `phaseNavigation.test.jsx`'s back-step case inverted. Green: `cs-test` 462/465 (3 pre-existing
  engine ENOENT), `fe-test` 247/247, `fe-lint` clean.
- **Balance left as single constants to tune after a playtest:** Travellers' count (5, vs
  Militia's 20) and the pad-to-2 rule itself.

### Recon rework — one scouting LEVEL from accumulated leftover points (DESIGNED 2026-07-20, grilled)

**Supersedes Stage C (`reveal_meter`)** and reworks Stage A's meter-value reveal. Grilled end-to-end
with the user before writing (per `CLAUDE.md`); the confirmed decisions are listed at the end. The
passive coverage-based scouting band is **removed**; a single recon **LEVEL**, earned by pouring
leftover scouting points, drives every scouting-gated reveal — and, above the band, a graduated
numeric estimate of the enemy count and the meter value.

**Core mechanic.**
- `campaign.recon.points` accumulates: at end-of-turn (dayResolution step 7, BEFORE the
  `raid.scoutingPoints` pool refills), whatever points the player didn't spend on the raid board are
  added — **accumulate, no decay, no reset**. Leftover points otherwise just expire, so this is
  automatic, not a choice ("it's the last place to spend points" — user).
- `reconLevel(points)` → 0..4 on the existing `SCOUTING_BANDS` ladder (Blind..Overwhelming) via a
  tunable `RECON_LEVEL_THRESHOLDS`; `reconBand(points) = SCOUTING_BANDS[level]`.
- The level read DURING a turn (campaignView + dayResolution) uses `recon.points` as it stands at
  turn start; this turn's leftover accrues at end-of-turn → affects NEXT turn. One band per turn
  (planning == resolution), exactly as the coverage band was consistent before.

**Replaces the passive band at all THREE consumers** (each was
`scoutingBand(scoutingCoverage(roster), scoutingCoverage(enemy))`):
1. Enemy reveal ladder (`campaignView.enemyView`) — composition %, placements, exact units at their
   existing tiers, just re-driven by recon level.
2. Forage posture yield + clash damper (`forage.js`, via `dayResolution`).
3. Recon-sensitive event rungs (`firedRung(event, band)` in `acceptFates` + `endDay`).
`scoutingCoverage`, `scoutingBand`, `SCOUTING_BAND_THRESHOLDS`, `reconValue` are **deleted** (nothing
else uses them). `scoutingPointsFor`/`scoutingPointValue` **stay** (they mint the per-turn pool that
feeds recon). `SCOUTING_BANDS` ladder stays. `ENEMY_STRENGTH_BANDS` phrase is replaced by the numeric
bracket below; `METER_BANDS` stays as the meter's level-0 phrase.

**NEW graduated numeric brackets (the "more accurate the more you pour" part) — enemy total count +
meter value.** Per quantity, store `{ atLevel, floorOffset, ceilOffset }` (floorOffset ≤ 0 ≤
ceilOffset, asymmetric):
- Set ONCE per level-up (detected at accrual when newLevel > stored `atLevel`): apply that level's
  asymmetric multipliers to the CURRENT truth + a small random jitter (so the midpoint ≠ truth and it
  isn't exactly reverse-engineerable), store the resulting absolute offsets.
- Displayed each turn as `[max(0, currentTrue + floorOffset), currentTrue + ceilOffset]` against LIVE
  truth — so it slides with player-known deltas (raid/forage casualties, meter growth) revealing
  nothing across turns; only a level-up narrows it. **Floor clamped ≥ 0** (user). Level 0 → phrase
  only (METER_BANDS for the meter; enemy shows nothing, like Blind today). Top level → offsets 0 →
  exact. Why absolute offsets not live multipliers: a player who knows a casualty delta could solve a
  live multiplier (hence the truth); fixed offsets just slide by the known delta and leak nothing.
- **Delicate interaction (user: "add good coverage"):** a `destroy_detachment` raid shrinks
  `enemy.army` → the enemy-count bracket must shift DOWN by exactly the casualties (same width, floor
  ≥ 0). Automatic via live truth, but MUST be explicitly tested.

**Confirmed decisions (grill, 2026-07-20):** meter is camp-troop-driven, NOT tied to scouting —
scouting only REVEALS it, never changes the true value; recon sharpens BOTH meter value and enemy
count; accumulate with no decay; the persisted bracket only narrows on level-up (never re-rolls, so
cross-turn comparison yields nothing); on casualties adjust floor/ceiling by the loss amount
(≡ live-truth + fixed offsets); floor never negative; combine the two systems so accumulation
determines the level, keeping the level's existing uses (enemy ladder + forage posture); the
enemy-army coverage input is dead and thrown away.

**Staging (one thing at a time):**
- **R1 — recon core + band-driver swap. ✅ COMPLETE** (source `ba1ec33`; tests finished + verified
  green this session). `campaign.recon.points` (schema **v15**) + `reconLevel`/`reconBand`; leftover
  points accrue at end-of-turn; all 3 consumers swapped to the recon band; `scoutingCoverage`/
  `scoutingBand`/`reconValue` deleted. `RECON_LEVEL_THRESHOLDS = [100,300,700,1400]` (rough/tunable
  — the fresh starting-roster pool is ~1112 pts/turn, so a fully-unspent turn already jumps to
  Superior; calibrate in playtest). Tests **99/99 green** (`capabilities` + `campaigns`). The whole
  test delta was expectation-only: fresh campaign now starts **Blind** (recon 0), so its turn-1
  forage posture is Blind's ×0.7 — the create response's `kgPerUnit` preview asserts the scaled
  21/59, and the raw-number capacity/harvest tests pin `Contested` via a new `pinBand(id, band)`
  helper (sets `recon.points` to the band's threshold + zeroes `raid.scoutingPoints` so an
  intervening end-day's accrual doesn't drift the pinned band). No brackets yet.
- **R2 — numeric brackets + revert Stage C. ✅ SHIPPED 2026-07-21** (see the R2 handoff block
  immediately below).
- **R3 — frontend readout. ✅ SHIPPED 2026-07-21** (see the R3 handoff block below). Recon level +
  brackets in `ScoutReport`/HUD.

#### Recon R2 (numeric brackets + revert Stage C) ✅ SHIPPED 2026-07-21 — handoff

Server-only, TDD. Full `campaign-server` suite **302/302 green** locally this session (20 files;
the sandbox mongo cooperated — no flake this time). Schema **v15→v16**.

- **Grill outcome (design knobs the R1 note flagged).** Confirmed with the user before coding:
  (1) **offsets live under `recon.brackets`** (`{enemyCount, meter}`, each
  `{atLevel, floorOffset, ceilOffset}`) — grouped with `recon.points` since both are set at the
  same recon-accrual moment; (2) **per-level multipliers** = the "Moderate" curve
  `RECON_BRACKET_MULTIPLIERS` (L1 `[0.6,1.7]`, L2 `[0.78,1.4]`, L3 `[0.9,1.18]`, L4 `[1,1]`
  exact); (3) **jitter is directional & widening** — the user corrected my first reading: floor is
  pushed DOWN by up to 25% of truth, ceiling UP by up to 50% (`RECON_BRACKET_JITTER={floor:0.25,
  ceil:0.5}`), so it can't invert an offset's sign or leak the truth via a fixed width; skipped at
  the top level so exact stays exact. All three are **rough/tunable**.
- **RECON_LEVEL_THRESHOLDS raised `[100,300,700,1400]`→`[200,700,2000,4500]`** (user flag mid-build:
  with a ~600-pt/turn pool over a ~10-turn campaign the old top tier was trivially reached). Now the
  top tier (exact intel) costs most of a campaign's unspent points, so a player who ALSO spends on
  the raid board can't reach it. NB: because the fresh-army pool is ~1112/turn (R1 note), a fresh
  campaign still climbs to **Contested (L2)** after its FIRST end-day — this shifted one enemyAi
  test's meter assertion (line ~182) from "estimate null" to "estimate is a bracket". Still tunable.
- **Mechanic (services/recon.js, pure + injectable `rand`):** `computeBracket(truth, level, rand)`
  stores ABSOLUTE offsets (`floorOffset ≤ 0 ≤ ceilOffset`); `displayBracket(stored, liveTruth, level)`
  renders `[max(0, live+floor), live+ceil]` (null at level 0, exact at top). Offsets are re-set ONLY
  on a level-up (`bracketOnLevelUp`, wired into `dayResolution` step 7 right after the recon accrual,
  reading the post-casualty enemy count + the just-filled meter value) — never re-rolled per turn, so
  the estimate is stable across turns within a level and cross-turn triangulation leaks nothing.
- **campaignView:** enemy `strength` phrase → `count {low,high}` (replaces `ENEMY_STRENGTH_BANDS`,
  now deleted from config); meter `{band, revealed, value}` → `{band, estimate}` (estimate null at
  L0, bracket above, exact `{v,v}` at top). A free reveal (prisoners) shows `count` exact.
- **Reverted Stage C:** `reveal_meter` scout action + `METER_REVEAL_SCOUT_COST` + `meter.revealed`
  field + its end-day reset all gone; the meter is now revealed by recon LEVEL, not a per-turn buy.
- **Tests:** new `tests/recon.test.js` (10 pure-fn cases incl. narrowing, floor clamp, exact-at-top,
  casualty slide); a new `describe('recon numeric brackets (R2)')` in `campaigns.test.js` with the
  **delicate destroy_detachment casualty-shift** coverage (whole bracket slides down by exactly the
  loss, same width; floor never negative) + an end-day level-up-sets-brackets-once case; the enemy
  key-set tables + meter key-set assertions in `campaigns.test.js`/`enemyAi.test.js` updated
  (`strength`→`count`, `{band,estimate}`); the 4 `reveal_meter` cases removed from `raid.test.js`.
- **Leftover flagged for a later pass (user, 2026-07-20 deferred + reminded this session):** the
  `enemy.stance`/`battleOffer` concept is outdated cruft (there's no army "stance" in the siege
  framing) — the `METER_BANDS` comment still describes the stance machine because the machine still
  EXISTS. Its removal is the separate "remove enemy.stance/battleOffer entirely" cleanup pass, NOT
  folded into recon. Deferred to that pass / code review.
- **R3 DID (✅ SHIPPED 2026-07-21):** rewired `CampaignHUD`/`ScoutReport` off the removed
  `meter.revealed`/`meter.value` onto `meter.estimate` + `enemy.count`, and surfaced the recon
  band (level). Frontend-only, frontend vitest **230/230 green**.

#### Recon R3 (frontend readout) ✅ SHIPPED 2026-07-21 — handoff

Frontend-only; no server or fixture-shape-vs-live drift left. Frontend vitest **230/230 green**,
oxlint clean.

- **New `estimate()` helper** in `frontend/src/utils/format.js`: a recon bracket (`{low, high}`
  from `services/recon.js`'s `displayBracket`) → `"600–1100"` (en-dash range) or `"560"` once it
  has collapsed to exact (top recon level / free reveal, `low === high`). Callers own the `null`
  case (recon level 0 — no estimate shown at all). Unit-tested in `format.test.js`.
- **`CampaignHUD.jsx`:** `hud-meter` now reads `meter.estimate ? estimate(meter.estimate) :
  meter.band` (was `meter.revealed ? meter.value : meter.band`). Added a **`hud-recon`** span
  (`Recon: <band>` from `scouting.band`) — surfaces the recon LEVEL on the always-visible HUD, per
  the "frontend testing convenience" note below. The existing raid-pool span (`hud-scouting`) was
  **relabeled `Scout pts:`** (was `Scouting:`) to disambiguate the per-turn raid points pool from
  the new recon band readout — RaidPanel's own copy is untouched.
- **`ScoutReport.jsx`:** the `enemy.strength` phrase block → an `enemy.count` block
  (`data-testid="scout-count"`) rendering `estimate(enemy.count)` — a range while intel is partial,
  a single exact figure at the top recon level (or a prisoners free reveal). `knowsAnything` now
  keys off `enemy.count`.
- **Fixture + tests:** `__tests__/fixtures/campaign.js` moved to `meter: {band, estimate:null}` and
  `enemy.count {low,high}` (was `meter:{band,revealed,value}` + `enemy.strength`); `campaignHud`/
  `scoutingReveal`/`dayReportRungs` test cases updated to the new shapes (range vs exact both
  covered; the top-level exact case asserts NO en-dash).

Constants (`RECON_LEVEL_THRESHOLDS`, per-level multipliers, jitter) are **rough/tunable** — calibrate
against the real per-turn scouting-points pool in playtest.

**Frontend testing convenience (user ask, 2026-07-20) — do NOT skip, even though it's small.**
`CampaignHUD.jsx` today shows `Turn`/`Food`/`Materials`/`Forts`/`Land`/roster only
(`frontend/src/components/CampaignHUD.jsx:20-32`) — no scouting/meter/future-resource readout at
all, and `raid.scoutingPoints` is otherwise only visible buried inside `RaidPanel`'s
`.raid-scouting-header` (Raids screen only). User's reasoning: a plain number on the always-visible
HUD is trivial to add and makes manual playtesting/debugging each stage far easier than digging
into a panel or the network tab. Add as each value comes into existence, same commit as the
stage that introduces it — don't defer to a cleanup pass:
- **Stage A/C + recon R3: ✅ FULLY SHIPPED.** meter band (plus its recon numeric estimate — the
  `meter.revealed`/exact-value idea was replaced by the recon `meter.estimate` bracket in R2/R3),
  the recon band (`hud-recon`), and `raid.scoutingPoints` (`hud-scouting`, labeled `Scout pts:`)
  all on the always-visible HUD. Stage A landed `hud-meter`/`hud-scouting` (2026-07-20); recon
  R3 (2026-07-21) rewired `hud-meter` onto `meter.estimate` and added `hud-recon`. RaidPanel keeps
  its own scouting-points copy for the spend buttons (a cheap second read, not a move).
- **Stage E:** the new `gold` resource and `horses` (whatever shape that ends up — a resource
  count or a roster-like pool) go on the HUD the moment they're added to `campaignView`'s
  `resources`, same line pattern as the existing `Food:`/`Materials:` spans.

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
Committed + pushed as `0c47535` on `main` (on top of the E2E commit `8df52da`); no schema bump.
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
- **NOT yet done at slice 1**: a live browser click-through — user is running `docker compose up
  --build` (Windows serves the built bundle, so a rebuild is REQUIRED to see these source changes)
  and playtesting the new flow next session.

**Slices 2–3 SHIPPED 2026-07-18 (frontend only, uncommitted) — Back nav + screen-scope trim.**
Done alongside the tutorial pass above (user chose "Back nav + trim screens").
- **Back navigation**: the phased turn was a one-way march; now **Omens → "Back to the Council"**
  (`back-to-prepare`) and **Raids → "Back to the Omens"** (`back-to-omens`) let it be walked both
  ways. Pure `setPhase` changes — no committed server action (forage/augury/raids) is undone; going
  back just re-renders an earlier screen whose own guards handle any already-done action. Secondary
  (`login-toggle`) styling; `.phase-nav` + a flex `.raids-bar` in `App.css`.
- **Screen-scope trim / audit**: confirmed each phase screen exposes only its own actions — the
  slice-1 split already achieved this (Prepare = forage/camp, Omens = augury only, Raids = raiders
  only), so the "trim" was a verification pass, now **pinned** so a future change can't re-bundle:
  `phaseNavigation.test.jsx`'s "screen scope" block asserts the council has forage/camp but no
  augury/raids controls, and the tent has only the augury (no forage/camp/raids). (`raidPanel.test.jsx`
  already pinned the raids' side.)
- **Tests**: new `phaseNavigation.test.jsx` (Back nav both directions + screen scope, 4 tests).
- **Verification**: `npm run lint` clean; the touched/at-risk files (tutorialCoverage,
  phaseNavigation, watchReplay, replay, battleVictory/Defeat, eventReveal/Choices, campaignFlow,
  raidPanel) = **68/68 green** run at `--maxWorkers=2`. A plain full `vitest run` shows the known
  CPU-starvation timeout flakiness (this run: 203/216, the 13 failures all "Test timed out in
  5000ms", green in the reduced-worker rerun) — same effect the slice-1 note records.
- **STILL NOT done**: the live browser click-through (needs the Docker rebuild); Deploy→Raids back
  step was left out (only the two screens the user named got Back — add it if the playtest wants it).

#### Playtest findings 2026-07-18 (new phased build) — ✅ BOTH FIXED (TDD, uncommitted)

Two issues surfaced playtesting the pushed `0c47535` build. **Both fixed 2026-07-18** (user
decisions below); campaign-server 252/252, frontend 208/208, oxlint clean, no engine change.

- **Issue 1 (deferred fate shown resolved) — FIXED.** User steer: only a fate that spawns a
  counter_event raid target is deferred; at the tent it shows the pending THREAT only, and it
  RESOLVES after the raid phase depending on whether the raid unmade it (normal fates still
  resolve immediately at the tent). Server (`services/dayResolution.js`): `acceptFates` deferred
  branch now rebuilds the reveal card to `{predicted, odds, deferred}` — strips `actual`/`fired`/
  `scoutsIntervened` and drops the "came to pass"/"scouts saw it coming" log lines (one neutral
  "a coming blow has been foreseen" line instead); the accepted-arm `endDay` now REVEALS each
  deferred slot's outcome (`report.augury` = the deferred cards, each carrying `fate: i` = its
  slot index) via a new shared `attachFired` helper, applying the recorded rung. Frontend
  (`components/EventRevealScreen.jsx`): `FateBeat` gained a deferred branch (prophecy + threat
  line only, guards the `came` deref); `buildBeats` keys the beat index off `slot.fate ?? i` so
  a sparse end-day reveal lands under the right fate name. Tests: 2 server (modified defer test +
  new recon-sensitive defer test), 1 frontend (auguryAccept deferred test now asserts no verdict
  leaks at the tent).
- **Issue 2 ("again only 2 raid targets") — FIXED (additive counter).** User steer: the raid
  amount shouldn't be hard-fixed at 2; better scouting already gives more (band count), and a bad
  fate should ADD the counter target, not replace one. `services/raid.js`
  `generateRaidOpportunities` now builds the band count of ordinary openings THEN pushes the
  counter_event on top (removed the `types.length = count` truncation). Contested bad-fate day
  now shows 3 targets (2 + counter) instead of 2. Tests: new additive test + the fresh-campaign
  and tomorrow's-band count tests made counter-aware (a random augury may seal a bad fate).
  **Deferred tuning — CLOSED, superseded by the scouting-points economy (2026-07-20).** The
  band-scaled base count this note worried about no longer exists: the Stage 1 rewrite (see the
  "Raid mini-game (scouting-points economy)" section below) replaced `RAID_OPPORTUNITIES_PER_DAY`
  entirely with a flat `RAID_BASE_TARGETS = 1` + buy-more-with-points model. User confirmed
  (2026-07-20) this is exactly the intended shape, not a gap to revisit — "base count should just
  be 1 and then you buy new ones with the scouting points." Any further raid-count feel is a
  balance-knob tweak (`RAID_SCOUT_COST_ADD`/`RAID_SCOUT_COST_REVEAL`), not a design question.

Original diagnosis kept below for reference.

Two issues surfaced playtesting the pushed `0c47535` build.

1. **Deferred fate is shown ALREADY RESOLVED at the tent — "it should not be turned instantly
   before I do anything" (user).** On the "Fates Come to Pass" reveal, a recon-sensitive fate that
   is *deferred* (a `counter_event` raid targets its slot) renders its full resolution — "What came
   to pass: Ambush Foreseen", "The augur was wrong", **and "Your scouts saw it coming — the blow was
   turned"** — while ALSO showing "It has not yet struck — your raiders may still unmake it." Self-
   contradictory: a deferred fate is *pending*, but the card presents it as turned before the player
   reaches the Raids screen. Root: `acceptFates` (`services/dayResolution.js`, deferred branch ~L86-101)
   sets both `report.augury[i].fired`/`scoutsIntervened` AND `deferred:true`, and pushes
   "Came to pass … — but your raiders may yet unmake it." + "Your scouts saw it coming." to the log;
   `FateBeat` (`components/EventRevealScreen.jsx:79-127`) then renders the `came`/`scoutsIntervened`
   resolution lines next to the deferred/pending line.
   **Intended direction (confirm with user first):** for a DEFERRED fate, the tent shows it as an
   unresolved THREAT only — the prophecy + "has not yet struck; your raiders may unmake it" — and
   ALL resolution flavour (what came to pass / scouts turned it / averted) moves to END-DAY, after
   the raid opportunity. Spans server (deferred branch: don't emit `fired`/`scoutsIntervened` nor the
   "came to pass"/"scouts saw it coming" log lines; end-day resolves + reveals the outcome) + frontend
   (`FateBeat`: when `deferred`, suppress the resolution lines). NB: the recon rung that fires IS
   already fixed by the scouting band (recorded in `slot.firedRungName`); the raid only escalates it
   to fully averted — so this is a TIMING/framing fix, not a mechanic change. The accepted-arm
   end-day (`dayResolution.js:154-174`) currently emits NO `report.augury` reveal cards, only log
   lines — so revealing a deferred fate's outcome at end-day may need a reveal card added there.

2. **"Again only 2 raid targets" (user).** Still only 2 raid opportunities. `generateRaidOpportunities`
   (`services/raid.js:89-102`) builds `types = []`, pushes ONE `counter_event` if any bad fate slot
   exists, fills the rest from the pool up to `RAID_OPPORTUNITIES_PER_DAY[band]`, then truncates to
   that count — so the counter_event **replaces** a normal slot rather than adding to the total; at
   Contested the band count caps it at 2. User seems to expect a bad fate to yield an EXTRA counter
   opportunity (and/or more targets overall). **Open question for next session — ANSWERED &
   SUPERSEDED, see the "CLOSED" note above this diagnosis:** should a
   counter_event be additive (band count + 1 when a bad fate exists), and/or should
   `RAID_OPPORTUNITIES_PER_DAY` be higher? Decide with the user before changing.

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

**✅ SHIPPED 2026-07-19 — event enrichment + the `convert` mechanic (campaign-server only).**
The event pools were thin/bland (user, 2026-07-19: "add more interactive events … minor/normal/big
event pools … e.g. get horses and upgrade soldiers to cavalry"). Slice 1 landed:
- **New `convert` effect** (`services/events.js`): `{ type: 'convert', from, to, count }` moves up to
  `count` roster units of `from` into `to`, capped at what the source holds (no negative roster).
  `eventValence` classifies it `good` (an in-place upgrade). Needs no engine/frontend change —
  Cavalry (and every convert target) is already a placeable+spawnable `UnitCatalog` unit, and the
  UI derives unit lists reactively from `roster`, so converted units are immediately fieldable.
- **The Horses event** (`horses`, severity 3, choice/`good`): "A Captured Herd" → **Mount your
  veterans as cavalry** (multi: `convert` Soldier→Cavalry ×25, −20 materials for tack) **or Sell the
  herd** (+materials +food). The user's example, and the `convert` mechanic's first use.
- **Three more interactive choice events** to de-blandify the normal/major pools: `sellswords`
  (sev 2, good — hire mercenaries for supply → +Soldiers), `drillmaster` (sev 2, neutral — `convert`
  Militia→Soldier at a food cost, reusing convert to tie the levy→line progression), `deserter_lord`
  (sev 3, good — take a defecting company's oath → +Soldiers, or send him home to `enemy_losses`).
- **Tests**: augury.test.js +6 (convert apply/cap, convert valence, Horses structure) → 39 green;
  full campaign-server suite **256/256**. All EVENT_POOL structure tripwires still hold (every pool
  mixes good/bad, choice options are phrase-only/digit-free, every event has a recognized valence).
- **Slice 2 (same day):** `merchant_caravan` (sev 1, choice/neutral) — the minor pool's new
  interactive event: a two-way trade, buy food with materials or buy materials with food. augury.test.js
  +2 → 41 green. Every pool (minor/normal/major) now carries at least one choice event.
- **Deadlock fix `283fce8` (frontend + e2e):** the raised choice-event density exposed a REAL
  pre-existing bug the CI e2e caught (not a flake). A **deferred** fate (a counter-raid target) that
  is ALSO a **choice** event gets both `deferred` and `pendingChoice` on its tent reveal card, but the
  deferred `FateBeat` renders only the threat (no options) — so gating `reveal-next` on that
  `pendingChoice` disabled the advance with nothing to click → stuck reveal. Fix: EventRevealScreen
  `awaitingChoice` now ignores `slot.deferred` (a deferred decision is owed later via the
  pendingChoices overlay, which `campaignView` already serves with options); non-deferred choice
  fates still gate inline. Deterministic regression test in `eventReveal.test.jsx`. E2E hardened with
  `clearPendingDecisions()` (drains the deferred-decision overlay after each reveal; no-op otherwise).
- **E2E hardening `917ba7e` (tests + helper, NOT an app fix):** repeat-each e2e runs (choice density is
  now high — ~7 of ~20 events carry choices) exposed a fragile TEST HELPER, not an app bug. Root cause:
  `e2e/helpers.js advanceReveal`'s tight loop re-clicked a choice button while its pick POST was in
  flight — the button goes `disabled` then detaches, and Playwright actionability on that hangs ~30s
  per extra choice, blowing the 90s test timeout once two+ choice-fates land together. Rewrote it as a
  self-healing poll that only clicks an ENABLED choice (`:not([disabled])`), no long blocking waits
  (same guard on `clearPendingDecisions`). Took the spec from ~1/4 flaky (old loop) → ~7/8.
  **The app is PROVEN correct** by three new deterministic `eventReveal.test.jsx` tests (all green):
  two choice-fates in one reveal; a deferred fate that also owes a choice; and **choice → deferred →
  choice** (the exact shape the e2e wedged on — the middle deferred card must not throw off the later
  choice's index/gating). Mocked-network unit tests can't reproduce the residual, which confirms it's
  browser+server TIMING, not logic.
- **✅ SHIPPED 2026-07-19 — the residual multi-choice e2e flake is FIXED (deterministic augur).**
  The real fix the follow-ups below pointed at is done. Two parts:
  - **Server: a test-only `DEV_AUGURY` force hook** (mirrors the existing `DEV_SEED` env idiom;
    OFF and byte-identical in production). `config.js` parses `DEV_AUGURY` into a list of
    `trueId:falseId` specs; `services/augury.js` gained a `forcedSlot()` FIFO (re-seeded each
    `drawAugury()`, consumed by every draw AND reroll) that forces BOTH members of a slot's hidden
    pair — so the shown fate is deterministic whatever the odds/`shownTrue` roll does. It
    deliberately does NOT route through the dice queue (the [augury.js:55] note: a redraw must not
    eat queued consult rolls). Unknown id → random fallback. TDD: 5 new `augury.test.js` cases
    (46/46). The 6 parallel-run failures seen were pre-existing mongodb-memory-server hook timeouts
    under CPU contention — `raid.test.js` (the augury→counter_event path) passes 24/24 in isolation.
  - **e2e wired to force a KNOWN 3-choice, non-deferred reveal.** `docker-compose.yml` + the CI
    `e2e` job set `DEV_AUGURY="merchant_caravan:refugees,sellswords:drillmaster,horses:deserter_lord,refugees:merchant_caravan"`
    (all six are CHOICE events, one pair per severity, all neutral/good valence → no counter-raid
    deferral; the 4th spec covers the spec's slot-0 recast so all three shown fates stay choices).
    `helpers.js advanceReveal` rewritten deterministic: it picks the current card's one open choice
    then WAITS for the advance to re-enable (the precise post-pick sync — no fixed sleeps, no
    re-clicking a busy button), and returns the choice count; `campaign-loop.spec.js` asserts
    `choicesResolved === 3`, PROVING the multi-choice path ran every run.
  - **Bug found & fixed while verifying:** the first rewrite trapped the loop — the `choice-`
    testid prefix also matches the resolved-outcome `<p data-testid="choice-outcome-N">`, so the
    "pick a choice" branch spun on that inert paragraph forever and never clicked Reveal (the old
    helper hid this by checking Reveal first). Fixed by narrowing to `button[data-testid^="choice-"]`.
  - **Verified end-to-end:** stack rebuilt at localhost:5173 with `DEV_AUGURY` live in the
    container; the previously ~1/8-flaky `campaign-loop` spec ran **8/8 then 12/12 = 20 consecutive
    clean** under `--repeat-each`, each hitting the deterministic 3-choice reveal.
- **Follow-ups (not done):**
  - **Event chains/prerequisites** (the long-standing "richer event system" follow-up) — **part 1
    (prerequisites) SHIPPED 2026-07-20** and **part 2 (chains) SHIPPED 2026-07-21**; both fully
    landed. See the dated SHIPPED bullets near the top. `schedule` effect + `scheduledEvents` queue
    drained into forced slots + `chained:true` out of the random pool are all live, proven by the
    `captured_courier → sprung_ambush` chain. Remaining is content only (more authored chains), not
    mechanism.
  - **A live in-browser click-through** of the new choice events (Horses→Cavalry especially). Windows
    serves the built bundle, so `docker compose up --build` is REQUIRED to see 28471e7/d1d97e2/283fce8.
    (Stack WAS rebuilt this session at localhost:5173; rebuild again for anything newer.)

---

## Deferred design backlog (user, 2026-07-05 — ideas only, NOT scheduled, no implementation)

**~~TODO~~ ~~DESIGNED 2026-07-20~~ ✅ BUILT 2026-07-21 — multi-turn campaign loop: persistent enemy
army + a "final battle" meter.** Grilled, designed, and shipped — see the "Boss-fight campaign loop
(meter + decisive battle)" section near the top of this file (right after "Project state"): Stages
A–D + the recon rework + the stance removal are all in `main`; only Stage E (hiring troops) and the
narrative siege reframe remain.

**TODO — squads as the persistent campaign unit (user, 2026-07-20 — idea only, no plan yet).**
[[todo-squads-persistent-unit]]
Direction sketched: squads (already persistent + named, see the 2026-07-13 campaign-squads
shipped entry) become the primary unit players manage — a squad should be able to **absorb**
compatible replacement troops after taking casualties, and even **survive being wiped** (full
rebuild from scratch, identity/name/prestige retained) rather than disbanding as today's
reconciliation does (`campaigns.js` battle route currently disbands a squad whose every tagged
survivor left it). Follow-on ideas bundled with this ask: **prestige** progression (the existing
`_prestige` placeholder, currently unwired — see the test-quality-audit user decision (2) noting
it's "kept" for exactly this), **attaching characters** to a squad so they move with it and
contribute some effect, and a **cavalry rework** so mounted units fight like cavalry rather than
fast infantry — floated idea: a phase where cavalry can disengage, and light cavalry specifically
should be able to pin/slow slower units rather than just trade blows. The cavalry piece overlaps
[[design_mounted_units]] and [[design_pursuit]] (screening/rearguard) in auto-memory. All of this
is idea-stage — needs grilling before scoping into stages.

**Squad-centric overhaul — direction firmed up (user, 2026-07-21).** The above sketch was
grilled and given a concrete shape. The end-state the game is heading toward:

- **Squads are the primary managed unit.** Everything the player commits to an action is a
  squad, not a loose troop count.
- **Prestige is a per-squad currency.** A squad earns prestige and spends it to buy **squad
  upgrades**, each upgrade applying a bonus to *all* the troops in that squad. Upgrade levels
  get **more expensive** each level.
- **Prestige is earned, at first, from raids:** *participating* in a raid grants some prestige;
  a *successful* raid grants more. (Makes the long-standing "prestige stub" in
  `applyRaidReward`/`_prestige` real — see Stages C/D handoffs and the note above.) Other
  earn sources can come later.
- **The raiders upgrade (the first concrete squad upgrade).** A prestige-bought, per-squad,
  escalating-cost upgrade that makes that squad **cheaper to send on raids** — i.e. it
  discounts the squad's `raidCapacityCost` contribution so more/bigger squads fit within an
  opportunity's `capacity`. Cost seam: `raidCapacityCost` (or its per-squad sum) multiplied by
  a `raidDiscount(squad)` that reads the squad's raid-logistics level.
- **Squad-only raiding (see below — the FIRST step, shipping now).** Raids can no longer be
  crewed from loose troops; you send whole squads.
- **Wiped squads can be re-bought / rebuilt** (identity/name/prestige retained) rather than
  disbanding. **Reinforcement:** a squad refills casualties from the general (loose) roster,
  but **only the correct troop type** — though some squads may be intentionally **mixed-type**.
- **Attaching characters to a squad** (spellcasters at this stage) so they ride along and
  contribute an effect. **Open decision: how many characters per squad** (1? a small cap? scale
  with squad prestige/size?). Not yet decided.
- **A way to acquire *more* squads** (recruit/buy new squad slots) — overlaps the deferred Stage
  E hiring plan and the "recruiting a new unit/squad slot that absorbs idle troops" idea above.

Everything in this bullet-list is still design-only EXCEPT the squad-only-raiding step below.
The prestige economy (earning + spending), the raiders upgrade mechanic, attaching characters,
re-buy/reinforcement, and acquiring squads are all deferred and want their own grilled stages.

**Squad-only raiding — ✅ FIRST STEP (user, 2026-07-21).** Raids are launched by sending whole
**squads** instead of hand-picked troop counts. Scoped decisions from the grilling:
- A raid opportunity's party is a **set of squad ids** (`parties[raidId] = [squadId, …]`);
  **multiple squads may stack** onto one opportunity. A squad goes **whole** (its full
  `composition`) — no partial squads.
- **Capacity stays a hard cap:** a party's cost is still `Σ raidCapacityCost` over every troop
  in the sent squads, and must be `≤ opportunity.capacity`. A squad too big for a small target
  simply can't be sent there. (`raidDiscount(squad)` — the raiders-upgrade seam — is noted but
  reads 1.0 for now; nothing spends prestige yet.)
- A squad can only raid **once per turn** (a new `raid.squadAssignment` ledger, the squad twin
  of `raid.assignment`, cleared at `newDay`). Its troops still land in `raid.assignment` too, so
  a raided squad's members remain excluded from the day's other raids and the main battle line.
- Post-raid the squad is **reconciled from its battle survivors** exactly like the main battle
  route (`blue_squads`): composition = survivors, disbanded if the formation was wiped. This
  keeps the invariant `loose = roster − Σ squads.composition − forage`.
- **The `ambush` fate is dropped, and with it `enemy_advance` — 2026-08-08 (user's call).** That
  fate's effect set `bossFightDue` outright, "regardless of the meter" — a leftover from when a
  pitched battle was one engagement among many. It is now the campaign's decisive end (the battle
  route sets `status=won/lost` either way), and since all three of a turn's true fates fire at
  end-of-day out of a ~27-event pool, an ambush drawn on turn 1 ended the whole campaign on turn 2
  — roughly 11% of turns, against a wall meter that needs 10+. The event, its rung ladder, the
  `enemy_advance` branch of `applyEffect`, and its `eventValence` case are all gone. **The wall
  meter is now the only thing that sets `bossFightDue`**, pinned by a new augury test that walks
  every event/rung/choice effect in the pool and asserts none of them sets it. Severity 3 still
  holds 5 unconditional events (decoy peers are fine); `forage_raiders` and `night_raid` remain the
  recon-sensitive ladder events, and the rung tests retarget to `forage_raiders`.
- **The quiet turn no longer offers a battle — fixed 2026-08-08 (UX bug).** Recruiting's exit read
  "Deploy for Battle" and opened the deployment screen on EVERY turn, so from turn 1 the game
  looked like it was offering the decisive battle a dozen turns early — and the screen it opened
  was dead: no `Fight!` (that is `bossFightDue`-only), placement state nothing would read, just an
  "End Turn (no battle)" button. The exit is now `breakCamp` (`frontend/src/stores/flows.js`):
  deployment only on the pitched-battle day, and on a quiet turn the button reads "End the Turn"
  and ends it outright. The placement screen's `end-day` button stays as the no-soft-lock
  guarantee (that screen has no back button). Test helper `marchToDeployment` now REQUIRES a
  `bossFightDue` fixture; `marchToRecruit` is the quiet-turn walk.
- **A raid party auto-deploys as squads — fixed 2026-08-08 (bug).** The party carried `squad_id`
  from the start, but the auto-placer (`makeZonePlacer.add`) scattered it one unit per hex, and
  the engine forms squads by **(hex, squad_id)** — so a raid fielded N one-member "squads" that
  fought as loners with no cohesion or shared morale, while the main battle route worked because
  the frontend drops a whole squad on one hex. Raids now use `makeZonePlacer.addBlock`, the
  server-side twin of that: one squad → one (preferably empty) hex, packed hex-by-hex only if the
  squad is bigger than `hexCapacity`; `squad_name` rides along too, so the replay names the
  formation. Pinned by `enemyPlacement.test.js` (addBlock properties) + a multi-squad party test
  in `raid.test.js`.
- **Deferred alongside this step:** prestige earning from raids (the very next thing), the
  raiders upgrade spend, and the whole rest of the overhaul above.

**~~TODO~~ ✅ SHIPPED 2026-07-18 — tutorial-message pass over every menu/screen (user, 2026-07-18).**
Walked the whole campaign UI and closed the `TutorialIntro` gaps the phased build left. Before this
pass, intros existed on login, start, council/Prepare, forage, camp, omens/augur, raids, the
end-turn `reveal` report, and deployment. **Four screens had none — now filled** (all behind the
`useUiStore` `tutorial` flag, panels reading `s.tutorial` directly per the established no-fan-out
convention):
- **Game-over** (Victory!/Defeat) — `id="gameover"`, copy branches on won/lost + points at New Campaign (`App.jsx`).
- **Battle result** (`BattleResult.jsx`) — `id="result"`; explains survivors are permanent, and the second line adapts to whether a replay is offered.
- **Decisions Await** (the reload-recovery choices-only path in `EventRevealScreen.jsx`) — `id="decisions"`.
- **Replay viewer** (`ReplayView.jsx`, used by demo/raid/campaign replays) — `id="replay"`; glyph=one soldier + scrub-controls hint.
Tests: new `tutorialCoverage.test.jsx` pins all four with the standard flag-on/flag-off contract
(mirrors `eventReveal.test.jsx`). See [[project-tutorial-flag]]. Copy carries the augur-tent's
click-explicit house style.

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
- **Extension idea (user, 2026-08-02, NOT planned yet — BLOCKED on the morale-system design):**
  `combatScore` should also (a) drive morale checks on the losing side of a hex side, and (b)
  force the losing side to fall back a hex under sustained pressure — not just erode
  `fortDurability`. Blocked because the engine already has two half-wired morale layers that
  this would have to reconcile rather than duplicate: per-unit `AUnit::testMorale()` (fires on
  every hit, sets `broken`, already wired into `AUnit.cpp`'s damage path) and squad-collective
  `MoraleState` (`Squad.hpp`/`Squad.cpp` — `Confident/Normal/Scared/Broken`,
  `updateMoraleState()`/`moraleModifier()` fully implemented but **no production caller yet**,
  per the file's own `[PLANNED — unwired]` note). Before this can be scoped: decide whether
  hex-side combat score triggers a NEW check layer, feeds the existing squad `MoraleState`
  machine (finally wiring it in), or just modulates the existing per-unit `testMorale()` odds —
  and what "fall back a hex" means for units mid-engagement (individual flee already exists;
  this would be a forced, side-wide retreat distinct from that). Needs its own grilling session
  before implementation.

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

**~~TODO~~ ✅ DESIGNED 2026-07-20 — raid vs. main-battle turn sequencing.** Resolved as part of the
same grilling session: see point 3 of "Boss-fight campaign loop" above — raiders/foragers get the
same carve-out from the boss-fight roster that foragers alone get today, and the "whole army must
take the field" rejection goes away once the meter/boss-fight mechanic lands (Stage B). Until
Stage B ships, raiding stays independent of the main battle as today (the placeholder this entry
originally described).

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
Engine-backed skirmishes via `battleRunner` on a small map (`max_turns: 30`, watchable replays); tutorial content pass; region map; wood/metal split; flying scout/forager unit; enemy harass duty; character system; **enemy reinforcement schedule + its scouting detection** (prerequisite for the Stage 4 "reinforcement detection" mini-stage); richer event system (chains + prerequisites BOTH shipped 2026-07-20/21 — mechanism complete, only more authored chains remain; distinct from Stage 4's event *transforms*).

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

### Raid mini-game (scouting-points economy) — IN PROGRESS 2026-07-20

Turning the raid phase into a planning mini-game: a per-turn **scouting-points** pool spent to
**scout new targets** or **reveal** a target's hidden reward / per-unit-type enemy strength (ranges →
exact). Full grilled spec + staged design in the plan file
`~/.claude/plans/distributed-cooking-steele.md` (machine-local; summary here for cross-machine).

- **Stage 1 ✅ SHIPPED (commit `c9310f3`, schema v13).** Server core: `raid.scoutingPoints` pool +
  per-opportunity `rewardRange`/`enemyRange` (per unit TYPE — "3 Giants + 20 spearmen", never one
  headcount) + `rewardReveal`/`enemyReveal` LEVELS (int, 0=range 1=exact) + `source`. Points are
  ARMY-derived, not band-derived: `scoutingPointValue = (accuracy/BASELINE_ACCURACY × speed/foot) +
  reconTag`, summed raw over the roster (baseline human ≈ 1 pt), set at both deal sites, expiring at
  turn start. One counter-raid per bad fate (was one total). Retired `RAID_OPPORTUNITIES_PER_DAY`;
  flat raised costs (`RAID_SCOUT_COST_ADD=8`/`REVEAL=3`) are the balance knob. Tests green
  (capabilities + raid).
- **Stage 2 ✅ SHIPPED 2026-07-20 (commit `90ab204`).** `POST /:id/raids/scout` route in
  `routes/campaigns.js`:
  `{action:'add_target'}` (cost `RAID_SCOUT_COST_ADD`, rejects on insufficient points or an exhausted
  enemy host) and `{action:'reveal', raidId, field:'reward'|'enemy'}` (cost `RAID_SCOUT_COST_REVEAL`,
  rejects on missing/resolved target, already-max reveal level, insufficient points, or a slot-only
  `counter_event` reward with nothing numeric to reveal). Both guarded the same way as
  `/raids/launch` (ownership/active/pending-choice). `campaignView`'s raid projection
  (`services/campaignView.js`) now exposes per-opportunity `enemy`/`reward` as a range pre-reveal and
  the exact value once bought (a `rewardView` helper keys the exact side off `rewardRange`'s own keys,
  never the raw `reward`, so a counter_event's `reward.slot` can't leak even after a reveal — its
  `rewardRange` is null so there's nothing to buy), plus `enemyReveal`/`rewardReveal`/`source` and a
  new `raid.scoutingPoints` + `raid.scoutCost` block. Updated the 3 existing hidden-info discipline
  tests (`raid.test.js`, `campaigns.test.js`, `enemyAi.test.js`) for the new opportunity key set, plus
  11 new scout-route tests (add/reveal happy paths, cost/exhaustion/already-revealed rejections, the
  counter_event slot-leak guard, 404/400s). **campaign-server: 281/281 green** (verified in the user's
  own terminal — see the sandbox note below).
- **Stage 3 ✅ SHIPPED 2026-07-20 (frontend only, uncommitted).** The raids phase/screen already
  existed (phased-turn slice 1, 2026-07-18) — what was missing was the mini-game UI on top of the
  Stage 1/2 server surface. `RaidPanel.jsx`: a `.raid-scouting-header` shows the pool
  (`raid-points`, floored) + a "Scout new target (−N)" button (`raid-scout-add`, cost
  `raid.scoutCost.addTarget`); each unresolved card gains a `.raid-intel` block — a reward line
  (`raid-reward-<id>`, only rendered when the type has a numeric reward — destroy_detachment/
  counter_event have none) and an enemy line (`raid-enemy-<id>`, always present, per-type), each
  with its own "Reveal (−N)" button (`raid-reveal-reward-<id>`/`raid-reveal-enemy-<id>`) that
  disappears once that field's reveal level is ≥1. A shared `formatAmount`/`rewardParts` renders a
  `[lo,hi]` range or the exact value identically either side of the reveal — the JSX doesn't need
  to know which it got. `onScout` prop (new, alongside `onLaunchAll`/`onWatch`) wired through
  `App.jsx` → `guarded(scoutRaid)`; `useCampaignStore.scoutRaid(body)` → `api.scoutRaidTarget(id,
  body)` → `POST /:id/raids/scout`, swapping in the refreshed view like every other campaign
  action. Buttons disabled on `scoutBusy` (a dedicated flag, separate from the party-launch `busy`
  so a reveal click doesn't grey out the unrelated Launch button) or insufficient points — pure
  client-side convenience, the server re-validates identically. Resolved cards render no intel
  block (nothing left to scout on a finished raid). Minimal CSS (`.raid-scouting-header`,
  `.raid-intel`). Tests: `raidPanel.test.jsx` fixtures (`OPPORTUNITY`/`OPPORTUNITY_2`, `withRaid`)
  gained `reward`/`enemy`/`*Reveal`/`source`/`scoutingPoints`/`scoutCost`; a new "scouting
  mini-game" describe block (6 tests: points+ranges render, reward reveal swaps to exact +
  spends points, enemy reveal likewise, add-target appends a card + spends points, buttons
  disable when short, resolved cards show no intel). **225/225 frontend green, oxlint clean.**
  **Manually verified in a real browser** (native `make server-node` + `make frontend` on this
  Linux box — no Docker/mongod needed, `index.js` falls back to an embedded
  `mongodb-memory-server` when `MONGODB_URI` is unset, and seeds the `testuser`/`test` dev login)
  via a throwaway Playwright script driving a fresh campaign through Prepare → Omens → Accept the
  Fates → Raids: the points header, ranges, and Scout/Reveal buttons rendered correctly; clicking
  "Reveal" on the enemy line flipped `"21–35 Soldier, …"` to exact counts and dropped
  `raid.scoutingPoints` by exactly the reveal cost; clicking "Scout new target" appended a new
  card and dropped points by the add cost. Screenshots taken, then the scratch spec/screenshots
  discarded (not part of the permanent `e2e/` suite). **Not yet committed** — still on the working
  tree pending the user's own review pass.

**Dev-tooling fix landed alongside Stage 2:** `scripts/dev.sh` now auto-detects a Flatpak sandbox
(`/.flatpak-info` present) and, only then, exports `MONGOMS_DISTRO=ubuntu-22.04` +
`--no-file-parallelism` for `cs-test` — a no-op on every other machine. It also sources
`~/.nvm/nvm.sh` itself when `npx` isn't already on `PATH`, so plain `bash scripts/dev.sh cs-test …`
works standalone without a `bash -lc` wrapper. **Sandbox caveat found this session:** on the laptop,
running `cs-test` from the coding assistant's own shell can intermittently hang/time out on the
`beforeEach` `clearDb()` hook — even a single isolated test file, even with the flags above — because
VS Code's own TS-server/ESLint/GPU subprocesses share the same sandboxed resource envelope as the
in-memory `mongod`. Two clean back-to-back runs (before/without that contention) passed 122/122 in
~26s each, and the user's own terminal ran the full suite clean (281/281, 94s) — so this is
environment contention, not a real flake; **prefer running `cs-test` from the user's own terminal on
this machine**, not the assistant's sandboxed shell.

**Deferred asks logged this session (not in the plan above):** (1) archery rework — rescale accuracy
to avg-10 + give archers control roles (taunt/hold/disrupt) beyond DPS [engine work]; (2) install the
`grill-me` skill (github.com/mattpocock/skills .../grill-me) + add a "grill the spec before building
complex features" rule to CLAUDE.md. **Laptop note:** campaign-server tests here need
`MONGOMS_DISTRO=ubuntu-22.04` + `--no-file-parallelism` (Flatpak sandbox) — now automatic via
`scripts/dev.sh`, see the sandbox caveat above for where it still needs the user's own terminal.
