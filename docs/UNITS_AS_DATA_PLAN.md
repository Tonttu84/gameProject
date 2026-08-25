# Units as Data — Restructuring Plan

Working plan for hollowing unit subclasses into pure stat rows: **spells come from a
requirement-gated spell roster, ranged attacks come from the weapon, boolean capability
tags live on AUnit — units themselves carry stats, not functionality.** (User design,
2026-07-05.) The playtest gate has passed; Stage R0 landed 2026-07-06, R1 is next up.

**The division of labor (user design):**
- **Unit = who**: stats only (hp, attack skill, BS, speed, armour, size, mana) + tags.
- **Weapon = what is delivered**: ALL attacks, melee and ranged, come from weapons. A
  unit holds a vector of weapons and runs them in order. Unique unit attacks (a
  monster's sting, a trample) are weapon-roster entries that only that unit's spec
  references — same mechanism, no special cases.
- **Spell roster = what can be cast**, requirement-gated (paths later, exact unit-type
  name as stopgap and for genuinely unique spells).

**Why this direction is right for this codebase:**
- **Melee is already built this way.** `AUnit` stores `std::vector<Weapon> _attacks`;
  the attack loop iterates that vector in order (`AUnit.cpp` ~409), defense qualifies
  the best-reach weapon from the same vector, and weapons are constexpr roster entries
  in `WeaponList.hpp` — a unique single-unit attack is just one more entry. The user's
  melee principle is a confirmation of the engine's shape, not a change. Wielder skill
  (`attackPWR`, `ballisticSkill`) stays on the unit; everything delivered stays on the
  weapon — that boundary is already correct and must be preserved.
- It converges on a pattern the engine already uses: `Weapon` is constexpr data whose
  `WeaponEffect` enum is dispatched via `WeaponEffects.cpp`. Spells are the same shape,
  one level up. Nothing philosophically new is being introduced.
- The four `special()` overrides (Archer bow, Mage fireball, Priest bless, Necromancer
  raise-dead) already share every primitive: `mana`, `getCast()/setCast()` cooldowns,
  `Utility::findTarget(team, eligible, score, myTeam)` targeting predicates,
  `RangedShot`/`RangedCombat::fire`, `logEvent`. They differ only in data + one effect
  body each — i.e. they are already spell-roster rows in disguise.
- It strengthens the SSOT/tripwire discipline (fewer places where unit facts live) and
  makes the "new unit = one table row" workflow real.
- The mage-owns-fireball arrangement is an acknowledged stopgap: the roadmap is
  **spell paths** on casters, spells carrying path requirements, and unit-unique spells
  expressed as roster entries whose requirement is an exact unit-type name. This plan's
  requirement mechanism is designed so paths later slot into it without rework.

**Boundaries (decided up front):**
- **MountedUnit stays a composite**, not a tag. Rider/mount delegation, hit routing by
  weapon reach, dismount-on-death are structural behavior, orthogonal to this plan.
- **Tags are engine-behavior switches only** (movement/combat reads them). Campaign-layer
  values keep deriving from exported stats (`reconTag`, forage/screen values) — do not
  reach for a tag when a stat derivation serves.
- **Spell effects stay C++ functions.** No scripting/data-file layer: the engine remains a
  self-contained subprocess and the SSOT direction (engine → DB, never back) is preserved.
- Determinism is sacred: casting order stays unit-iteration order; every stage must keep
  the existing dice-queue tests green.

---

## Stage R0 — Spell roster (name-gated stopgap requirements) ✅ DONE (2026-07-06)

The pivotal stage; everything else follows its pattern.

**Landed as planned, with these implementation decisions (session 2026-07-06):**
- `Spell::cast` returns **bool** (fired / didn't) rather than void: `castSpells()` only
  spends mana and starts the cooldown on `true`, preserving the old "no target, no cost"
  behavior of fireball and bless. `raise_dead` returns true whenever its gates pass
  (the old body paid mana/cooldown even when every summon placement failed).
- **One spell per caster type for now** (user decision): casters will eventually hold
  all path-matching spells as an array, needing a real cast-selection algorithm.
  Until then `AUnit::chooseSpellToCast()` is the dedicated seam — pick-first placeholder,
  documented so the design intent survives the simplification. A roster tripwire test
  enforces ≤1 spell per catalog type and says when to delete it.
- The **hex requirement is per-spell**, not common gating: old `castBless` worked
  without the caster standing on a hex (pinned by the existing Priest tests) —
  fireball/raise_dead check `caster.getHex()` in their own bodies.
- `mana` was NOT a shared primitive (it was a per-subclass field on Mage/Priest/
  Necromancer); it is now `AUnit::mana` (+ `getMana`/`setMana`), default 0, casters
  set 99 in their ctors. Not exported — catalog JSON unchanged, campaign server untouched.
- The `special()` audit found **Soldier** (empty override — deleted), not Scorpion.
  `special()` remains virtual for Archer only, as planned.
- **Latent UB found & fixed:** `triggerSpecialPhase` range-looped the team vector while
  raise-dead `push_back`ed summons into it (iterator invalidation; pre-existing, ASan
  caught it once castSpells re-ordered the phase). The phase now acts on a phase-start
  snapshot of raw unit pointers — also pins the rule that units summoned this phase
  don't act this phase.
- Deliberate behavior change (uniform gate): a **broken** mage no longer casts
  (old Mage::special never checked `broken`; Priest/Necromancer did). Pinned by a
  new test. Also: a broken caster's cooldown now ticks uniformly (old Priest froze
  it while broken, old Necromancer didn't — unpinned either way).
- New tests in `backend/engine/tests/test_spells.cpp`: characterization tests for
  fireball + raise-dead written BEFORE the migration (green against the old code),
  then roster tripwires. The three Priest tests in test_combat.cpp needed exactly one
  mechanical edit (`priest->special()` → `priest->castSpells()`); assertions untouched.
- Known oddity, NOT fixed (pre-existing): with corpses ≥ 4 raise-dead double-spends
  (up-front `setCorpses(corpses-3)` AND per-placement decrement in placeZombie).
  corpses ≤ 3 behaves as designed and is what the tests pin. Decide intended corpse
  economy before touching it.

- `include/Spell.hpp` + `src/SpellList.cpp` (mirror Weapon/WeaponList naming):
  ```cpp
  struct SpellRequirement {           // extended by paths in Stage R4
      std::string_view exactUnitType; // stopgap: "" = no name gate
      // later: PathMask paths;
  };
  struct Spell {
      std::string_view id;            // "fireball" | "bless" | "raise_dead"
      int manaCost;
      int cooldown;                   // value fed to setCast() after casting
      SpellRequirement requirement;
      void (*cast)(AUnit& caster);    // targeting + effect, moved verbatim from
  };                                   // the current special() bodies
  ```
- Effect bodies move as-is: `castFireball` (Mage.cpp's findFireballTarget + RangedShot),
  `castBless` (Priest.cpp), `castRaiseDead` (Necromancer.cpp incl. placeZombie/
  placeSkeleton — these become free functions or SpellList statics).
- `AUnit` gains `std::vector<const Spell*> spells` (assigned at construction by querying
  the roster with the unit's type name) and a **non-virtual** `castSpells()` that
  `triggerSpecialPhase` calls: iterate known spells, first castable one (mana ≥ cost,
  cast cooldown at 0, alive, not broken, has hex) fires. Common gating (mana decrement,
  setCast) moves here so each effect body only targets + applies.
- Mage/Priest/Necromancer shrink to ctor-only classes (stats + weapon + symbol).
  `special()` stays the virtual hook only for Archer until R1 retires it.
- **Audit while here:** any other `special()` overrides (Scorpion?) — fold or document.
- Tests: existing mage/priest/necro behavior tests must pass untouched (they pin the
  migration); add roster tripwires (every spell id unique; name-gated spells resolve to
  exactly their caster type; a unit with no matching spells casts nothing).
- **No catalog export change** — campaign server totally unaffected.

## Stage R1 — Ranged attacks join the weapon pipeline

Melee already flows unit → weapon vector → in-order strikes (see above). This stage
brings ranged attacks into the same pipeline and audits the stragglers.

- Ranged capability becomes weapon data: either `RangedWeapon` entries in WeaponList or
  range/ammo/projectile fields on `Weapon` (decide at implementation; lean toward fields
  on Weapon — one list, and a Javelin is a melee-ish weapon with a throw).
  Bow = {range, ammo, damage, pen}; accuracy keeps deriving from the wielder's
  ballisticSkill (the Stage-0 seam, untouched).
- `Archer::fireBow`/`findArcherTarget`/`calcShot`/`accurateShot` generalize into
  `RangedCombat` driven by weapon stats + wielder BS; ammo tracking moves to the unit's
  weapon state (`restoreForNextBattle` resets it there).
- `triggerSpecialPhase` → units cast spells, then units with a loaded ranged weapon
  shoot (same order as today: one special action per unit per tick — an archer today
  only shoots, a future spellcaster-with-bow decides by priority, spells first).
- Archer shrinks to ctor-only; `special()` virtual dies entirely.
- LightCavalry gets its javelin for free later (it already has BS 8 "javelin-flavored").
- **Audit:** any attack delivered outside the weapon vector (unit-special melee, Scorpion
  bolt, undead claws expressed as bare stats) moves into WeaponList as a roster entry
  referenced only by that unit — after this stage the weapon vector is the ONLY way any
  unit deals damage.
- Tests: archer ammo-exhaustion test and ranged pipeline tests pass untouched; new test:
  a non-Archer unit handed a Bow shoots identically (proves it's the weapon, not class).

## Stage R2 — Capability tags on AUnit

- Small fixed tag set as named booleans exported per unit: start with `flying=false`
  everywhere (first consumer: the flying scout/forager follow-up) and fold the existing
  `spellcaster` flag into the same surface. Storage: plain bools or a bitset — keep the
  exported shape `{ flying: bool, ... }` regardless.
- Export in `unitCatalogJson()` → mirror in `unitType.js` statsSchema + fixtures +
  tripwire — **identical workflow to ballisticSkill** (strict mirror aborts boot on
  drift, intended). Coordinate with Stage 4 scouting's `reconTag` (a signed stat riding
  the same machinery; whichever lands second reuses the first's plumbing).
- Movement/terrain consumers for `flying` wired only when the first flyer exists —
  the tag ships inert.

## Stage R3 — Units as pure data (the payoff)

Only after R0–R2 have hollowed the subclasses out:

- `UnitSpec` table (constexpr, next to UnitCatalog's existing name→factory table):
  `{name, symbol, category, size, stats (hp/attack/defence/armour/speed/BS/...),
  weapons, tags, placeable}`.
- One generic `Unit` class constructed from a spec row; spell assignment queries the
  roster by type name as in R0. Soldier/Archer/Mage/Priest/Necromancer/Zombie/Skeleton/
  LightCavalry classes are deleted. MountedUnit remains, composing two spec-built units
  (Cavalry = spec "Cavalry rider" + spec "Warhorse").
- `UnitCatalog` factory becomes table-driven; the catalog tripwire (export == live
  instance) survives unchanged and now guards the table directly.
- Update `docs/ADDING_UNITS.md`: new unit = one UnitSpec row (+ spell-roster entries if
  it casts). This is the moment the "stats in ctor" workflow memory gets rewritten.

## Stage R4 — Spell paths (later, with the character system)

> **✅ THE INTERVIEW HAS HAPPENED (2026-08-25) — this stage is now spec'd, under "THE MAGIC SYSTEM"
> in `docs/CAMPAIGN_PLAN.md`.** Nineteen decisions, all the user's; read them before touching this
> stage, because several overturn what is written below. In particular: **mana is deleted entirely
> and casting costs FATIGUE** (so `Spell::manaCost` and `AUnit::mana` go rather than gaining paths
> beside them); a requirement becomes a **set** of path requirements plus an optional school gate;
> spells gain **minor and major forms** instead of ladders; and R4's own reserved question — what
> picks the spell when several qualify — is answered as **script, then AI**, with the AI taking the
> best form the caster qualifies for.

> **The user has since asked for more than this stage covers** (2026-08-25): more spells, spell
> paths, and *research to unlock spells* — the last of which is a new CAMPAIGN system this plan
> never contemplated. Idea-stage and un-interviewed; the entry that captures it is
> `[[todo-spell-paths-research]]` in `docs/CAMPAIGN_PLAN.md`'s deferred backlog. Read it before
> building this stage, and note that the character-system half of R4's gate is now open while the
> R1–R3 half is not.

- Casters gain `paths` as data (bitmask/list on UnitSpec, exported if the campaign layer
  wants it); `SpellRequirement` gains a path mask; name-gated stopgaps are replaced
  except for genuinely unique spells, which keep the exact-name requirement — both
  mechanisms coexist by design.
- Spell selection when multiple qualify (priority? mana budget?) is decided here, not
  before — R0's "first castable" rule is deliberately dumb.

---

## Sequencing & interplay

- **Nothing before the user's playtest** (feature freeze). R0 is a good first
  post-playtest engine session: small blast radius, pins everything with existing tests.
- The `Battlefield.cpp` tick-phase split (CAMPAIGN_PLAN restructuring item 1) has
  **shipped 2026-08-25**, so R1's ranged work lands in a file that is already three:
  movement in `BattlefieldMovement.cpp`, seating in `BattlefieldEngagements.cpp`, the
  lifecycle in `Battlefield.cpp`.
- R2 and campaign Stage 4 (scouting `reconTag`) share export plumbing — sequence
  whichever is ready first, the other rides along cheaply.
- Engine-backed skirmishes + the `Utility::getBattlefield()` global retirement
  (restructuring item 2) are untouched by this plan.

## Verification (per stage)

WSL `make test` + `make clang` (the effect-body moves are exactly where compiler-specific
UB would hide); campaign-server `npm test` for R2+ (catalog mirror); a full
`./game battle < in.json` smoke diffed for identical BattleResult on a fixed dice queue
where feasible. The existing caster/archer behavior tests are the migration's safety
net — they must never be "adapted" to make a stage pass.
