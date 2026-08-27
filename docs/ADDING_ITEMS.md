# Adding a new item — one row, and what reads it

Written out of Construction slice C1 (docs/CAMPAIGN_PLAN.md "THE CONSTRUCTION INTERVIEW",
C-8): the guide is documentation of a path just walked, the way `ADDING_UNITS.md` came out
of the unit path. `ADDING_UNITS.md` is the precedent for the format and for the rule that
matters most here too: **one hand-maintained row, everything downstream derived**.

## TL;DR

1. Add **one row** to `ITEM_CATALOG` in `campaign-server/utils/campaignConfig.js`.
2. If its power is an **ability**, give the ability a player-language line in
   `ITEM_ABILITY_TEXT` (`campaign-server/services/items.js`) — for **both** targets if it
   can appear on both a squad item and character gear. If its power is **stats**, use only
   names already in `ITEM_STAT_TEXT` (9-5's vocabulary).
3. Give it an **arrival channel**: a `forge` block on the row (craftable), a fate in
   `services/events.js` with `effect: { type: 'item', itemId: … }`, or the loot path
   (enemy bearers draw from the catalog by themselves).
4. Run `campaign-server` tests. `items.test.js` sweeps the catalog and fails on a row whose
   ability has no phrasing, whose stats aren't in the vocabulary, or whose denials are
   inert — the tripwires do the reviewing.

No schema change, no migration, no frontend change: `campaign.items` stores ids, and every
sentence the client renders is composed server-side (17-5) from the row.

## The row

```js
{
  id: 'gear_example',        // stable id; the store may hold several copies (kit stacks, 9-6)
  kind: 'gear',              // 'gear' (character) or 'banner' (squad)
  slot: 'hand',              // gear only: 'head'|'torso'|'legs'|'hand'|'misc' — the KIND of
                             // place it needs; how many such slots a creature has is the
                             // engine catalog's anatomy (5-6)
  name: 'Example Blade',
  blurb: '…',                // the card's flavour line
  target: 'character',       // who it goes on ('character' | 'squad')
  permanent: false,          // true = BINDS: once given it never comes back (a bound
                             // banner, the artificial heart). planUnequip refuses it and
                             // the store's two-step confirm warns before the click.
  unique: false,             // true = the campaign may hold at most one, ever (9-6)
  lootable: true,            // false takes it out of the loot path BOTH ways (9-12)
  mods: { attack: 1 },       // {stat: delta} in ITEM_STAT_TEXT's vocabulary (9-5);
                             // maxHP, never `hitpoints`
  abilities: ['fearless'],   // engine wire words the item grants (9-2)
  denies: [],                // abilities it takes AWAY (9-3) — never name an implied one
                             // (IMPLIED_ABILITIES); the row would be inert and the sweep
                             // fails it so you find out
}
```

**A row may carry `mods`, `abilities`, or both** (9-2). The engine never learns what an
item is — abilities reach it as `carried_abilities`/`squad_abilities` wire words, stats as
`squad_mods` deltas.

### Making it craftable: the `forge` block (Construction C-6)

```js
  forge: { level: 1, paths: { fire: 1 }, mithril: 4 },
```

The block **is** the whole gate, all three parts required: the Construction school level,
the paths the smith must **himself** command (research is fungible, forging never was), and
the mithril price. A row without a `forge` block simply cannot be forged; nothing else
about the item knows which channel it arrived through (C-2) — a forged item lands in the
store like loot does and the equipment rules take over.

The costs beyond the row: the smith's `RESEARCH_POINTS_PER_MAGE` never arrive at that
day's accrual (C-6 — the bank is never debited), and he is stamped `forgedDay` once per
turn. That is the entire price; do not add gates to the action (C-1 keeps it
location-blind — no away rule, no squad rule).

### The other kind of forgeable row: a construction (slice C2, C-3)

A **construction** is not an item — it *stands* instead of stacking — but it is authored
with the same discipline, in `CONSTRUCTION_CATALOG` (same file). A row is `id`, `name`,
`blurb`, the same three-gate `forge` block above, plus its effect halves, **only through
channels that already exist** (C-3):

```js
  // campaign-side: EVENT effect vocabulary, applied once at build via applyEffect.
  // Permanent (no turnsLeft), never raidable — a structure is not a pressure a raid lifts.
  effects: [{ type: 'forage_modifier', id: '<row id>', label: '…', target: 'playerYield', factor: 1.1, raidable: false }],
  // battlefield-side: extra fortified_sides in the FORTIFICATION_PRESETS entry shape,
  // derived from campaign.constructions at read time (walledSides) — never stored.
  sides: [{ q: 0, r: 7, dir: 'SE', durability: 130 }],
```

The catalog sweeps in `constructions.test.js` hold the C-3 line for you: effects must be
`forage_modifier` (a new effect type here has to argue its way past that fence — a
construction wanting a genuinely new engine capability is content **blocked on its own
engine slice**), the modifier `id` must equal the row id, `sides` must not duplicate a
fort preset side, and every row must reach the balance sheet's forge ledger. Building
shares the item forge's whole cost model — same eligibility, same `forgedDay` stamp, so a
mage builds *or* forges each turn — and a construction is inherently unique: the built
gate replaces `unique`.

### The third kind of forgeable row: a crafted unit (slice C3, C-4/C-5)

A **crafted unit** is a *body*: the row (in `CRAFTED_UNIT_CATALOG`, same file) is `id`,
`name`, `blurb`, the same three-gate `forge` block, plus `unit` — the engine type the
foundry mints:

```js
  { id: 'crafted_golem', name: 'Golem', unit: 'Golem', blurb: '…',
    forge: { level: 3, paths: { earth: 2 }, mithril: 15 } },
```

What arrives is a **character** (C-4): named from `GOLEM_NAMES`, attachable,
artifact-bearing, permanently mortal — and mindless, so no paths/script, no hang-back
order (`MINDLESS_CHARACTER_TYPES`), and no rations (`NON_EATING_TYPES`, a thematic call
per type). The row never closes — there is no `unique`/built gate; mithril and path-mages
are the throttle.

The `unit` must be an engine type carrying the `Crafted` role, and the agreement is
pinned both ways in `engine.integration.test.js` (the twin of the Player obtainability
rule — see `docs/ADDING_UNITS.md` §2/§5): a Crafted type with no row here fails, a row
whose unit is not Crafted fails, and a craftable unit missing from `CHARACTER_TYPES`
fails. So adding one touches **both docs' paths**: the C++ unit + catalog entry first,
then the row here.

## Arrival channels (9-7)

| Channel  | Where it's authored                                                       |
| -------- | ------------------------------------------------------------------------- |
| Loot     | nothing to author — enemy bearers roll gear off the catalog (`enemyBearers.js`), and `lootable`/`unique` on the row steer the recovery arithmetic (`loot.js`) |
| Events   | a fate with `effect: { type: 'item', itemId }` — `eventEligible` drops it once a unique is held |
| Crafting | the `forge` block above                                                   |
| Purchase | not built yet (9-7 names it; nothing implements it)                       |

## Tests to touch

Usually **none** — the sweeps in `campaign-server/tests/items.test.js` review the row for
you (phrasing coverage, inert denials, slot sanity), `forge.test.js` pins the forge gates
generically, and `balanceSheet.test.js` fails if a new *effect type* escapes the sheet.
Add a test only when the row introduces a new **rule** (a new flag like `permanent` was,
a new effect kind), not for a new instance of an existing shape.

## Gotchas

- **`maxHP`, never `hitpoints`** (9-5): the engine regenerates HP from the maximum, so a
  `hitpoints` mod would make a bearer start battles wounded.
- **Denying an implied ability does nothing** — the engine subtracts denials *before* the
  implication closure. The sweep flags it; delete the denial.
- **`permanent: true` on gear is a real design decision**: it is the binds-on-equip flag
  (C-2), and the only way back to the store is never. Say so in the blurb — the UI warns,
  but the card should read like the commitment it is.
- **A unique row needs its uniqueness respected at the offer**, not just the grant:
  channels filter on `holdsItem` before offering (events via `eventEligible`, the forge
  via `planForge`/`held`). A new channel must do the same or a duplicate is only stopped
  by `grantItem`'s late refusal.
- **Mithril is deliberately scarce** (C-7: seed, raid strongboxes, events, the garrison's
  trust). Price forge rows against `docs/BALANCE_SHEET.md` (`make balance-sheet`), which
  now carries a mithril column.
