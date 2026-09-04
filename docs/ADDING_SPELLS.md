# Adding a new spell — one form row, and what reads it

Written out of the magic system's battlefield-enchantment slices (docs/CAMPAIGN_PLAN.md,
E-1..E-8), which is when the path had been walked often enough to describe. This is the
"spells equivalent" C-8 owed after `ADDING_ITEMS.md`, and it follows the same house rule:
**one hand-authored row, everything downstream derived.**

The difference from items is *where* the row lives. An item is campaign data in JavaScript;
a spell is **engine** data in C++, because a spell is a thing that happens in a battle. The
campaign layer never authors a spell — it imports the roster at boot and renders it.

## TL;DR

1. Write the effect body and (usually) a constant or two in
   `backend/engine/include/Defines.hpp`, marked balance-deferred.
2. Write a **description builder** that composes the sentence *from those constants*.
3. Add the row to `Spells::roster()` in `backend/engine/src/SpellList.cpp`.
4. `make test-fast`. The roster sweeps in `backend/engine/tests/test_spells.cpp` review the
   row for you.

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

```cpp
{ "minor", "Ember", ember(),
  {{P::Fire, 1}}, S::Evocation, 1,  8, 1, castEmber, nullptr,
  EnchantAim::None, 0, nullptr,
  TargetKind::EnemyUnit, TargetPick::Densest },
//  ↑form    ↑label ↑description
//                  ↑paths        ↑school ↑lvl ↑fatigue ↑castingTime ↑cast ↑price
//   ↑the battlefield trio at its default (see below) — the table is initialised
//    POSITIONALLY, so an ordinary row has to name what it skips over
//                                    ↑target kind  ↑pick   (↑`true` here if it is a buff)
```

| Field         | What it is                                                                  |
| ------------- | --------------------------------------------------------------------------- |
| `name`        | `"minor"` \| `"major"` \| `"battlefield"` — the form's kind                  |
| `label`       | what the player sees; the row's name on screen                                |
| `description` | one paragraph, **built from the constants** (see below)                       |
| `paths`       | ORDERED requirement list, **primary first** (M-20)                            |
| `school`      | `SpellSchool::None` for Holy/Unholy (M-14), a real school otherwise           |
| `schoolLevel` | what the ARMY must have researched                                            |
| `fatigue`     | authored base cost, before M-10's divide and Low's halving                    |
| `castingTime` | ticks occupied, **minimum 1** — nothing casts instantly (M-23)                |
| `cast`        | `bool(AUnit&, const Target&)` — **applies only**; false = nothing happened     |
| `price`       | Low's second effect aimed at your own side (M-24); `nullptr` for every other path |
| `target`      | `TargetKind` — the SET of legal candidates (A-1); see the next section          |
| `pick`        | `TargetPick` — which candidate the body is handed                              |
| `buff`        | `true` for a standing effect the target keeps; the resolver then refuses to relay it (A-8) |
| `spell`       | back-pointer to the spell above — **wired automatically** at the end of `roster()`, never authored |
| `worth`       | `int(const AUnit&, const Target&)` — what casting this form at that target is worth, in `unitValue` (A-3); **wired by id** in `worthFor()`, see "Scoring" below |
| `aiDivider`   | `0` = derive from fatigue, casting time and pool cost (A-4); any positive number overrides it for playtesting/modding |

### Targeting is DECLARED, not coded (A-1, slice AI-1)

A body does **not** look for its own target. `Spells::chooseTarget()` resolves the form's
declared kind and pick once per cast attempt and hands the body a `Target`; the body applies an
effect to `target.unit` (or walks `target.units` for an `AllyTeam` form) and returns `false`
when it needs a unit and was given none.

| `TargetKind`  | Candidates                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| `EnemyUnit`   | living enemies within `SPELLRANGE`, elevation-adjusted                         |
| `AllyUnit`    | living allies **including the caster**, no range check (that is today's rule)   |
| `AllyTeam`    | the whole living ally line at once — `target.units`, in team order              |
| `Adjacent`    | none: the body scans the caster's own neighbouring hexes (raise_dead)          |
| `Battlefield` | none: the spell stands over the field (E-4/E-5)                                |
| `None`        | none at all                                                                    |

`TargetPick` — `Densest` (the offensive walk), `Wounded` (a hurt ally first, else the first
ally), `Fatigued` (the most tired, nobody at zero), `Broken` (a broken ally first), `First`.
**Every pick is a description of behaviour that already existed.** Adding a new preference is a
change to the cast AI, not to a spell row; AI-2's scorer is where that belongs.

The resolver is **side-effect-free and dice-free** on purpose: the scorer will ask "whom would
this form hit" many times per decision, and a resolver that rolled would eat the mock queue a
combat test seeded. If you add a helper it must keep both properties — `test_targeting.cpp`
fails otherwise.

**A `buff` form** (Stoneskin, Ward) marks its target with `markBuffOn(unit, "<spell id>")` on
success, and a marked man stops being a candidate for that spell for the rest of the battle
(A-8). Without the mark, recasting forever is the correct play: `applyStatMod`/`addShield` clamp
each delta on its own and never the total. The id in the body must be the row's own spell id —
a sweep in `test_targeting.cpp` holds the two together.

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

- a damage form is *expected damage × target value* (hit chance folded in, `AI_DAMAGE_SCALE`);
- a buff is *the value of what it lifts × `AI_BUFF_WORTH_PCT`* (a debuff its own percentage);
- a conjuration is *bodies × their value*, and **0 when the body would fail** (too few corpses);
- a battlefield enchantment is the flat `AI_GLOBAL_WORTH` — script-only (E-3), so its worth
  only has to clear the script floor.

Then `score = worth × AI_SCORE_SCALE ÷ spellDivider(form)`, where the divider is derived from
the row's own numbers (`castingTime × (AI_DIVIDER_BASE + (fatigue + poolCost ×
AI_POOL_COST_WEIGHT) ÷ AI_FATIGUE_PER_DIVIDER)`) unless `aiDivider` overrides it. The catalog
exports `divider` per row so The Study can show it. What the caster does with the scores:

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
AUnit&, const Target&)` beside the others in `SpellList.cpp` and map the id in `worthFor()`.
Keep it a *pure* read of the target — no dice, no state — and mirror the body's own gate (if
the body will decline, return 0), or the scorer will keep choosing a cast that never fires. The
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
"at range" once. A spell whose sentence genuinely differs (fireball names the men caught in the
blast) writes its own, and there is a comment there saying why.

## Numbers go in `Defines.hpp`, marked balance-deferred

```cpp
constexpr int EMBER_DAMAGE = 4;  // fireball's minor form — one bolt, no blast
```

Every spell number in this project is **balance-deferred**: chosen sane relative to its
neighbours, not tuned. Keep them together in the spell block, keep the comment saying what the
number *is* rather than what it equals, and never inline a literal into an effect body.

## The battlefield-wide kind (E-2..E-6)

A sustained spell that stands over the whole field until its caster dies. Three extra fields,
defaulted and last in `SpellForm`, so an ordinary row is unaffected:

```cpp
{ "battlefield", "Leaden Air", leadenAir(),
  {{P::Death, 2}}, S::Enchantment, 2,
  LEADEN_AIR_FATIGUE, 2, castLeadenAir, nullptr,
  EnchantAim::Everyone, LEADEN_AIR_POOL_COST, tickLeadenAir,
  TargetKind::Battlefield, TargetPick::First },
```

- **`enchantAim`** — `Friendly` (the instance helps its own side; both sides may hold their own
  and each benefits) or `Everyone` (symmetric, so it applies **once** however many instances
  stand — otherwise calling it second would be strictly better).
- **`poolCost`** — channels drawn from the army-wide POOL **in full** on completion. A pool that
  cannot cover it means the form does not qualify, and the walk moves to the caster's next line.
  This replaces the ordinary per-cast fatigue discount rather than stacking with it.
- **`tickEffect`** — `void(Battlefield&, int team)`, applied once per tick in `onTurnStart()`
  *after* passive recovery. For an `Everyone` aim the team argument is meaningless and the body
  reads both sides itself.

The `cast` body is one line — the machinery lives on `Battlefield`:

```cpp
static bool castLeadenAir(AUnit& caster, const Target& /*target*/)
{ return Utility::getBattlefield().beginEnchantment(caster, "leaden_air"); }
```

Three rules come free with that call: once per side **per battle** (an instance ended by its
caster's death cannot be re-called), the instance dies with its sustainer at the end-of-tick
sweep, and a second same-side caster fizzles unpaid.

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
                  └── castableSpellsFor() → the character sheet's chosen-spell picker
```

`spellCatalogJson()` is the one place a new field has to be repeated. The campaign layer
phrases what it owns (the pool sentence, the duplicate-script warning) and passes the
engine's own `label`/`description` through untouched. Since AI-2 each row also carries its
`divider`, and the campaign side sends two AI inputs the other way on a placement entry:
`value` (a character's worth, base + items, `services/characters.js characterValue`) and
`shortlist` (the post-script lottery's fence, v46). Both are stamped from the record and
stripped from the request, like `paths` and `script`.

## Tests to touch

Usually **none**. `test_scoring.cpp` sweeps every form for a `worth` and a positive divider
and pins the purity of scoring. `test_targeting.cpp` sweeps every form's target kind, refuses
a buff whose body marks the wrong id, and casts every unit-targeting body at nothing to prove
it declines rather than dereferences. `test_spells.cpp` sweeps the roster and fails a row that is malformed
(empty id or label, zero fatigue, instant cast, unordered paths, non-ascending forms), that
leaves a path with no level-1 spell, that carries a price without being Low, or that gets the
Holy/Unholy school gate wrong. `engine.integration.test.js` re-checks the same properties
campaign-side against the **real binary**, so a spell retuned in C++ cannot drift from what the
screens render.

Add a test when the row introduces a new **rule** — a new form kind, a new gate, a new cost —
not for a new instance of a shape that already exists. `test_enchantments.cpp` is what that
looks like: it went in with the battlefield kind, not with the second battlefield spell.

## Gotchas

- **A `worth` that says yes when the body says no is a stall.** The scorer picks by worth and
  the body fires later; if the estimator ignores a gate the body checks, the caster channels a
  cast that declines, every tick, forever. Read the same field the body reads.
- **A `cast` body handed an empty `Target` must return `false`.** Fatigue *powers* the spell
  (M-23), so a spell that never fired costs nothing — that is what makes the fall-through to
  weaker forms free rather than a way to burn a caster out.
- **Every one of the ten paths needs a castable level-1 spell.** Paths are rolled at hire
  (M-5), so a path with no minor makes that roll a dud. The sweep treats this as correctness,
  not polish.
- **`paths` is ordered and `paths[0]` is load-bearing**: it decides the fatigue divide, the
  effect scaling and the character of the cast. Later entries only gate. Never sort this list,
  and never call it the "major path" — major is taken.
- **Low is cheaper in fatigue and dearer in blood.** A Low spell with no `price` is a pure
  discount, which is the one thing Low must not be; the sweep enforces both directions.
- **Roster order is the AI's priority order.** Inserting a spell high in the table changes what
  every existing caster reaches for first. Put a new spell next to its path's neighbours.
- **The engine never learns a campaign word.** No spell body may mention research, gold, a
  charter or a turn. It gets path levels, a school number and a channel pool, and that is all
  the campaign is allowed to tell it (M-17).
