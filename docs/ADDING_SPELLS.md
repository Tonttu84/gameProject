# Adding a new spell — one form row, and what reads it

Written out of the magic system's battlefield-enchantment slices (docs/CAMPAIGN_PLAN.md,
E-1..E-8) and rewritten at the end of the SPELL TARGETING AND DELIVERY front (T-1..T-7,
slices TG-1/TG-2/TG-3), which is when the row finally had all of its fields. This is the
"spells equivalent" C-8 owed after `ADDING_ITEMS.md`, and it follows the same house rule:
**one hand-authored row, everything downstream derived.**

The difference from items is *where* the row lives. An item is campaign data in JavaScript;
a spell is **engine** data in C++, because a spell is a thing that happens in a battle. The
campaign layer never authors a spell — it imports the roster at boot and renders it.

## TL;DR

1. Write the effect body and (usually) a constant or two in
   `backend/engine/include/Defines.hpp`, marked balance-deferred.
2. Write a **description builder** that composes the sentence *from those constants*.
3. Write the **`worth` estimator** beside the others and map the id in `worthFor()`.
4. Add the row to `Spells::roster()` in `backend/engine/src/SpellList.cpp`.
5. `make test-fast`. The roster sweeps across `test_spells.cpp`, `test_targeting.cpp`,
   `test_scoring.cpp`, `test_delivery.cpp` and `test_resist.cpp` review the row for you.

**No schema bump, no campaign-server change, no frontend change.** `./game dump-spells`
exports the roster, the server caches it at boot (`utils/spellCatalog.js`) and projects it
through `services/magic.js`; The Study and the character sheet render whatever comes back.

## The shape: a spell is a set of FORMS

```cpp
struct Spell {
    std::string_view       id;     // "fireball" — stable, and what a script names
    std::vector<SpellForm> forms;  // WEAKEST FIRST
};
```

One row in the exported catalog is one **form**, not one spell: "Ember" and "Fireball" are
two rows the player reads, under one id a script points at. M-12's reason for forms rather
than a ladder of near-duplicate spells is "less outdated clutter" — a low-path caster keeps
a useful version of the same idea instead of a strictly worse spell of its own.

A real row, copied verbatim from `roster()`:

```cpp
{ "minor", "Ember", ember(),
  {{P::Fire, 1}}, S::Evocation, 1,  8, 1, castEmber,    nullptr,
  EnchantAim::None, 0, nullptr,
  TargetKind::EnemyUnit, TargetPick::Densest, false, 0, SPELLRANGE,
  AreaMode::None, 0,
  ResistKind::None, 0, 0 },
//  ↑form    ↑label ↑description
//                  ↑paths        ↑school ↑lvl ↑fatigue ↑castingTime ↑cast ↑price
//   ↑the battlefield trio at its default (see below) — the table is initialised
//    POSITIONALLY, so an ordinary row has to name what it skips over
//                                    ↑target kind  ↑pick   ↑buff (A-8/T-5)
//                                                          ↑accuracy ↑range (T-1/T-2)
//    ↑area mode ↑area in hex points (T-6)
//    ↑resist kind ↑resistMod ↑duration (T-4/T-5)
```

The fields, **in struct order** — which is the order a row is written in, and the order a
cast happens in: whom it may reach, how well it arrives, how much ground it covers, whether
the body may throw it off, and how long what is left of it stands.

| Field         | Decision | What it is                                                       |
| ------------- | -------- | ---------------------------------------------------------------- |
| `name`        | M-12     | `"minor"` \| `"major"` \| `"battlefield"` — the form's kind        |
| `label`       | S3-1     | what the player sees; the row's name on screen                     |
| `description` | S3-4     | one paragraph, **built from the constants** (see below)            |
| `paths`       | M-20     | ORDERED requirement list, **primary first**                        |
| `school`      | M-14     | `SpellSchool::None` for Holy/Unholy, a real school otherwise        |
| `schoolLevel` | M-6      | what the ARMY must have researched                                 |
| `fatigue`     | M-10     | authored base cost, before the divide and Low's halving             |
| `castingTime` | M-23     | ticks occupied, **minimum 1** — nothing casts instantly              |
| `cast`        | A-1/T-1  | `bool(AUnit&, const SpellForm&, const Target&)` — **applies only**; false = nothing happened. The form is passed so a body can read its own row |
| `price`       | M-24     | Low's second effect aimed at your own side; `nullptr` for every other path |
| `enchantAim`  | E-5      | `None` for an ordinary spell; `Friendly`/`Everyone` make it battlefield-wide |
| `poolCost`    | E-2      | channels drawn IN FULL from the army's banner pool                  |
| `tickEffect`  | E-4      | `void(Battlefield&, int team)` — a sustained spell's per-tick body    |
| `target`      | A-1      | `TargetKind` — the SET of legal candidates; see the next section     |
| `pick`        | A-1      | `TargetPick` — which candidate the body is handed                    |
| `buff`        | A-8/T-5  | `true` for a STANDING EFFECT the target keeps, boon **or bane**; the resolver then refuses to relay it while it stands |
| `accuracy`    | T-1      | a SIGNED modifier on the caster's own accuracy stat, clamped to 0-100. `SPELL_PRECISE` (100) means the form just lands — no roll, no scatter, no elevation or forest adjustment |
| `range`       | T-2      | how far the form reaches in hexes, elevation-adjusted — **boons included**. Defaults to `SPELLRANGE` |
| `areaMode`    | T-6      | `AreaMode::None` \| `Explosion` \| `Random` — how the blast spreads from where it landed. DESCRIPTIVE: the body reads it off the row to fill the shot |
| `area`        | T-6      | how much ground it covers, in hex SIZE POINTS (640 = one whole hex). `0` with `None`, non-zero with either other mode — the pair is a biconditional the sweep pins |
| `resist`      | T-4      | `ResistKind::None` (cannot be resisted, and rolls nothing) or `Negates` (contested per target body; the winner takes nothing) |
| `resistMod`   | T-4      | signed, added to the TARGET's side of the contest — Dominions' "easily"/"hard" as data. `0` on every row today |
| `duration`    | T-5      | ticks the form's standing effect stands; `0` = the whole battle. Read by the BODY and passed to `applyEffect` |
| `spell`       | A-1      | back-pointer to the spell above — **wired automatically**, never authored |
| `worth`       | A-3      | `int(const AUnit&, const SpellForm&, const Target&)` — **wired by id** in `worthFor()`, never authored in the row; see "Scoring" |
| `aiDivider`   | A-4      | `0` = derive from fatigue, casting time and pool cost; any positive number overrides it for playtesting/modding |

The last three are **wired, never authored**: `spell` and `worth` are filled in at the end
of `roster()` by a one-time pass, so a row that named them would only ever go out of sync
with the table it sits in. `aiDivider` is authored but almost never — it is the modder's
knob, and `0` is the answer for every row today.

### Targeting is DECLARED, not coded (A-1, slice AI-1)

A body does **not** look for its own target. `Spells::chooseTarget()` resolves the form's
declared kind and pick once per cast attempt and hands the body a `Target`; the body applies an
effect to `target.unit` (or walks `target.units` for an `AllyTeam` form) and returns `false`
when it needs a unit and was given none.

| `TargetKind`  | Candidates                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| `EnemyUnit`   | living enemies within the FORM's `range`, elevation-adjusted (T-2)              |
| `AllyUnit`    | the caster **always** (a boon on yourself crosses no distance, so he needs no hex), then living **placed** allies within the form's `range` of a **placed** caster |
| `AllyTeam`    | the same set, all at once — `target.units`, the caster first then team order    |
| `Adjacent`    | none: the body scans the caster's own neighbouring hexes (raise_dead)          |
| `Battlefield` | none: the spell stands over the field (E-4/E-5)                                |
| `None`        | none at all                                                                    |

`TargetPick` — `Densest` (the offensive walk), `Wounded` (a hurt ally first, else the first
ally), `Fatigued` (the most tired, nobody at zero), `Broken` (a broken ally first), `First`.
**Every pick is a description of behaviour that already existed.** Adding a new preference is a
change to the cast AI, not to a spell row; AI-2's scorer is where that belongs.

The resolver is **side-effect-free and dice-free** on purpose: the scorer asks "whom would
this form hit" many times per decision, and a resolver that rolled would eat the mock queue a
combat test seeded. If you add a helper it must keep both properties — `test_targeting.cpp`
fails otherwise.

### Delivery: precise or scattered (T-1, assistant's call 1 — slice TG-1)

A damage body no longer sets `shot.accuracy` and no longer calls `RangedCombat::fire()` — that
is the ARCHER's pipeline. It fills a `RangedShot` and hands it to `deliver()`, which reads the
row:

- **`accuracy == SPELL_PRECISE`** → `RangedCombat::strike()`. The man the resolver picked is
  the man who is hit. Armour, cover and shield block rolls and the elevation *damage* bonus all
  still apply — precise is about arriving, not about mattering more.
- **anything else** → `RangedCombat::scatter()` at `spellAccuracy(caster, form)`, elevation
  folded in there as it is for an arrow. **The scatter IS the miss**: land on the aimed man's hex
  and he is struck, drift off it and one body in the landed hex is (by size weight, friend
  included — T-7), and nobody at all if it is empty. The archer's second "roll ≤ accuracy to hit
  the aimed man" is deliberately not applied to spells.

A form whose body applies its effect directly — every boon, every debuff, both battlefield
enchantments — is written `SPELL_PRECISE`, because that is what it always was: it never rolled
to hit anything. Only fireball's two forms are thrown.

### Area: the arc (T-6, T-7 — slice TG-2)

An area is **hex size points**, and a hex given points covers them as **one contiguous arc** of
its 640 slots: a start slot is rolled, `points` consecutive slots are covered from it — wrapping
past 640 back to 1 — and every body whose slot range overlaps is struck **once** for the shot's
`areaDamage`. 640 points or more take the hex whole and roll nothing. The layout is
`pickHexTarget`'s: the phase's slot cache, in cache order, each body `getSize()` slots wide from
slot 1, empty ground after them. That is why a blast on a sparse line mostly hits dirt.

The user's own example: 50 points thrown from start 630 cover 630-640 and 1-40, so of twenty men
standing in slots 1-200 exactly the four in 1-40 are struck. Rejected on the way: a per-spot
lottery, which given enough rolls hits every man in the hex — *"this makes it too easy to hit all
humans"*.

The two modes spend the points differently:

- **`Explosion`** fills the landed hex first (640 covers it), then opens the next RING outward,
  640 a hex, and so on until the points run out; the last hex reached takes the remainder as an
  arc. Ring order is turned by ONE `getRandom(0, 5)` roll per cast so no compass direction is
  favoured, and off-map hexes are skipped **without spending their share** — a blast at the map's
  edge loses nothing to the void.
- **`Random`** splits the total into `AREA_CHUNK`-sized chunks and drops each on a hex drawn
  uniformly from the smallest ring set that could hold the whole area. Every hex that received
  points then covers them as one arc, so chunks that landed together are one stretch of ground.

**Friendly fire is real (T-7).** There is no team filter anywhere in coverage: the blast strikes
what it covers, both sides, the caster included. Nothing forbids throwing one into your own
line — the SCORER nets it instead (see "Scoring"). The rolls an area makes are COMBAT rolls at
delivery time (`Utility::getRandom`, pinned with `pushDiceRoll`), exactly like
`pickHexTarget`'s. `shot.onDamage` fires once **per body** the arc struck, so an effect hung on
a hit — a life drain, say — would trigger N times on an area form.

### Resistance: the contest (T-4 — slice TG-3)

**A form left untagged cannot be resisted, and rolls nothing for it.** That is the default and
most of the roster, and the "rolls nothing" half matters: a draw here would eat a mock roll a
combat test seeded for the shot itself.

Tag a row `ResistKind::Negates` and every body it would touch gets one opposed throw, at
delivery time, through the combat dice:

```
caster = RESIST_BASE + (the caster's level in the form's PRIMARY path
                        MINUS what the form requires, never below 0)
                     + caster.getPenetration() + throwDice()
target = target.getResistance() + form.resistMod + throwDice()
```

The spell lands **only if the caster's total is strictly the higher** — a tie goes to the body,
which is what makes `RESIST_BASE` a real threshold rather than a coin flip with extra steps.
A resisted body takes nothing from the cast and one Detail-tier line says so.

Two rules follow, and both are easy to get backwards:

- **The CAST still happened.** The body returns `true`, the caster pays the fatigue, and Low's
  `price` still fires. M-23's "no spell, no fatigue" is about a spell that never fired; this one
  fired and was thrown off, and M-24's bargain was struck when the caster reached for it.
- **The contest is per TARGET BODY, not per cast.** An area covering five men is five contests.

Where the check goes depends on what kind of body you wrote:

- **A direct-effect body** calls `Spells::resisted(caster, form, *unit)` at the TOP, before it
  changes anything, and returns `true` if it comes back true. `castBriarSnare` and
  `castHexOfFrailty` are the two examples.
- **A shot body** hands the question to the shot instead, because delivery is what knows which
  bodies were struck: `shot.resisted = [&caster, &form](AUnit* v){ return v && Spells::resisted(caster, form, *v); };`.
  `applyHit()` asks it FIRST, before the block rolls, so a body that shrugs the spell off takes
  no damage and triggers neither `onHit` nor `onDamage`. `castDrainLife` is the example.

The two stats are ordinary stats. `resistance` is set per type in the unit constructors from
the table in `Defines.hpp` (`RESIST_HUMAN` 10 — also `AUnit`'s default, so a type that says
nothing about magic is a man — `RESIST_CASTER` 12, `RESIST_UNDEAD` 14, `RESIST_GOLEM` 18,
`RESIST_BEAST` 8); `penetration` is 0 on every type today. **Both are `applyStatMod` names**
(`"resistance"`, `"penetration"`), which is the whole point: an item may carry either the day
one is authored, through the same door a helm comes through.

The SCORER's half is `Spells::landChancePct(caster, form, target)` — pure, no dice, 100 for an
untagged form so a caller can multiply unconditionally. It drops the dice (they cancel in
expectation) and reads an even chance at parity, `RESIST_PCT_PER_POINT` per point of advantage
from there, clamped to `RESIST_CHANCE_MIN_PCT`..`RESIST_CHANCE_MAX_PCT` — never a certainty in
either direction, because two exploding dice can always surprise you.
`scoreOf()` multiplies the worth by it ÷ 100 for a form with a unit target, before A-4's
divider, so the ratio forms compete on is a ratio of *expected* value. **An area form resisting
per body is not modelled** — no area form is tagged today, and the day one is, `worthArea()` is
where the per-body chance belongs.

### Duration, and the standing-effect registry (T-5 — slice TG-3)

**Anything a spell leaves standing on a body goes through `AUnit::applyEffect`, never through
`applyStatMod` directly.**

```cpp
unit->applyEffect("stoneskin", "armour", 1 + caster.getPathLevel(SpellPath::Earth) / 3,
                  form.duration);
```

One call does three jobs: it moves the stat (through `applyStatMod`, so the gear vocabulary and
its floors and its ±`MAX_STAT_MOD` clamp are the same ones), it records the change **that
actually landed**, and it starts the clock. The recorded number is read before and after,
because a −3 asked of a body standing at 1 point of defence moves it by −1 and no more — and a
revert that trusted the asked-for number would hand the body back three, permanently.

- **`duration` 0 is the whole battle.** Anything else is counted down one per tick in
  `Battlefield::onTurnStart()`, AFTER the passive `recover()` and BEFORE `applyEnchantments()`
  — an expiring stoneskin should be gone before this turn's standing spells press.
- **The registry is what `buff` reads.** `hasBuff(id)` is "is this body carrying that spell
  right now", so A-8's refresh rule is "not WHILE ACTIVE" by construction: the target stops
  being a candidate when the effect lands and is one again the tick it expires. T-5 widened
  that to **banes** — `hex_of_frailty` is a `buff` form aimed at an enemy, because a debuff
  recast every tick is the same bug A-8 closed for buffs wearing the other hat.
- **Battle end undoes everything.** `restoreForNextBattle()` calls `revertEffects()` and empties
  the temporary shield stack. This is the bug T-5 closed: before it, the mark was cleared and
  the *stat* was not, so a Stoneskin cast in one raid followed its bearer for the life of the
  process.
- **An effect that changed no number still records itself**, with an empty `stat` and an
  `applied` of 0. That is what a Ward is: its barrier is a consumable shield layer, so there is
  nothing for a revert to put back, and what the registry holds is *presence* for the refresh
  rule.

`applyEffect` returns `false` — recording nothing — for a stat `applyStatMod` does not know, so
an effect that could not be applied is never one the registry claims is standing.

Only one row carries a real duration today (`hex_of_frailty`, `HEX_FRAILTY_DURATION` = 8), and
that is deliberate: the expiry machinery should be walked by a spell and not only by a test.

### Two gates, and they are not the same gate

**The army knows; the caster qualifies** (M-6). `schoolLevel` is what research has bought for
the *side*; `paths` is what *this man* can do. A fresh hire is instantly as capable as a
veteran of the same paths — losing a caster costs you talent, never knowledge.

Holy and Unholy are **granted, not researched**, so they carry `SpellSchool::None` and pass no
school gate at all. A tripwire pins the biconditional: `school === null` **iff** the primary
path is Holy or Unholy. Give an arcane spell no school and it silently vanishes from The Study,
which filters on exactly that — so the test fails instead.

### Forms must strictly ascend

The sweep requires each form's primary level to be **greater than the one before it**, because
M-26's fall-through at cast time cycles DOWN the table: a form that fails for a reason
selection could not see (the major wanted corpses that were spent meanwhile) hands its channel
to the next weaker one. Two forms at the same level would make that order meaningless. Note
what this section no longer says: since AI-2 the form is **chosen by score**, not by table
position — a Death 3 necromancer conjures the one-tick skeleton when the field holds too few
bodies for the major, because a doomed major scores 0.

### Scoring: every form carries a `worth` (A-1..A-4, slice AI-2)

The caster does not walk a priority list any more. `Spells::optionsFor(caster, spell, floor)`
asks each qualifying form, for every candidate the resolver returns, what the cast is
**worth** — in `unitValue`, the one currency (A-3):

- a damage form is *expected damage × target value* (hit chance folded in, `AI_DAMAGE_SCALE`) —
  and since TG-1 the hit chance is the FORM's effective accuracy (`spellAccuracy`), so a precise
  row is priced at a certainty however poor a shot the caster is;
- an AREA form adds `worthArea()`: for every body other than the aimed man in every hex the area
  would reach, `areaDamage × chance × value / (100 × AI_DAMAGE_SCALE)` where `chance` is the
  arc-overlap probability `min(100, (P + size) × 100 / 640)`, POSITIVE for an enemy and
  **NEGATIVE for one of the caster's own** (T-7). A blast is therefore only worth throwing at a
  CROWD, and a caster at a lone man reaches for the cheap single-target form instead;
- a standing effect is *the value of what it lifts × `AI_BUFF_WORTH_PCT`* (a bane its own
  percentage, minus what Low's price costs your side);
- a conjuration is *bodies × their value*, and **0 when the body would fail** (too few corpses);
- a battlefield enchantment is the flat `AI_GLOBAL_WORTH` — script-only (E-3), so its worth
  only has to clear the script floor.

Then `score = worth × landChancePct ÷ 100 × AI_SCORE_SCALE ÷ spellDivider(form)`, where the
divider is derived from the row's own numbers (`castingTime × (AI_DIVIDER_BASE + (fatigue +
poolCost × AI_POOL_COST_WEIGHT) ÷ AI_FATIGUE_PER_DIVIDER)`) unless `aiDivider` overrides it. The
catalog exports `divider` per row so The Study can show it. What the caster does with the scores:

- **Script lines are an opening SEQUENCE** (A-6): each line once, in order; within a line the
  best-scoring form wins outright; a line scoring under `AI_SCRIPT_FLOOR` is skipped the same
  tick, never revisited. One exception (AI-3): an **enemy-targeted line with nobody in range is
  HELD**, not skipped — the armies start out of range, so the caster improvises from the pool
  until the enemy arrives and then fires the line first (`Spells::awaitsRange`).
- **After the script, a weighted LOTTERY** (A-2/A-7) over the caster's shortlist — or the whole
  castable roster minus globals when the shortlist is empty or all-poor — with tickets
  proportional to score, drawn through `Utility::lotteryRoll` (its own seam; never the combat
  mock queue). Nothing clears `AI_LOTTERY_FLOOR` → the caster idles this tick.

**Authoring a new spell means writing its estimator too**: add a `static int worthX(const
AUnit&, const SpellForm&, const Target&)` beside the others in `SpellList.cpp` and map the id
in `worthFor()`. Keep it a *pure* read of the target — no dice, no state — and mirror the body's
own gate (if the body will decline, return 0), or the scorer will keep choosing a cast that
never fires. Do **not** fold the land chance into it: `scoreOf()` applies that for every form,
so an estimator that did it too would price the spell at the square of its chances. The
`[scoring]` sweep fails any form left with a null `worth`, and a second case pins that scoring
consumes neither RNG queue.

## Descriptions are BUILT, never typed

```cpp
std::string ember()
{
    return "A single bolt of fire" + kRange + ": " + scalingDamage(EMBER_DAMAGE, "Fire")
         + ". No blast — this is what keeps a newly sworn Fire mage useful.";
}
```

This screen is the player's only written source on what a spell does. A description that said
"4 damage" as a literal would start lying the day `EMBER_DAMAGE` changed — and the balance pass
*will* change it. Compose from the same constants the effect body reads, and a retuned number
moves the sentence with it.

Reach for the shared builders above the roster before writing a sentence from scratch —
`scalingDamage(base, path)` phrases M-20's "and one more for every level of X", `kRange` says
"at range", `kResistible` says a will can throw it off, `standsFor(ticks)` says how long it
lasts. A row that is tagged or timed owes the player both sentences, and they are built from
the same `resist` tag and `duration` the catalog exports. A spell whose sentence genuinely
differs (fireball names the men caught in the blast) writes its own, and there is a comment
there saying why.

## Numbers go in `Defines.hpp`, marked balance-deferred

```cpp
constexpr int EMBER_DAMAGE = 4;  // fireball's minor form — one bolt, no blast
```

Every spell number in this project is **balance-deferred**: chosen sane relative to its
neighbours, not tuned. Keep them together in the spell block, keep the comment saying what the
number *is* rather than what it equals, and never inline a literal into an effect body — the
resistance table (`RESIST_*`), `RESIST_BASE`, `RESIST_PCT_PER_POINT` and `HEX_FRAILTY_DURATION`
all live there for the same reason `EMBER_DAMAGE` does.

## The battlefield-wide kind (E-2..E-6)

A sustained spell that stands over the whole field until its caster dies. Three fields,
defaulted, so an ordinary row is unaffected:

```cpp
{ "battlefield", "Leaden Air", leadenAir(),
  {{P::Death, 2}}, S::Enchantment, 2,
  LEADEN_AIR_FATIGUE, 2, castLeadenAir, nullptr,
  EnchantAim::Everyone, LEADEN_AIR_POOL_COST, tickLeadenAir,
  TargetKind::Battlefield, TargetPick::First, false,
  SPELL_PRECISE, SPELLRANGE,
  AreaMode::None, 0,
  ResistKind::None, 0, 0 },
```

- **`enchantAim`** — `Friendly` (the instance helps its own side; both sides may hold their own
  and each benefits) or `Everyone` (symmetric, so it applies **once** however many instances
  stand — otherwise calling it second would be strictly better).
- **`poolCost`** — channels drawn from the army-wide POOL **in full** on completion. A pool that
  cannot cover it means the form does not qualify, and the walk moves to the caster's next line.
  This replaces the ordinary per-cast fatigue discount rather than stacking with it.
- **`tickEffect`** — `void(Battlefield&, int team)`, applied once per tick in `onTurnStart()`
  *after* passive recovery and *after* the standing-effect countdown. For an `Everyone` aim the
  team argument is meaningless and the body reads both sides itself.

The `cast` body is one line — the machinery lives on `Battlefield`:

```cpp
static bool castLeadenAir(AUnit& caster, const SpellForm& /*form*/, const Target& /*target*/)
{ return Utility::getBattlefield().beginEnchantment(caster, "leaden_air"); }
```

Three rules come free with that call: once per side **per battle** (an instance ended by its
caster's death cannot be re-called), the instance dies with its sustainer at the end-of-tick
sweep, and a second same-side caster fizzles unpaid.

A battlefield form is aimed at no body, so it cannot be resisted: `ResistKind::Negates` on one
would tag a spell with nobody to contest it, and the `[resist]` sweep refuses any tagged form
whose target is not `EnemyUnit`.

> **⚠ A battlefield form must be its own SPELL, never an extra form on an existing one.**
> Script-only is enforced at spell granularity: `defaultScript()` drops any spell with *any*
> battlefield form. Bolt one onto `briar_snare` and you do not get a script-only major — you
> make the whole of Briar Snare unreachable to the default AI. This is why Soothing Winds is a
> separate Nature spell rather than briar_snare's major form.

## Who may reach for it

| Reachable by                | When                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| The default AI walk         | every ordinary spell, in **roster order** — that order *is* the default priority |
| A player's chosen spells    | any spell he qualifies for; his picks lead, the roster follows behind |
| An enemy caster             | only via a row in `ENEMY_SCRIPT_STORE` (`campaign-server/utils/campaignConfig.js`) whose every spell he can cast |
| Nothing at all              | a battlefield spell with no script naming it — that is the point (E-3) |

Adding a spell to the enemy's repertoire is a separate, campaign-side act: put it in a store
row. The priority walk hands each enemy caster the first row he fully qualifies for.

## What reads the row, downstream

```
SpellList.cpp roster()
   └── spellCatalogJson()            ← add any NEW field here too, or no screen can see it
        └── ./game dump-spells
             └── setSpellCatalog() at boot (campaign-server/index.js)
                  ├── spellsForSchool()  → The Study, grouped by school, gates pre-answered
                  └── castableSpellsForLevels() → the character sheet's chosen-spell picker
                                                   (and the battle lab, which has no campaign)
```

`spellCatalogJson()` is the one place a new field has to be repeated. **Both** projections in
`services/magic.js` then have to name it, or the field crosses the wire and stops at the
server — they are two separate object literals on purpose (The Study reads a form, the picker
reads the strongest form a caster qualifies for) and neither spreads the row. The campaign
layer phrases what it *owns* (the pool sentence, the duplicate-script warning) and passes the
engine's own `label`/`description` through untouched. Since AI-2 each row also carries its
`divider`, and the campaign side sends two AI inputs the other way on a placement entry:
`value` (a character's worth, base + items, `services/characters.js characterValue`) and
`shortlist` (the post-script lottery's fence, v46). Both are stamped from the record and
stripped from the request, like `paths` and `script`.

Unit stats cross by the same discipline through `unitCatalogJson()`. `resistance` and
`penetration` are exported there and the campaign's `UnitType` does **not** store them — the
same call `formationFighter` got, for the same reason: no campaign capability reads either, and
the character sheet shows a modifier to a stat the catalog does not carry rather than dropping
it. What they DO have campaign-side is a player-facing word in `ITEM_STAT_TEXT`, so an item
that moves one can describe itself.

## Tests to touch

Usually **none**. The suite is sweeps, and a new row walks into them:

- `test_spells.cpp` sweeps the roster and fails a row that is malformed (empty id or label,
  zero fatigue, instant cast, unordered paths, non-ascending forms), that leaves a path with no
  level-1 spell, that carries a price without being Low, or that gets the Holy/Unholy school
  gate wrong.
- `test_targeting.cpp` sweeps every form's target kind, refuses a standing effect whose body
  records the wrong id, and casts every unit-targeting body at nothing to prove it declines
  rather than dereferences.
- `test_scoring.cpp` sweeps every form for a `worth` and a positive divider, and pins the
  purity of scoring.
- `test_delivery.cpp` sweeps every form's `range` and `accuracy`, pins which rows are precise,
  and drives both delivery paths through the dice.
- `test_resist.cpp` sweeps `duration >= 0`, the `resistMod` band, and the claim that the tagged
  rows are exactly the three named ones — so tagging a fourth is a deliberate act. It also pins
  the contest's arithmetic on both sides of the boundary and the catalog's three new keys.
- `test_duration.cpp` pins expiry, the applied-versus-asked revert, "not while active", and the
  battle-end undo.
- `engine.integration.test.js` re-checks the same properties campaign-side against the **real
  binary**, so a spell retuned in C++ cannot drift from what the screens render.

Add a test when the row introduces a new **rule** — a new form kind, a new gate, a new cost —
not for a new instance of a shape that already exists. `test_enchantments.cpp` is what that
looks like: it went in with the battlefield kind, not with the second battlefield spell.

**One thing that is NOT free**: tagging a row `Negates` puts four dice draws in front of every
cast of it. Any existing test that drives that spell with a pushed dice queue now needs the
contest seeded first — the caster's die (face, then explode check), then the target's — or its
own rolls will be read as the contest's.

## Gotchas

- **A `worth` that says yes when the body says no is a stall.** The scorer picks by worth and
  the body fires later; if the estimator ignores a gate the body checks, the caster channels a
  cast that declines, every tick, forever. Read the same field the body reads.
- **A `cast` body handed an empty `Target` must return `false`.** Fatigue *powers* the spell
  (M-23), so a spell that never fired costs nothing — that is what makes the fall-through to
  weaker forms free rather than a way to burn a caster out. **A RESISTED body is the opposite
  case and must return `true`**: it fired, and it is paid for.
- **Never call `applyStatMod` from a spell body.** It mutates the stat outright and nothing
  puts it back; `applyEffect` is the door, and it is what makes the effect expire, revert and
  be seen by the refresh rule.
- **Every one of the ten paths needs a castable level-1 spell.** Paths are rolled at hire
  (M-5), so a path with no minor makes that roll a dud. The sweep treats this as correctness,
  not polish.
- **`paths` is ordered and `paths[0]` is load-bearing**: it decides the fatigue divide, the
  effect scaling, the resistance contest's mastery bonus and the character of the cast. Later
  entries only gate. Never sort this list, and never call it the "major path" — major is taken.
- **Low is cheaper in fatigue and dearer in blood.** A Low spell with no `price` is a pure
  discount, which is the one thing Low must not be; the sweep enforces both directions.
- **Roster order is the AI's priority order.** Inserting a spell high in the table changes what
  every existing caster reaches for first. Put a new spell next to its path's neighbours.
- **The engine never learns a campaign word.** No spell body may mention research, gold, a
  charter or a turn. It gets path levels, a school number and a channel pool, and that is all
  the campaign is allowed to tell it (M-17).
