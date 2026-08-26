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

### Where the work stands (2026-08-25) — START HERE

**▶▶ THE LIVE FRONT IS THE MAGIC SYSTEM, AND IT IS NOT IN THIS BLOCK — it is under "THE MAGIC
SYSTEM" further down.** Schema is **v42** (`CAMPAIGN_SCHEMA_VERSION` in models/campaign.js is the
authority; the v35/v36 talk below is 2026-08-24 history that was true when it was written). Read
this order to pick the work up cold:

1. **"THE MAGIC SYSTEM"** — twenty-six decisions (M-1..M-26), then "SLICE 2 — THE CAMPAIGN LAYER"
   (S2-1..S2-14), "SLICE 3 — THE STUDY" (S3-1..S3-6) and "SLICE 4 — CHOSEN SPELLS" (S4-1..S4-9).
   **All fifty-five are the user's; do not re-derive them.**
2. **M-15'S FOUR SLICES ARE ALL SHIPPED and on `main`** (2026-08-25). Spells fire in real battles
   from campaign research state, The Study renders what that research has bought, and a caster can
   be told what to reach for first.
3. **TIERED BATTLE LOGGING IS BUILT** (2026-08-25, six decisions L-1..L-6 under "TIERED BATTLE
   LOGGING") — three tiers all persisted with the browser filtering, a Catch2 capture that dumps the
   fight only when a test fails, and an end-of-turn sweep that deletes battles nobody can watch. It
   came out of S4-8's TODO; that TODO is now history, not work.
4. **▶▶ NEXT UP, THE USER'S CHOICE (2026-08-25): CONSTRUCTION — and a standing content task.**
   Two things, taken together because the first is what makes the second worth doing:

   - **CONSTRUCTION / CRAFTING.** The fourth school ships hollow (M-9), The Study renders it empty
     (S3-5), and 9-7 already named crafting as one of the four channels an item can arrive through
     — *"Loot, purchase, crafting, events"* — with only loot and events built. **It has never been
     interviewed. Interview it before building** (CLAUDE.md's standing rule): what a workshop IS,
     what it consumes, whether a crafted item is permanent like a bound banner, and how a
     Construction level gates any of it are all open. Nothing here is a blank page — M-9, 9-7 and
     S3-5 each say what the thing is FOR — but none of them says what it does.
   - **ADDING UNITS, ITEMS AND SPELLS** — recorded in the user's own words as a task of its own.
     **Which reading is meant is NOT settled and should be the interview's first question:** more
     CONTENT authored against the catalogs that exist, or better TOOLING so authoring one is
     cheap. `docs/ADDING_UNITS.md` already documents the unit path (and §5 pins the role↔config
     tests); items and spells have no equivalent. Construction is the natural forcing function
     either way, since a crafting system with three items to make is a menu, not a system.

5. **THERE IS NO SLICE 5 OF THE MAGIC SYSTEM SPEC'D.** What the interviews deliberately left for
   later, and where each is recorded: **a store of
   authored enemy scripts** assigned at random to match a caster's paths (S4-6); **a real cast AI**
   scoring a simulated cast (M-22), which is also where per-form priority is decided (S4-2 amends
   M-13 to per-spell until then); **stances** (M-12); **empowerment** (M-5); **Construction's
   content**, waiting on crafting's own interview (M-9/9-7). None is started; each is a decision
   already taken about what the thing IS, not a blank.

Everything in the rest of this block is the squad/character/items front, which is FINISHED —
decision 13 and slice 17 both shipped. It is kept as the record of how those systems got their
shape, and it is still the place to look before touching a squad, a charter or an item.

The rest of this block, as written on 2026-08-24. Schema version **35**
(this block read 34 until 2026-08-18; `CAMPAIGN_SCHEMA_VERSION` in models/campaign.js is the
authority, and 4a bumped it. 4b, 4c and 4d needed no bump — none of them changed the document
shape). **Slice 5a bumps it to 36** — `campaign.character` (singular, Mixed, a placeholder)
becomes `campaign.characters` (an array of real entities).
**Slice 4 IS DONE — 1, 2, 3, 4a, 4b, 4c and 4d of the squad overhaul are all SHIPPED**, 4d
(Royal Guard) as of 2026-08-18. **SLICE 5a IS SHIPPED (2026-08-19, schema v36)** — casters are
characters, hired by name, postable to a squad, riding into battles and raids, and permanently
losable. Its twelve decisions are under "SLICE 5 — CHARACTERS" below, and they are the user's; do
not re-derive them.

**SLICE 6 — BANNERS, ITEMS AND THE ABILITY SYSTEM — IS SHIPPED (2026-08-20, schema v37).** Its fifteen decisions are under "SLICE 6" below and they are the user's. It bumps the
schema to **v37** (`campaign.items`, the store; `squads[].banner`, the bound id). It is bigger than
its name: the interview turned "what does a banner do" into **the engine's ability system** — a
unit is stats + anatomy + abilities (6-1), `bool undead` splits into four composable flags behind
an implication closure (6-3, 6-4), and a banner's gift is scoped to squad MEMBERSHIP rather than to
`broken` (6-6).

**DECISION 13 IS DONE — BOTH SLICES SHIPPED (A 2026-08-21, B 2026-08-22). The squad overhaul is
finished. SLICE 17, THE STORAGE PAGE, IS ALSO SHIPPED (2026-08-23, no schema bump)** — its seven
decisions and what they built are under "SLICE 17" below. Two standing rules came out of it and
bind every later slice: **assignment happens at the target's screen, never at a store** (17-3), and
**the server phrases every item; the client composes no sentence** (17-5). What follows in this block is the record of
13's interview and what it built; the "SLICE B IS SHIPPED" note below it is what a later slice needs
to know. Decision 12 (a squad tied up for X turns) SHIPPED 2026-08-24 as MISSIONS,
schema v39 — see "DECISION 12 — MISSIONS" below. (This line said "still unbuilt" until 2026-08-25;
it was written before the mechanic had a name and never updated.)

**DECISION 13 — THE SQUAD INSPECTION SCREEN (user, 2026-08-20: "13 is good").** The last
of the squad overhaul, and the one that RENDERS everything the other twelve built. Decision 13
already lists what it must show — composition against the per-type caps, prestige rank, banner tier
and what it grants, attached character, availability (free / raiding / tied up) — but that is a
CONTENTS LIST, not a design, and three panels are waiting to be absorbed into it:
`SquadUpgradePanel` (which now also carries slice 6's banner slot), `SquadReinforcePanel`, and
`CharacterPanel`, each of which says in its own header that it is deliberately plain until this
screen exists.

**INTERVIEW BEFORE BUILDING IT.** It is the largest UI decision in the campaign layer and the
first screen that is a design rather than a mechanic, so it is exactly what the `grilling` skill
in CLAUDE.md is for. Do not start from the contents list and guess a layout.

**THE INTERVIEW IS UNDER WAY — ten decisions taken so far (user, 2026-08-20/21), recorded here
because a `/clear` ate the first batch once already.** They are the user's; do not re-derive them.
The rest of the interview continues from 13-11 below.

**13-1. THE SCREEN IS THE HUB, not a display case.** It absorbs the actions, and
`SquadUpgradePanel`, `SquadReinforcePanel` and `CharacterPanel` are DELETED rather than left
beside it. Every one of those actions needs the same context the screen exists to show (composition
against caps, slots against rank, who is already posted), so a look-here/act-there split would
build that context twice. Rejected: read-only inspection (the screen becomes a thing you visit, and
the army is still managed in three places).

**13-2. REINFORCEMENT BECOMES AUTOMATIC — there is no player action left** (user: *"reinforcements
happen automatically"*). At turn end every charter under its caps pulls from the loose pool up to
its archetype's intake, server-side. `POST /:id/squads/:squadId/reinforce` and its panel GO. This
is decision 14's own wording made real ("it refills through the ordinary per-turn intake, taking
suitable troops from the loose pool"), and it is why 13-1 has one less action to absorb than the
handoff above predicted. Rejected: standing orders per charter, and a manual path kept for
deliberate shaping — both re-admit the per-turn fiddling the decision exists to remove.

**13-3. IT STILL COSTS, auto-spent and reported.** The refill pays the same `SQUAD_REINFORCE_POOL`
prices (plus the squad's `reinforceSurcharge`) out of the treasury, fills as far as the money goes,
and stops. Every number in `docs/BALANCE_SHEET.md` survives and 4d's "the ongoing cost IS
reinforcement" stays true — a mauled guard cohort still bleeds 5 gold a body. Rejected: free
refills (a real gold/materials sink vanishes and RoyalGuard's dear recipe stops being a downside)
and free-for-the-rank-and-file (a rule with an exception in it). The price of spending money
without asking is 13-6.

**13-4. WHEN IT RUNS SHORT, CHARTERS FILL IN ROLL ORDER — flat, oldest first.** Predictable, no new
concept, and the shortfall lands on whoever is last. Rejected: most-decorated-first (prestige
already gates three other things) and neediest-first (elite squads would be fed last exactly when
you want them ready).

**13-5. INSIDE A CHARTER, THE CAPS TABLE'S DECLARED ORDER DECIDES — primary type first.** `line` is
`{Soldier, Pikeman}` and `skirmish` is `{Archer, Militia}`, already written primary-first, so a
line charter fills soldiers to cap before it touches pikemen and stays recognisably a line charter.
A designer retunes it by reordering one line. Rejected: biggest-hole-first (a bad battle rewrites
what the squad IS) and proportional (rounding rules, and a refill you cannot predict body by body).

**13-6. THE REFILL IS FORECAST ON THE SCREEN AND RECORDED IN THE REPORT.** The charter shows what
will join at turn's end and what it will cost *before* it happens ("6 Soldiers join — 12 gold, 12
materials", or "nothing: the loose pool is empty"); the day report says what actually arrived and
what was spent. The forecast is what turns the screen from a scoreboard into a planning tool — it
is how a player learns that raiding for gold this turn is what refills the line next turn — and it
is the answer to 13-3 spending money unasked.

**13-7. IT IS A TAKEOVER, REACHABLE FROM THE HUD IN EVERY PHASE.** Back returns to the phase you
were on, the `ItemStorePanel`/`ReplayView` pattern that already works. Squads matter in every phase
(picked for raids, placed at deploy, posted to in prepare) and two of its three actions have no
server phase gate, so binding it to one phase would hide it for most of the turn. Rejected: a new
step in the turn ladder (another mandatory click on quiet turns, and unreachable while deciding a
raid) and a panel inside `RecruitPanel` (stays a panel; unreachable when you most want it).

**13-8. THE SHAPE IS A ROLL → A PAGE PER CHARTER** (user: *"list of units, clicking them will
redirect to the units page so it will scale well, the test campaign doesnt mean anything for scale
of the real game"*). Not cards side by side: the design target is an army of many charters, not
today's three. There is no router in `frontend/` — the page swap is UI state in `useUiStore`, the
way `storeRequest` already takes over the screen.

**13-9. THE ROLL IS THE WHOLE ARMY: charters, then the loose pool, then unposted characters.** The
loose pool is now the fuel every refill eats (13-2), so "why did nothing join?" must be answerable
on the same page that shows the shortfall; an unattached caster is a resource going to waste and
needs somewhere to be seen. Rejected: a charters-only list (cause and effect on different screens,
and `CharacterPanel` survives after all).

**13-10. THE CHARTER PAGE SHOWS TROOP TYPES AS ROWS — counts against caps**, plus rank, banner,
posted character, upgrades and free slots, availability, the pending refill, and the actions.
Composition IS counts by type; only characters are individuals. Rejected for later slices of their
own: a page per troop type (the engine's unit catalog surfacing to the player — a real feature, not
this one) and modelling every body as a named individual (composition, reinforcement, casualties
and the battle round-trip all stop being counts).

**13-11. AVAILABILITY RENDERS ONLY WHAT EXISTS — free, or out raiding today.** The screen does NOT
get decision 12's "tied up for X turns" state, and 12 does not fold into this slice. The reason is
12's own: a tie-up and the event that REQUIRES a squad are two halves of one readable trade and
must ship together, or the cost lands uncompensated. Building the display half here would mean
rendering a state nothing in the game can put a squad into. Also rejected: rendering all three
states with the third unreachable — a branch no test can reach through the game is how a stale
reader survives (the 4c lesson, `8027892 fix(campaign): stop a self-skipping test from hiding a
stale reader`). When 12 lands, the screen learns the third state then.

**SLICE A IS SHIPPED (2026-08-21, schema v38)** — the refill runs, the route and the panel are
gone, and 13-17 rode along. What slice B needs to know before it starts:

- **`planAutoRefill` IS the forecast.** 13-6's on-screen "6 Soldiers join — 12 gold" is that
  function called against today's pool and purse; do not compute a preview a second way, or the
  screen and the turn will drift the moment a gate changes.
- **The view lost `reinforceRecipes`, `reinforceSurcharge` and `reinforcedToday`** with the panel
  that read them. `caps`, `intake` and `loose` stayed, because the screen shows all three.
- **The forecast is a PREDICTION, and an honest one has to say so.** It is computed against tonight's
  numbers; a raid fought afterwards changes the purse, and every charter ahead of this one in the
  roll spends before it does (13-4). A forecast rendered as a promise will look like a bug the first
  time a raid moves it.
- **`refillSquads` is the only caller of `applyReinforcement`.** If slice B wants a "what would
  happen" endpoint, it calls `planAutoRefill` and never `apply`.

**SLICE B IS SHIPPED (2026-08-22, no schema bump)** — decision 13 is DONE, and with it the squad
overhaul. The screen exists: a takeover opened from the HUD in every phase, a roll of the whole
army, a page per charter, the refill forecast on it, and the honours and company screens hanging
off it. 13-18 rode along, so nothing of slice 5a is API-only any more. What the next slice needs to
know:

- **A PENDING FATE OUTRANKS THE SCREEN, and the item store with it.** Every action either one
  offers — upgrades, banner binding, attachment, hang-back — is a route guarded by
  `rejectIfChoicePending`, so both render BELOW the pending-choices overlay and the HUD hides its
  door while a decision is owed. The store used to sit ABOVE it on the strength of a comment saying
  binding "is not a campaign action the server 409s on"; `POST /squads/:id/banner` carries the same
  guard as the rest, so that was simply false. Both orderings are now pinned by tests in
  `squadScreen.test.jsx` rather than by a comment — which is the lesson: a claim about what the
  server does belongs in a test, because a comment that drifts takes the layout with it.
- **The forecast is `planAutoRefill`, walked once for the whole army.** `forecastRefills(campaign,
  sizeOf)` in `services/squadReinforce.js` is `refillSquads` with the spending simulated instead of
  done — same order, same shared pool and purse (13-4). The two are pinned together by an agreement
  test that forecasts a campaign, then applies the pass to it and demands the same bodies. **Do not
  add a second preview path**; if a gate moves, move it in `planAutoRefill` and both follow.
- **A null plan cannot say WHY, so `refillBlocker` does** — one word, one of
  `pool｜cost｜space｜intake｜full｜none`, reached only when the plan came back empty. Where two types
  are blocked differently the one with the most ROOM decides, because that is the shortfall the
  player came to the screen about. The client phrases it (`BLOCKED` in `SquadCharterPage.jsx`) and
  phrases nothing else.
- **The view grew `squads[].refill` and `squads[].nextRank`** and nothing else. `nextRank` is
  `{label, at}` or null at the top of the ladder — shipped because SQUAD_RANKS is one server-side
  constant, and a client copy of the thresholds goes stale the first time they are retuned.
- **`SquadUpgradePanel` is now the DRAFT and nothing else.** What a charter HOLDS — its banner, its
  honours, its slots — moved to the charter page. Two screens listing a squad's honours is exactly
  the "managed in three places" 13-1 exists to end, so if a later slice wants the held list back,
  it moves rather than copies.
- **`RecruitPanel` keeps only a POINTER to the honours** ("An honour waits… Go to the army"). It
  takes no `onTakeUpgrade` any more.
- **Character placement is client-side only.** The battle route has accepted `character_id`
  entries since 5a; 13-18 just gave them a screen. `usePlacementStore.characterPlacements` is
  `{characterId: {col, row}}`, and only an UNATTACHED living character ever appears in it — an
  attached one is seated by the server on their squad's hex (5-8), and offering them at deploy
  would field the same person twice.
- **A placed character is counted APART from the troops.** The "whole army must take the field"
  gate is roster arithmetic and a character is not a roster count (5-1), so folding them into
  `placedCount` would break the in-camp sum on both sides of the wire. Leaving a caster in camp
  does not hold up the battle, server-side or on screen.

**What 13 did NOT ship, deliberately:** decision 12's "tied up for X turns" availability (13-11 —
it lands with the event that requires a squad, not before), and decision 17's storage page, which
`ItemStorePanel` was the deliberately-plain placeholder for. **17 HAS SINCE SHIPPED (2026-08-23) —
its seven decisions are spec'd in full under "SLICE 17 — THE STORAGE PAGE" below, and they are the
user's; do not re-derive them.** Two of them reach past the slice: assignment always happens at the
TARGET's screen (17-3), and a read-only screen stays open while a fate is owed (17-6). **Decision 12 has since SHIPPED too (2026-08-24, schema v39), so nothing 13 named is
outstanding.** The mechanic is called a MISSION; its seven decisions are under "DECISION 12 —
MISSIONS" below and they are the user's. Two things there bind later work: 12-3 amends decision 12's
own instruction about how "busy" is stored (two notions, not one), and the write-up carries a
CORRECTION to what the assistant claimed about the boss-fight meter during the interview.

**▶ DECISION 9 IS DONE — 9a SHIPPED 2026-08-24 (schema v40) AND 9b THE SAME DAY (no schema bump).**
With 12 shipped, the squad overhaul's seventeen decisions are all built except 11 (acquiring squads)
and 16 (the basic banner's benefit, deliberately deferred until the surrounding systems can be
played). Decision 9's equipment was the seam 5a shipped empty, and 9a filled it: **its sixteen
decisions are under "DECISION 9 — CHARACTER EQUIPMENT" below and they are the user's; do not
re-derive them.** What each slice built is under "9a SHIPPED" and "9b SHIPPED" in that
section. Three things there reach past the slice: gear may both ADD and REMOVE abilities, kept safe
by ORDER rather than by a rule (9-4); banners sit outside the whole loot and recovery path in both
directions (9-12); and the user's direction that `reconTag` should become an ability rather than a
value is still an OPEN future change to the recon formula (9-5), deliberately not folded into gear.

**9b was 9-16: a PAGE PER CHARACTER**, and it is built — reached from the company roll, with base
stats and modifiers folded, every slot and what fills it, equip/unequip against the store, and the
posting and hang-back orders that used to live on `CharacterPanel`. The handoff above claimed every
number it needed was already on the wire; that was nearly true and the gap is worth naming, because
it is the shape of the next such gap: `mods` crossed but the BASE stats never did, so a sheet could
have shown "+1 defence" and not "defence 5". The fold is server-side now (`characterSheet`), for
the reason the charter page states — every number on a campaign screen is the server's.

**WHAT THE NEXT SLICE SHOULD KNOW.** Nothing 9 named is outstanding. The open ends are decision 11
(acquiring squads), decision 16 (the basic banner's benefit), 9-7's purchase and crafting channels
(each needs prices and a call on what they compete with — their own interview), and 9-5's `reconTag`
rework. **The engine-side scoping bug 9a recorded and 9b left standing is FIXED (2026-08-25, no
schema bump)** — see "THE CARRIED SET" immediately below.

**THE CARRIED SET — the gear-on-a-loose-body fix (2026-08-25, no schema bump).** The bug: a
gear-granted ability on a character posted to no charter never reached the field. Both gifts — the
banner's and the gear's — were merged onto the one wire field `squad_abilities`, and
`AUnit::abilities()` holds that set only while the unit is in a squad (6-6). A loose character is
in no squad, so their own helm's word was parsed, stored and then silently ignored.

**The fix is a third set, and what separates the three is SCOPE, not source.** `_grantedAbilities`
(wire: `squad_abilities`) is what something OUTSIDE the body gave it and stays squad-scoped;
`_carriedAbilities` (wire: `carried_abilities`) is what the body's own gear gave it and is scoped
to nothing — it goes where the body goes, onto a loose unit and away with a man who breaks, exactly
as gear's DENIAL already did. 6-7 is untouched: the engine still learns the word `fearless` and
never the word `helm`. What the field name tells it is the scope.

What a later slice needs to know:

- **Never fold gear onto `squad_abilities` again.** That merge IS the bug. `characterEntryFor` and
  `bearerEntry` each send the two separately now, and a test on each pins a loose body keeping its
  gift.
- **The order in `abilities()` is still the safety argument (9-4), now over three sets.** The
  carried set is folded in BEFORE the denial is subtracted, so one item denying what another grants
  resolves as *denial wins*, and the implication closure still runs last.
- **A forged `carried_abilities` is stripped unconditionally at the route**, like a forged denial
  and unlike a forged `squad_abilities` (which is overwritten from the squad). A rank-and-file body
  wears no gear, so there is no legitimate value to overwrite it with — and this field bypasses
  squad scoping, so it is the one an attacker would want most.
- **The enemy champion's `squad_id` is no longer load-bearing.** `bearerEntry` tagged him into a
  one-man squad *because* of this bug; the tag stays (the replay names his formation by it) but his
  relic no longer depends on it, and both comments now say so.

**⚠️ CORRECTION, ON THE USER'S INSTRUCTION (2026-08-24): THERE IS NO NIGHTLY BATTLE, AND THERE HAS
NOT BEEN FOR A LONG TIME.** Several older passages in this file still talk about "tonight's battle",
a nightfall departure, or "the day's main battle" as though a pitched battle were fought every turn.
That was retired ages ago and the phrasing is a leftover figure of speech. **`POST /:id/battles`
refuses with 400 unless `campaign.bossFightDue` is set** — the ONLY battle is the decisive boss
fight, and raids are the only other way to fight. Read every "tonight" in the older write-ups as
"end of turn". This block is the authority; the older wording below is history, not a spec.

**▶ THE MAGIC SYSTEM — ALL FOUR OF M-15'S SLICES ARE BUILT (interviewed and shipped 2026-08-25).**
The biggest system the project has taken on: **twenty-six decisions under "THE MAGIC SYSTEM" below,
fourteen more under "SLICE 2 — THE CAMPAIGN LAYER", six under "SLICE 3 — THE STUDY" and nine under
"SLICE 4 — CHOSEN SPELLS", all the user's — do not re-derive them.** Modelled deliberately on
Dominions, with the source checked rather than recalled. See "SLICE 1 SHIPPED", "WHAT SLICE 2
ACTUALLY LANDED", "SLICE 3 SHIPPED" and "WHAT SLICE 4 ACTUALLY LANDED" at the end of that section
for what each landed and what is still stubbed. **A spell now fires from campaign state rather than
from an engine default** (slice 2's whole point), **the player can see what their research is buying
them** (slice 3's), and **a caster can be told what to reach for first** (slice 4's).

**▶▶ SLICE 4 — CHOSEN SPELLS — IS SHIPPED (2026-08-25); its nine decisions are under "SLICE 4 —
CHOSEN SPELLS" at the end of this section.** It is where the granted paths finally surfaced: S3-2
kept Holy and Unholy off The Study because they are had rather than earned (M-14), so **a Priest's
sheet is the first screen in the project on which `bless` is named at all** — and it needed no
decision of its own, falling straight out of S4-3's "offer what he can cast today".

M-22 predicted the shape and was right: **the walk was already a script**, so the player's list
replaced the default one and no second selection path was written. The user's original sketch —
*"one option for the battle scripting would be to have all mages equip x spells and then those
spells would be used in the AI part of battle"* — was interviewed rather than built, and the
interview moved it: an equipped SET reads as a restriction, and S4-1 made it a preference instead.

**A trap the interview caught, worth the same shelf as slice 3's below.** The assistant reached for
S2-12 (the research focus is `prepare`-only) as a precedent for when a script may be edited. It is
not one: the focus is an ARMY-WIDE POOLED allocation (M-7), not an order given to a person, so it
says nothing about a per-character screen. **Check that a precedent is about the same KIND of thing
before leaning on it** — the two decisions sit a few paragraphs apart and read alike.

**▶▶ THE ONE THING SLICE 3 GOT WRONG BEFORE IT STARTED, recorded because the mistake is
instructive.** The handoff written for it said, in bold, that it was a PURE UI slice needing no route
and no schema work — reasoning from S2-1, which really had finished the server's half of the
*research* state. **It was wrong, and the interview caught it in its first question.** M-15's own
one-line brief for slice 3 is "the research screen — directing the school, **seeing what is
unlocked**", and nothing campaign-side had ever heard of a spell: the engine's roster carried machine
ids and `minor`/`major`, no display names and no prose, and `./game info` exported units and terrain
only. Directing the school needed no server work; seeing what is unlocked needed an engine export
that did not exist.

The lesson is not that S2-1 failed — it did exactly what it promised. It is that **"the server is
finished for it" was checked against the state the screen would MUTATE and not against the data the
screen would READ.** A handoff that names a slice pure UI is making a claim about both halves.

(What stayed true: slice 3 added **no route and no schema bump**. The catalog is read-only reference
data, so it needed neither — see S3-1.)

**SLICE 2 IS BUILT AND SHIPPED (2026-08-25).** A second interview settled the thirteen things
M-15's one-line "campaign" bullet left open — the hire roll, where a fresh campaign's research
starts, what feeds it, the channel table, the enemy's declared level, and the phase the focus is
chosen in — and a fourteenth (S2-14) came out of building it. **See "SLICE 2 — THE CAMPAIGN LAYER"
at the end of the magic section for the decisions and for what landed against each.** Slice 3 is
next, and it is a PURE UI slice: the research screen, against a server that already answers every
question it will ask (S2-1).

**A CORRECTION TO WHAT THIS FILE USED TO SAY, established by running the binary while building slice
1: magic was NOT dead code.** The "WHAT EXISTS TODAY" paragraph below claimed `mana` is never seeded
outside tests and no spell had ever fired. In fact `Mage`, `Priest` and `Necromancer` all seeded
`mana = 99` in their constructors, and `./game sample` — which fields 7 Mages, 7 Priests and 11
Necromancers — logged bless casts on every run. Slice 1 was therefore a **live balance change to
battles that already happened**, not a no-op on dead code. The paragraph is kept below as the record
of what was believed, because the belief is what justified M-1's "nothing is being taken away".

Four things in the spec reach past the system: **mana is deleted and casting costs FATIGUE**
(M-1), which runs past the ceiling into real damage (M-2); **banners become the army-wide magical
allowance** (M-11), which AMENDS decision 10's per-squad wording and finally ANSWERS decision 16's
deferred benefit; **there is no player magic and enemy magic, only one system** (M-17), with the
enemy's research level declared by the ENCOUNTER (M-19); and paths run 1-9 because **the current
campaign is only act one** (M-16) and the design is not to be trimmed to fit it.

**13-12. IT SHIPS AS TWO SLICES, THE REFILL FIRST.** Slice A is server-side and playable on its
own — the end-of-turn refill, the treasury spend, the report line, `POST /reinforce` and
`SquadReinforcePanel` deleted — and nothing is lost in the gap, because the mechanic it removes is
replaced by one that runs itself. Slice B is then a pure UI slice against a settled server, and
13-6's forecast calls arithmetic that already exists rather than one invented alongside the screen
that renders it. Rejected: one big slice (a diff spanning server logic and the largest campaign UI,
where a red CI means bisecting across two unrelated kinds of change) and screen-first (it would
mean building a reinforcement form we have already decided to throw away).

**13-13. THE REFILL DRAINS THE LOOSE POOL — the army IS its charters.** Nothing protects the pool:
charters fill to their caps and whatever they cannot hold stays loose, so the pool empties early
(total caps 102 against a starting army of ~76) and refills on its own once the charters are full.
The system is self-limiting, and hiring a type no charter admits is how a loose contingent is built
deliberately. **The consequence to watch:** `HexGrid` hand-places loose bodies straight from
`campaign.roster`, so for the first several turns there will be almost nothing to hand-place at
deploy. Rejected: a protected reserve (a new number to tune, and charters under strength while
bodies sit idle) and a one-turn grace for fresh hires (roster counts have no identity to age).

**13-14. PRESTIGE READS AS RANK AND RAW NUMBERS, WITH NO PROMISES** — "Blooded — 18 prestige, next
rung at 25". The ladder is legible and the numbers are honest, but the page does not editorialise
about what a rung is worth; you learn that when the draft or the banner arrives. The server ships
the threshold (the client never re-derives campaign math). Rejected: the rank word alone (a system
the player can feel but never plan around) and naming the next rung's grant (turns the page into a
progress bar).

**13-15. THE UPGRADE SCREEN SURVIVES AS A SCREEN, REACHED FROM THE SQUAD SCREEN** (user,
2026-08-21: *"we can just keep the upgrade screen accessible from the squad screen, mark the squads
that can be upgraded in the screen where you have all squads"*). The roll marks which charters have
a draft waiting; the three cards and their permanence confirm live on their own screen. **This
amends 13-1**: the panels are not all dissolved into the charter page. The squad screen is the HUB
you navigate FROM — which is how `ItemStorePanel` already works (a `storeRequest` takeover reached
from the banner slot), so the pattern is the house one rather than a new idea.

**13-16. THE CHARACTER SCREEN LIKEWISE STAYS A SCREEN, reached from the squad screen.** The full
roll of the living and the fallen, the attachment picker and the hang-back toggle keep a place of
their own — 5-9's roll of the dead has nowhere to live on a charter page — and the charter page
shows who is posted with a way through. Rejected: folding it into the charter page, and doing both
(two code paths for one mutation).

**13-17. MEMBERSHIP MEANS MEMBERSHIP — an attached character DOES receive their squad's
`squad_mods`.** The gap flagged at the end of slice 6 is closed rather than left: 5-0 already says a
character is a special kind of troop and 6-6 already scopes the banner's gift to squad MEMBERSHIP,
so a third neighbouring system answering "does this reach the character?" differently was an
inconsistency, not a design. Posting a character to your best-drilled cohort is now worth what it
looks like. Small server change; it rides with slice A.

**13-18. SLICE B CLOSES 5a's DEPLOY LOOSE END** — the deploy screen learns to place an unattached
character. It is the last thing keeping a shipped feature reachable only through the API, and it is
what 5-12 was for when it started all six casters unposted.

After it: 17's storage page (which `ItemStorePanel` is the deliberately-plain placeholder for).

**What 6 leaves for the next slice to know:**
- **`squad.banner` in the VIEW is a tier word, not a boolean** — `'plain' | 'basic' | 'item'`.
  Every squad carries a plain banner, so `if (squad.banner)` is true for the whole army and means
  nothing. The panel had exactly that bug for one commit. Ask `!== 'plain'`, or ask for the rung
  you actually mean.
- **`campaign.items` holds only what is on NOTHING.** A bound item lives on its holder, so
  "is it held?" must check the store AND the holders (`heldItemIds`) — a store-only check would
  hand out a second copy of a unique relic the moment the first one was bound.
- **A `bool` on `AUnit` is now the wrong shape for anything creature-ish.** New behaviour that is
  not a stat and not a body part is a `UnitAbility` flag; `docs/ADDING_UNITS.md` §1 has the rules,
  and the implication table is the only place a "X implies Y" may be written.
- **Granted abilities are scoped to squad MEMBERSHIP, not to `broken`.** Anything that moves a unit
  in or out of a squad mid-battle changes what it can do, automatically and by design.
- **A `Squad` must outlive its members in any test that builds one on the stack.** `~Squad` does not
  clear members' back-pointers (only `disband()` does), so declaring the squad second is a
  use-after-free that `test-fast` passes and the sanitized build catches. It caught it here.

**WHAT SHIPPED (2026-08-23).** All seven decisions, TDD against them, no schema bump:
- `describeItem(row)` in `campaign-server/services/items.js` returns `{effect, where, binding}`,
  phrased from `abilities`/`target`/`kind`/`permanent`. `ITEM_ABILITY_TEXT` is the ability→English
  map, and **items.test.js sweeps every catalog row through it**: a new ability that lands in
  `ITEM_CATALOG` without a line fails the suite rather than reaching a player as a debug word.
  describeItem DROPS what it cannot phrase (never prints the enum), which is only safe because
  that sweep fails first — do not remove one without the other.
- The view's `items` rows grow `permanent` plus the three lines. The client still holds no copy of
  the catalog, and a route-level test asserts the word `fearless` never crosses.
- `ItemStorePanel` is one component with two modes, branching on `storeRequest.browse`.
  Browse: unfiltered, read-only, the clicked row expanding inline. Slot: unchanged, plus the
  phrased lines. `where` is rendered in browse only — you arrived FROM the slot in slot mode —
  but the WORDING comes from the one server function either way, which is the drift that matters.
- `The Stores` door in `CampaignHUD`, always rendered, no count. It outlives a pending fate;
  `The Army` beside it does not.
- `App.jsx` branches on `storeRequest?.browse` ABOVE the pending-choices overlay and keeps the
  slot branch below it. **Both halves have a test** (`itemStoreBrowse.test.jsx`, "the two modes
  split") — the amended rule is no longer a comment making a claim about the server.

**Assistant's calls, flagged as overturnable:**
- **`Squad::hasBanner` was DELETED rather than promoted to the tier.** Decision 10 said it should
  "become the tier"; once 6-7 put ABILITIES on the wire instead of banners, the engine had no
  banner concept left to hold, so the tier lives campaign-side next to the item catalog and the
  engine-side flag simply went. 74 constructions lost an argument that never meant anything.
- **An attached CHARACTER is covered by their squad's banner**, following 5-0 (a character is a
  special kind of troop) and the banner's own "all units in that squad". Note the pre-existing gap
  this sits beside: a character entry does NOT carry the squad's `squad_mods`, so an attached
  character misses their squad's stat upgrades. That predates this slice and was left alone rather
  than fixed silently — it wants its own decision.
- **No raid card carries an item yet.** The generic `reward.item` path is built and unit-tested;
  the first banner comes down the event channel, and a card that wants to offer one is a row of
  config rather than a code change (6-13).
- **The item store's `items` view field ships `kind` and `target` per row**, because the slot the
  player clicked is what filters the list (6-14) — the client needs to know what a row IS, not only
  what it is called.

**What 5a leaves for the next slice to know:**
- **`roster` no longer holds a caster key at all.** Anything asking "how big is the army" must read
  `allBodies(campaign)`, never `campaign.roster` — food, the meter, the field-points pool and the
  annihilation check all do. A reader that forgets silently refunds six bodies' rations.
- **A MISSING survivor list is not an empty one.** `blue_characters: []` means nobody lived;
  `undefined` means the engine never reported. `reconcileCharacters` kills nobody in the second
  case, and `battleRunner` passes the field through undefined-preserving to keep them
  distinguishable. Defaulting it would turn a broken pipeline into a permanent massacre.
- **The modifier layer is a SEAM, wired but empty.** `characterMods()` returns `{}`; items,
  experience and wounds are stored and unpriced. The slices that fill them (5-4/5-5/5-6) change
  that one function and nothing else — sources are stored, the bag is derived.
- **`preferredRange` is now campaign-visible**, because the hang-back default derives from it. Two
  integration tests hold the hand-written `catalogFixture` to the real dump and assert that every
  character type still prefers range; before 5a the fixture had quietly drifted (Priest 0, Archer 8)
  because nothing read it.

**What 4d leaves for the next slice to know:**
- **A row may now cost more than one slot**, and `picksAvailable` is `slotsFor − slotsUsed`
  where `slotsUsed` SUMS `row.slots ?? 1` over the taken ids. Anything that counts
  `squad.upgrades.length` to mean "slots spent" is wrong from here on.
- **`typeSwap` is a real effect kind**, and the first thing that changes WHICH types a charter
  fields. `squadCaps` applies it BEFORE `capsBonus` — reversing that order silently strands a
  caps row on a type that no longer exists.
- **A `Player` unit no longer has to be for sale.** The engine.integration rule is now
  "in `RECRUIT_POOL` **or** `SQUAD_REINFORCE_POOL`", and `docs/ADDING_UNITS.md` §2/§5 say so.
  RoyalGuard is the first type obtainable only by training; it will not be the last.
- **A live campaign server must be restarted** after this build, as after any engine unit
  change: `squadSizePoints` throws on a type the DB catalog does not know, and the catalog is
  synced from `dump-units` at boot.

**The real-vs-adjusted size split now EXISTS** (4c), so the thing every earlier note called "the
awkward one" is no longer blocking anything. `AUnit::getSize()` is the REAL body and
`AUnit::getPackingSize()` is the room it takes; the rule for a new call site is *does it measure
room on the ground, or the man?* Anything priced off a body — food, raid capacity, the drawn glyph,
stray-shot target weight — keeps `getSize()`.

Squads can now take replacements: the caps have teeth, the intake meters them, the hex is fenced,
and the Recruit screen has the button. What the next slice needs to know before it starts:

- ~~**Prestige is EARNED and READ but still gates nothing.**~~ **As of 4a it gates the upgrade
  draft** — `slotsFor`/`hasBanner` in services/squadUpgrades.js are the only readers, and both derive
  from the rank ladder rather than storing anything.
- ~~**The upgrade catalog is NOT designed yet.**~~ **DESIGNED 2026-08-13** — the interview happened;
  eight decisions are recorded in the slice-4 spec below. Upgrades turned out to cost NO resources
  and no prestige (rank + a free slot is the price), to arrive as a random 3-row DRAFT at each
  slot-granting rank, and to be permanent once taken.
- **Two upgrade candidates now have live seams to hook into:** bigger caps and faster intake are
  `SQUAD_ARCHETYPES` values today, resolved into `campaignView` per squad, so a per-squad modifier
  layer would sit between the archetype row and `squadCaps()`/`squadIntake()` in
  `services/squadReinforce.js`. ~~Formation-fighters is the awkward one — it changes the packing
  size, which is exactly the "two sizes" split written up under slice 2 and does not exist in the
  engine yet.~~ **Built in 4c** — the split is real on both sides of the boundary.
- **The hex budget is the invariant to respect.** A cap-raising upgrade must not be able to push a
  squad past `SQUAD_TROOP_BUDGET`; `engine.integration.test.js` enforces that for archetypes, and an
  upgrade layer needs the same guard (the config invariant only sees the base rows).

**SLICE 5 — CHARACTERS (SPEC'D 2026-08-19, interviewed; 5a IN BUILD).** Decision 9 of the squad
overhaul, taken through a `grilling` interview the same way 4b/4c/4d were: interview first, record
the decisions here, then build TDD against them. Twelve decisions, all the user's.

**5-0. THE STANDING RULE, and the one to reach for when this spec is silent: a character is a
SPECIAL KIND OF TROOP, and follows every rule troops follow unless a decision here explicitly
changes it** (user, 2026-08-19). It is the reason 5-10 is a short list rather than an argument:
characters eat, fill the meter and cost raid capacity because *troops do*. The exceptions are
few and all written down — they sit outside the per-type CAPS (decision 3 / `SQUAD_CHARACTER_RESERVE`),
they have identity that survives death (5-9), and they can be told to hang back (5-8). A future
question of the form "do characters do X?" is answered "yes, if troops do" unless it is on that list.

**5-1. TOTAL migration — Mage and Priest leave the roster entirely.** Not a new layer beside the
old one: after this slice `roster` has no caster key at all, `STARTING_ROSTER`'s `Mage: 3, Priest: 3`
become six individual characters, and the caster `RECRUIT_POOL` lane hires a CHARACTER. Considered
and rejected: keeping roster casters and making characters a rarer parallel thing, which is the
`placeable`/`spawnable` mistake again — two systems stating the same fact, able to disagree.
`campaign.character` (singular, `Mixed`, read only as `character?.auguryBonus ?? 0`) becomes
`campaign.characters`. **Schema v35 → v36.** No data migration is written: a save from another
build is deleted on listing already (`buildVersion`), and this is a shape change on top of that.

**5-2. The base type is NEVER modified; everything rides a MODIFIER LAYER** (user: *"We don't
modify the type base stats but can add items, experience, wounds… we can keep the base type and
then add modifiers"*). A character is a catalog type plus modifiers, and the layer is built NOW
even though nothing fills it — the user's explicit reason being that planning for it now is
cheaper than refactoring into it later.

**5-3. SOURCES are stored; the stat bag is DERIVED.** The document carries `items: []`,
`experience: 0`, `wounds: []` — present and empty from 5a — and one pure `characterMods(character)`
folds them into a `{stat: delta}` bag, returning `{}` today. This is 4a's rule applied again
(store the taken ids, derive the slots): retuning a future item's numbers re-prices every existing
character, and no save can go stale. Rejected: storing the accumulated bag (a retune leaves every
save wrong, and healing a wound means correctly un-applying it) and caching it alongside the
sources (two things that must agree).

**5-4. Items go in TYPED SLOTS that belong to the creature** — head, torso, legs, hand, misc, with
a per-creature COUNT of each and a cap of **10 per type** so the odd bodies fit (user: *"hydra could
have 2 or more head slots. we might have 4 armed monsters"*). The cap is flexibility for modders,
not a number our roster needs.

**5-5. Equipped items are a SPARSE LIST: `{slot, index, itemId}`.** Only what is worn is stored, so
any layout works with no document surgery, equipping validates `index < layout[slot]`, and a
creature that gains or loses a limb changes the LAYOUT only — an item stranded in a vanished slot
is a derivation-time filter, never a corrupted save. Rejected: fixed-length arrays per slot type
(every layout change resizes arrays in every save) and a flat id list with the slot inferred from
the item (nothing can say WHICH of four hands holds the brand).

**5-6. The slot LAYOUT lives in the ENGINE unit catalog**, exported by `unitCatalogJson()` beside
`size`/`category`/`roles` and synced into `UnitType` at boot. A body plan is a fact about the
creature, like its size — so adding a hydra in C++ brings its anatomy along instead of needing a
second table that `docs/ADDING_UNITS.md` exists to stop people forgetting. The dependency still
runs campaign → engine: the engine DECLARES anatomy and never learns what an item is.
**And it is declared down the inheritance chain with NO DEFAULT** (user: *"the CPP already has the
inheritance system… no type is an error it doesn't default to anything. Better to be strict than
vague"*) — a type that fails to declare a layout is an error, never a humanoid by omission.

**5-7. Attach/detach is FREE and UNGATED — any phase, any number of times.** One character per
squad, held in a named constant and still explicitly a prototyping placeholder (decision 9).
Considered and rejected: sealing it at the end of `prepare`, and a bonded-until-death version with
a price to reassign. There is no mid-raid exploit to guard: `POST /raids/launch` resolves the whole
raid synchronously, so there is no window in which a character can be yanked off a losing squad.

**5-8. Attached means EVERYWHERE, automatically — raids included, at full risk.** No per-fight
opt-out and none needed: detaching is free (5-7), so leaving a character home is one click, and the
risk is exactly what makes raiding with your only Mage a decision. **Paired with the HANG-BACK
TOGGLE** (the "tag for whether it avoids melee" decision 9 asked for, raised again by the user
mid-interview): a per-character boolean on EVERY character regardless of type (user: *"I will have
to re-evaluate later so let's just have a toggle for now, type doesn't matter"*), which makes the
engine pass that unit over for rank 1 and seat it there only once nobody else can fill the line —
*hang back unless we run out of troops*. **Its DEFAULT is type-derived**: on for spellcasters and
archers, off for melee. `preferredRange > 0` picks out exactly Archer, Mage, Priest and Necromancer
from the live catalog and nothing else, so the default needs no new data to derive.

**5-9. Death is permanent, but the RECORD AND ITS DATA SURVIVE.** The entry stays in `characters`
marked dead with the day they fell, and **items, experience and wounds are preserved intact** —
the user's requirement is explicit: *"make it so that there is option to recover with some means,
special spells etc, mummification, we don't need them right now but don't lose data."* So nothing
in 5a may prune a dead character or strip their gear; every live reader (augury, attachment,
deployment, upkeep) filters on alive instead. This is one of the few places the troop rule (5-0)
does NOT decide the answer — a troop has no identity to remember.

**5-10. Characters keep counting toward food upkeep, the boss-fight meter and raid capacity.**
Straight from 5-0. The point is a negative one: if they stopped, migrating six casters out of the
roster would silently REFUND their rations, shift the idle fraction the meter fills from, and make
an attached character a free passenger on every raid — three balance changes nobody chose. Upkeep
must be identical the day this ships.

**5-11. Augury reads Mage CHARACTERS with the same formula**: `min(AUGURY_MAGE_BONUS_CAP,
floor(sqrt(living Mage characters)))` plus their derived augury modifiers. Balance is unchanged on
day one (3 Mages → +1), and it is what finally makes the `character?.auguryBonus` placeholder REAL
rather than deleting it — a future scrying item adds through the modifier layer (5-3), not through
a second formula. Rejected: flat +1 per Mage (silently jumps the day-one bonus to the +3 cap) and
a single "court mage" reading (the count stops mattering at all).

**5-12. Hiring keeps its rows and prices; names come from an AUTHORED POOL.** The caster lane stays
`mage` 100 gold / `priest` 80 gold, `count: 1` — the hire now mints a character, drawing an unused
name from a hand-written list in campaign config. Zero UI, immediate flavour, and a rename action
can arrive later without changing anything structural. **The six starting casters all begin
UNATTACHED**, which makes attachment the player's first character decision and keeps the
deploys-alone path exercised from the very first battle rather than lying untested.

**5a SHIPPED 2026-08-19.** Built in four commits: the migration (roster → characters, allBodies,
augury off characters), hiring by name plus attach/detach, taking the field and dying on it, and
the plain `CharacterPanel`. C++ 368 cases, campaign-server 851, frontend 300, lint clean.

**One assistant call worth flagging, since the spec marked it unconfirmed:** an unattached
character is placed INDIVIDUALLY by the client (with the server stamping identity, the toggle and
modifiers from the record), while an attached one is placed automatically on its squad's hex. That
follows 5-12's reason for starting the six unattached — it "keeps the deploys-alone path exercised
from the very first battle" — but the deploy screen does not yet offer them, so today that path is
reachable through the API rather than the UI. Wiring it into the deploy screen is a loose end for
the squad screen (decision 13) or a small follow-up.

**What 5a BUILDS, and what it only RECORDS.** The line, drawn by the user:
- **BUILT** — the migration (5-1); hire, name, persist, attach, detach (5-7, 5-12); riding along
  everywhere (5-8); permanent death with the record kept (5-9); food/meter/raid capacity (5-10);
  augury off characters (5-11); a plain `CharacterPanel`; the hang-back toggle wired through the
  engine's seating (5-8).
- **SEAMS ONLY** — `items: []`, `experience: 0`, `wounds: []` present and empty, and
  `characterMods()` returning `{}` (5-2, 5-3).
- **RECORDED, NOT BUILT** — the item catalog, the C++ slot layouts, experience, wounds
  (5-4, 5-5, 5-6). Each is its own later slice with its own interview.

**Assistant's calls, flagged as overturnable:**
- **Identity round-trips through the engine as `character_id`** on the placement entry, coming back
  as a list of surviving ids — because `survivorJson` reports COUNTS BY TYPE, which cannot say
  *which* Mage died, and 5-9 needs exactly that. It rides beside `squad_id`, which already proves
  the pattern.
- **An attached character is placed on its squad's hex automatically**, with no separate placement
  step (the squad already places as one block); an unattached one is placed individually, like the
  loner Mage/Priest of today. No-regression reading of decision 9, not separately confirmed.
- **`CharacterPanel` is deliberately plain** — list, attachment picker, hang-back toggle, dead roll —
  because decision 13's squad screen will absorb it. It should not grow a design of its own.

**SLICE 6 — BANNERS, ITEMS AND THE ABILITY SYSTEM (SPEC'D 2026-08-20, interviewed).**
Decisions 10, 15, 16 and 17 of the squad overhaul, taken through a `grilling` interview the same
way 4b/4c/4d and 5 were. Fifteen decisions, all the user's. Build TDD against them; do not
re-derive them. **Schema v36 → v37.**

**6-0. THE SLICE IS THE WHOLE CHAIN, SERVER-SIDE, PLUS THE ASSIGN FLOW** — tier ladder, a generic
item store, a banner won as loot, binding, and the ability it grants reaching the battlefield.
Deferred as their own later slices: 17's full storage PAGE and 13's squad screen. Considered and
rejected: shipping the tier ladder alone (decision 10 without 15/16/17), which changes nothing
observable — plain is inert, basic's bonus is deferred, and the item rung would be unreachable.

**6-1. THE STANDING PRINCIPLE, and the one to reach for when this spec is silent: A UNIT IS STATS
+ ANATOMY + ABILITIES** (user, 2026-08-20: *"anything weird will operate with the abilities …
everything that differs from human and is not just stats or body parts"*). Anything that differs
from a human and is not a stat and not a body part (5-6's slot layout) is an ABILITY. New
behaviour joins the ability vocabulary or it does not go in. This is the third axis of the unit
model and it outlives this slice — flying, ethereal, fire resistance and the rest arrive here when
the creatures that need them do.

**6-2. Abilities are a BITMASK on the unit, in two sets — innate and granted.** A new
`UnitAbility` enum in `Defines.hpp` with an `Abilities.hpp/.cpp` dispatch, modelled exactly on
`WeaponEffect`/`WeaponEffects.cpp`, which is the shape this codebase already proves. `_innate`
comes from the type; `_granted` arrives from the campaign layer (6-7). Rejected: reusing
`WeaponEffect` (it is a property of a *weapon* constructed into shared `WeaponList` values, so a
per-unit grant means either mutating shared data or giving every unit a private weapon copy), and
reusing `Spell` (gated on mana, cooldown and a caster, none of which an aura wants).

**6-3. Adding one ability can AUTO-ADD another: a declared IMPLICATION table, applied by a closure
at every assignment point** (user's own proposal, against the risk of *"accidentally creating
undead that leave a corpse"*). Declared today, and only these:

    Mindless ⇒ Fearless          (the immunity comes from mindlessness, not from undeath)
    Undead   ⇒ NoCorpse

A type declares `Undead | Mindless` and *receives* `Fearless | NoCorpse`; nobody can forget the
pairing because nobody types it. Rejected: a CI test asserting the pairing instead — it catches
the mistake but still lets it be written, and does nothing for abilities granted at runtime.
Closure makes the bad state unrepresentable rather than merely detectable.

**6-4. `bool undead` DIES, and splits into four composable flags.** `Undead`, `Mindless`,
`Fearless`, `NoCorpse`. Zombie and Skeleton declare `Undead | Mindless`. `AUnit::testMorale` asks
`Fearless` (not `undead`), `Team.cpp`'s corpse count asks `NoCorpse`, and `getUndead()` goes away —
it had exactly one caller, so nothing anywhere asks "is this thing undead?" as a fact in its own
right. **Skeleton's `morale = 99 // undead — never breaks` goes with it**: the same fact stated
twice in one constructor, which is the `placeable`/`spawnable` mistake in miniature.
**`Undead` must NOT imply `Fearless`** — a lich or a vampire is precisely an undead thing that CAN
be rattled, and the implication would make it unexpressible.

**6-5. `Mindless` ships BARE-BONES — the immunity only.** Its real cost is known and deliberately
unbuilt: **mindless troops need a commander able to lead mindless**, and nothing like that exists
yet (user, 2026-08-20). Recorded here so the later slice has its premise; do NOT stub it.

**6-6. A granted ability is tied to squad MEMBERSHIP, not to `broken`.**

    abilities() = closure(_innate | (_squad ? _granted : None))

`Battlefield::flee()` already calls `leaveSquad()` ("a fleeing unit leaves its squad — it's no
longer part of the formation"), and `_squadId` is deliberately left intact so a straggler regroups
after the battle. So every behaviour the user described falls out of one expression with no new
logic: he flees and loses the banner's gift; he rallies but stays out of the squad and fights on as
a lone trooper without it; he survives and rejoins the charter afterwards. Rejected: stripping
`_granted` in `setBroken` (rally would then have to restore it, and a grant landing after a break
would be an ordering bug), and revoking from the WHOLE squad when any one man breaks (one coward
would delete a unique relic's payoff for everyone, and it inverts `Fearless` — the men the banner
was protecting are the only ones who could not trigger it).

**6-7. Transport: `squad_abilities: ["fearless"]`, a sibling of `squad_mods` on the placement
entry**, attached SERVER-SIDE from the squad's banner, parsed with the same never-throw discipline
(`UnitRegistry.cpp`). **The engine learns the word `fearless` and never the word `banner`** —
campaign → engine, never back, exactly the line `UnitRole` drew. Whatever arrives this way IS
granted by definition, so the innate/granted split needs no marker. Rejected: a top-level
`squads: [{id, abilities}]` block (nothing in BattleInput is normalised, and it would be the only
cross-referencing structure in the format) and a reserved key inside `squad_mods` (a non-stat in a
stat-modifier object). Consequence, accepted: `enemyPlacement.js` reads `extra.squad_mods` already,
so the same door lets an enemy host field ability-carrying troops — that is the enemy FIELDING a
type, not DECIDING anything, so principle 1 is untouched.

**6-8. The tier is FULLY DERIVED — the only stored fact is the binding.**
`bannerTier(squad, campaign)` returns `item` if a banner is bound, else `basic` at or above
`SQUAD_BANNER_RANK`, else `plain`; `campaignView`'s `banner: true/false` becomes the tier word.
This is 4a's rule again (store what was taken, derive the rest). Rejected: storing
`squad.bannerTier` — retune the rank ladder and every save is silently wrong, because the tier was
frozen at the moment of crossing.

**6-9. A stored item is a BARE CATALOG ID, and every non-basic banner is UNIQUE in a campaign**
(user, 2026-08-20). No per-instance uid: document shape is free to change here, because
`routes/campaigns.js` culls any save whose `schemaVersion` or `buildVersion` differs, so a save is
never migrated. **The distinction that decides it, and worth keeping: a CODE SEAM is worth
pre-building (5-2's modifier layer, and 6-13's `grantItem` below); a DOCUMENT SHAPE is not.** If a
duplicate-able kind ever arrives, the store grows a uid then and the saves die as they always do.

**6-10. The binding is HOLDER-SIDE.** `campaign.items` is the store — every item NOT currently
held — and `squads[].banner` holds the bound id; binding moves the id out of the store, and per
decision 10 it never comes back. This is 5a's `characters[].items` convention (a character's gear
lives on the character), so banners and armour are stored the same way and 17's single assignment
path never has to branch on kind. Rejected: a store-side `{id, boundTo}` list, which stores the two
kinds by opposite conventions.

**6-11. The Seasoned rung opens the item slot AND grants the basic banner; an item banner REPLACES
the basic one** (user, 2026-08-20). Below that rung a won banner simply sits in the store, which 17
already ruled is fine and needs no explanation — an unassigned item is an item at the stage every
item starts in. Rejected: no gate at all, which would empty the basic tier completely: with its
bonus deferred by 16 AND its gate removed, "basic" would be a word in a switch with no consequence
anywhere. **16 still stands — do NOT invent a bonus for the basic banner.**

**6-12. ONE banner in the catalog, granting `Fearless`.** The grantable vocabulary is exactly that
one ability (`Undead`/`Mindless`/`NoCorpse` are innate-only — no banner hands out undeath), and the
catalog grows when new abilities arrive with the creatures that need them. Rejected: several
banners carrying upgrade-style effects (`caps`, `intake`, `raidCost`) for variety — the user ruled
out banners granting flat stats, and campaign bookkeeping bonuses are the same species; they would
make the first banners read like upgrade rows wearing a flag.

**6-13. ACQUISITION IS CHANNEL-AGNOSTIC** (user, 2026-08-20: *"It is an item and you should be able
to acquire it like any other magical item even if each banner is unique"*). One `grantItem`
chokepoint, reached from BOTH `applyRaidReward`'s generic tail (any card carrying `reward.item`,
outside the type switch — the shape S3's `modifierId` already uses) and a new `{type: 'item',
itemId}` event effect. **Uniqueness is a property of the ITEM, never of the channel**: filter at
draw time (a card or event offering an already-held item is never drawn — `eligibleUpgrades`'
shape), and no-op defensively at apply time. Per 15, `describeEffect` learns the type, so a card
offering a banner SAYS so. **Content in this slice: the garrison event** — a plain event in the
random pool, `requires: { minResolve: 75 }` (the existing garrison-gift tier sits at 67; food, coin
and a night sally are things a grateful garrison does often — handing over their standard is what
they do when they would follow you out the gate). No raid card is authored yet; when a second
banner exists, one row of config gives it a raid home.

**6-14. THE SLOT DECLARES WHAT IT ACCEPTS, AND THE STORE FILTERS TO THAT** (user, 2026-08-20). A
Seasoned+ squad row in `SquadUpgradePanel` shows a BANNER SLOT (empty = the basic banner, filled =
the bound item). Clicking it pushes a UI-only `store` screen via `useUiStore` carrying
`{accepts: 'banner', target: {kind: 'squad', id}}`; clicking a banner there raises a CONFIRM PROMPT
naming the permanence before the bind route is called; Back returns where you were, as the replay
screen does. This generalises to 5-4's typed character slots without change — one store, one
assignment path, the filter supplied by the caller, which is 17's "storage stays ignorant of what
kinds exist" achieved in the UI as well as the service. Rejected: a store-first panel with a target
picker (frames the store as a squad feature, and the second item kind would need a second control).

**6 SHIPPED 2026-08-20.** Built in six commits: the ability system and the `undead` split, the
`squad_abilities` transport (and `Squad::hasBanner`'s deletion), the store and the derived tier,
acquisition through one `grantItem` from both channels, the wiring into both battle paths, and the
slot → filtered store → permanence prompt. C++ 384 cases (sanitized), campaign-server 891,
frontend 309, lint clean.

**What slice 6 BUILDS, and what it only RECORDS:**
- **BUILT** — the `UnitAbility` enum, dispatch and closure (6-2, 6-3); the `undead` split with
  `morale = 99` removed (6-4); membership-scoped grants (6-6); the `squad_abilities` transport
  (6-7); the derived tier (6-8); `campaign.items` + `squads[].banner` (6-9, 6-10); the Seasoned
  gate (6-11); one banner granting `Fearless` (6-12); `grantItem` with both channels wired and the
  garrison event authored (6-13); the slot → filtered store → permanence prompt (6-14).
- **RECORDED, NOT BUILT** — the commander who leads mindless troops (6-5); the basic banner's
  bonus (16, still deferred on purpose); flying, ethereal, fire resistance and the rest of the
  vocabulary (6-1); 17's full storage page; 13's squad screen; banners capping scripted spells,
  which still waits on spell costs existing at all (10).

**SLICE 4 — THE UPGRADE CATALOG (SPEC'D 2026-08-13, interviewed; 4a/4b/4c/4d ALL SHIPPED).**
The design interview the handoff above asked for is DONE. Eight decisions, all the user's. Built TDD.

**The 4d interview HAPPENED (2026-08-18)** — the build pattern 4b and 4c settled into: interview
first, record the decisions here, then build TDD against them. Its seven decisions are under
"4d — Royal Guard" in the build order below, and they OVERTURN two of the assistant's earlier
calls (see the note beneath them). Do not re-derive them.

**Standing principle the user restated during it, worth applying beyond this slice: this is a
ROGUELITE — "not super balanced everything."** Asymmetry and luck are features. That is the reason
there is no pity timer and no guarantee below; do not add one to make a draw "fair".

**1. Rank gates BOTH which upgrades a squad may take and HOW MANY it may hold.** Slots are
cumulative over the slice-1 ladder: `Untested 0 · Blooded 1 · Seasoned 1 · Renowned 2 · Legendary 3`.
Picks therefore land at **Blooded, Renowned and Legendary** — three in a campaign.

**2. Seasoned grants the BANNER instead of a pick** — free, consuming no slot, which is what makes
it "a bit better than the others". It does its structural job (it opens the item slot) and carries
**no bonus and no kind choice**. **Decision 16 stays deferred exactly as written.** The user's idea
that a banner will later have "options to what kind it is" is RECORDED AS A LATER PASS, not built —
and when it comes, it is the thing that un-defers 16. Do not invent it now.

**3. Each pick is a DRAFT: 3 random eligible rows, keep 1.** No duplicates — a row already taken
never reappears. If fewer than 3 remain eligible, offer what is left rather than padding the draw.

**4. Upgrades cost NOTHING to take, and PRESTIGE IS NOT SPENT (decision 5 holds).** Reaching the
rank and having a free slot IS the price. Existing troops are upgraded FREE. The interview
explicitly considered spending prestige and rejected it, so the currency model stays dead.

**5. The ongoing cost is REINFORCEMENT, not purchase.** Some rows — gear changes, and any row that
switches the squad's unit type — permanently raise that squad's per-body reinforcement cost
(`SQUAD_REINFORCE_POOL` rows, slice 3). That is where an upgrade's price is actually paid.

**6. Every pick is PERMANENT.** No swapping, at any price. With upgrades free, permanence is the
entire cost — it is what makes 5-pick-3 an identity choice rather than a shopping list.

**7. Royal Guard is just another row in the draw — luck decides.** Considered and rejected: a
guaranteed Legendary offer, and an automatic grant like the banner. A campaign may end never having
been offered it. That is the roguelite principle above, deliberately applied.

**8. Sequencing is the assistant's call (user: "whichever you think is easier") — CATALOG FIRST,
engine rows after**, so each step ships green instead of one long red branch.

**Assistant's calls, flagged as overturnable:**
- **Royal Guard sits in the `line` ARCHETYPE pool**, not bespoke one-squad machinery. Only 1st
  Cohort is `line` today, so it lands where the user wanted it, and a line charter acquired later
  can draw it too — no special-casing to write or delete. **CONFIRMED by the 4d interview, and it
  is now structurally forced**: the row swaps the Soldier cap for a RoyalGuard one, and neither
  skirmish (Archer/Militia) nor vanguard (Cavalry/LightCavalry) has a Soldier cap to swap.
- **Pools sized by "access to 5 for now, then increase as we get cool upgrades"** (the user's
  sizing rule), drawing 3. Counts as actually built: **4a line 3 / skirmish 3 / vanguard 3;
  4b line 5 / skirmish 5 / vanguard 5; 4c line 6 / skirmish 5 / vanguard 5; 4d line 7.**
  Since 4d that count is the pool, not necessarily the DRAW: eligibility also asks whether the
  squad's remaining ladder can pay for the row, so a two-slot row drops out of a late offer.
  (An earlier revision of this block claimed "line 8, skirmish 6, vanguard 6" — that was wrong,
  and 8 was the TOTAL row count in `SQUAD_UPGRADE_POOL`, not any one archetype's eligible set.
  Count with `SQUAD_UPGRADE_POOL.filter(r => r.archetypes.includes(a))`, never by eyeballing the
  array length.)

**Build order:**
- **4a — ✅ SHIPPED 2026-08-13 (schema v35).** Draft machinery, slots, rank gating, the free
  Seasoned banner and the three campaign-side rows, built TDD off the spec above. What landed, and
  what a later slice must not undo:
  - `services/squadUpgrades.js` is the whole pure layer. Slots and the banner are DERIVED from
    prestige (`slotsFor`, `hasBanner`) — only `squads[].upgrades` (taken) and `squads[].upgradeOffer`
    (the pending draft) are stored, so a retuned ladder cannot leave a document stale.
  - The offer is drawn ONCE at newDay and sealed on the document. That is load-bearing: the draw is
    random, so a lazily-redrawn offer would let a reload reshuffle until the player liked it. An
    unspent offer is left alone — a squad with two free slots fills them one turn at a time.
  - Upgrades reach the world through `squadCaps`/`squadIntake` (upgrades sit BETWEEN the archetype
    row and the readers, and only raise types the archetype already names) and `raidCostFactor`,
    read per squad inside the party-cost loop so each squad pays its own rate.
  - `deeper_ranks` is a FLAT +2 per type, not a percentage: `line` has only 6 bodies of headroom
    under the hex budget, and +20% would put it at 640. Both the pure suite and
    engine.integration.test.js check every archetype × every caps row against the real catalog.
  - The draft is DEGENERATE today (3 rows, draw of 3 — every eligible row is always offered). That
    is expected; the randomness starts to bite when 4b-4d add rows to the same table.
- **4b — ✅ SHIPPED 2026-08-18 (no schema change).** Four stat rows, and the first upgrades that
  reach the ENGINE. Shape settled with the user: ONE shared row plus ONE per archetype —
  `honed_edge` +1 attack (all), `heavier_kit` +1 armour (line), `marksmans_eye` +1 ballistic skill
  (skirmish), `fresh_remounts` +1 speed (vanguard). What a later slice must not undo:
  - `AUnit::applyStatMod(stat, delta)` is the only way a stat is bumped, and it is BOUNDED
    (`MAX_STAT_MOD`) with floors — placement JSON is attacker-controlled, so the engine must not
    believe a forged modifier. An unknown stat name is INERT, matching the campaign layer's
    unknown-kind convention.
  - `ballisticSkill` goes through `setBallisticSkill`, never the member, because `accuracy` is
    derived from it (`accuracy = bs * 5`). There is a test pinning exactly that.
  - `squad_mods` is attached SERVER-SIDE in both battle paths (pitched battle and raid party) from
    the already-validated `squad_id`. A `squad_mods` in the request body is DISCARDED, not merged —
    the client sends placements, never stat modifiers. Omitted entirely for an unupgraded squad, so
    the JSON is unchanged for an army with no upgrades.
  - This also un-degenerated 4a's draft: `line` now has 7 eligible rows and skirmish/vanguard 6,
    against a draw of 3. A squad can no longer exhaust its pool (3 slots vs 6-7 rows), so the
    shorter-offer branch in `drawUpgradeOffer` is now defensive rather than reachable.
  - The FRONTEND needed no change — the pick panel renders whatever name/blurb the server sends, so
    every future row arrives on screen for free. That is the payoff of 4a shipping first.
- **4c — ✅ SHIPPED 2026-08-18 (no schema change).** Formation fighters, and with it the
  real-vs-adjusted size split the earlier notes kept calling the awkward one. Interviewed first;
  seven decisions, all the user's. What landed, and what a later slice must not undo:
  - **`AUnit::getSize()` is the REAL body; `AUnit::getPackingSize()` is the room it takes.** The
    rule for a new call site, in the user's words: *does it measure room on the ground, or the man?*
    ADJUSTED — hex capacity, fighting frontage, rank-1 eviction, a squad's footprint moving into a
    hex, the fatigue-weighted side allocation, the cramped-terrain penalty. REAL — food upkeep, raid
    capacity cost, the drawn glyph radius, stray-shot target weight, and the `size` the unit catalog
    exports. `getSize()` stayed the real one DELIBERATELY: a spatial call site nobody converted then
    keeps today's behaviour instead of silently mis-pricing a body.
  - **The value belongs to the ABILITY, not to a constant** (user): `formationFighter` is a unit
    stat with a default of 0, so a goblin can carry 1, a human 2 and a giant 5 in the same battle.
    Our roster needs one row at 2; nothing may re-hardcode it. It is SIGNED — a negative value packs
    LOOSER (the long-weapon case), which is the "adjustment runs both ways" warning made real, so
    **never assume packing ≤ real**.
  - **The floor is 1, not something proportional**, and that is a considered call (user: "I don't
    see why we would make it more than half for any real unit but let's not potentially limit
    modders from doing crazy stuff"). It exists at all because a packing size of 0 is not "very
    tight" but UNLIMITED — every gate is `used + size > cap`, which a zero always passes.
    `MAX_STAT_MOD` is what bounds a value arriving over the wire. Do not "harden" this to half.
  - **VALUE 2 is load-bearing arithmetic, not taste.** An Open side seats 40 size-points in rank 1
    and the fit is STRICT, so four size-10 soldiers fill it exactly and a packing size of 9 still
    seats four (45 > 40). A -1 would buy hex headroom and nothing at the front.
    `test_engagements.cpp` pins 4/4/5 for 0/-1/-2 so a retune cannot quietly make the row a no-op.
  - **LINE ONLY.** A vanguard body packs 20 → 18 and still seats two per side, so the row would
    spend one of a campaign's three permanent picks on almost nothing — a trap, not a trade-off.
    Pools after 4c are line 6, skirmish 5, vanguard 5 (this line originally read "line 8,
    skirmish 6, vanguard 6", which counted the whole `SQUAD_UPGRADE_POOL` array rather than each
    archetype's eligible subset — corrected 2026-08-18).
  - **A ROW IS NOW A BUNDLE: `effect: {}` became `effects: []` across the catalog.** The user's
    call, and the reason is worth keeping: the PRICE belongs to the CHOICE, not to the ability, so
    Formation Fighters pairs `formationFighter` with `reinforceCost` on one row while the ability
    itself knows nothing about money. A later row may grant the same ability at another price.
    The surcharge is **+1 gold per body**, flat and explicitly a first pass ("the costs are
    unbalanced for now, I just want to see that it works").
  - **`formationFighter` rides the SAME `squad_mods` transport as 4b's stat rows**, because it IS an
    engine stat — a private channel would be a second thing to attach at both battle routes and a
    second thing to forget. `UnitRegistry` now parses `squad_mods` BEFORE charging the hex capacity;
    that ordering is what makes the extra bodies actually fit, and it is easy to break by moving the
    block. The request-size DoS budget deliberately still charges the REAL size, so a forged mod
    cannot buy a bigger request.
  - **Three layers measure the same hex and must agree**: `AUnit::getPackingSize`,
    `squadReinforce.packedSize` and `enemyPlacement.packedSize` (which reads its adjustment out of
    the `squad_mods` it already carries rather than being told twice). `engine.integration.test.js`
    runs a drilled block through the REAL binary and checks every body the campaign packed reached
    the field — that is the test that catches a floor or a sign drifting on one side only.
  - **The FRONTEND needed one change after all**, unlike 4b: `SquadReinforcePanel` previews the bill
    client-side, so `campaignView` now ships `reinforceSurcharge` per squad. Without it the preview
    understates a drilled squad's cost and the player can submit what the route then refuses — the
    one disagreement that panel exists to make impossible.
- **4d — Royal Guard: ✅ SHIPPED 2026-08-18 (no schema change).** Seven decisions, all the
  user's, taken in a `grilling` interview and then built TDD against them; the spec is kept
  verbatim below because it is still the reference for WHY, and nothing in it was overturned
  by the build. **What landed, beyond the decisions as written:**
  - `slotsUsed`/`upgradeSlotCost` are the new arithmetic, and `canAfford` — one private
    predicate — is the WHOLE of the borrowing rule. It is applied in two places on purpose:
    `eligibleUpgrades` (so the row is never drawn when the ladder cannot pay) and `planUpgrade`
    (so a replayed request against a stale offer cannot smuggle it past). Both of the user's
    requirements and "never offered on the last pick" fall out of that one predicate; there is
    no rule anywhere naming the Royal Guard.
  - The conversion lives in `applyTypeSwap` and runs AFTER the row is recorded, so a wiped
    charter still ends up holding it. It writes composition and roster together; the
    composition KEY is dropped rather than left at 0 (the charter no longer permits the type
    at all), while the roster keeps its key at the reduced count, as every other roster
    mutation does.
  - **The hex-budget fences now price through `squadCaps` itself** rather than re-implementing
    the caps fold — in the pure suite and against the real binary both. That is what makes them
    see a type swap at all: RoyalGuard replaces a Soldier body for body today, but a swap to a
    bigger body is exactly how a squad could be handed more than its hex holds with nothing
    noticing.
  - `campaignView` ships `slots` per offered option and `upgradeSlotsUsed` per squad;
    `SquadUpgradePanel` marks any row costing more than one honour. `upgradeSlots`/
    `upgradePicks` keep their old meanings.
  - C++ 361 cases, campaign-server 786, frontend 293, lint clean.

  **4d-1. The pick CONVERTS the squad, wholesale and free.** Taking the row swaps the line
  charter's `Soldier 40` for `RoyalGuard 40` — **Soldier leaves the charter entirely** — and every
  Soldier body already in the composition becomes a Royal Guard at pick time, at no cost. Pikeman
  10 rides along untouched. Considered and REJECTED: an elite cadre capped alongside the Soldiers
  (grants nothing on the turn you take it), and grandfathering the bodies so the squad converts
  through casualties (leaves it a mongrel for many turns). Wholesale is the only reading that
  satisfies both decision 4 ("existing troops are upgraded FREE") and decision 5 ("any row that
  switches the squad's unit type"), and it is what makes the pick an identity change rather than
  a purchase. **Soldier leaving the charter is load-bearing, not tidiness**: it is what makes the
  dearer replacement recipe unavoidable, and therefore what makes decision 5 true here. A later
  reader who "restores" Soldier to the guard charter hollows the whole row out.

  **4d-2. The unit — a Soldier with a halberd and no shield.** New `RoyalGuard : Human`,
  symbol `'G'`, `Player` role ONLY (enemy hosts do not field them — a separate balance decision
  the user declined to bundle in; adding the `Enemy` role later is a one-word catalog change).

  | | Soldier | RoyalGuard |
  |---|---|---|
  | weapon | SwordAndShield (dmg 5, reach 1, shield 4) | **Halberd** (dmg 8, reach 2, two-handed, NO shield) |
  | maxHP | 10 | **14** |
  | attackPWR | 11 | **13** |
  | defence | 12 | **14** |
  | morale | 10 | **13** |
  | unitValue | 10 | **15** |
  | armour | HEAVYARMOUR 5 | HEAVYARMOUR 5 |
  | fatigueCost | 5 | 5 |
  | ballisticSkill / movementSpeed / size | 4 / 10 / 10 | 4 / 10 / **10** |

  **WHY the defensive stats rise so much, and why it is not padding:** in MELEE, `armour` only
  reduces damage from *Piercing* weapons (`AUnit::defend`, the `resultDMG -= armour / 2` branch) —
  full armour applies only in `takeDamage`, i.e. arrows and spells. Against an ordinary sword the
  SHIELD is the entire mitigation: a second save roll at `defence + shield`, and `SHIELDREDUCTION
  + shield * 2` = 13 points off the blow when it lands. So dropping sword-and-shield for a halberd
  costs a Royal Guard nearly all of his melee protection and none of his missile protection. The
  +4 HP and +2 defence buy that back; without them these "elites" would die faster than the
  Soldiers they replaced. **Do not trim them as though they were flat power creep.**

  Downsides, chosen deliberately (the user rejected both "no downsides" and "+1 fatigue"):
  fatigue stays 5 — *elite drill is exactly what bearing the halberd means* — and `unitValue` 15
  makes them the obvious spell target, so a caster-heavy host is the counter to a guard squad
  without weakening them in a fair melee.

  **4d-3. The row COSTS TWO SLOTS — one now, one BORROWED from the next rung.** The user's
  reasoning: "basic upgrade is modest increase to one stat", so a whole new unit type is worth
  two. This is new machinery. **A two-free-slots-at-once rule would make the row unreachable
  forever** — trace the ladder (`Blooded 1 · Seasoned banner · Renowned 2 · Legendary 3`,
  cumulative) and a squad never holds two free slots at any rung. So:
  - `picksAvailable` becomes `slotsFor(squad) − slotsUsed(squad)`, where **`slotsUsed` sums
    `findUpgrade(id)?.slots ?? 1`** over the taken ids — summed over the ID list, NOT over
    resolved rows, so a row that has left the catalog still costs its slot and cannot refund one
    into a live campaign (the `archetypeOf` degrade-don't-throw convention, applied to arithmetic).
  - A row of cost N is offered only when the squad has a pick in hand AND **`maxSlots − slotsUsed
    ≥ N`**, where `maxSlots` is `Math.max(...Object.values(SQUAD_UPGRADE_SLOTS_BY_RANK))` — derived,
    never the literal 3, so retuning the ladder cannot strand the rule.
  - Both of the user's requirements fall out of that ONE rule: take it at Blooded and Renowned
    grants no draft, take it at Renowned and Legendary is silent (it "skips the next upgrade"),
    and at Legendary there is no future slot to book so **it is never offered on the last pick**.
    A campaign ends with 2 picks instead of 3, one of them the Guard.
  - Considered and REJECTED: a stored `skipNextDraft` flag on the document — mechanically
    near-identical, but it is state that can drift out of step with the derived ladder, which is
    exactly what 4a's "slots are DERIVED, never stored" note exists to prevent.

  **4d-4. The replacement recipe — `Soldier 1 → RoyalGuard 1`, `gold 5 · materials 4`.** Input is
  Soldier because there are never loose Royal Guards in the roster; this also keeps the
  Militia→Soldier pipeline load-bearing. Cavalry-dear on purpose (2.5× a Soldier's `gold 2 ·
  materials 2`): refilling 15 dead runs 75 gold, two or three good raids — losses hurt without a
  mauled squad becoming unrecoverable dead weight. NO food, per the 1:1 rule (a replacement
  destroys a body and creates one, so the army gains no new mouth). The row carries **no
  `reinforceCost` surcharge effect** — unlike Formation Fighters, the dearer RECIPE *is* the
  price, and stacking a surcharge on top would charge the same trade twice.

  **4d-5. `engine.integration.test.js`'s recruit rule WIDENS: "every `Player` type appears in
  `RECRUIT_POOL` **or** `SQUAD_REINFORCE_POOL`".** Royal Guard must be a `Player` unit (to be
  deployed, drawn and placed) but must never be buyable on the Recruit screen, which collides
  head-on with today's "no exemptions" rule. The rule's real intent is *no Player type is
  unobtainable*, and since slice 3 there are TWO honest acquisition channels — hire, or train
  through a reinforcement recipe. Widening keeps the tripwire's teeth (a genuinely dead type still
  fails, naming itself) and stops the rule lying about the channels that exist. Royal Guard is the
  first type obtainable only the second way; it will not be the last. Considered and REJECTED:
  giving it a RECRUIT_POOL row anyway (kills the squad-exclusivity the row exists to deliver — the
  upgrade would grant a cap, not access), and tagging it `Enemy`-only (works, and permanently
  misleads every future reader about whose troops these are). Update `docs/ADDING_UNITS.md` §5 to
  match, or the next person to add a unit reads the old rule.

  **4d-6. The hex budget is UNTOUCHED — size stays 10.** A guard squad measures exactly what a
  line squad measures today: 40×10 + 10×10 + the 40-point character reserve = 540 of 600, or 580
  with `deeper_ranks` stacked on top (RoyalGuard's 2 slots + 1 leaves room for exactly one other
  row). The user chose the halberd shape over "bigger men in heavier plate" partly for this: no
  new invariant risk, and the packing/formation-fighters math behaves as it already does.

  **4d-7. The FRONTEND needs one change**, like 4c and unlike 4b: `SquadUpgradePanel` renders each
  offered option as `{id, name, blurb}` only, so a two-slot row would look free. Ship **`slots` on
  the projected option** in `campaignView` and mark it on the card — a player must not spend a
  future draft without being told. (`upgradeSlots`/`upgradePicks` keep their meaning: slots the
  rank is worth, and picks makeable NOW.)

  **Two orderings that are load-bearing rather than incidental:**
  - **The type swap applies BEFORE `capsBonus`** in `squadCaps`, so `deeper_ranks` raises the
    RoyalGuard cap and not a Soldier cap that no longer exists. Note this deliberately BENDS 4a's
    "an upgrade never admits a type the charter was not written for" — a type-swap row is exactly
    that, by design, and it is the first one. The fence 4a was protecting (a caps row must not
    smuggle in a new type) still holds for `caps` rows; `typeSwap` is a separate, explicit kind.
  - **Conversion writes BOTH sides**: `squad.composition` and `campaign.roster` move together,
    since the standing invariant is that a squad's composition is always a subset already
    reflected in the roster (`looseRoster` is the function that would go negative otherwise).

  **Build order within 4d** (decision 8's "catalog first, engine rows after", which shipped 4a–4c
  green each time): campaign layer + slot machinery first (the row can name a type the engine does
  not have yet, since nothing places it until a squad holds it), then the `RoyalGuard` unit and
  its catalog row, then the integration test's widened rule.

**The invariant to respect throughout:** a cap-raising row must not push a squad past
`SQUAD_TROOP_BUDGET`. `engine.integration.test.js` enforces that for archetypes; the upgrade layer
needs the same guard, because the config invariant only ever sees the base rows.

**▶ THE ACTIVE FRONT IS "NEXT UP — THE SQUAD OVERHAUL", immediately below. It is fully designed;
slices 1-3 are built and the rest is ready to BUILD.** Nineteen decisions, all interviewed and
recorded, nothing open. Two things are deliberately deferred and must NOT be invented to fill the
gap: the basic banner's bonus, and the plain banner's spell-cost role.

**SLICE 3 — reinforcement — ✅ SHIPPED 2026-08-13 (schema v34).** Built TDD off the eleven-decision
spec below (kept verbatim — it is still the reference for WHY, and nothing in it was overturned).
campaign-server 697/697 across 27 files, frontend 283/283 across 37 files, oxlint clean, engine
untouched. What landed:

- **`SQUAD_REINFORCE_POOL`** in `campaignConfig.js` — one global table, looked up by OUTPUT type,
  six rows at the spec's prices. **`SQUAD_CHARACTER_RESERVE = 40`** became a real constant (it was
  a comment), because the budget gate has to do arithmetic with it.
- **`services/squadReinforce.js`** — `archetypeOf`/`squadCaps`/`squadIntake`/`canSquadAccept`/
  `squadSizePoints`/`looseRoster`, plus the plan-then-apply pair (`planReinforcement` decides and
  prices, `applyReinforcement` is the only thing that writes). That split is what makes the route's
  atomic contract cheap: a refusal has spent nothing because nothing ran.
- **`POST /:id/squads/:squadId/reinforce`**, phase-guarded to Recruit exactly like the hire (the
  draw stamp is the door in, `rejectIfPhasePassed` the door out), body `{reinforce: {type: n}}`,
  ledgered by **`squads[].reinforcedDay`** (schema 33 → 34).
- **`enemyPlacement.addBlock` now THROWS** on all three old fallbacks, and `add` returns the number
  it left off the field instead of swallowing it. The three tests that asserted the fallbacks were
  rewritten to assert the throws, with the reasoning kept in the test comments.
- **The invariants slice 2 skipped**, in two places by necessity: the pure ones (every capped type
  has a recipe, one recipe per output type, every starting composition inside its own caps) in
  `tests/squadReinforce.test.js`; the SIZE ones in `tests/engine.integration.test.js`, because only
  a run against the real binary can see both the caps and what a body occupies. The budget itself is
  pinned against the live `Hex::CAPACITY` rather than the 640 in the comments.
- **`docs/ECONOMY.md`** — the rough price reference, linked from the top of `campaignConfig.js`.
- **UI**: `components/SquadReinforcePanel.jsx` inside `RecruitPanel` — per-type headroom
  ("30/40 Soldier"), the pooled intake readout, a live cost preview and one submit per squad.

**Three build-time calls worth not re-litigating:**

1. **The wire carries `reinforcedToday` (a boolean), not `reinforcedDay`.** The spec said the stamp;
   the view's standing convention is to answer the question instead (`recruit.drawn` is exactly
   `drawnDay === day`). Shipping both would have been the `placeable`/`spawnable` mistake. The
   DOCUMENT stores the day, which is what decision I actually needed.
2. **`campaignView` also ships `reinforceRecipes`** (and a top-level `loose`), which decision K did
   not list. The panel has to preview a cost, and the alternative was a second copy of the price
   table client-side. Shipped ONCE for the army rather than per squad, since recipes are global and
   the archetype only decides which of them a charter may use.
3. **Reinforcing can make the day's SEALED hire offer unaffordable, and that is allowed.** The two
   sinks share the purse even though neither gates the other (decision I), so spending the coin on
   replacements really can put a 100-gold caster out of reach after the offer was drawn against it.
   The phase cannot deadlock — the free Travellers card is always hireable — so this is a trade the
   player makes, not a stranding. It is the one place the Recruit phase's "nothing can move
   resources between draw and hire" property no longer holds, and it holds deliberately.

**What is NOT in slice 3** (unchanged from the spec): the upgrade catalog, characters, banners, the
item store, the squad inspection screen, per-archetype recipe overrides, and making the loose `add`
path fatal.

**SLICE 2 — archetypes and per-type caps — ✅ SHIPPED 2026-08-13 (schema v33).** Interviewed
before building (the numbers are the user's, not assumed); campaign-server 654/654. What landed
is **data only, by explicit choice**: the catalog and the field, nothing that reads them.

- **`SQUAD_ARCHETYPES`** in `utils/campaignConfig.js`, three rows matching the three starting
  squads: `line {Soldier: 40, Pikeman: 10} intake 10` · `skirmish {Archer: 30, Militia: 10}
  intake 6` · `vanguard {Cavalry: 6, LightCavalry: 6} intake 2`. Vanguard's caps are decision 3's
  stated numbers verbatim. All three starting squads sit exactly AT their caps, so a squad only
  reinforces after taking losses — a full formation having no room reads correctly.
- **Permitted types are the KEYS of `caps`**, not a second list beside them. A separate
  `permitted: []` could disagree with `caps` and express nonsense; that is the
  `placeable`/`spawnable` mistake `UnitRole` fixed on 2026-08-10, and it is written into the
  config comment so it is not "helpfully" split later.
- **`squads[].archetype`** (schema **32 → 33**), the id only — the row is looked up, never copied
  onto the document, so a rebalance reaches campaigns already in flight. A plain String, not an
  enum: acquisition (decision 11) must be able to add a row without a schema change.
- **`SQUAD_TROOP_BUDGET = 600`** — of `Hex::CAPACITY` 640, with **40 reserved for attached
  characters**, who sit outside the CAPS (decision 3) but emphatically not outside the hex. New
  constraint from the interview, and the reason base caps sit well under the ceiling: the
  headroom is what size upgrades sell.

**Deliberately NOT in slice 2** (user chose the bare minimum): no validation helper, no
`campaignView` exposure, no cap enforcement anywhere, no config-invariant test. Caps have nothing
to enforce against yet — `squad.composition` is only ever *written* by battle/raid reconciliation,
which only shrinks a squad to its survivors. Slice 3 is the first caller with teeth.

**Two sizes, once formation-fighters lands (user, 2026-08-13) — decided now so it is not
re-litigated.** A unit will carry its **real size** and an **adjusted (packing) size**. The split
is by what the number measures, not by convenience:
- **Adjusted size** drives packing only — hex capacity, side frontage, and `SQUAD_TROOP_BUDGET`.
  Tighter drill is the whole point of the upgrade, so the same 600 admits more bodies.
- **Real size** drives everything priced off a body: food upkeep (`size²  ×
  FOOD_KG_PER_SIZE_SQ_PER_DAY`), armour and kit costs. *"Armor etc will still take as much
  resources as for other humans, the formation is just tighter."* Upkeep must not follow the
  adjusted figure.

  **The adjustment runs BOTH WAYS (user, 2026-08-13).** It is not a discount: a weapon that needs
  room — a long polearm — makes a man occupy MORE space, exactly as drill makes him occupy less.
  So **never assume `adjusted ≤ real`**. Anything that treats the packing figure as a reduction
  (a cap derived from real size "with headroom", a frontage check that only guards the tight
  case) silently overfills a hex the first time a unit packs looser, which is the one direction
  the engine drops units for.

This is also why the budget is stored in **size points and never as a headcount**: troop types
smaller than a human are expected later, so "600 = 60 bodies" is true of size-10 foot today and
of nothing in particular tomorrow.

**One squad, one hex** is settled and load-bearing (user, 2026-08-13): a squad never splits
across hexes, which is why an archetype's caps are bounded by the hex at all. Special-rule
archetypes (skirmish-style loose order) may revisit it later; nothing today should assume
otherwise.

**Superseded, kept because it explains WHY slice 1 came first:**

**Start with slice 1 — prestige persistence — and note it is a PREREQUISITE, not a warm-up.**
`campaign.squads` is `{id, name, composition}`: no rank. The engine's `Squad::_prestige` lives on an
object rebuilt per battle, so nothing round-trips today. Every other slice is blocked on this one.
**Its full spec — award formula, rank ladder, and what is out of scope — is in "SLICE 1 — prestige
persistence" further down; follow that, not this summary.** In short: a schema bump adding
`prestige` (archetypes come LATER, not here), raid awards scaling with the opportunity's
`strengthBand`, and the wipe-survival change that stops reconciliation deleting a zeroed charter —
folded in deliberately, because without it prestige dies with the squad and the persistence is a
fiction. It depends on neither deferred answer.

**Build it TDD — failing test first, one behaviour at a time** (user, 2026-08-10). The campaign
server's existing suites are the pattern.

The award numbers and the rank ladder were CHOSEN BY THE USER on 2026-08-10, not assumed — earlier
drafts of this handoff called the `strengthBand` scaling an open assistant judgement call, and that
is now out of date. Treat them as settled.

**Read `CLAUDE.md`'s "Shipping" section first.** Standing instruction as of 2026-08-10: finish a
feature, get it green, merge it to `main` — do not ask permission to ship. Interviewing the user
about DESIGN is still expected and welcome; asking whether to merge finished work is not.

**2026-08-13.** The enemy's opening size came OFF the open list (deferred to a general balancing
pass — see the struck-through bullet under "What is actually open"), and the tool that pass wants
was built: **`docs/BALANCE_SHEET.md` + `make balance-sheet`**, every fate and raid reward priced
in one table. See "The balance sheet" below, including four observations the first read turned up
— chief among them that **severity does not weight the augury draw**, so a sev-3 fate is exactly
as frequent as a sev-1 one.

**2026-08-10, in order.** Eleven player-facing changes, each with its own section below — plus a
tenth, structural one:
- **Every fate and raid reward priced in one table** (`3b99739`) — the last of the reward-clarity
  thread; the enemy's opening size was settled alongside it (`3704f56`), so 721 is no longer an
  open question.
- **The third sally flake, caught and fixed** (`f76f400`, seed `446545517`) and **`make test-fast`**
  (`37faef6`, ~155s → ~5s). The hunting method is the reusable part — see the flake entry under
  "What is actually open" for how a 1-in-250 seed was reached, and why a seeded replay only
  reproduces in FULL-SUITE context.
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

**NEXT UP — THE SQUAD OVERHAUL (grilled 2026-08-10; nothing built yet).** Ten decisions, taken in
dependency order. This SUPERSEDES parts of "Squad-centric overhaul — direction firmed up
(2026-07-21)" further down; where they disagree, this section wins and says so.

Squads are meant to be **the central feature** — the thing the player forms an attachment to. They
survive the death of every troop in them, carry a history, and are individually flavourful. Every
decision below serves that.

**1. Identity — a squad is a permanent CHARTER, not its bodies.** It owns troops rather than being
made of them: name, banner, prestige and upgrades live on the charter. A wiped squad stays on the
rolls at zero troops and rebuilds. The `roster` remains the single source of truth for bodies. The
scarce resource is the NUMBER of charters.

**2. Size — per-squad archetypes, and size is itself upgradeable.** No global rule: an archetype
sets both the caps and the innate character, so *elite-and-small* versus *large-and-mediocre* is a
real trade the player picks between. Archetypes are what acquisition hands out (see 8).

**3. The cap is PER TROOP TYPE, with no total.** An archetype fences which types may be present and
caps each one — Vanguard Riders is `{Cavalry: 6, LightCavalry: 6}`, not "12 mounted". There is no
global weight table and no separate total budget to allocate; the numbers live on the squad, not on
the unit type. Characters sit OUTSIDE the caps entirely. The inspect screen therefore reads
"5/6 Cavalry · 6/6 LightCavalry".

**4. Reinforcement — once per turn, per squad, bounded by an intake stat.** How many bodies a squad
can absorb in a turn is an archetype stat (militia absorb fast, elites are picky) and is
upgradeable, so it pulls against size on the same flavour axis: the elite-small squad is also the
slow-to-heal one. It belongs to the **Recruit** phase — after Raids, so a squad mauled on a raid can
be topped up the same turn, and before Deploy, so it is at strength for the pitched battle. It
COSTS: gold and materials per body (sometimes horses; a magical resource later), fluffed as training
and kit.

**5. Prestige is a PERMANENT RANK that GATES upgrades — it is never spent.** Upgrades are paid for
in resources; the rank only ever climbs. **This overturns the 2026-07-21 line** that called prestige
"a per-squad currency… spends it to buy squad upgrades, each upgrade level more expensive". That
line is superseded — do not implement it.

**6. Prestige sources, weighted deliberately.** Raids are the main earner (participating earns,
winning earns more). Events award it too, and **especially an event that REQUIRES a squad** —
commitment is what pays, not proximity. Turns survived grant a small trickle, small on purpose so
idling never competes. **One judgement call made in the interview, flag it if wrong:** raid prestige
scales with the opportunity's `strengthBand` (already stored on every card) so farming the easiest
target on the board cannot rank a squad up.

**7. A squad's power IS the troop type it fields — no modifier layer.** Squads may hold
**squad-exclusive elite types** (a Royal Guard that exists nowhere else in the army). Reinforcement
is therefore a **conversion**: consume N of an input type from the loose pool — usually the same
type, sometimes a lower one (Soldier in, Royal Guard out) — plus gold/materials, and produce N of
the squad's own type. That is the same promotion shape `RECRUIT_POOL` already uses for the
recruitment ladder, so reuse it rather than inventing a second one.

  **This inverts a live engine rule.** Today a broken unit calls `leaveSquad()`, and the engine
  reports a squad wiped once every tagged survivor has left. The new rule: **broken-but-surviving
  troops REJOIN their squad after the battle**, which is what keeps elite types from leaking into
  the loose pool, and "wiped" comes to mean everybody actually died. Changing this is part of the
  work, not a side effect of it.

**8. What prestige unlocks — a broad, flavourful catalog.** A shared pool of upgrades gated by
archetype, plus signature ones locked to a single squad. Named so far: the elite conversion above,
cheaper raiding (discounting the squad's `raidCapacityCost` contribution), bigger caps, faster
intake, flat **+1 stat** bumps (small-looking and already strong), and **formation fighters** —
reducing the size a unit occupies so the squad packs more frontage.

  **Engine seams, all confirmed:** `AUnit::size` drives BOTH hex capacity and frontage
  (`Battlefield.cpp` packs a hex side by summing `getSize()`), so formation-fighters is a stat
  change and not new machinery. Stats come from the constexpr `UnitCatalog`, so a +1 upgrade wants a
  small `squad_mods` field on the placement entry, applied in `buildArmyFromPlacement`. Attacks are
  already `std::vector<Weapon>` with `addWeapon()`, so per-squad equipment has a clean seam if it
  ever returns.

**9. Characters — Mage and Priest become characters.** They stop being roster counts and become
individual persistent entities (a `characters` array, not the `roster` Map), attachable to a squad
now, with magical equipment and leadership bonuses later; this gives the existing
`campaign.character` placeholder something real to grow into. **One per squad — explicitly a
PROTOTYPING PLACEHOLDER**, so hold it in a named constant rather than baking 1 into the logic. An
unattached character can still deploy alone, exactly as Mage/Priest do today (no-regression default;
not explicitly confirmed). Survival needs no new machinery: the character is a unit on the field —
survives and stays attached, dies and is dead. The charter surviving at zero troops already covers
the rest. A caster also wants a **tag for whether it avoids melee**.

**10. Banners, in three states — and where they are going.** *Plain*: every squad has one; its job
is to power spells, but **spell cost does not exist yet**, so today it does nothing and ships inert
so the later stage has its prerequisite. *Basic*: reached by a level upgrade, carries a benefit, and
**opens the item slot**. *Item*: magical, assigned permanently, **overrides** the basic banner, bound
to that squad. The destination: **banners limit how many powerful scripted spells a squad may cast —
deliberately like gems in Dominions 6.**

  **No banner-bearer tracking.** If a banner falls, assume someone picks it up. `_flagBearer` and
  `onFlagBearerDeath()` exist and are wired into `Battlefield`, so the machinery is available if a
  reason appears — but a droppable banner is NOT part of this design. And `Squad::hasBanner` is DEAD
  CODE (constructor-set, getter never called, no logic reads it): it should BECOME the tier, not
  gain a sibling flag — the `placeable`/`spawnable` mistake `UnitRole` fixed on 2026-08-10.

**11. Acquiring squads.** Charter count is scarce and grows only through acquisition, most likely
**events arriving on set turns**. An acquisition hands over an archetype (see 2), which is what
makes each new squad interesting rather than another slot.

**12. The tie-up mechanic — an event can take a squad away for X turns.** Not a separate feature: it
is the other half of prestige. An event that takes a squad away IS the event that requires one, so
it supplies both sides of a readable trade — off the board and unable to raid, paid for in prestige.
Build them together or the cost lands uncompensated and no such event is ever worth taking.
`raid.squadAssignment` already tracks "spent on a raid today"; a tie-up is that same idea across
turns, so extend it rather than inventing a parallel notion of busy.

**13. The squad inspection screen — LAST, because it renders everything above.** There is no squad
UI today: no component mentions squads, and they surface only inside `RaidPanel` as pickable rows.
It must show composition against the per-type caps, prestige rank, banner tier and what it grants,
attached character, and availability (free / raiding / tied up).

**Sequencing.** Prestige persistence first — `campaign.squads` is `{id, name, composition}` with no
level or prestige, and the engine's `Squad::_prestige` dies with each per-battle object, so nothing
round-trips and everything above is blocked on it. **Schema bump** (currently v31). Then archetypes
and caps, then reinforcement/conversion, then the upgrade catalog, then characters, then banners,
then the screen.

**14. A wiped squad is ANSWERED — nothing special happens (user, 2026-08-10).** There are no
re-buy terms, no rebuild cost, no special state. A charter at zero is simply a charter at zero: it
refills through the ordinary per-turn intake (4), taking suitable troops from the loose pool until
it is no longer empty. Resist adding a wipe mechanic — the charter model already covers it, and the
question only looked open because it was asked in currency terms.

  **The consequence to watch when tuning.** Recovery speed IS the intake stat, so a wipe punishes
  the elite-small archetype twice: it was already the picky, slow-to-absorb one, and now it has the
  furthest to climb. That is the intended shape of the trade, not a bug — but it is where an elite
  charter could become dead weight for many turns, so it is the first thing to look at if elites
  feel unplayable after a bad raid.

  **Guard: an empty squad must not be sendable.** Committing a zero-troop charter to a raid or a
  battle should be refused — server-side, since that is the trust boundary, with the UI greying it
  out as a courtesy rather than as the enforcement.

**15. Item banners are won, not bought (user, 2026-08-10): an event or a raid reward.** No purchase
track and no prestige unlock — they arrive as loot. That puts them on machinery that already exists:
`applyRaidReward` handles typed raid payoffs and `applyEffect` handles event effects, so a banner is
a new payload on both rather than a new subsystem.

  **It must render, or it breaks a standing rule.** "No card shows flavour alone" means a raid card
  offering a banner has to SAY so on the board, and an event granting one has to state it — which
  means `describeEffect` learns the new type. A banner that appears silently in an inventory is
  exactly the vagueness that rule exists to stop.

**16. The BASIC banner's benefit is deliberately DEFERRED (user, 2026-08-10):** "we will decide the
basic benefits later when I see that other things are working." This is a decision to postpone, not
an unanswered question — do not invent a benefit to fill the gap. Build the basic banner for its
structural job (it is the tier that OPENS THE ITEM SLOT) and leave the bonus unspecified until the
surrounding systems can be played. The plain banner already ships inert for the same reason.

**17. A magic-item STORAGE, generic from the start, with its own UI page (user, 2026-08-10).** A
won item lands in storage first; from there the player assigns it.

  **Storage is the FIRST STEP of item handling, not a fallback.** Every won item goes there,
  always — acquisition puts it in the store, and assignment is a separate action the player takes
  afterwards. It is not a safety net for the case where no squad qualifies yet, and it should not
  be described as one: an unassigned item is not a problem being absorbed, it is simply an item at
  the stage every item starts in. It follows that nothing needs to explain why a given item has not
  been assigned — there is no refusal to justify, only a step the player has not taken. (An earlier
  draft of this entry got that backwards and demanded the page account for it; corrected
  2026-08-10.)

  **And it is where an unassigned item RETURNS to.** For kinds that allow it, unassigning sends the
  item back to the store — so the store is not merely the entry point but the home of every item
  that is not currently on something. Banners are the exception and cannot be unassigned at all
  (10): bound is bound, and a bound banner never comes back. Later kinds like character armour are
  expected to move freely, which is exactly what the per-item permanence flag exists to express.

  That makes the store the single hub of the whole flow — won → store → assigned → (if reversible)
  store again — rather than a one-way inbox. Worth building it that way from the start: a store
  that only ever receives new items is the wrong shape for the first reversible kind, and that kind
  is already promised.

  So: **do not collapse acquisition and assignment into one action**, and do not add an
  "unassignable" state. An item sits in the store until the player moves it, however long that is. Storage will hold more than
banners later, so **build it for items in general and never for banners specifically** — the item
declares its own kind and rules, and the storage stays ignorant of what kinds exist. This is the
`placeable`/`spawnable` lesson again: a `banners: []` field would have to be joined by
`weapons: []`, `relics: []` and so on, each with its own branch, instead of one list that already
carries them.

  **Flexibility here has a precise meaning, because two rules already decided pull apart.** A
  banner **binds permanently** to a squad once assigned (10) — it leaves storage and never returns.
  Character equipment, promised for later (9), is the obvious candidate for being re-assignable
  between characters. So an item must DECLARE both what it may attach to (squad / character) and
  whether assignment is permanent or reversible, rather than the code inferring either from its
  kind. Get this wrong and the first re-assignable item means rewriting the assignment path.

  **There are exactly TWO attachment targets, and an item names which it wants (confirmed
  2026-08-10).** A banner binds to a **squad** — the charter, not a body. **Magical armour and its
  like attach to a CHARACTER**, not to the squad around them, and are the reason the target has to
  be a property of the item instead of a global rule. Nothing attaches to an individual
  rank-and-file troop, and nothing should: that would need a per-troop identity the game does not
  have and has no reason to grow.

  So the assignment path is written once against `{target: 'squad' | 'character'}` and asks the
  item where it goes. Two kinds are already known to differ on BOTH axes — a squad-bound permanent
  banner and a character-worn re-assignable armour — so a path that hardcodes either axis is known
  to be wrong before it is written, not merely at risk of it.

  Storage is campaign state and wants a schema field of its own; `campaign.character` is a
  `Mixed`-typed placeholder and is NOT the right home for it.

  **Its own page** — a third screen alongside the squad screen (13), showing what is held, what
  each item does (via `describeEffect`, per 15), and where it can go. Sequencing: the page renders
  storage, storage holds items, items are won from raids and events — so it comes after those, and
  before or beside the squad screen that shows the assigned end of the same relationship.

**SLICE 3 — reinforcement (SPEC'D 2026-08-13, interviewed before building; schema v33 → v34).**
**✅ BUILT 2026-08-13 exactly as written — see the shipped write-up under "Where the work stands"
for the three build-time calls that went beyond it. Kept in full because it is still the record of
WHY each rule is the way it is.**
Eleven decisions, all the user's. This is the slice with TEETH: slice 2 stored the archetype and
its caps and enforces nothing, because nothing added troops to a squad until now. Build it TDD.

**A. The recipe — inputs and outputs are UNCONNECTED (user, 2026-08-13).** Reinforcement is not a
transformation and must not be modelled as one. **The inputs are DESTROYED; the outputs are
CREATED.** Nothing carries over, because a body has no identity to carry — it is a roster count.

> *"There is no reason why they must match. We might take scorpion as a monster and then a rider
> and create some new unit. For some really funky stuff we might even split existing one. There is
> no need to limit creativity."* — user, 2026-08-13

So both sides are collections, and neither constrains the other:

```js
{ id, output: { type: 'Soldier', count: 1 },
  inputs: { Soldier: 1 },          // many-to-one: { Scorpion: 1, Soldier: 1 } → a ridden monster
  cost:   { gold: 2, materials: 2 } }
```

One *application* destroys everything in `inputs` and creates `output.count` of `output.type`.
Today every row is `inputs: {X: 1} → output: {type: X, count: 1}`, and **no code path may assume
that** — many-to-one and one-to-many are the stated reasons the shape is general. **Revisit the
destroy/create model if troops ever gain experience or wounds** (user's own caveat): at that point
a body has something worth preserving and "destroy and create" stops being a faithful description.

**B. One GLOBAL recipe table** — `SQUAD_REINFORCE_POOL` in `campaignConfig.js`, a sibling of
`RECRUIT_POOL`, keyed by output type. The archetype owns **the fence** (which types may stand in
the charter, and how many); the recipe owns **the transformation**. Keeping them orthogonal means
a new troop type is one row rather than an edit to every archetype admitting it. A per-archetype
override is NOT built now. **Config invariant test:** every `caps` key across every archetype has
a recipe — a capped type with no recipe is silently un-reinforceable otherwise.

**C. `intake` is a POOLED per-squad budget, metered on the OUTPUT side.** Not per type: under a
per-type allowance an archetype's real refill rate would scale with how many types it admits, so
`vanguard` (2) would quietly beat `line` (10) per type — a bookkeeping accident undoing decision
14's trade. **Output-side is the decision, and it is arbitrary but FIXED** (user: *"it really
doesn't matter as unit design can account for how it was coded"*) — the reason to prefer it is that
caps and `composition` are already denominated in output bodies, so every per-turn limit is one
currency and the route's arithmetic is `min(capHeadroom, intakeRemaining)`. Guarding the input side
would let a one-to-many recipe satisfy intake and overrun the cap unseen. **Vanguard's `intake: 2`
means at most 2 bodies JOIN this turn, however many were destroyed to make them.**

**D. The numbers — gold and materials, deliberately NO food.** A 1:1 recipe destroys a body and
creates one, so the army gains no new mouth: recruiting *provisions* a new body, reinforcement
*re-equips* an existing one. (A one-to-many recipe breaks that symmetry; none exists yet.) Anchored
on each type's `RECRUIT_POOL` materials-per-body, with gold as the type's worth:

| output | inputs | cost | a full intake costs |
|---|---|---|---|
| Militia | 1 Militia | 1 gold, 1 materials | — |
| Soldier | 1 Soldier | 2 gold, 2 materials | line (10): 20g, 20m |
| Archer | 1 Archer | 2 gold, 2 materials | skirmish (6): 12g, 12m |
| Pikeman | 1 Pikeman | 2 gold, 1 materials | — |
| LightCavalry | 1 LightCavalry | 4 gold, 3 materials, 1 horse | — |
| Cavalry | 1 Cavalry | 5 gold, 4 materials, 1 horse | vanguard (2): 10g, 8m, 2 horses |

Sized against real income: a won raid pays ~20–40 gold (`units × RAID_GOLD_PER_UNIT ×
RAID_GOLD_VARIANCE` on a target ~5% of the host), `garrison_paychest` +75, and gold starts at 0. So
a full line refill is about one raid's coin — a real claim on the purse the casters want, never
unaffordable. Vanguard is the intended sting: 2 bodies a turn at 5 gold and a horse each is
decision 14's "a wipe punishes the elite archetype twice" showing up in numbers, not just prose.
**Explicitly a first pass — balance later** (user). 1 horse per reinforced rider is exactly the
hire rate, with no discount for the destroyed input having been mounted.

**E. `docs/ECONOMY.md` — a rough internal price reference (user's ask).** *"You might want to
create some internal documentation for the value of gold or materials so it is easier for you to be
consistent… just a very rough internal consistency."* Exchange rates between food / materials /
gold / horses / workers and what a body of each type is worth, derived from prices already in
`RECRUIT_POOL` and the raid rates, linked from `campaignConfig.js`. **Not a balance pass** — its
job is to give the next invented price something to be consistent with.

**F. `canSquadAccept` — over-CAP is inert, never an error.** Headroom is `max(0, cap − current)`.
An over-strength squad (from a future event) simply offers no reinforcement in that type and
shrinks back under the cap through casualties. A type absent from `caps` is likewise inert: it
keeps fighting but can never be reinforced. No `archetype` ⇒ nothing is reinforceable. **The user
is content for squads to run over-strength** — *"most squads will work fine even if overstrength,
might even make some interesting events."* Add the invariant test slice 2 skipped: every
`STARTING_SQUADS` composition is within its archetype's caps and names only permitted types.

At the **route**, an over-request is a **400 with nothing spent, never a silent clamp** — ask for 5
when 3 fit and it is refused. A clamp would leave the UI's arithmetic and the server's disagreeing
with no one noticing.

**G. The SIZE BUDGET is a second, INDEPENDENT gate — over-cap is a design knob, over-hex is a bug.**
> *"However if we go accidentally over hex limit I suspect we might run into serious bugs."* — user

A reinforcement must satisfy the per-type cap **and**
`Σ composition[T] × size(T) + SQUAD_CHARACTER_RESERVE ≤ SQUAD_TROOP_BUDGET`. The 40 reserved for
characters becomes a **named constant** (it is only a comment today). Plus a **config invariant
test: no archetype's caps may sum past the budget at full strength**, so a rebalance raising `line`
to 60 Soldier fails CI instead of splitting squads on raids.

**Measured facts (2026-08-13):** `Hex::CAPACITY = 640`; all foot are size 10, **Cavalry and
LightCavalry are size 20**. Caps at full strength: `line` 500 · `skirmish` 400 · `vanguard` 240 —
all under `SQUAD_TROOP_BUDGET` 600, and 500 + 40 = 540 ≤ 640. **Per-type caps alone cannot overflow
a hex today**; the danger arrives with cap upgrades (decision 8), a new archetype, or an event
granting troops directly. The invariant is what keeps it that way.

**H. NO SILENT FALLBACKS — loud failures while the design is early (user, 2026-08-13).** The
failure mode being fenced is not a crash and is worse than one: on the battle route
`findOverstackedHex` refuses an overstacked placement outright, but on the **raid** route
`enemyPlacement.js`'s `addBlock` silently scatters an oversized squad across hexes — which the
engine reads as N one-member squads with *no cohesion, no shared morale, no squad movement* — and
drops the remainder if the zone is full. A squad one body too fat loses cohesion on raids with no
error anywhere.

- **`addBlock` THROWS** on all three of its current fallbacks: the multi-hex split (it violates
  "one squad, one hex", which is settled and load-bearing), the zone-full drop, and an unknown unit
  type (a squad holding a type the catalog doesn't know is a data bug, not a degradation).
- **`add` keeps its drop but stops swallowing it** — it returns the number left unplaced. It
  spreads a *loose* army over a bounded zone by design, and the enemy host grows across a campaign;
  making it throw would convert "the rear ranks camp this battle" into a hard-failed battle
  mid-campaign, on a path with no invariant to protect.
- **Three existing tests change MEANING** (they currently assert the fallbacks):
  `enemyPlacement.test.js` "a squad bigger than one hex packs into as few hexes as it can" (:149),
  "a block that outgrows the zone leaves the remainder off the field" (:164), and "unknown types
  are skipped" (:173) for the `addBlock` half. The raid route gains a failure mode it lacks today —
  that is what "loud failures early" buys, accepted knowingly.

**I. The route — `POST /:id/squads/:squadId/reinforce`, phase-guarded to `recruit`.**
- **Fully independent of `hiredToday`, both directions.** Reinforcing does not consume the day's
  hire and the hire does not gate reinforcing: they are different sinks (the hire spends
  food/workers and adds bodies to the ARMY; reinforcement spends gold/materials and moves bodies
  into a CHARTER). Coupling them would make the mandatory hire silently a mandatory reinforcement
  decision too.
- **The body is a MAP, applied ATOMICALLY:** `{ reinforce: { Cavalry: 1, LightCavalry: 1 } }` — all
  of it or none. "Once per turn per squad" stays literally true while a mixed archetype still
  splits its intake across its types, which vanguard (intake 2, two permitted types) needs on day
  one. A single-type call would either break once-per-turn or leave vanguard unable to spend half
  its allowance. Chosen over a drawn-down counter across repeated calls so a rejection leaves
  nothing spent.
- **The ledger is `squads[].reinforcedDay`** (schema **33 → 34**), a day stamp mirroring
  `recruit.drawnDay`'s sealed-day convention — not a parallel array like `raid.squadAssignment`. It
  survives a wipe with the charter and needs no end-of-day clearing.

**J. The UI ships in this slice, minimally.** Slice 2 was rightly inert — it was data with no
caller. Slice 3 has teeth, and a reinforcement route with no button cannot be playtested, on a
system whose whole point (decision 14's elite-recovery trade) is only judgeable by playing it.
Minimal means a reinforcement section in `RecruitPanel`: each squad with its per-type headroom
("5/6 Cavalry"), its intake allowance, a cost preview and one submit. **NOT the squad inspection
screen** — decision 13 puts that last, and it stays last.

**K. `campaignView` exposes `archetype`, the RESOLVED `caps` and `intake`, `reinforcedDay`, and the
derived loose-pool counts per type.** All own-info, same tier as `composition` — none of it is
hidden enemy state. Resolving `caps`/`intake` server-side from the archetype id (rather than
shipping the id for the client to look up) is what keeps the config single-sourced, which is why
the id was stored bare in slice 2.

**Not in this slice** (unchanged): the upgrade catalog, characters, banners, the item store, the
squad inspection screen, `addBlock`'s loose-`add` counterpart being made fatal, per-archetype
recipe overrides.

**SLICE 1 — prestige persistence — ✅ SHIPPED 2026-08-13 (schema v32).** Built TDD; campaign-server
653/653, frontend 275/275, lint clean, engine untouched. What landed:
- `campaign.squads[].prestige` (schema **31 → 32**), plus `raidBandWeight`/`raidPrestige`/`squadRank`
  in `utils/capabilities.js` and their constants in `campaignConfig.js`. Band weight is DERIVED from
  `RAID_STRENGTH_BANDS` (reverse index) rather than a second hardcoded table, so adding a band
  cannot leave its weight behind; an unknown label is worth 0 rather than throwing.
- Awards in the raid route: every squad that went earns, a win pays the higher rate INSTEAD of the
  participation one, both scaled by the target's band. A log line names the squads and the number.
- **Both reconciliations stopped disbanding squads** — the raid route AND the battle route. A wiped
  charter stays on the rolls at `composition: {}` with its name and prestige.
- The empty-squad guard, checked PER SQUAD rather than on the party total, so an empty charter
  cannot ride along on a real squad's coat-tails and burn its once-per-turn raid slot.
- `campaignView` exposes `prestige` + the derived `rank` word.
- The old prestige STUB line in `applyRaidReward` is gone; the flavour line that remains no longer
  claims prestige is untracked.

**Decision 7 (broken-but-surviving troops REJOIN their squad) landed HERE, earlier than planned.**
It was scoped to a later slice, but it is not separable: once reconciliation stops disbanding, a
squad the engine reports `wiped: true` *with* survivors simply keeps them. The campaigns.test.js
case that asserted those stragglers scattered into the loose pool now asserts they stay — the
behaviour change is deliberate and is what stops squad-exclusive elite types leaking out later.

**Two pre-existing tests changed MEANING** (not just shape), both asserting the disband rule this
slice inverts: raid.test.js's lost-raid case and campaigns.test.js's wiped-squad case. A third
assertion was narrowed: a lost raid's "no reward path" check matched `/prestig/` loosely, which now
collides with the participation award a loss is SUPPOSED to pay.

**Not in this slice** (unchanged): archetypes and per-type caps, reinforcement/conversion, the
upgrade catalog, characters, banners, the item store, both UI screens. Nothing reads the rank for
gating yet — it is earned and kept, and that is all.

**Superseded spec, kept for context:**

**SLICE 1 — prestige persistence (SPEC'D 2026-08-10).** Everything above is blocked
on this: prestige has nowhere to live. Build it TDD — **write the failing test first**, one
behaviour at a time; the campaign server's suites are the pattern to follow.

**Schema (bump from v31).** `campaign.squads[]` gains `prestige: {type: Number, default: 0}`. The
archetype belongs to a later slice — this slice is the number and its persistence, nothing more.

**Awards — raids only in this slice.** Scale with the opportunity's `strengthBand`, weighted by band
index 1–4 over `RAID_STRENGTH_BANDS` (`a handful` 1 · `a small band` 2 · `a full company` 3 ·
`a strong detachment` 4):
- **participating: 1 × band** (1–4), paid to every squad in the party, win or lose;
- **winning: 2 × band** (2–8), instead of the participation award, not on top of it.

Chosen as the modest end of the options offered (user, 2026-08-10) so a squad that raids most turns
reaches Seasoned mid-campaign and Legendary only by carrying the whole run.

**Rank ladder** — thresholds over cumulative prestige, never spent (5):
`0 Untested · 10 Blooded · 25 Seasoned · 45 Renowned · 70 Legendary`.

**The stub to make real:** `services/raid.js` already pushes the log line *"A prestigious victory —
word of it spreads (prestige not yet tracked)."* That parenthetical is the marker; award there and
delete it.

**A wiped charter must SURVIVE — folded into this slice deliberately (user, 2026-08-10).** Today a
wiped squad is DELETED from `campaign.squads` by both the raid and the battle reconciliation, so its
prestige would die with it and the persistence would be a fiction. Per decision 14 a charter at zero
simply stays on the rolls with `composition: {}`. Two changes:
- reconciliation keeps the squad instead of filtering it out;
- **the empty-squad guard** (14): sending a zero-troop squad on a raid or into a battle is refused
  server-side (400), since that is the trust boundary.

**Not in this slice:** archetypes and per-type caps, reinforcement/conversion, the upgrade catalog,
characters, banners, the item store, and both UI screens. Prestige is earned and kept; nothing
spends or reads it yet beyond display.

**Nothing in this section is now blocking.** Both former open questions are settled — item banners
are event/raid loot, and the basic banner's bonus is postponed on purpose. What remains is
sequencing, and the first slice is prestige persistence.

**What is actually open:**
- ~~**An unidentified C++ flake.**~~ **CAUGHT AND FIXED 2026-08-10 — seed `446545517`.**
  `test_garrison_sally.cpp`, "reinforcements do not cross back as survivors", reading `3 == 4` on
  `getTeam(BLUETEAM).size()`. The THIRD sally case to fail the same way, after the two fixed on
  2026-08-09: an assertion that names one thing and measures survival. The wave lands in Red's rear
  band with Red standing in it and combat runs in that same tick, so "all three summons are still
  alive" was never an invariant — it was a dice roll dressed as scaffolding above the line that
  carried the case's actual claim.

  Fixed structurally, not statistically: the on-field count is now self-consistent (`1 + summons`,
  with at least one summon present) while the real assertion — that NO summon crosses back into
  `blueSurvivors` — stays exact, because the original sits far from Red and cannot be reached in one
  tick. Verified by replaying `GAME_RNG_SEED=446545517` green under BOTH builds.

  **How it was found, because the method is the reusable part.** `make test-fast` (added the same
  day) cut a run from 155s to ~5s, making a 1-in-~250 seed reachable: 164 fast runs caught it where
  150 earlier ones and 150 of a hand-picked summon subset had not. Two things mattered — the user's
  hunch that summoning had caused trouble before, which turned out to be exactly right, and the
  `[rng] seed=` line, WITHOUT which this would have been another sighting. An earlier occurrence
  that day was lost precisely by piping a run through `tail -4`. **Never filter that line.**

  A seeded run only reproduces IN FULL-SUITE CONTEXT: the same seed passes when the test runs
  alone, because preceding tests consume draws and shift the stream. Replay the whole suite with the
  seed, not the single case.

- ~~**The enemy host's opening size (721) is unbalanced.**~~ **DEFERRED 2026-08-13 (user's call) —
  off the open list, not a gap.** *"We can get rid of the enemy size for now… I will first need to
  balance everything else, events, raids etc before I can know what kind of army the player will
  have at the end, and balancing the enemy will be done then."* The host's size is the LAST number
  to set, because it is the only one whose right value is a function of every other one: the
  player's army at the end of a campaign is an output of the event pool, the raid board, the
  recruitment ladder and the forage economy, and until those are settled 721 has nothing to be
  measured against. So `ENEMY_ARMY` stays untouched **on purpose** — do not retune it, do not
  propose a number, and do not treat its imbalance as a bug found. It comes back as part of the
  general balancing pass (see Follow-ups), fed by a playtest of the whole curve at once.
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

### THE MAGIC SYSTEM (interviewed 2026-08-25) — SPEC'D, NOT BUILT

Modelled deliberately on the **Dominions** series (user, 2026-08-25), with the source checked rather
than recalled. **Twenty-six decisions, all the user's — do not re-derive them.** Recorded on the
user's instruction ("record the spec only"), so nothing below is built yet. It supersedes
`[[todo-spell-paths-research]]` in the deferred backlog, which recorded the ask and listed the
questions this interview answers, and it is what `docs/UNITS_AS_DATA_PLAN.md` **Stage R4 — Spell
paths** must be read against.

**WHAT EXISTS TODAY, established by reading and by running the binary — magic is DEAD CODE, not
half-built.** Three spells (`fireball`/`bless`/`raise_dead`) sit in `Spells::roster()`, each gated
by exact unit-type name, chosen by "first castable in roster order" (which `SpellList.cpp` itself
calls deliberately dumb). **`mana` is never seeded anywhere outside tests**: every caster is built
with `mana = 0` and `chooseSpellToCast` requires `mana >= manaCost`, so no spell has ever fired in a
real battle. A 15 MB `./game sample` replay contains no spell activity at all. Nothing here is
being taken away from a working system.

**THE DOMINIONS BASELINE, verified 2026-08-25** (sources at the end of this section): ten paths
(nine arcane requiring research, plus Holy which needs only priestly authority); a mage's path level
gates what they may cast; **fatigue is the cost**, a spell's fatigue divided by (excess path levels
+ 1) with spellcasting encumbrance added after, and a mage at 100+ fatigue cannot cast; gems are
per-path, found by site-searching, and in battle a mage may spend up to their path level in gems to
cut fatigue or to raise their effective level by one; research is 7 schools x 9 levels; and in
battle a mage is scripted with five spells, after which the combat AI chooses for itself, weighing
things like enemy resistances.

**M-1. MANA IS DELETED OUTRIGHT; CASTING COSTS FATIGUE** (user: *"We will remove the whole mana
thing and change to spells creating fatigue"*). This removes a stat that never held a value and
replaces it with one that is already first-class and already tuned: `fatigue` gates action
(`> FATIGUE_MAX` -> `recover()`), costs defence (`defence - fatiguelvl * 2`), and decides
engagement ranks (fresh fill the line before tired). `Spell::manaCost`, `AUnit::mana`, `getMana`,
`setMana` and the mana clause in `chooseSpellToCast` all go.

**M-2. THE SAME POOL, AND IT RUNS PAST THE CEILING INTO BLOOD.** Casting fills the ordinary fatigue
pool with the ordinary consequences. Beyond that, a NEW universal rule (user): fatigue may run to
**2 x FATIGUE_MAX**, where it CLAMPS, and everything past that point converts at **4 fatigue -> 1
damage**, with the fraction rolled — 1 point over is a 25% chance of a wound. **It applies to every
unit, not only casters**: ordinary troops will never reach it by marching and fighting, but a spell
can put them there. At 2 x MAX a body is at `fatiguelvl` 10, i.e. **-20 defence** — an overcast mage
is not asleep, he is a free kill. `AUnit::addFatigue` is the single mutation site and already floors
at 0, so the ceiling and the overflow land in one place and reach every unit for free.

**M-3. TEN PATHS: Fire, Earth, Water, Air, High, Low, Nature, Death, Holy, Unholy.** The four
elements are the spine. Blood and Glamour are NOT adopted: in Dominions each is a subsystem rather
than a name, and a path with no subsystem behind it is empty content.

**M-4. HIGH IS STUDIED, LOW IS BARGAINED.** Holy/Unholy already own the light-versus-dark axis, so
High/Low differ in where the power COMES FROM, not in whether it is wicked. **High** is formal,
celestial magic that acts on magic itself — stars, mind, wards, dispelling. **Low** is hedge-craft
and old bargains — curses, hexes, sacrifice. And the difference is mechanical, not only flavour:
~~**Low may pay a spell's cost in LIFE where every other path pays fatigue**~~ — **CORRECTED BY
M-21 (user, 2026-08-25): it is not either/or.** Low pays LESS fatigue *and* pays in blood on top;
the discount is the temptation and the blood is the price. The struck wording is kept because it is
exactly the either/or a later reader would otherwise re-derive. Rejected: High/Low as a tier axis (greater ritual vs lesser battle magic),
and High/Low as order vs chaos (which would restate Holy/Unholy).

**M-5. PATH LEVELS ARE ROLLED AT HIRE AND THEN FIXED.** A caster's paths are their identity, as in
Dominions, and with one Mage type and one Priest type the roll is what makes one hire differ from
the next — a real gamble on a named individual who can be lost for good (5-9). **Rare events and
items may change a path**; items do it through 9's existing mod bag, which already carries two
vocabularies, so a path is one more name in it rather than a new system. **EMPOWERMENT IS
DELIBERATELY UNRESOLVED — the user will decide after playtesting** — and when it comes it belongs
to **Low**, the path that is thematically about cheating the system (user). Rejected: paths that
advance with use, which makes every surviving mage converge on the same sheet and the hire stop
mattering.

**M-6. THE ARMY KNOWS; THE CASTER QUALIFIES.** Research unlocks a spell campaign-wide; whether a
given caster can cast it is decided by their path levels alone. Dominions' exact model. A fresh
hire is instantly as capable as a veteran of the same paths — losing a caster costs you talent,
never knowledge. **The fluff licenses the pacing** (user): our mages are not experienced battlemages
but other kinds of mage catching up, and they are *"not actually researching new spells but tapping
into existing systems, thus we can justify relatively fast speed"*. Rejected: per-character
spellbooks (which need teaching, copying and last-knower rules) and a two-gate learn-it-yourself
model.

**M-7. EVERY LIVING MAGE CONTRIBUTES EQUALLY, POSTED OR NOT — the choice is WHICH SCHOOL, not how
much.** Research has **multiple sources** and is deliberately not just mages idling in camp:
**garrison relations** feed it (which hangs off the existing `garrison.resolve` track, so "they
teach us what they know" is a resolve-gated fate rung rather than a new system), and **allies and
events** can lend a friendly mage who contributes every turn. **No research institutions** — an ad
hoc army has none, and the user rejected them explicitly. **A known oddity, accepted with eyes
open:** a mage who spent the battle hurling fire learns no more Fire than one who stayed home. The
alternative considered was "study steers, practice teaches what you cast"; the user chose the simple
rule.

**M-8/M-9. RESEARCH IS BY SCHOOL, CUTTING ACROSS PATHS — four of them: EVOCATION, CONJURATION,
ENCHANTMENT, CONSTRUCTION.** Fewer than Dominions' seven, but genuinely orthogonal to paths, so a
spell is gated TWICE: by the army's school level and by the caster's path level. Harm, summoning,
what is laid on a unit, and making things. All three existing spells file cleanly (fireball ->
Evocation, raise_dead -> Conjuration, bless -> Enchantment), which is a sign the cut is at a real
joint. **Construction ships with the set even though it is empty today** (user's call over holding
it back): it is the natural home for magic-item crafting, which 9-7 already defers to its own
interview.

**M-10. THE COST FORMULA IS DOMINIONS' OWN:** `spellFatigue / (casterLevel - spellLevel + 1) +
encumbrance`. The second term is the unit's existing `fatigueCost` (4 by default) — Dominions'
encumbrance under a name we already have. A path level therefore buys a real price curve rather than
mere access: a Fire 5 casting a Fire 1 spell pays a fifth of what a Fire 1 pays.
**Which path's numbers the divide reads is answered by M-20: the PRIMARY path, always.** Rejected: a flat
cost (no reason to want depth), and the divide with no additive floor (a high-level caster spamming
a cheap spell would pay almost nothing).

**M-11. BANNERS ARE THE ALLOWANCE, AND A CASTER DRAWS FROM EVERY BANNER ON THEIR SIDE.** There is
NO separate gem currency: gem management is *"kept simpler but works basically the same way"*
(user). A banner tier contributes channels; the channels form an **ARMY-WIDE POOL** any caster may
draw on to push past their own fatigue, which is Dominions' burn-a-gem-for-fatigue use delivered
through the vessel decision 10 already named.
**THIS AMENDS DECISION 10**, which said banners limit what *a squad* may cast — the limit is
army-wide, not per-squad. Recorded as an amendment rather than applied silently, because 10's
original wording is still in this file (the 12-3 precedent).
**AND IT ANSWERS DECISION 16**, the basic banner's benefit, deferred since 2026-08-10 until the
surrounding systems could be played. This is that moment: a basic banner's benefit is its channel.
Mechanically the pool is a new TOP-LEVEL field on the battle input rather than a per-placement one.
Rejected: real per-path gems (an acquisition system with no province map behind it) and gems as
consumable store items (a new shape for a store built around permanent kit).

**M-12. SCRIPT, THEN AI — and a compact spell list with MINOR AND MAJOR FORMS rather than ladders.**
An ordered list of preferred spells per caster; when it runs out the engine chooses for itself.
Stances — biasing the AI toward a type of spell — are wanted but come **afterwards**, not in the
first slices. And unlike Dominions there are deliberately FEWER spells, with **one spell carrying a
minor and a major form** instead of a ladder of near-duplicates: *"less outdated clutter"*, and the
minor form keeps a low-path caster useful exactly as Dominions' early-generation spells do.

**M-13. THE SCRIPT NAMES THE FORM; THE AI TAKES THE BEST ONE.** In a script the player chooses minor
or major deliberately — a strong mage can be told to spend cheap and conserve fatigue — while the
engine, once the script is exhausted, uses the most powerful form the caster qualifies for.

**⚠ AMENDED BY S4-2 (2026-08-25): the first half is NOT built and is not on the near list.** A chosen
line names a SPELL, and the engine takes the strongest qualifying form within it — the second half of
this decision, applied everywhere rather than only past the end of the list. So "told to spend cheap"
is currently inexpressible, by the user's call that the ORDER is the whole decision procedure until
there is a real cast AI. The half that still stands unchanged is the one the engine implements.

**M-14. HOLY AND UNHOLY ARE GRANTED, NOT RESEARCHED.** A Priest's Holy level alone gates their
blessings; no school level is involved, as in Dominions. **But a spell requiring BOTH Holy and an
arcane path DOES carry a school gate, possibly at level 0** (user) — on the books, but needing no
depth. **The consequence for the data model, and it is built in from the start rather than
retrofitted: a spell's requirement is an ORDERED LIST of path requirements** (Dominions' `F2A1`
shape), plus an optional school requirement which pure-Holy spells simply lack. Ordered rather than
a set, because M-20 makes the FIRST entry load-bearing.

**M-15. FOUR SLICES: ENGINE -> CAMPAIGN -> RESEARCH UI -> SCRIPTING.**
1. **Engine** — mana deleted, fatigue costs with M-10's divide and M-2's overflow, paths as unit
   data, multi-path requirements, minor/major forms, and a real selection policy replacing "first
   castable in roster order".
2. **Campaign** — paths rolled at hire, the research track and its sources, unlocks, the army-wide
   banner channel pool. **At the end of this slice a spell fires in a real battle for the first
   time in the project's history.** Schema bump (research state, per-character paths, scripts).
3. **The research screen** — directing the school, seeing what is unlocked.
4. **Scripting** — storage plus the script editor on 9b's character sheet.
Same reasoning as 9-1 and 13-12: each slice is playable and reviewable alone, and the largest UI
piece sits on a settled server.

**M-16. PATHS RUN 1-9, Dominions' full scale.** The user's reason overrides the "fit the campaign"
argument the assistant made from the boss meter (which fills 50-100/turn toward 1000, i.e. a 10-20
turn act): ***"Our current campaign is just the first act, so dont worry about balancing it to fit
this."*** Act one reaching only the low end is **headroom, not dead range**.

**M-17. ONE SYSTEM — THERE IS NO PLAYER MAGIC AND ENEMY MAGIC** (user). The enemy uses the same
paths, the same fatigue rules, the same spells. This falls out naturally from putting the spell
layer in the ENGINE, which knows nothing about who owns a unit: path levels ride the placement entry
for both sides exactly as `squad_mods` and `squad_abilities` already do, and the engine never learns
the word "research".

**M-18. AUTHOR ONE MINOR SPELL PER PATH — ALL TEN — PLUS MAJOR FORMS FOR THE THREE THAT EXIST.**
Coverage here is CORRECTNESS, not polish: paths are rolled at hire (M-5), so a path with no castable
level-1 spell makes that roll a dud and the player hires a Water 2 mage who can do nothing. The
three existing spells are reworked into the model rather than kept beside it. Numbers are
**BALANCE-DEFERRED** per the standing pass.

**M-19. THE ENEMY'S SCHOOL LEVEL IS DECLARED BY THE ENCOUNTER** (user: *"the research can be limited
by the encounter"*). Both sides pass the identical two gates; only the source of each number
differs. The player's school level is campaign state grown by research; the enemy's is written on
the encounter, and their paths are authored like their gear (9-12/9-13 already ship enemy champions
generated per encounter). **This gives the designer a dial to escalate enemy magic across a campaign
— later acts fight at a higher level — with the enemy never REACTING to anything, so standing
principle 1 is untouched.**

**M-20. THE FIRST PATH IS THE PATH THE SPELL IS ACTUALLY CAST WITH; THE OTHERS ONLY GATE IT**
(user, 2026-08-25: *"Every spell is really cast with the first path, the others just gate it, they
dont matter to fatigue etc, the effect will scale with the first path etc not with the
secondaries"*). A spell's requirement list is **ORDERED, highest requirement first**, and that first
entry is the **PRIMARY** path. It carries everything:

- **Fatigue** — M-10's divide reads the caster's level in the PRIMARY path against the primary
  requirement. Secondary paths never enter the arithmetic.
- **Effect scaling** — a spell's strength grows with the caster's PRIMARY path level, never with a
  secondary. A Fire 5 / Water 1 caster throwing a Fire-primary spell scales on the 5.
- **The nature of the casting** — *"the first path ... will determine the type of casting generally,
  not just with low"*. Each path may impose its own casting character on the spells it leads, and
  Low (M-21) is the first path through that door rather than a special case beside it.

Secondary paths do exactly one thing: **you cannot cast the spell without them.** That is what
spares a multi-path spell from needing a second cost model, and it is why the list is ordered rather
than a set.

**A NAMING NOTE, because the interview nearly created a collision.** The user called the first path
the *"major"* one (*"major or however we will call it"*), but **major** is already taken by
M-12/M-13 for the stronger FORM of a spell. The first path is therefore **PRIMARY** throughout. Do
not reintroduce "major path": one word with two meanings inside one system is how a later reader
mis-implements it.

**M-21. LOW'S BARGAIN: HALF THE FATIGUE, AND A PRICE IN BLOOD.** *(Sharpened by M-24: the price is a second effect.)* A spell whose PRIMARY path is Low
costs **half fatigue** — the shortcut Low exists to offer — **and carries an ADDITIONAL authored cost
that is thematically a sacrifice**: damage to the caster, damage to allies, or the outright death of
an ally (user: *"low spells will have some additional cost, might make allies take damage, caster
take damage, even sacrifice an ally or something to make it thematic"*). **This CORRECTS M-4 as
first recorded**, which had Low paying in life INSTEAD of fatigue. Low is never simply cheaper: it is
cheaper in the currency that limits casting and dearer in the one that cannot be recovered
mid-battle.

**M-22. CAST SELECTION IS A PRIORITY WALK, AND FATIGUE NEVER BLOCKS IT.** Each caster carries an
ordered default list of the spells they know. The engine walks it: skip a line the caster's paths or
the army's school level does not allow, take the most powerful FORM they qualify for (M-13), and
**fall through to the next line when a spell finds no legal target** rather than stalling. This
replaces `chooseSpellToCast`'s "first castable in roster order", which `SpellList.cpp` itself calls
deliberately dumb.

**FATIGUE IS NOT A GATE ON CASTING** (user, 2026-08-25: *"fatigue is not a cost, as noted you can get
unlimited fatigue, it will just be turned into damage so it should not block for now"*). The old
`mana >= manaCost` clause has no successor: nothing checks affordability, because under M-2 there is
no such thing as unaffordable — a caster may cast himself into the overflow and bleed for it. **The
interaction to resolve at build time, flagged rather than decided here:** `Battlefield` already makes
a unit past `FATIGUE_MAX` spend its turn recovering, so whether an exhausted caster still reaches the
special phase is a real question about the tick, not about spell selection.

**THE WALK IS ALREADY A SCRIPT**, which is why slice 4 is cheap: the player's list replaces the
default one, and there is no second code path to write or reconcile.

**DEFERRED, AND EXPLICITLY NOT THIS SLICE** (user): a **simulated cast** of every option, scored on
its outcome, best score winning — *"to make it a bit more dynamic but not for this slice
certainly"*. Do not build scoring hooks in anticipation; the targeting split it would need is real
work and belongs to the slice that uses it.

**M-23. CASTING TIME REPLACES COOLDOWN, AND THE FATIGUE IS PAID WHEN THE SPELL GOES OFF.** A spell
is authored with a casting time in ticks rather than a post-cast cooldown, **minimum one turn**
(user) — so the cheapest spell still occupies the caster for a tick, and nothing casts instantly.

**The fatigue lands at completion, not at the start and not per tick** (user, 2026-08-25: *"The
caster gains fatigue when the spell is actually cast, the fatigue powers the spell, if there is no
spell there is no fatigue"*). The rule reads cleanly in both directions: fatigue is what POWERS the
spell, so an interrupted channel costs nothing, and a caster can never be exhausted by a spell that
never happened. Rejected on the user's answer: paying up front (which front-loads exhaustion and can
drop the very cast it paid for) and paying per tick of channelling.

**BEING HIT MID-CAST FORCES A CONCENTRATION THROW** (user). The interruption rule is a roll, not an
automatic loss — a struck caster may hold the spell together. **What the throw is rolled against is
BALANCE-DEFERRED** like every other number here; what is decided is that damage threatens a channel
and does not simply end it.

**A CONSEQUENCE RAISED HERE AND CLOSED BY M-25 BELOW: how a passed-out mage moves now that
casters are squad members.** The answer is movement zero plus the existing help-the-slow
mechanic ("carry them"). That mechanic is real — `Battlefield.cpp`'s squad pre-pass pools movement
points, and a blocked squad spends `SQUAD_AID_COST = 3` points to buy the most-drained straggler +1,
described in its own comment as "faster members finding the path for a slow one and carrying his
gear". **The edge, weighed and accepted in M-25:** that same comment records that "a member at zero or below
blocks the whole squad", and a unit at `movementSpeed` 0 never regains points on its own, so aid at
3:1 becomes the only thing moving him and the squad hauls him at roughly a third speed.

**M-24. LOW'S PRICE IS A SECOND EFFECT THAT FIRES ALONGSIDE THE SPELL** (user: *"just basically
casting a double spell"*). This SHARPENS M-21 rather than replacing it: a Low-primary spell is
authored as **two effects that both resolve** — the intended one aimed outward, and a harmful one
aimed at your own side (the caster bleeds, allies burn, an ally dies). Low is literally casting
twice, once against them and once against yourself.

**Why this is the cheap answer as well as the thematic one:** M-2's data model already carries a
cast function per form, so the price is simply a second one. No new machinery, and **each Low spell
states its own sacrifice in data** rather than inheriting one rule — which is what M-21 asked for
when it said the additional cost is *authored*. Rejected: sizing the price as a second casting's
fatigue converted to damage (uniform, so every Low spell pays the same KIND of price), and doubling
Low's casting time instead (which would replace the blood price rather than sharpen it).

**M-25. A PASSED-OUT CASTER MOVES AT ZERO AND THE SQUAD CARRIES HIM** (user), closing the question
M-23 left open. No new mechanic: `Battlefield.cpp`'s squad pre-pass already pools movement points and
spends `SQUAD_AID_COST = 3` of them to lift the most-drained straggler, in its own words "faster
members finding the path for a slow one and carrying his gear". A caster at `movementSpeed` 0 never
regains points on his own, so that aid is the only thing that moves him — which is exactly the
picture wanted.

**The slowdown is accepted and deliberately not pinned to a number** (user: *"there is no real number
as it depends on the squad size but it is fine in any case"*). It falls out of squad size and terrain
cost together — many members make the pool that pays for one unconscious body — and it is a cost
worth paying rather than one to engineer away.

**M-26. A FORM THAT FAILS FALLS THROUGH TO A WEAKER ONE OF THE SAME SPELL** (user, 2026-08-25:
*"You can make the major need more corpses but then also try minor if the major fails"*, and
*"Just cycle through them, try major if gate closed for any reason, try minor"*). Selection takes the
most powerful form the caster qualifies for (M-13); if that form then fails to fire, the engine
cycles DOWN through the same spell's weaker forms and casts the first that succeeds.

**Why the fallback lives at casting time and not in selection:** a form can fail for reasons the
gates cannot see. `raise_dead`'s major wants corpses the field has not produced yet — corpses are
not a path level or a school level, so `chooseSpellToCast` is blind to the shortage and only the
attempt reveals it. **The price charged is the price of the form that ACTUALLY fired**, never the one
first chosen.

**This is also what licenses a hungry major.** The major form is free to demand more than the spell it
replaced, precisely because coming up short is no longer a wasted turn — it degrades to the minor
instead. So `raise_dead`'s major no longer carries its own internal skeleton fallback: **the minor form
IS the fallback**, and there is exactly one of it.

**LEFT OPEN, RAISED BY THE USER AND NOT INVENTED HERE** (*"I guess the major and minor might have
different priority"*): whether a caster might prefer one spell's MINOR form over another spell's
major — i.e. whether priority is really per-form rather than per-spell. Today the walk is per-spell
and takes the strongest qualifying form within each. Decide it when scripting (slice 4) gives the
player a way to express the preference, since that is where it would first be felt.

**⚠ ANSWERED BY S4-2 (2026-08-25): NOT YET — priority stays per-spell.** Slice 4 reached the point
this question was parked for, and the user's call was that the order alone is enough for now. The
question moves on to the real cast-AI slice (M-22's deferred simulated cast), which is the next place
it would be felt. Recorded as answered rather than still open, so nobody re-derives it as a gap.

**Assistant's calls, flagged as overturnable:**
- **A script line the caster cannot currently cast is SKIPPED, not stalled on** — they fall through
  to the next line. That is Dominions' own behaviour when a spell has no legal target, and it is
  what stops a stale script from freezing a caster for a whole battle.
- **`AUnit::addFatigue` is the one place M-2 lands.** It already floors at 0; it gains the 2 x MAX
  ceiling and the 4:1 overflow, and every unit inherits the rule with no per-caller change.
- **The three existing spells lose their exact-name gate.** R4 reserved exact-name requirements for
  genuinely unique spells; fireball, bless and raise_dead are not unique, they are the first three
  entries of a real roster.
- **Research numbers, spell fatigue values and hire path spreads are all balance-deferred.**
- **The campaign slice needs a schema bump** (research state, per-character path levels, scripts) —
  `CAMPAIGN_SCHEMA_VERSION` in models/campaign.js is the authority, and v40 is current.

**Deliberately left open, and not to be invented while building:** empowerment (M-5, after
playtest); stances (M-12, after scripting); Construction's content (waits on crafting's own
interview, 9-7); exactly how Low pays in life (design it when Low's spells are authored); and
whether the player may ever wield Unholy (M-14 leaves the door as a Low-style bargain or a dark
event, never a research track).


**✅ SLICE 1 SHIPPED (the engine, 2026-08-25).** What landed, against M-15's list:

- **Mana is gone** — `Spell::manaCost`, `AUnit::mana`, `getMana`/`setMana` and the `mana = 99` seeds
  in all three caster constructors. Casting costs FATIGUE, paid on completion (M-23).
- **`AUnit::addFatigue` is the single site for M-2**, as predicted: the `2 x FATIGUE_MAX` clamp and
  the 4:1 overflow with the fraction rolled land there and reach every unit, caster or not.
- **Ten paths and four schools as real types** (`SpellPath`, `SpellSchool` in `Spell.hpp`), path
  levels on `AUnit`, and the ordered multi-path requirement list with the primary leading (M-14/M-20).
- **Minor/major forms** as `Spell::forms`, weakest-first so "the last one that qualifies" IS "the
  most powerful form" (M-13), with M-26's fall-through when the chosen form fails.
- **The priority walk** replacing "first castable in roster order", with no affordability test at all
  (M-22).
- **Casting time replacing cooldown**, minimum one tick, plus the concentration throw on being
  wounded mid-channel (M-23).
- **Thirteen forms across ten spells** — one minor per path so no hire roll is a dud, plus major
  forms for fireball, bless and raise_dead, all three of which lost their exact-unit-type gate (M-18).
- **The JSON boundary**: `paths` on a placement entry (both sides, M-17) and a top-level `magic`
  block carrying per-side school levels and banner channels, both on the same never-throw discipline
  as `squad_mods`.
- **M-25**: a body past `FATIGUE_MAX` regains no movement points in the squad pre-pass, so the aid
  pool carries it.

**Deliberately still stubbed, and NOT to be mistaken for finished work:**

- **The school gate and the channel pool DEFAULT OPEN.** With no `magic` block on the battle input
  every school sits at 9 and there are no channels. This was the user's call (all three gates in the
  engine, values default open) so slice 1 could never remove magic from a battle that already had
  it. **Slice 2's job is to start sending real — and lower — numbers.**
- **Path levels are seeded from the unit type**: Mage Fire 1, Priest Holy 1, Necromancer Death 1.
  M-5 rolls them at hire, and that is campaign state, so it belongs to slice 2.
- **Every number is balance-deferred**, in `Defines.hpp` next to the spell constants.
- **Construction has no spells**, as M-9 said it would not.

**An assistant's call worth knowing about, since M-9 and M-14 pull opposite ways here:** M-9 files
bless under Enchantment, but M-14 says a Priest's Holy level ALONE gates their blessings with no
school level involved. Holy and Unholy spells therefore carry `SpellSchool::None` and pass no school
gate — M-14 wins because it speaks directly to the gate, while M-9's filing is about where the
conceptual cut falls. A tripwire test pins it.

**▶ SLICE 2 — THE CAMPAIGN LAYER: INTERVIEWED 2026-08-25, NOT YET BUILT.** Thirteen more decisions,
all the user's, taken in a second interview once slice 1 had shipped. They settle what M-15's
one-line "campaign" bullet left open. **Numbers marked (bd) are BALANCE-DEFERRED** per the standing
pass — plausible values chosen by the assistant, not tuned ones, and free to move without reopening
a decision.

**S2-1. THE DIRECTION ROUTE SHIPS WITH THE SERVER, NOT WITH THE SCREEN.** Slice 2 lands
`campaign.research` AND `POST /:id/research {school}` and exposes both through `campaignView`, so
slice 3 is a pure UI slice against a settled server. Same reasoning as 13-12 and 9-1, and the same
shape: the largest UI piece sits on a server that already answers every question it will ask.
Rejected: state-only with a hardcoded focus (slice 3 then grows a server half), and no focus at all
with points split evenly (which throws away M-7's *"the choice is WHICH SCHOOL, not how much"* — the
one decision research exists to offer).

**S2-2. A FRESH CAMPAIGN STARTS WITH ALL FOUR SCHOOLS AT 0.** Every arcane minor needs school 1
(ward 2, the majors 3), so on day 1 the three starting Mages can cast **nothing at all**, while the
three Priests bless from the first battle because Holy carries no school gate (M-14). The
consequence is stated rather than softened: research is immediately the most valuable thing on the
board, and the first unlock is an event the player feels. **If the dead first turn reads badly, the
lever is the level-1 cost, not the design.** Rejected: all four at 1 (research becomes a top-up
rather than a lifeline, and the first-unlock moment is spent before it happens) and Evocation 1 with
the rest at 0 (silently declares a default school and makes a Fire hire luckier than the others).

**S2-3. THE HIRE ROLL: A PRIMARY AT LEVEL 2, THEN ONE 25% CHECK** (user: *"primary level2, then 25%
to get a new path (can end up being the same)"*). A Mage's primary is drawn from the **eight
non-Holy paths** at level 2; a **single** 25% check then draws once more from the same pool — a new
path enters at **1**, a repeat is **+1**, so Fire 2 becomes Fire 3. That repeat is the only way a
fresh hire reaches the majors' level-3 gate, which is what makes it worth wanting. **Not a repeating
loop** (the user chose the single check): no lottery tail, and a distribution with two shapes rather
than an open-ended one. **Unholy is NOT in the pool** — M-14 leaves the player's Unholy a Low-style
bargain or a dark event, never a hire.

**S2-4. A PRIEST IS ALWAYS HOLY 2 — FLAT, NO ROLL** (user: *"priest just get lvl2. Being a priest is
very formal, not related to skill"*). The Mage lane is the gamble and the Priest lane is the
certainty, and that is the whole difference between the two hires. It also means a Priest never
reaches the major bless at hire; moving a path is what items and rare events are for (M-5).

**S2-5. PATHS ARE HIDDEN UNTIL HIRE.** The recruit card offers "a Mage"; the roll happens inside
`mintCharacter()` and the log names what took service. M-5's *"a real gamble on a named individual"*,
and the roll site stays the one place characters are already minted. Rejected: sealing a rolled
caster onto the day's offer (the machinery raid bearers use), which turns hiring into shopping.

**S2-6. MAGES ALONE FEED RESEARCH — NOT PRIESTS.** Holy needs no research and priesthood is formal
(S2-4), so the two lanes trade against each other: **Priests give day-1 castings, Mages give the
future.** And **a Mage away on a mission still studies** — any living Mage counts wherever they are,
because a second thing that changes the rate re-opens exactly what M-7 closed when it made every
mage contribute equally, posted or not.

**S2-7. POINTS BANK PER SCHOOL, AND SWITCHING FOCUS COSTS NOTHING.** Each school holds its own level
and its own part-finished progress; the focus decides only where this turn's points land. Switching
parks progress where it was earned and picks it up untouched later, so **the focus is a plan rather
than a commitment you get punished for revising.** Rejected: one loose pool spent on demand (no
focus at all, contradicting S2-1) and forfeiting the partial on a switch (a punishment, plus a decay
number to tune, attached to a choice that is supposed to be about direction).

**The numbers (bd):** 10 points per living Mage per turn, a lent ally the same; level *n* costs
`30 × n`. Three Mages therefore open a school at the end of turn 1 and reach the majors' level 3
around turn 6. Levels run to 9 like paths — act one reaching only the low end is headroom, not dead
range (M-16).

**S2-8. CHANNELS BY TIER — PLAIN 0, BASIC 1, ITEM 2 (bd) — AND ONLY THE FIELDED SQUADS COUNT.**
Three numbers in one place, and **decision 16's long-deferred answer made concrete: the basic
banner's benefit IS its channel.** A banner sitting in camp channels nothing, so a two-squad raid
draws on less than the whole army — *"army-wide"* (M-11) means not per-squad, never regardless of
presence, and carrying your bannered charters becomes a real decision. The pool is set at battle
start, drained by the engine and never persisted, so it needs **no schema at all**. Rejected:
authoring the count per `ITEM_CATALOG` row (two mechanisms for one number, plus a fallback for a
banner that authors none) — do that the day a banner actually wants to be special.

**S2-9. THE ENEMY'S SCHOOLS ARE ONE SEALED NUMBER PER ENCOUNTER:** `evocation 1, conjuration 2,
enchantment 1, construction 0` (bd), written onto the host at creation exactly like its bearer.
Their eleven Necromancers therefore **keep raising skeletons while the player starts at nothing** —
which is the story the fluff already tells (M-6: our mages are other kinds of mage catching up). The
host never reacts to anything, and a later act simply authors higher numbers, which is the dial M-19
asked for. Rejected: schools climbing with the day (a difficulty curve nobody designed, and it edges
toward an enemy that reacts) and all-zero enemy schools (which would silently remove something that
happens in every battle today, and waste eleven casters already in the host).

**S2-10. ENEMY CASTERS ROLL THE SAME SPREAD THE PLAYER'S HIRES DO — SO THEY ARE SEALED WHERE THEY
ARE DEALT.** The host's roll goes onto `enemy.plannedPlacement` at creation; a raid target's goes
onto the opportunity when the board is drawn. Rolling at launch instead would let a reload reroll
the enemy, which is precisely the bug the v40 bearer sealing exists to prevent.

**S2-11. SLICE 2 AUTHORS ITS SOURCES, NOT ONLY THE PLUMBING.** A new `research` effect granting
`{points}` or `{allies}`, one **resolve-gated garrison fate** (the wardens teaching what they know —
M-7's own example, hanging off `garrison.resolve` rather than a new system) and one **ally fate**
lending a mage. **A lent mage is a PERMANENT standing contributor** — `research.allies` only goes
up, barring an event that takes one away — which is how `forage.modifiers` already reads. M-15 lists
"the research track AND ITS SOURCES" as this slice's job, and an effect nothing grants is untestable
in play. Both land in `docs/BALANCE_SHEET.md`, whose test fails if an effect escapes the sheet.
Rejected: a lent mage with an `untilDay` (a per-ally expiry to walk at newDay, for the source that
is meant to be the quiet background one).

**S2-12. THE FOCUS IS A CAMP DECISION — `prepare` ONLY, FREELY RE-SETTABLE.** It belongs beside
forage and the camp actions, and changing your mind is free because nothing is spent: no metering,
no `drawnDay` stamp, no once-per-turn rule to remember. Rejected: ungated in every phase (the
attach/detach rule, 5-7), because that would let study be re-aimed after seeing the omens and the
raid board — information the choice should not get — and once-per-turn, which punishes a misclick on
a decision that costs nothing.

**S2-13. THE ONLY UI IS PATHS ON THE CHARACTER SHEET.** `campaignView` exposes each character's
paths (and the research state, for slice 3 to render); the existing character screen prints
`Fire 2 · Water 1`, so the hire gamble pays off on the turn you take it. Everything else about
research waits for slice 3 — which is what keeps that slice pure UI rather than a screen reconciling
with a HUD line built early.

**What slice 2 builds, in one place** (schema **v40 → v41**):

```
campaign.research = {
  focus:   'evocation',                    // S2-12: set in `prepare`, freely re-settable
  allies:  0,                              // S2-11: lent mages, permanent
  schools: { evocation: {level, points}, conjuration: …, enchantment: …, construction: … },
}
campaign.characters[].paths      = Map{ fire: 2, water: 1 }   // S2-3/S2-4, rolled in mintCharacter
campaign.enemy.magic             = { schools: {…}, channels: 3 (bd) }   // S2-9, sealed at creation
campaign.enemy.plannedPlacement[].paths                       // S2-10, sealed at creation
campaign.raid.opportunities[].casterPaths                     // S2-10, sealed when the board is drawn
```

- **Both battle-input builders** gain the `magic` block and `paths` on caster entries: the pitched
  battle and the raid in `routes/campaigns.js`. The engine's default-open 9 stops applying to
  campaign battles the moment a real block is sent; `./game sample` sends none and is untouched.
- **Accrual runs at end of turn** in `dayResolution.js`, into the focused school only.
- **Nothing migrates.** A save from another schema version is deleted on listing, so v41 needs no
  backfill for the six starting casters — they are minted fresh with their rolls.

**▶ WHAT SLICE 2 ACTUALLY LANDED (2026-08-25).** All thirteen decisions built as written. Schema
**v41**. `services/magic.js` is the new home for everything here — the hire roll, the research
arithmetic, the channel table and the block each side is sent — and it is the ONE place the
campaign layer knows what a path or a school is.

**S2-14 IS A NEW DECISION, taken with the user while building.** S2-10 says the enemy's casters
"roll the same spread the player's hires do", but S2-9 asserts their eleven Necromancers **keep
raising skeletons**. A Mage-style roll (a primary drawn from the eight non-Holy paths) could hand a
Necromancer Fire 2 and no Death at all, which contradicts S2-9 outright — so the two could not both
be taken literally. The user's call: **a Necromancer's TYPE declares his primary — Death 2, exactly
as a Priest's declares Holy 2 — and he then takes the same single 25% check a Mage does.** Skeletons
are guaranteed, S2-10's roll still does something, and the occasional Death 3 raiser reaches the
major form (~1 in 32). The asymmetry with the Priest, who takes no check at all, is deliberate and
is the reason each way: **priesthood is formal, necromancy is a craft.**

**Three things the build learned by running the binary, recorded because a later reader will
otherwise re-derive them:**

- **`channels` is a FATIGUE-RELIEF POOL, not a gate on casting** (`Battlefield::drawChannels` — a
  caster draws on it to push past their own fatigue, and a dry pool simply grants 0). This matters
  because a fresh campaign's charters are all *plain* tier and therefore channel **nothing** — and
  if channels gated casting, S2-2's "the three Priests bless from the first battle" would have been
  false on day 1. Verified against the real `./game battle`: at all four schools 0 and channels 0, a
  minted Priest blesses. S2-2 stands.
- **The zeros in the wire's path map are load-bearing, and this was measured, not assumed.**
  `AUnit::setPathLevel` writes only the paths it is handed, and all three caster constructors seed
  one of their own (Mage → Fire 1, Priest → Holy 1, Necromancer → Death 1). Sending a hire's rolled
  paths *sparsely* would leave that seed standing beside them. Against the real binary, one Priest
  in three otherwise identical battles: `paths` **omitted** → he blesses (the constructor's Holy 1
  survives); `paths` **fully zeroed** → he casts nothing; `paths` as the campaign now mints him
  (`holy: 2`) → he blesses more often than the omitted case, because a higher primary divides the
  fatigue. So `enginePaths()` sends **every path the engine knows, zeros included**, and the RECORD
  is the whole truth about a caster.
- **`castEmber` and the other damage spells log nothing** (they resolve as a `RangedShot`), so a
  replay-log grep is no evidence a damage spell did or did not fire. The school gate was verified
  through `stoneskin` instead, which does log: enchantment 0 → no cast, enchantment 1 → it fires.

**ONE SEAM LEFT OPEN ON PURPOSE, and it is not in the thirteen decisions: an enemy BEARER rolls no
paths.** `rollBearer` draws his type from `ENEMY_ARMY`, so a champion can be a Necromancer — and
because `bearerEntry` builds him from his GEAR and nothing else, he reaches the field with the
engine constructor's Death 1 while the rank-and-file raisers beside him now carry the rolled Death 2
of S2-14. He is therefore slightly *weaker* at magic than the ordinary casters he leads, which reads
oddly. It was left rather than fixed because S2-10 speaks of the casters on `plannedPlacement` and on
a raid card, and a bearer is neither — giving him paths means a new field on `enemyBearerSchema` and
a decision about whether a champion rolls better than his men, which is a decision nobody has taken.
**Take it in the slice that next touches bearers, not silently.**

**What was deliberately NOT here, and was slice 3's:** every screen for research. `campaignView`
shipped the whole `research` block from slice 2 (S2-1) but only ONE thing rendered — the paths on the
character sheet (S2-13), so the hire gamble paid off on the turn you took it. **Slice 3 has since
shipped and built the rest; see below.**

**▶ SLICE 3 — THE STUDY: INTERVIEWED AND SHIPPED 2026-08-25.** Six decisions, all the user's. The
research screen M-15 asked for, and the slice that made the campaign layer learn what a spell is.

**S3-1. THE SCREEN NAMES SPELLS, LOCKED AND UNLOCKED** — grouped by school, each row carrying its
gates. This is the decision that broke the "pure UI" prediction (see the block at the top of this
section): nothing campaign-side had ever heard of a spell, so it needed an engine export. Rejected:
levels-and-progress-only, which is truly pure UI but makes directing study **a choice of tone** —
the player picks a school without being told what the school buys, which is exactly what the standing
"no card shows flavour alone" rule exists to stop; and a server-authored spell table with no engine
export, which would write every gate down twice in two languages with nothing able to catch them
drifting (the `placeable`/`spawnable` mistake, again).

**S3-2. HOLY AND UNHOLY ARE NOT ON THIS SCREEN** (user: *"we only need to have them in the scripting,
not in screens"*). They carry no school gate (M-14) — they are granted, not researched — so on a
screen organised by school they have no home. The consequence is stated rather than softened: until
slice 4 ships, **no screen in the game names `bless` or `drain_life`**, though three Priests have been
casting the first one since day 1 of every campaign. Rejected: a separate "Granted" section (the
assistant's recommendation — it teaches M-14 by showing it, but puts a section on the research screen
about the thing that is not researched) and listing them as pseudo-schools, which implies they are
researchable, the one thing M-14 says they are not.

**S3-3. A THIRD HUD DOOR — "THE STUDY".** A takeover exactly like The Army and The Stores, opened
from the same shelf, because research is **army-wide**: the same tier as the stores and unlike a
squad's charter. One boolean on `useUiStore` (`studyOpen`), no router, per 13-8. It hides while a
fate is owed — the side of the overlay The Army is on, not the side browse is on (17-6) — because the
focus route is phase-gated and a Study opened over the choice cards could only offer a button the
server refuses.

**S3-4. A ROW IS A NAME; THE DESCRIPTION OPENS ON CLICK** (user: *"You can expand or click to see the
whole description and what it does mechanically. I guess a name is enough for the menu"*). So the
menu stays dense enough to read a school at a glance, and the prose is there for the player who wants
it. The expanded panel carries the description **plus the real fatigue and casting time** — the
mechanical half is exported data, not prose, so it cannot drift.

**S3-5. CONSTRUCTION IS TREATED LIKE ANY OTHER SCHOOL** (user: *"Dont worry about it, Im the only
player, just make it normal"*). It holds no spells — M-9 shipped it hollow, and crafting has its own
interview pending — so focusing study there banks levels that unlock nothing today. Shown, focusable,
not special-cased. Rejected: disabling the focus with a reason (the assistant's recommendation, a
trap-avoidance the sole player does not need) and hiding the school entirely, which would leave the
screen and the route disagreeing about how many schools there are.

**S3-6. A ROW STATES ITS REQUIREMENT AND STOPS.** No "you have nobody who can cast this" mark. M-6
splits the two gates — the ARMY researches the school, the individual CASTER meets the path level —
and this screen owns the first. Whether you have a Fire 3 mage is the character sheet's business,
which is the screen that owns people. Rejected: marking rows no living caster qualifies for (it ties
S2-3's hire gamble to the research track and needs no new server state, but puts a fact about people
on the screen about study) and a per-school summary of your best path level.

**✅ SLICE 3 SHIPPED (2026-08-25).** All six built as written, and **no route and no schema bump** —
S2-1 held for the half it actually covered.

- **The engine exports its roster**: `SpellForm` gains `label` and `description`, `dump-spells` is a
  new headless mode, and `Spells::spellCatalogJson()` emits **one row per FORM** — "Ember" and
  "Fireball" are two rows a player reads, not one row with a rank hidden inside it. The spell id
  rides along so slice 4 can address the (spell, form) pair M-13 needs.
- **Descriptions are BUILT from the constants the effect bodies read**, never typed as literals, so a
  retuned `EMBER_DAMAGE` moves the sentence with it. The Study is the player's only written source on
  what a spell does, and prose carrying a hardcoded "4 damage" would go quietly wrong.
- **The catalog needs no collection.** `utils/spellCatalog.js` is a plain module cache filled at boot
  — nothing queries a spell and no document references one, so a schema for it would be a second
  place to keep in step. It degrades to an EMPTY roster when unset, which is what let 35 existing
  server test files that mock `services/engine.js` whole keep passing untouched.
- **`researchView()` in `services/magic.js`** assembles what campaignView ships; the view assembles
  and does not compute. `spellsForSchool()` is where S3-2's filter lives — a single
  `school === null` test, whose safety is pinned by a contract test asserting that school-less is
  **exactly** Holy/Unholy in the real binary. An arcane spell that ever lost its school gate would
  otherwise vanish off the research screen without a word.
- **Nine tests against the real binary and eleven against a fixture**, plus four C++ structural
  sweeps over the whole roster (every form has a label, a description, at least one path requirement,
  a casting time ≥ 1). The sweeps are the point: a spell authored next month is covered the day it is
  written, the same shape `tests/describeEffect.test.js` uses on the campaign side.

**A TRAP SLICE 3 FELL INTO AND SLICE 4 WILL MEET AGAIN — a takeover screen's phase gate must read
`campaign.phase`, never the UI store's `phase`.** The Study's focus button first read the UI phase,
which is the SCREEN the player is looking at, while `POST /:id/research` answers to
`rejectIfPhasePassed(campaign, …)` — the phase the turn is actually in. For a screen mounted BY the
phase router those two agree, which is why every panel before this one got away with `locked`. **A
takeover does not agree, because it is reachable from every phase**, and the two come apart in two
ordinary ways: a back-step is pure looking and the sync is forward-only, so the screen can say
`prepare` while the turn is in `raids`; and a UI-only screen (report/placement/battling/result/
replay) has rank **−1**, so `phaseRank(phase) > phaseRank('prepare')` is FALSE there and the gate
read as open on the day report. Both rendered a live button that could only answer 409. Fixed in
`8c3ba1c`.

**The testing half of that lesson is the sharper one.** The first three tests written for the gate
set the campaign's phase, opened the screen and asserted the button was disabled — and they passed
against the BUG, because App syncs the UI phase forward to the server's and the two readings then
agree. **A gate test has to put the screen and the server deliberately out of step** (set
`campaign.phase` to a later phase, then `useUiStore.setState({phase})` back to an earlier or a
UI-only one) or it is testing nothing. The replacements were checked by reverting the fix and
watching them fail. Slice 4's script editor is another takeover with a phase-gated action; it
inherits both halves of this.

**The dice-flake trap slice 2 left is still live and still worth heeding** (it bit slice 2 twice —
tests that passed locally and failed in CI, fixed in `90562b1`). `rollBearer` can make an enemy
champion ANY type in `ENEMY_ARMY`, so filtering a placement by `unit_type` alone catches him too; and
`wandering_adept` is in the ordinary draw pool and lends a mage permanently, so any test asserting a
research RATE must read `research.allies` rather than assume the starting three Mages. Slice 3's own
rate test reads it off the view for exactly this reason. **Run a new random-sensitive test several
times before believing it.**

**▶ SLICE 4 — CHOSEN SPELLS (SCRIPTING): INTERVIEWED AND SHIPPED 2026-08-25.** Nine decisions,
all the user's — do not re-derive them. The last of M-15's four, and the slice that finally puts a
spell's NAME in front of the player as something he chooses rather than reads.

**S4-1. A CHOSEN LIST IS A PREFERENCE, NOT A REPERTOIRE.** The chosen spells lead the caster's walk;
the rest of the roster keeps its order behind them. So an empty list is *exactly* the behaviour of
every battle fought before this slice, nothing in the feature can make a caster mute, and a stale
choice costs a skipped line rather than a wasted battle. This settles M-12's "script, then AI"
against the sketch's "equip x spells", which read as a restriction. **The whole feature is therefore
additive**, which is what let it ship without a migration or a fallback path.

**S4-2. A LINE NAMES A SPELL, NOT A FORM — and this AMENDS M-13** (user: *"We will just use the order
for now, later we will have actual spellcasting ai"*). The engine still takes the strongest form the
caster qualifies for within a chosen spell, and M-26's cast-time fall-through is untouched. M-13's
"a strong mage can be told to spend cheap" is therefore **not expressible today**, deliberately: the
ORDER is the whole decision procedure for now, and per-form control waits for the real cast AI.

**This also answers M-26's one deferred question** — *"I guess the major and minor might have
different priority"* — which M-26 explicitly parked until scripting gave the player a way to express
it. The answer is **not yet**: priority stays per-spell. M-26 asked the right question at the right
time; the user's call is that it is not this slice's to spend.

**S4-3. THE SHEET OFFERS ONLY WHAT HE CAN CAST TODAY** — his paths *and* the army's research, both
enforced. Rejected: showing the whole roster greyed (most rows are permanently dead on most sheets),
and path-filtered-but-research-blind (which would let a player script toward an unlock). **A property
falls out of this and is worth knowing: a saved choice can never go stale.** Paths are fixed at hire
(M-5) and school levels only ever rise (S2-7), so nothing prunes the stored list and nothing needs to.

**S4-4. EDITABLE ALWAYS — ANY PHASE, IN CAMP OR AWAY** (user: *"There is no reason why you couldnt
change the script while away, they wont participate in battles while on a mission and the fluff isnt
that you tell every mage what to cast, in fluff they decide themselves"*). **The fiction is the
reason and it is load-bearing for the wording**: the player is not shouting cast orders across a
field, he is leaning on a mage's own judgement about what to reach for. So this goes *further* than
equipping's in-camp rule (9-8), and the sheet's away banner had to be narrowed — it now says the gear
and the posting are locked, because they are and this is not. Only the dead are read-only: a record
takes no orders (5-9).

*(Recorded because the assistant reached for it and it was wrong: S2-12's `prepare`-only research
focus is NOT a precedent here. The focus is an army-wide pooled allocation (M-7), not an order to a
person, so it settles nothing about a per-character screen.)*

**S4-5. THREE SLOTS (bd).** A cap on EXPRESSION, not on power — S4-1 keeps the rest of the roster
available underneath, so a fourth slot would add reach and never strength. Early casters cannot fill
three, which is the intended shape rather than a flaw. `MAX_CHOSEN_SPELLS`.

**S4-6. NO ENEMY SCRIPTS THIS SLICE, and the future design is recorded rather than left blank**
(user: *"Easiest way for a simple game like this is that we have scripts in store, the enemy gets
random assignment based on their paths. So they will appear smarter as the scripts make sense for
their paths. But not now, note down though."*). **A store of authored scripts, and an enemy caster
drawn one at random that MATCHES HIS PATHS** — competence without a decision anywhere in it, so
standing principle 1 is untouched. The engine already accepts a list on any placement entry (M-17
means it cannot tell whose caster it holds); only the campaign layer's authoring is missing.

**S4-7. THREE ORDERED SLOTS WITH AN INLINE PICKER**, reusing the sheet's own slot idiom (9-16) with
the ORDER as the visible structure. An inline picker rather than a store takeover (17-3): a spell is
not an object that lives somewhere. Rejected: a checklist with reorder arrows (order becomes a
secondary control) and drag-and-drop (new front-end machinery, and the hardest thing here to test).

**S4-8. A PLAIN CAST LINE LANDS NOW.** Every spell effect logged its own flavour, but nothing said
WHO cast WHAT — and the damage spells resolve as a `RangedShot` and so logged **nothing at all**,
which meant a player could reorder three slots and have no way whatever to tell the difference.
`AUnit::completeCast` now logs `Mage (blue) casts Ember`, naming the form that ACTUALLY fired so
M-26's fall-through reads honestly.

**▶▶ TIERED BATTLE LOGGING IS NOW BUILT — see "TIERED BATTLE LOGGING" below (interviewed and
shipped 2026-08-25).** What follows is the TODO as it was written when slice 4 shipped, kept because
it is the user's own wording of the design; the six decisions that settled it are in that section.

**▶▶ THE TODO AS IT STOOD, the user's design** (*"We will (*"We will
strive to log the combat with great detail with different levels, spells cast should however appear
on any level… Basic info, units dying, spells being cast are on by default but then we can go deeper
where we see every roll, mages preparing to cast and spells going off"*). A default tier carrying
basic info, deaths and casts; deeper tiers exposing individual rolls and casters mid-channel. S4-8's
line will be re-filed under that default tier when it is built.

### TIERED BATTLE LOGGING (interviewed and shipped 2026-08-25)

The TODO slice 4 left behind, taken up because the user wanted the tests to explain themselves:
*"We have existing tests, if the tests log in more detail I would assume it is easier to debug them
when something fails."* **Six decisions, all the user's — do not re-derive them.** No schema bump:
the one new persisted field is on `Battle`, which is not version-gated (see L-6).

**L-1. EVERY TIER IS PERSISTED; THE BROWSER FILTERS.** The engine has no verbosity setting and
records everything it knows. Rejected: a per-battle cap (the assistant's recommendation — cheaper,
but a battle is fought once and watched later, possibly at a depth nobody had chosen while it ran,
so capping at write time throws away the only chance to keep the detail) and two separate channels,
replay for players and stderr for developers (which would have left the player unable to go deeper
in the browser — the half of the user's design that says *"then we can go deeper"*).

**Measured, not guessed:** a sample battle was 319 ticks / 5,820 lines / **19.7 MB** before, and
**21.0 MB** after (+6.7%) with 31,053 Trace lines, 2,152 Detail and 4,895 Basic. The bulk of a
replay is 1,400 unit positions per tick, not prose, which is why the ladder was affordable at all —
and L-6 is what stops even that accumulating.

**L-2. THREE TIERS: Basic · Detail · Trace.** Basic carries turn markers, deaths, **casts**, routs
and the battle's end; Detail carries engagements forming, morale checks, a caster beginning to
channel, a spell fizzling; Trace carries every roll. **Casts sit on Basic so that the user's one
hard rule — "spells cast should however appear on any level" — is STRUCTURAL**: the filter cannot go
shallower than Basic, so no setting can hide a spell. Rejected: a fourth always-on tier for casts
(the same guarantee, one more concept) and unnamed numeric levels 1-9 (nothing in the code would say
what level 3 MEANS, so call sites drift).

Three existing lines moved OFF Basic to match the ladder as decided: the spell fizzle, the rally,
and the shield-chip. Everything else stayed, so the replay at its default depth reads as it always
did.

**L-3. TESTS RUN AT TRACE AND PRINT ONLY ON FAILURE.** `CAPTURE_BATTLE_LOG(field)` in
`tests/BattleLogCapture.hpp` attaches the battle to every following assertion as Catch2 scoped info:
silent on green, and on red it dumps the roll-by-roll fight under the assertion that failed.
Rejected: opt-in-while-debugging (CI goes red and you get the basic log only, so reproducing locally
is the extra step the idea existed to remove) and a whole-run env var (a Trace CI run prints
everything for passing tests too).

**It works because nothing drains the log in tests.** `Battlefield` clears `_tickLog` only in
`reset()`/`loadArmies()`, and only the `ReplayRecorder` takes it — so in a test the whole battle
accumulates and is simply sitting there when the assertions run. `tickLog()` was added beside
`takeTickLog()` for exactly this: reading the log to build a failure message must not consume the
log the test is about to assert on. **Measured: the fast suite is unchanged at ~2.5s.**

**L-4. THIS PASS AUTHORS THE COMBAT ROLLS.** The frame, the filter, the capture, the 21 existing
lines retagged, Trace where melee and ranged actually resolve, and Detail where the code already
branched. Rejected: a full sweep of the engine (most of it is code nobody is debugging) and
frame-only (the capture would have had nothing extra to show, which was the point).

**L-5. A CUMULATIVE SEGMENTED CONTROL, OPENING ON BASIC.** Detail includes Basic, Trace includes
both. Rejected: independent per-tier toggles (most combinations are noise, and it makes the
always-on rule for casts a special case rather than a consequence of the ladder) and storing the
tiers with no control yet.

**L-6. AT END OF TURN, EVERY BATTLE OLDER THAN THE CURRENT TURN IS DELETED** — the `Battle` document
and its `Tick`s — and `campaign.battles` is pruned with them (user: *"We only need to keep the last
turn in the DB for the campaign… the older battles cant be replayed anyways"*, conditional on there
being no way to watch them from the UI).

**THE CONDITION WAS CHECKED, NOT ASSUMED.** `campaignView` does ship the id list, but **no component
consumes it**: `getBattle`/`getTicks` are called only for the fight just watched. There is no
navigation to an old replay, so those ticks are storage nobody can open.

**Where the turn number lives, and why it is not on the campaign:** `Battle.day`. The campaign schema
is version-gated and a save from another version is DELETED on listing, so putting the field there
would have cost the player their in-flight campaign to store a number the battle already knows about
itself. `Battle` carries no such gate. A `null` day means "belongs to no turn" — the ownerless sample
battle behind the login-screen demo, which no sweep ever reaches because it is in no campaign's list.

**Two consequences handled rather than left to bite:**

- **A bare-string log line normalises to Basic at the persistence boundary** rather than being
  rejected. The campaign server and the engine binary are deployed together but not BUILT together,
  and a server meeting a pre-ladder binary should store its battles, not 400 on every one. The
  browser does the same for an already-stored replay, and shows an UNKNOWN tier rather than dropping
  it — a replay from a newer engine should read as slightly noisy, never as silently missing the
  line that explains the battle.
- **`Tick.log` is now `[{tier, text}]`**, and `tier` is deliberately not an enum for the same
  forward-tolerance reason: a validator would turn an unknown tier into a lost tick.

**▶ A REGRESSION THIS SLICE CAUSED AND FIXED, worth knowing about because the trap is still there.**
Naming a unit in a log line calls `unitNameForSymbol`, whose symbol map is built lazily **by
constructing one unit of every type — and every `AUnit` constructor draws a random number for its
sortKey.** That was harmless while the map was only built by the JSON export, and stopped being
harmless the moment combat started naming units: the first Trace line of a battle built the map
mid-fight and ate a dozen draws, which broke every test that pushes an exact dice sequence and made
a seeded replay depend on whether a log line happened to fire first. **The map is now warmed at
static-init**, before main and therefore before any seeding or any pushed dice. **Anything else that
lazily constructs units carries the same hazard.**

**S4-9. IT IS CALLED "CHOSEN SPELLS"** (user). Not "script" (our internal Dominions word), not
"standing orders" (the reading S4-4 ruled out).

**✅ WHAT SLICE 4 ACTUALLY LANDED (2026-08-25).** All nine as written. Schema **v42**
(`characters[].script`). Nothing migrates, as ever.

- **The engine change is one function.** `AUnit::setChosenSpells` rebuilds `_spells` as chosen-first,
  roster-behind — rebuilt from `defaultScript()` every call, so setting a list twice cannot compound.
  M-22 was right that slice 4 would be cheap: **there is still exactly one selection path**, and
  `chooseSpellToCast` was not touched at all.
- **`Spells::findSpell(id)`** is the only other engine addition, plus the S4-8 log line.
- **The wire is one field.** `script` on a placement entry, parsed on the same never-throw discipline
  as `paths` (unknown id skipped, repeats dropped), stamped from the RECORD by `characterEntryFor`
  and **stripped from the request** — a list in a deploy body is forged by definition.
  An empty list sends no field at all: absent and empty mean the same thing, and the wire says what
  the engine must not assume rather than restating a default.
- **`services/magic.js` keeps its monopoly** on what a path or a school is: `castableSpellsFor`
  (the S4-3 fold from thirteen FORM rows down to ten SPELL rows, each wearing the label of the
  strongest form the caster qualifies for), `chosenSpellsView`, `planChosenSpells`.
- **A row grows with the man who chose it.** Because the fold labels a spell with his best qualifying
  form, one choice reads "Ember" at Fire 1 and "Fireball" at Fire 3 — the stored id never changed, so
  the player never re-makes the decision.
- **`POST /:id/characters/:characterId/script`** takes the whole ordered list and replaces it. One
  route rather than a per-slot one: a set is then idempotent and a clear is just a shorter list.
- **The client compacts** (`chosenWith` in `CharacterSheetPage`): clearing a slot promotes what was
  under it, and picking a spell already chosen MOVES it rather than drawing a refusal the player
  would have to decode.
- **Thirty-one tests**: six C++ (ordering, empty-is-default, unknown ids, repeats, a spell he cannot
  cast, `findSpell`), eighteen campaign-side, twelve front-end, and **three against the real binary**
  proving the whole chain — an unscripted mage casts Ember, the same mage given `["shock"]` casts
  Shock, and a mage given a nonsense id is never left mute. Those three read their verdict off S4-8's
  cast line, which is the right coupling: the feature and the player's evidence for it are the same
  thing.

**THE PHASE-GATE TRAP SLICE 3 WARNED SLICE 4 ABOUT DID NOT FIRE — because S4-4 removed the gate
entirely.** The warning was sound and was heeded; the answer turned out to be that this screen has no
phase to gate on. **The warning still stands for the next takeover with a phase-gated action.**

**Sources for the Dominions baseline** (checked 2026-08-25):
[Magic — illwiki](https://illwiki.com/dom5/dom6/magic) ·
[Getting Started with Magic (Steam guide)](https://steamcommunity.com/sharedfiles/filedetails/?id=3319144156) ·
[Dominions 6 manual (PDF)](http://ulm.illwinter.com/dom6/dom6manual.pdf) ·
[Combat Magic — illwiki](https://illwiki.com/dom5/combat-magic)

### DECISION 9 — CHARACTER EQUIPMENT (interviewed 2026-08-24) — ✅ BOTH SLICES SHIPPED

The modifier layer 5a shipped empty finally gets filled. **Sixteen decisions, all the user's — do
not re-derive them.** The spec below was recorded on the user's instruction ("record the spec
only") and **both slices have since been built against it — see "9a SHIPPED" and "9b SHIPPED" at
the end of this section**.

What it stands on, already settled and NOT reopened here: 5-2 (the base type is never modified),
5-3 (sources stored, the stat bag derived), 5-4 (typed slots — head/torso/legs/hand/misc, a
per-creature count, capped at 10), 5-5 (the sparse `{slot, index, itemId}` list), 5-6 (the layout is
declared in the ENGINE catalog down the inheritance chain, with NO DEFAULT — an undeclared type is
an error), 6-1 (a unit is stats + anatomy + abilities), 6-3/6-4 (the implication closure), 17-3
(assignment happens at the TARGET's screen) and 17-5 (the server phrases every item).

**9-1. TWO SLICES, SERVER FIRST.** 9a is the engine and the server: anatomy in the unit catalog,
the ability-suppression path, the catalog rows, `characterMods()` deriving for real, equip/unequip,
loot, enemy bearers. It is playable through the API alone. 9b is the UI. This is 13-12's split and
its reason: a diff spanning C++, the schema and the largest new screen makes a red CI a bisect
across three unrelated kinds of change. Rejected: one big slice, and engine-first (which ships
nothing observable — what 6-0 rejected).

**9-2. GEAR GRANTS BOTH STATS AND ABILITIES, bundled on one row.** A row may carry a `{stat: delta}`
bag, an ability list, or both, the way `SQUAD_UPGRADE_POOL` rows already bundle several effects.
**This does not overturn "banners grant abilities, never flat stats" (user, 2026-08-20)** — that was
a rule about BANNERS, and gear is the other kind of thing. Rejected: abilities only (which would
leave `characterMods()` a function that can never return anything, after 5-2/5-3 built the whole
layer for deltas) and stats only (the first interesting item reopens it).

**9-3. ITEMS ARE FULLY GENERAL** (user, 2026-08-24: *"We will try to make items flexible and edit
every stat or add or remove any ability that exists in the game"*). An item may move any stat and
may both ADD and REMOVE abilities. Removal is new: the granted set has been additive-only since
slice 6.

**9-4. REMOVAL IS RESTRICTED BY RULE TO NON-IMPLIED ABILITIES, AND MADE SAFE BY ORDER** (user:
*"We can make the implied add the non-implied so that the adding happens after removal phase. Thus
the system will be robust regardless of changes. You might be able to technically remove something
but it wont actually work"*). Suppression is applied FIRST and `abilityClosure()` runs AFTER it, so
a row that denies an implied flag is representable but inert — the closure simply puts it back.
6-3's invariant (an undead that leaves a corpse is unwritable) therefore survives any future edit to
the implication table, and a new implication row turns an old item inert rather than dangerous.
The eligibility rule is an authoring convention; the ORDER is the enforcement. Rejected: literal
removal winning over the closure (reopens exactly the bug 6-3 exists to make unrepresentable) and
suppression before the closure with no authoring rule (same behaviour, but nothing tells an author
their item does nothing).

**9-5. THE STAT VOCABULARY IS THE CHARACTER SHEET** (user: *"Values should be the stuff that we show
as numbers on a character sheet. Anything tricky is an ability"*). `maxHP`, `attack`, `defence`,
`armour`, `speed`, `ballisticSkill`, `preferredRange`, `formationFighter` — `applyStatMod` grows the
branches it lacks. **`hitpoints` is NOT a stat: items move `maxHP` and HP is GENERATED from it**
(user: *"maxHP should of course be the one that gets changed, not the HP"*), which is what stops
gear making a character start every battle already wounded. **`reconTag` is excluded** — it is not a
sheet number but a signed fudge term in a campaign formula (`reconValue = speed² + ⌊ballisticSkill/2⌋
+ reconTag`; LightCavalry +4, Warhorse −2). **The user's direction, recorded as its own future
change and NOT smuggled in here: reconTag should really be an ability rather than a value**, which
means reworking how recon value is computed — a scouting-balance change, not a gear one.
**Behavioural flags are expected later** (user: *"Behavioral flags likely in the future but dont need
right now, just try to make it as flexible as possible"*).

**9-6. A ROW DECLARES ITS OWN UNIQUENESS.** Banners are unique; ordinary kit stacks. The cost the
interview feared (two storage shapes) turned out not to exist: `campaign.items` is already `[String]`
and may simply repeat, and two copies of one row ARE identical, so nothing needs telling them apart.
`unique: true` on the row, `grantItem` gating on it, **and one real fix — `assignItem`'s
`filter(id => id !== itemId)` drops EVERY copy and must become remove-one.** A per-instance uid
arrives only if items ever gain per-instance state, and for that reason rather than this one.

**9-7. FOUR CHANNELS EVENTUALLY; TWO IN 9a** (user: *"Loot, purchase, crafting, events"*). Every
channel goes through `grantItem`, which is already the one chokepoint and already channel-agnostic
(6-13), so a channel is a caller and never a subsystem. 9a wires the two that exist — raid rewards
and event effects. **Purchase and crafting are their own slice with their own interview**, because
each needs prices and a call on what it competes with for gold or materials, and those are decisions
rather than details.

**9-8. EQUIPPING IS FREE — EXCEPT WHILE THE BEARER IS AWAY.** No phase gate and no per-turn limit
(5-7's rule), but a character whose squad is out raiding today or on a mission cannot be re-kitted:
they are not here. Availability is exactly the state 12-3 already stores in two notions and
`availabilityOf` already phrases.

**9-9. AN AWAY CHARACTER IS UNTOUCHABLE — this AMENDS 5-7.** Attach/detach is refused while the
squad is away too, because otherwise 9-8 is advisory: detach, re-kit, re-attach is three clicks.
5-7's "free in any phase" still holds; "away" is simply not a state you can act on. Rejected:
accepting the bypass (shipping a restriction that does not restrict) and letting a detached
character stay away under their own away state (a third notion of busy beside the squad's two).

**9-10. ON DEATH: HOLD THE FIELD AND UNIQUES COME HOME; ORDINARY KIT ROLLS 50%** (user: *"You have
50% chance of recovering it if it is lost and you win, uniques are always recovered if you win"*).
Lose the field and it all goes down with the bearer. The roll is per item and uses 9-6's `unique`
flag, so the two decisions carry each other.

**9-11. YOU LOOT THE ENEMY'S DEAD BY THE SAME RULE** (user: *"You also gain 50% of looting items
from dead enemies if you win, guaranteed for uniques"*). One recovery function serves both sides —
your fallen and theirs — because it is one rule.

**9-12. ENEMY BEARERS ARE REAL: full enemy characters carrying real gear**, fighting with its mods
and abilities and dropping it when you take the field. A relic you win is one that hurt you.
**This stays inside standing principle 1**: the enemy still decides nothing — a champion with a
blade is DATA, not behaviour. **BANNERS ARE NEVER LOOTED, in either direction** (user: *"we dont
loot banners (mainly for thematic reasons, it would be showing enemy colors etc)"*, and *"as our
squads survive even if destroyed they can keep their banner, so no need to loot our own banners
either"*). So banners sit outside the whole loot and recovery path: not stripped from the enemy, not
lost when your own charter is wiped (decision 14 already keeps the charter and its banner).
**Written down explicitly because it is exactly the kind of asymmetry a later reader would "fix".**

**9-13. ENEMY CHARACTERS ARE GENERATED PER ENCOUNTER**, not persisted. No enemy roster, no name to
remember, nothing that survives a fight. Rejected: persistent enemy captains (a named enemy who
returns is the beginning of an opponent) and bearers only in the boss host (two mechanisms for one
idea, and a raid that never yields a relic with a story).

**9-14. THE BEARER IS REVEALED BY RECON.** Low recon says only that a captain rides with them;
higher recon names the champion's type and what he carries. It reuses the graduated-reveal machinery
from scouting sub-pieces 1b/1c, gives scouting points a payoff the player can see, and satisfies "no
card shows flavour alone" at every rung — what the card shows is always true, only coarser.
Rejected: always fully visible (scouting gets nothing) and hidden until after the fight (you can
never choose a raid FOR its reward).

**9-15. 9a AUTHORS ONE PIECE PER SLOT PLUS ONE UNIQUE RELIC.** Five mundane stackable pieces
(head/torso/legs/hand/misc) with plain numbers, and one named unique granting an ability — so every
slot, both uniqueness paths and both effect kinds carry real content rather than only tests.
**The numbers are BALANCE-DEFERRED** per the standing pass: plausible values, not tuned ones.

**9-16. 9b IS A PAGE PER CHARACTER.** The character roll gains a way through to a sheet: base stats
with modifiers folded in, the five slots and what fills them, equip/unequip against the store,
attachment and hang-back. It is 13-8's roll-then-page shape, chosen there on scaling grounds that
apply identically here, and 17-3 already binds assignment to the target's screen rather than to the
store. Rejected: growing `CharacterPanel` in place (it was called deliberately plain because a real
screen would absorb it) and adding a compare view (a second view to keep true, in a slice already
spanning C++ anatomy, loot and enemy bearers).

**Assistant's calls, flagged as overturnable:**
- **A recovered item LEAVES the dead character's list; an unrecovered one STAYS on the record.** The
  store's invariant is that "in the store" means "on nothing", and an item cannot be in two places.
  This is also what finally gives 5-9's preservation rule teeth: the gear you did NOT recover is
  still on the body for a future recovery spell to find.
- **`lootable` is a ROW FLAG (default true, false on banners)** rather than a `kind === 'banner'`
  test inside the loot code — the row already declares its kind, target, permanence and uniqueness,
  so this is the house pattern rather than a new one.
- **A catalog sweep test fails an authored denial of an implied ability**, so an author learns at CI
  time that their row is inert (9-4). Same spirit as `items.test.js`'s ability-phrasing sweep.
- **Campaign-side mod names ride the same bag as engine ones** (9-2 / the user's "one bag, two
  vocabularies"): `characterMods()` returns everything, `characterEntryFor` sends it, and the
  engine's parser skips names it does not know — its documented never-throw discipline, already
  relied on. Campaign formulas (5-11's scrying item) read the names they care about server-side.
  No second modifier system, which is what 5-11 promised.
- **The bearer must be SEALED onto the raid opportunity when the board is drawn**, exactly as the
  augury slots and 12's mission offer are, or a reload rerolls what the card advertised. That is a
  new field on `raid.opportunities[]` and therefore **a schema bump — v39 → v40** (SHIPPED as
  exactly that, plus `enemy.bearer` once the open question below was answered)
  (`CAMPAIGN_SCHEMA_VERSION` in models/campaign.js is the authority). Nothing else here changes the
  document: `campaign.items` and `characters[].items` already have the shapes 9a needs.
- **Bearer generation scales with the opportunity's `strengthBand`**, the field raid prestige
  already scales on, so a harder card is where the better relic is.
- **The open question is ANSWERED (user, 2026-08-24): bearers on raids AND the boss host —
  *"any battle we dont need a special rule"*.** The spec had authored them on raid opportunities
  only and left the pitched battle and boss host deliberately undecided. There is no special rule:
  wherever the enemy fields a force, it may field a champion. The host's is sealed at CREATION
  rather than per battle, because the host is one host and the decisive battle is fought once — a
  per-battle roll would reroll on a reload. **The same answer also retired a stale premise: there
  is no nightly battle** (see the correction in the handoff block at the top of this file).

### 9a SHIPPED 2026-08-24 (schema v40)

Built in four commits: the engine's anatomy, the engine's ability suppression plus the gear stat
vocabulary, the campaign-side gear layer, and enemy bearers with the loot rule.
C++ 402 cases, campaign-server 1066, frontend 341, lint clean.

**What 9b must not re-derive, and the calls worth not re-litigating:**

- **`AUnit::anatomy()` is PURE VIRTUAL.** 5-6 said an undeclared body plan is an error rather than
  a humanoid by omission; a pure virtual makes that a COMPILE error instead of something a CI sweep
  has to notice, which is stricter than the interview imagined. It earned its keep immediately —
  three test dummies subclass `AUnit` directly and the build named all three. Plans are declared
  down the chain (`Human` → HUMANOID for eight subclasses, `Horse` → QUADRUPED for Warhorse,
  `MountedUnit` delegates to whichever part is actually there, `Scorpion` writes its own two-clawed
  one), so a new humanoid needs no anatomy edit at all. Counts are WEARING POSITIONS, not limbs: a
  horse has four legs and one `legs` slot, because barding is worn as a set.
- **The order in `AUnit::abilities()` is the whole safety argument for 9-4** — grant, then subtract
  the denial, then `abilityClosure()`. Do not "fix" it. A row denying an implied flag is legal to
  author and inert, so 6-3's invariant survives a fully general item system and a NEW implication
  row turns an old item inert rather than dangerous. Nothing anywhere enumerates which flags are
  implied; `IMPLIED_ABILITIES` in `services/items.js` is a courtesy that lets a catalog sweep tell
  an author their row does nothing, and it is a MIRROR of `Abilities.cpp`, never a sync.
- **Suppression is NOT scoped to squad membership, unlike a grant.** A banner stops covering a man
  who leaves the formation (6-6); gear is worn on the body, so a man who breaks and runs takes his
  cursed helm with him. The asymmetry is deliberate.
- **The real bug 9-6 predicted was there.** `bindItemToSquad`'s `filter(id => id !== itemId)`
  dropped EVERY copy — correct while banners were the only item and every item was unique, and
  destructive the moment kit stacks. It is remove-one now, and `eventEligible` is gated on the
  row's `unique` too, so a fate offering a second helm stays drawable.
- **A gear-granted ability on a LOOSE character is silently dropped by the engine**, because
  granted abilities are scoped to squad membership (6-6) and a loose character is in no squad.
  Nothing in 9a can hit it — every gear ability is on a character who must be posted to fight — but
  **9b's sheet is where it becomes visible**, and the fix belongs in the engine's scoping rather
  than in a special case campaign-side. Recorded rather than worked around.
- **The enemy champion's `squad_id` and `character_id` are load-bearing, not decoration.** The
  squad tag is what makes his relic reach the field at all (a tagged squad is honoured down to one
  member); the character tag is the only thing that can answer whether he FELL, which decides both
  whether you loot him (9-11 strips the dead, not the escaped) and whether he counts among the
  target force's survivors. He is an EXTRA body, so counting him understated the host's real losses
  until `hostSurvivors` took him back out — in ONE place, feeding both the casualty arithmetic and
  `applyRaidReward`'s pursuit of the routing remainder.
- **`red_characters` now crosses from the engine into the battle summary.** It was deliberately
  unsurfaced while "the enemy has no characters in this design" was true; bearers made it true no
  longer. It is undefined-preserving like its blue sibling, because handing out a relic on a
  pipeline failure is the wrong way to be wrong.
- **The recon ladder for a bearer is the scouting BAND, not a card's own `enemyReveal`.** One
  ladder for "what do the scouts know about them", so the card and the host view can never
  disagree. `null` at Blind means "you cannot tell"; above it, an absent bearer is an explicit
  `{present: false}` so the client can SAY "no captain" rather than shrug.
- **Assistant's calls that held up:** a recovered item leaves the dead character's list while an
  unrecovered one stays (which is what finally gives 5-9's preservation rule teeth); `lootable` is
  a row flag rather than a `kind === 'banner'` test; campaign-side mod names ride the same bag as
  engine ones and the engine skips what it does not know.
- **Still deferred, deliberately:** purchase and crafting (9-7 — each needs prices and a call on
  what it competes with, which are decisions rather than details), `reconTag` becoming an ability
  (9-5), and experience and wounds, which `characterMods` still leaves unpriced.

### 9b SHIPPED 2026-08-24 (no schema bump)

9-16's page per character, and with it decision 9 is finished. The sheet is a page of the squad
screen (`{page: 'character', characterId}`), reached from the company roll: the stats with their
modifiers folded in, one row per wearing POSITION with what fills it, equip and unequip against the
store, and the posting and hang-back orders. C++ 402 cases, campaign-server 1073, frontend 356,
lint clean.

**What a later slice must not re-derive:**

- **The handoff's "everything it needs is already on the wire" was nearly true, and the miss is the
  useful part.** `mods` crossed; the BASE stats never did, so the sheet could have said "+1 defence"
  and not "defence 5". `characterSheet(baseStats, mods)` does the fold SERVER-side and ships
  `[{stat, label, base, delta, value}]` — the charter page's rule ("every number on this page is the
  server's") applied to a page that is nothing but numbers. **Do not fold base and delta
  client-side**; the client holds no unit catalog and re-derives no campaign math.
- **The stat VOCABULARY is `ITEM_STAT_TEXT`, reused rather than rewritten.** 9-5 says the vocabulary
  is the character sheet, and the item cards were already phrasing exactly that list — so the sheet
  and a helm's card name the same number the same way by construction, and `reconTag`'s exclusion
  falls out rather than being remembered. A stat gains a sheet line and an item line together or
  neither. A stat the TYPE lacks still shows when something moved it (the engine exports
  `formationFighter`; `UnitType` does not store it), because an invisible modifier is worse than a
  base of zero.
- **`characters[].anatomy` became `characters[].slots`** — `[{slot, label, count}]`, phrased and
  ordered, only the slots that exist. The raw map was shipped by 9a for a consumer that did not yet
  exist; its consumer wanted slot WORDS, and letting the client map `misc` → "kit" would have been
  the client meeting the engine's vocabulary (17-5). One shape, not two.
- **The store row grew `slot`.** 6-14 filters the store on `kind`, which was enough while a banner
  slot was the only slot; every piece of gear is kind `gear`, so a head slot filtering on kind alone
  offers blades. The REQUEST carries the slot and the row answers it — the panel still knows nothing
  about what a helm IS.
- **The permanence confirm is keyed on the ROW's `permanent`, not on which slot asked.** Kit comes
  off again, so warning that it never can would be a lie; a banner is unaffected. The day a
  permanent piece of GEAR is authored, both the store's prompt and the sheet's missing "take it off"
  button already tell the truth about it with no edit.
- **The orders MOVED to the sheet; `CharacterPanel` is a roll and nothing else.** 13-1's rule
  applied one level in: every order wants the context the sheet exists to show, and a form on the
  list beside a form on the page is the "managed in three places" the squad screen exists to end.
  The roll still MARKS who is away (the server's phrase), and the fallen's sheets open too — what a
  body was still carrying is exactly what 5-9 preserves it for.
- **The page locks WHOLE, never in halves.** Away disables kit and orders together, which is 9-9's
  amendment to 5-7 made visible: were only the kit locked, detach / re-kit / re-attach would be
  three clicks. The dead get no orders at all and keep their kit on display.
- **Left standing, deliberately: the engine drops a gear-granted ability on a LOOSE character**
  (granted abilities are scoped to squad membership, 6-6). 9a predicted 9b's sheet would make it
  visible. 9b did not special-case it campaign-side — the sheet states what the ITEM grants, which
  is true of the item — and the fix still belongs in the engine's scoping.

### DECISION 12 — MISSIONS ✅ SHIPPED 2026-08-24 (schema v39)

The last thing decision 13 named as unbuilt, and the other half of prestige. **Seven decisions, all
the user's — do not re-derive them.** Build TDD. **Schema bump: v38 → v39** (`squads[].mission`).

**12-1. YOU PICK, FROM A DRAWN OFFER OF TWO** (user, 2026-08-24: *"lets make it more roguelite and
you get a pick from two (if you have two that fit requirements) otherwise just 1 and 1 locked out
choice"*). Not the whole roll and not the server's choice: the card offers TWO eligible charters,
and where only one qualifies it offers that one plus a LOCKED slot. The draft pattern already in
the codebase (`SQUAD_UPGRADE_DRAW`) offers fewer rows when fewer are eligible; this one deliberately
SHOWS the slot it cannot fill. Rejected: the player picking from every charter (the trade stops
being a draw and becomes an inventory), and the server picking by rule (the cost becomes arbitrary
and you cannot deliberately spend your worst charter).

**12-2. THE WORD IS MISSION** (user, 2026-08-24: *"we will call them missions, and say that it is on
a mission"*). A charter away is **on a mission**; the locked slot says the same. "Tied up", the
phrase decision 12 and 13-11 were written with, is retired — it was never player-facing vocabulary.

**12-3. MISSIONS AND RAIDS ARE TWO STATES, TWO WORDS — this AMENDS decision 12's own text.** 12 said
`raid.squadAssignment` already tracks "spent on a raid today" and a tie-up should "extend it rather
than inventing a parallel notion of busy". The user chose two notions (2026-08-24): raiding today
and being away for turns are different things and read differently, so missions get their own
storage and their own line. **The consequence, and it is 13-11's third state arriving:** the squad
screen now renders free / out raiding today / on a mission, and every availability check asks two
questions rather than one. Recorded as an amendment rather than applied silently, because the
original wording is still in this file above.

**12-4. FLAT: THEY GO, THEY RETURN, PRESTIGE PAID.** A fixed number of turns away, a fixed prestige
gain, no roll and no return card. The trade is already complete without one — you sold turns of a
charter's raiding for a rung on the ladder — and a failure roll would mean paying the cost and
getting nothing, which is how a card stops being worth taking. Rejected: a return card that rolls an
outcome (doubles the content per mission and makes the card's worth unknowable at the moment you
must decide) and a flavour-only return card (a card per mission that changes nothing).

**12-5. AWAY MEANS OFF THE BATTLEFIELD, OFF THE BOSS-FIGHT METER, AND OFF THE RAID BOARD — BUT THEY
STILL EAT.** They are not in camp, so they cannot be placed and the "whole army must take the field"
gate stops counting them; they are still your men on your errand, so the food bill is unchanged.
**The consequence the user accepted, flagged here because it is a lever and not only a cost:
sending charters away SLOWS THE METER**, so missions move the decisive battle later. That is the
first thing to look at if missions feel too strong.

**12-6. IF NO CHARTER CAN GO, THE FATE IS NEVER DRAWN.** A `requires` clause ("at least one charter
free") makes it ineligible, exactly as `horse_sickness` needs Cavalry and the garrison fates need
resolve — so the augur can show it neither as truth nor as decoy. Rejected: drawing it with every
slot locked (spends one of the day's fates on a card that can do nothing) and drawing it with only
the Refuse branch (reads as a bug the first time a demand arrives with no way to meet it).

**12-7. THEY LEAVE AT ONCE, AT THE OMENS.** Gone the moment you choose: missing from the raid board
that same turn, and from the decisive battle if it happens to fall on it. `TURN_PHASES` is
`prepare → omens → raids → recruit → deploy`, so an end-of-turn departure would hand the player one
free sortie out of every mission and the cost would not bite until the following day. It also makes
the turn count honest — "gone 3 turns" means three turns the player feels. Rejected: departing at
the end of the turn after one last sortie. *(Wording corrected 2026-08-24: this decision was
written as "tonight's battle", a leftover from a nightly-battle design retired long ago. See the
correction in the handoff block above.)*

**Assistant's calls, flagged as overturnable:**
- Storage is `squads[].mission` — `{untilDay, eventId}` or null — ON THE CHARTER rather than a
  campaign-level list, because 12-3 made it a per-squad state and every reader already holds the
  squad. Schema **v39**.
- **The offered PAIR is drawn when the pending choice is SEALED** and stored on the pending, so a
  reload cannot reroll which charters were offered. Same reasoning as the augury slots.
- `POST /:id/choices/:slot` grows an optional `squadId`, VALIDATED against that stored pair — the
  client may not name an arbitrary charter, matching the existing rule that the option set comes
  from `EVENT_POOL` and never from the request.
- A new `mission` effect type in the tagged union; `describeEffect` learns it, and so does
  `services/balanceSheet.js` (whose tripwire test fails if a new effect escapes the sheet).
- Returns resolve at `newDay`: a mission whose `untilDay` has arrived ends, prestige is paid, and
  the day report says so.
- One authored mission event to start. **The numbers (turns away, prestige) are BALANCE-DEFERRED**
  per the standing pass — plausible values, not tuned ones.

**12 SHIPPED 2026-08-24, all seven decisions, and with it the last thing decision 13 named as
unbuilt.** `services/missions.js` (which imports NOTHING — events.js owns the pool and needs the
predicates, so the event lookup is passed in and the dependency runs one way); the `mission` effect
type through `applyEffect`/`describeEffect`/`eventValence`/the balance sheet; `requires.freeSquads`;
`squads[].mission` and the sealed `pendingChoices[].missionOffer`; the picker on the choice card;
the third availability state on both squad screens; and the `ford_watch` fate. campaign-server
961, frontend 341, lint clean.

**A CORRECTION TO THE INTERVIEW, and the reason it is written here rather than quietly fixed.**
During the interview the assistant told the user that excluding a charter from the boss-fight meter
would SLOW the decisive battle, and 12-5 was agreed with that on the table. It is the wrong
direction. `meterFillAtShare` is `CEILING − FLOOR × (inCamp / total)`, so a HIGHER in-camp fraction
means a SLOWER meter. Taking a mission's bodies out of `total` leaves the raiders weighing against a
smaller army, which lowers that fraction:

- with nobody raiding, a mission is meter-NEUTRAL (the ratio is unchanged);
- with raiders out, a mission makes the meter run slightly FASTER, because the army that remains is
  proportionally more exposed.

Both directions are pinned by tests in `missions.test.js` ("the boss-fight meter stops counting a
charter that is away" / "an away charter does not make the meter treat the rest as raiders") so the
next reader meets the real behaviour rather than the claim. **The decision itself stands** — a
charter that is not in the valley should not be counted by a gauge measuring the army in the valley
— but the balancing note in 12-5 above should be read as "missions do not buy time", not as a lever
on when the boss fight lands.

**What the build settled that the spec did not:**
- **A DEFERRED mission cannot leave at once, and that is not a violation of 12-7.** A deferred fate
  (its slot targeted by an unresolved counter-raid) has not come to pass yet, so the charter cannot
  already be gone. The pick rides on `augury.slots[].chosenSquadId` and the mission begins when the
  FATE does, at end-day. A charter that went elsewhere in between sends nobody rather than being
  double-booked.
- **The offer is resolved by ONE function on the server** (`missionOfferView`, exported from
  `campaignView.js`), because the same offer appears on two screens — the tent's reveal card and the
  choices-only overlay — and two resolvers would drift the first time the wording changed.
- **`availabilityOf` in `selectors.js` is the one phrasing site** for free / raiding / on a mission,
  read by both the roll and the charter page. The store convention: one canonical computation site.
- **An away charter is DROPPED from the raid board, not greyed.** A slot it cannot fill for three
  turns is clutter; the squad screen is where the absence is explained.
- **FORAGING was never asked about and is deliberately UNCHANGED.** A charter away still counts in
  `forage.pool`'s field points, exactly as it still eats. The interview offered battlefield / food /
  meter / raids and nothing else, so extending the exclusion to foraging would have been the
  assistant deciding it. **Open question for whoever tunes this**: men three days' march away
  plausibly should not be foraging the valley either.

### SLICE 17 — THE STORAGE PAGE ✅ SHIPPED 2026-08-23 (no schema bump)

The interview the handoff asked for is DONE. **Seven decisions, all the user's — do not re-derive
them.** Build TDD against them. **No schema bump:** nothing about the document changes; the store
is `campaign.items`, which slice 6 already shipped.

**17-1. PAGE ONLY, AGAINST TODAY'S CATALOG.** `ITEM_CATALOG` holds exactly one row
(`banner_unbroken_line`), and decision 9's character armour is NOT part of this slice. The page's
job is DISCOVERABILITY: today a won banner is invisible unless the player happens to click the
banner slot on a Seasoned+ charter, so the item can sit unheld for a whole campaign without the
player ever learning they hold it. Rejected: bundling decision 9's character equipment to give the
page a second kind and its first reversible item (it needs the engine-side slot layout of 5-6,
which does not exist — two slices' work in one), and authoring more banners first (spends the
slice on balance decisions instead of the screen).

**17-2. THE PAGE IS THE STORE, STRICTLY — only what is on nothing.** It renders `campaign.items`
and nothing else; a bound banner does not appear on it. This is 17's own wording ("the home of
every item that is not currently on something") taken literally. **The consequence, and it binds
the next slice:** an assigned item is not on this page, so when the first REVERSIBLE kind arrives,
"unassign" lives on the HOLDER's page — the character's screen, the charter's page — never here.
Accepted cost: with one permanent item, the store reads empty for the rest of the campaign the
moment the banner is bound. Rejected: showing everything owned with its holder named, and one flat
list with a status per row.

**17-3. THE PAGE IS READ-ONLY, AND THE WIDER RULE WITH IT: ASSIGNMENT HAPPENS AT THE TARGET'S
SCREEN** (user, 2026-08-23: *"the items get assigned from the character screen or banner from the
screen of that squad, if we create any camp items etc they get assigned from general screen etc"*).
The slot lives with the thing that wears it. This is 6-14 restated as a standing rule rather than a
banner-shaped one, and it means the stores NEVER grow a target picker: there is exactly one code
path per mutation, and a new item kind brings its own slot on its own owner's screen. Rejected: an
assign-from-the-page picker (two ways to bind one banner, two permanence prompts to keep in step —
6-14 rejected this once already), and handing off to the squad roll with eligible charters lit.

**17-4. ONE STORE SCREEN, TWO MODES — and the browse door is its own** (user, 2026-08-23:
*"you select the slot from outside. The store opens (and filters for allowed items for that type),
then you choose an item and the item gets moved to the slot. This is the flow with everything"*).
  - **SLOT MODE** — opened from a slot, exactly as today: filtered to what the slot accepts,
    clicking an item assigns it, the permanence prompt unchanged.
  - **BROWSE MODE** — opened from a `The Stores` door in the HUD beside `The Army`, from any
    phase: unfiltered, and clicking a row only opens its detail.
The browse door is the HUD's because 17-3 just made the store campaign-wide rather than
army-owned — camp items belong to the camp, gear to characters — so hanging its only door off the
army screen would file it under one of the things it is not. Rejected: a door on the squad roll,
and no browse door at all (the store stays reachable only from slots, and nothing ever tells a
player what they hold).

**17-5. THE SERVER PHRASES EVERYTHING.** The view grows `permanent` and a SERVER-WRITTEN effect
line per item; the client renders sentences it never composes. This is the `describeEffect`
precedent decision 15 already named, and the reason is the house one: the client holds no copy of
`ITEM_CATALOG` and has no business turning the enum word `fearless` into English. Rejected: letting
the flavour blurb carry the mechanics (every future item's truth then depends on an author
remembering to write it into prose) and shipping the raw `abilities` array for the client to list
(leaks engine vocabulary and reads like a debug view).

**17-6. AT A PENDING FATE, THE TWO MODES SPLIT.** Browse renders **ABOVE** the pending-choices
overlay and its HUD door stays visible — it is read-only, so there is nothing the server can
refuse, and the user's rule is that read-only screens stay open. Slot mode stays **BELOW**, exactly
as today, because `POST /squads/:id/banner` carries `rejectIfChoicePending` and a Give button
rendered over the choice cards could only answer 409. **This amends the single rule slice B
pinned** ("both render BELOW the pending-choices overlay"), and both halves get their own test —
the lesson from that same entry is that a claim about what the server does belongs in a test, not a
comment. Rejected: keeping both below (makes "read-only screens stay open" untrue for this one) and
putting both above (restores the exact 409-able button the old comment existed to record).

**17-7. THE DOOR IS ALWAYS THERE, UNCHANGING.** No count, no badge, no appearing the day the first
item is won: `The Stores` sits in the HUD from turn one and reads the same whether the store holds
nothing or five things. Empty, the PAGE says so plainly. Rejected: a held-count on the door (a
ninth number in a header that already carries eight) and hiding the door until something is won (a
feature a player can finish a campaign without discovering).

**Assistant's calls, flagged as overturnable:**
- `describeItem(row)` in `services/items.js` returns the phrased `{effect, where, binding}` lines,
  and BOTH modes render them — one function, so the two modes cannot drift apart in wording.
- **One component, two modes** (`ItemStorePanel` branching on whether its request carries a slot)
  rather than a second component beside it, for the same reason.
- Browse detail is the clicked row EXPANDING INLINE, not a sub-page: there is no router, and 13-8
  already settled that a page swap is `useUiStore` state.
- `storeRequest` carries browse as its own shape (`{browse: true}`) — one field, one takeover,
  `App.jsx` branching on it, which is what 17-6's split needs to read.

### The balance sheet (2026-08-13) ✅ SHIPPED

The tool the deferred balancing pass wants: **`docs/BALANCE_SHEET.md`**, regenerated by
`make balance-sheet`. Every fate and every raid reward in one table, so the numbers can be
compared to each other instead of read one card at a time out of `events.js`.

`services/balanceSheet.js` is pure — no DB, no engine binary, derived from `EVENT_POOL` /
`GARRISON_SORTIE_EVENTS` / `campaignConfig` at call time, so it cannot drift from what it
describes and it runs in any environment. The snapshot is committed so the numbers **diff in
review**: a retune shows up as a changed table, which is the point of keeping a generated file
in the tree. `tests/balanceSheet.test.js` (17 pure tests) is the tripwire — a new event or a new
effect type that escapes the sheet fails the suite rather than silently pricing as nothing.

**Deliberately not a score.** It has no single currency and ranks nothing: whether +40 Soldiers
beats 4 t of food is the judgement the sheet exists to inform. Three things it does that a
naive dump would get wrong:
- **One row per OUTCOME, not per event** — a choice event is priced per branch, a
  recon-sensitive one per rung, because the branch is what the player actually buys.
- **Bands, not predictions.** A multi-outcome fate contributes a worst/best pair, and an
  outcome that never mentions a resource contributes **0** to it — otherwise "+2 t or nothing"
  would price as if the food branch were certain and every band would read too rich.
- **The enemy column is read from the player's side.** A host that shrinks 1.4% is the BEST
  case, so that row's columns are swapped against the numeric min/max. Pinned by a test,
  because it looks like a bug to anyone reading the render alone.

**What the first read shows (observations, not decisions — the pass itself is still deferred):**
- **Severity does not weight the draw at all.** `randomSlot` picks uniformly from the eligible
  pool; severity only sets `POOL_LEGIBILITY`. So `defection` (+40 Soldiers, sev 3) is exactly as
  frequent as `traders` (+1.5 t, sev 1). If majors should be rarer, that is a mechanism that
  does not exist, not a number to retune.
- **Gold's expected value from ungated fates is exactly 0.00/turn.** The only event tap,
  `garrison_paychest`, is gated at resolve ≥67 — so before a determined garrison, gold is a
  raid-board resource and nothing else. Worth weighing against what the caster lane costs
  (Mage 100, Priest 80) — a raid means ~36–54 gold.
- **The fates are a net troop faucet**: Soldier headcount runs +6.9 (worst) to +13.3 (best) per
  turn, before raids and recruiting. Food is the opposite — a −2.19 t … +1.67 t band against a
  12.4 t/turn burn, i.e. noise beside foraging.
- **`loot_supplies`' food and materials are flat rolls** that do not scale with the target,
  while its gold does. A big detachment is worth scouting for coin, never for stores.

Green: campaign-server 633/633 (25 files, DB-backed suites included).

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
   S4 stage write-up below for the derivation. **The host's opening size** (721) was the other half
   of that complaint and is now **deferred to the general balancing pass (2026-08-13, user's
   call)** — see the live front above; it is not an open question.
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

**TODO — more spells, spell paths, and research to unlock them (user, 2026-08-25 — idea only,
no plan yet).** [[todo-spell-paths-research]]
**✅ SUPERSEDED 2026-08-25 — THE INTERVIEW HAS HAPPENED.** See "THE MAGIC SYSTEM" above: nineteen
decisions, all the user's. Every question this entry lists as open is answered there. What follows is
kept as the record of the ask and of what was true before the interview.
The ask, in the user's words: *"more spells, spell paths, some kind of research to unlock more
spells"*. Recorded rather than designed, on the user's call — the interview has NOT happened, and
nothing below is a decision.

**Where it lands, so the next session need not re-derive it.** This ask has a seam waiting for it,
and one unbuilt prerequisite chain:

- **Three spells exist, total**: `fireball` (Mage), `bless` (Priest), `raise_dead` (Necromancer),
  in `Spells::roster()` in `backend/engine/src/SpellList.cpp`. Each is gated by EXACT unit-type
  name, and selection is "first castable in roster order" — `SpellList.cpp` calls that deliberately
  dumb and says so.
- **Paths are already a reserved stage**: `docs/UNITS_AS_DATA_PLAN.md` **Stage R4 — Spell paths**,
  which also reserves the "which spell when several qualify" question for that stage. `Spell.hpp`'s
  `SpellRequirement` carries a comment saying the exact-name gate is a stopgap until paths exist and
  that paths will EXTEND the struct rather than replace it — genuinely unique spells keep their
  exact-name requirement by design. So the engine half has a shape waiting; it does not have a
  design.
- **R4's own prerequisites are unshipped.** R0 landed 2026-07-06; R1 (ranged joins the weapon
  pipeline), R2 (capability tags) and R3 (units as pure data) have NOT — `Archer::special()` and
  `AUnit::special()` are both still there. R4 was sequenced after them and gated on "later, with the
  character system". The character system HAS since shipped (5a/9a/9b), so that half of the gate is
  open and the R1–R3 half is not. **Whether paths must wait for R1–R3 is itself an open question**,
  not a settled no.
- **The campaign layer knows nothing about spells or mana** — no spell, path or mana field anywhere
  in `campaignConfig.js` or the campaign document. Research would therefore be a NEW campaign
  system, not an extension of one, and the engine→campaign export plumbing for it does not exist.

**What the interview will have to settle** (questions, deliberately not answered here): whether a
spell is known by the CHARACTER or by the army; whether research unlocks a spell for everyone or
teaches one person; what research spends and what it competes with for that resource (the same
"what does it compete with" call 9-7's purchase and crafting channels are waiting on); whether a
path is a caster's identity chosen once or a track advanced over a campaign; how a path interacts
with the Mage/Priest type split that `CHARACTER_TYPES` already draws; and what picks the spell when
several qualify, which is R4's own reserved question. Note also standing principle 1 — whatever
research is, the enemy does not react to it.

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
- ~~**Prestige is a per-squad currency.** A squad earns prestige and spends it to buy **squad
  upgrades**, each upgrade applying a bonus to *all* the troops in that squad. Upgrade levels
  get **more expensive** each level.~~ **SUPERSEDED 2026-08-10 — prestige is a PERMANENT RANK that
  GATES upgrades and is never spent; upgrades are paid for in resources.** See "NEXT UP — THE SQUAD
  OVERHAUL" at the top of this file, which is the live design. Do not implement the struck text.
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
1. *Split `Battlefield.cpp` by tick phase* — **✅ SHIPPED 2026-08-25.** 1475 lines became
   three translation units along `tick()`'s own phase order: `BattlefieldMovement.cpp`
   (the terrain-cost/passability statics, the reserve-gradient reinforcement scan, squad
   entry and direction choice, plus `moveUnits`/`moveTeam`/`moveSquad`/`moveUnitStep`/
   `moveToward`/`flee`/`retreatToRange`), `BattlefieldEngagements.cpp`
   (`resolveEngagements` and its whole seating machinery — `markEngagedSides`,
   `buildHexSideMap`, `allocateSidesToGroups`, the ranked squad/loner fill passes) and
   `Battlefield.cpp`, which keeps the lifecycle and the state both phases read
   (ctor/reset, `loadArmies`/`extractResult`, `tick` and its turn hooks, the special
   phase, `makeBattle`/`cleanup`, `findTarget`, corpses, the per-side magic state).
   **A pure move: not one line of code changed** — verified line-by-line against the
   pre-split file, and the only new text is each file's header comment. The one helper
   the two phases share, `sideIsEngagedNow`, went to the engagement file because it is
   the predicate `markEngagedSides` sets `HexSide::engaged` from; movement calls it live
   (the flag is a tick stale by the time movement runs) and its comment says so. No
   header change, no Makefile change (source discovery is recursive). Green: `make`
   (-Werror), `test-fast` 442 cases, `test-serial` 442 cases sanitized. **Done for the
   stated reason** — DESIGN.md's frontage/formation system now lands in a file that is
   only the engagement phase.
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

**The general balancing pass (deferred 2026-08-13, user's call).** One pass, in one order, not a
series of one-off retunes: **events, raids and the rest of the economy first**, and **the enemy
host's size (`ENEMY_ARMY`, opening 721) last** — the player's end-of-campaign army is an output of
everything else, so the host has nothing to be balanced against until those are settled. Until this
pass runs, an imbalanced-looking constant is a deferred decision rather than a bug: leave it, and
don't offer a replacement number.

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

**Deferred test-infra cleanup — ✅ DONE 2026-08-25.** The stationary-enemy dummy is now one shared header, `backend/engine/tests/TestDummies.hpp`: `ImmobileDummy` (movementSpeed 0, morale 99) plus `HighArmorDummy`, which now DERIVES from it instead of restating the same three lines. `test_movement.cpp`, `test_battle_length.cpp` and `test_main.cpp` all include it and their local copies are gone. Header-only on purpose — the Makefile compiles every `*.cpp` under `tests/`, so a `.cpp` here would be a translation unit with nothing in it. The convention stands and is written into the header: a test that needs the enemy to sit tight uses this dummy rather than holding a real unit, so a later tuning pass on `Soldier` cannot quietly start moving the "stationary" enemy.

**Deferred — frontend rendering/integration test coverage (user, 2026-07-07). ✅ THE RENDERING HALF IS DONE 2026-08-25; the integration half is still open.** `frontend/src/__tests__/gridRendering.test.jsx` (33 cases) covers what the behaviour suites never looked at — what the grid actually LOOKS like: terrain colours off the `/api/info` catalog (named, absent-entry default, unknown-terrain fallback, impassable beating terrain), the three zone tints, layout geometry (one hex per cell, svg size, the row→x / col→y transpose, the odd-row brick offset, six vertices at the hex radius, the zone labels), rampart geometry (`wallSegment`'s midpoint / perpendicularity / edge length, and an unknown `dir` drawing nothing rather than NaN), in-hex stacking, and `ReplayView`'s terrain layer.

  **Two things came out of writing it.** (1) The last block pins ReplayView.jsx's *"Same geometry as HexGrid.jsx (kept in sync — extract if a third user appears)"* comment: both renderers are now asserted to place every hex at the same points in the same order, and to resolve an axial map entry to the same cell. Two copies kept in sync by a comment is exactly the pair that drifts, and a drift would mean the replay of a battle no longer lines up with the map it was fought on. (2) **A real layout bug, fixed in the same commit**: the three things drawn inside a hex — loose types, squads, characters — each centred on its OWN count, so a hex holding loose units and a squad drew them 4.5px apart instead of 9, and one loose type under two squads put two glyphs on the identical y. Only the character block (added last) used the full total. `HexGrid` now hoists one `hexRows`/`rowY(k)` counter that all three groups and the hold badge share.

  **The integration half — ✅ DONE 2026-08-25 (the battle → recorded replay → `ReplayView` round-trip).**
  Both ends of the pipeline, pinned against ONE real battle rather than against
  hand-written ticks: `frontend/src/__tests__/fixtures/recordedReplay.json` is a genuine
  31-tick fight (17 units, a squad a side, cavalry, a Mage who really casts, a unit that
  really routs) recorded by the binary and stored in exactly the shape
  `GET /api/battles/:id/ticks` serves.
  - `frontend/src/__tests__/replayRoundTrip.test.jsx` (6 cases) renders it: every tick of the
    recording draws one glyph per recorded unit; each glyph sits at centre + the engine's own
    `ox/oy` (which is what pins the axis transpose — get it backwards and a real battle renders
    sideways, a bug two units on one row cannot show); the two recorded squads take two distinct
    palette colours while loners keep team colours and a broken unit beats both; the seated ranks
    dim behind the front; the log filters by depth and casts are Basic at every depth (L-2); and
    a unit that leaves the roster between ticks always has a line saying so.
  - `campaign-server/tests/replayRoundTrip.test.js` (5 cases) runs the fixture's own input through
    the REAL binary, persists it through the real `battleRunner`, reads it back through the real
    route, and asserts every unit field and log line survives **field-for-field**. That is the
    guard the pipeline never had: `Tick.units` is a strict schema, so a field the engine emits and
    the schema does not declare is dropped on write with no error anywhere — the browser just
    stops drawing something (it has happened; `ox/oy/sz` carry a schema comment saying so). Its
    fifth case is a fixture tripwire: a unit key the live engine emits that the fixture has never
    seen fails with the regeneration instruction, so the browser test can't quietly render a
    shape the recorder has moved on from. One direction only — a field the fixture has and this
    run didn't produce is just a draw that went differently. Lives campaign-side for the standing
    reason: only that layer sees both the binary and the wire.
  - The run is seeded (`GAME_RNG_SEED`, the seed stored in the fixture) so a CI failure is the
    same fight twice; every assertion is still about SHAPE, never an outcome, because the same
    seed reproduces only on the same toolchain (`resolveSeed()` in `Utility.cpp`).

  **Still open:** the other integration candidate — a full campaign loop driven through the
  campaign-server routes end to end.

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
