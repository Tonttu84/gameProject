# Economy — a rough price reference

> *"You might want to create some internal documentation for the value of gold or materials so it
> is easier for you to be consistent … just a very rough internal consistency."* — user, 2026-08-13

**What this is for.** When a new event, raid reward, upgrade or recipe needs a price, this is what
the number should be consistent *with*. It is a reading of prices the game already charges
(`services/recruit.js`'s `RECRUIT_POOL`, `utils/campaignConfig.js`'s raid rates, the forage yield),
not a proposal to change any of them.

**What this is NOT.** It is not the balancing pass, and nothing here is a target the numbers should
be moved toward. The general balancing pass — the one that also finally sets the enemy host's size —
comes later and is fed by a playtest of the whole curve; see `docs/CAMPAIGN_PLAN.md`. The
observations at the bottom are things a reader should *know*, not a to-do list. `docs/BALANCE_SHEET.md`
is the companion piece: generated, and it prices every fate and raid reward side by side.

Hand-written, unlike the balance sheet. Figures below are computed from the config as of
2026-08-13; if one disagrees with the code, the code is right.

## The six currencies, and what each is really for

| Resource | Where it comes from | What spends it | Character |
| --- | --- | --- | --- |
| **Food** (kg) | foraging (80% of the harvest), `loot_supplies` raids, supply fates | upkeep every turn, recruiting | The campaign clock. Abundant per transaction, ruinous per turn. |
| **Materials** | foraging (20% of the harvest), loot raids, salvage fates | fortifications, recruiting, reinforcement | Bulk goods. Priced in the authored content as if scarce; foraging says otherwise (see observations). |
| **Gold** | won raids, `garrison_paychest` (+75) | casters, reinforcement | The scarce one. Starts at 0, has no passive income, and is the only thing casters take. |
| **Horses** | `seize_horses` raids, A Captured Herd | mounted hires and mounted replacements, 1 per rider | Narrow: it gates exactly one branch of the roster. |
| **Workers** | the starting 2,000 (no replenishment yet) | fort labour (`used`), Militia hires (`total`) | A stock, not an income. Every Militia is a worker who left. |
| **Bodies** | the recruit ladder | battles, raids, reinforcement inputs | The ladder's rungs are a currency of their own: a Soldier is spent to make a Cavalry. |

## What a body costs

Per body, at the rung's own price (`RECRUIT_POOL`), then rolled up through the ladder — because
above Militia the count comes off the rung below, one for one.

| Type | Own price / body | Rolled up (through the ladder) | Eats / turn |
| --- | --- | --- | --- |
| Militia | 2 food, 1 materials, 1 worker | same | 28 kg |
| Soldier | 4 food, 2 materials, +1 Militia | 6 food, 3 materials, 1 worker | 28 kg |
| Archer | 3.3 food, 1.7 materials, +1 Militia | 5.3 food, 2.7 materials, 1 worker | 28 kg |
| Pikeman | 3.3 food, 1.3 materials, +1 Militia | 5.3 food, 2.3 materials, 1 worker | 28 kg |
| LightCavalry | 7 food, 3 materials, 1 horse, +1 Soldier | 13 food, 6 materials, 1 horse, 1 worker | 112 kg |
| Cavalry | 8 food, 4 materials, 1 horse, +1 Soldier | 14 food, 7 materials, 1 horse, 1 worker | 112 kg |
| Mage | 100 gold | same | 28 kg |
| Priest | 80 gold | same | 28 kg |

**The first rule of pricing a body: buying one is trivial next to keeping one.** A Soldier costs 6 kg
of food to raise and eats 28 kg every fortnight thereafter — the purchase price is paid back in
upkeep inside one turn. Anything that hands the player *bodies* is therefore handing them a
liability as much as an asset, and anything that hands them *food* is buying time for the army they
already have. A rider is 4× a footman's upkeep, which is most of what makes cavalry elite.

## What a replacement costs

Reinforcement (`SQUAD_REINFORCE_POOL`, slice 3) is priced in **gold and materials, never food** — a
1:1 recipe destroys a body and creates one, so no new mouth joins the army. Recruiting *provisions* a
body; reinforcing *re-equips* one.

| Type | Replacement | A full intake |
| --- | --- | --- |
| Militia | 1 gold, 1 materials | — |
| Soldier | 2 gold, 2 materials | `line` (10): 20 gold, 20 materials |
| Archer | 2 gold, 2 materials | `skirmish` (6): 12 gold, 12 materials |
| Pikeman | 2 gold, 1 materials | — |
| LightCavalry | 4 gold, 3 materials, 1 horse | — |
| Cavalry | 5 gold, 4 materials, 1 horse | `vanguard` (2): 10 gold, 8 materials, 2 horses |

Horses are charged at exactly the hire rate (1 per rider) with no discount for the destroyed input
having been mounted — the remount is a remount either way.

## What a turn of income looks like

Rough, for the starting army (field-points pool ≈ 1,112) at the default half-and-half effort split.

| Channel | Per turn | Notes |
| --- | --- | --- |
| Foraging (70% of the pool on food) | ≈ 10.0 t food + ≈ 2,490 materials | 0.7 × 1,112 × 16 kg = 12,454 kg gathered, split 80/20 |
| Upkeep of the starting army | −12.4 t food | 300 Soldier + 50 Archer + 22 riders + 6 casters |
| A won `destroy_detachment` raid | 22–86 gold (mean ≈ 54) | 36-unit target × 1.2 × uniform[0.5, 2] |
| A won `loot_supplies` raid | 14–58 gold (mean ≈ 36), plus 2–5 t food, 10–30 materials | |
| A won `seize_horses` raid | 7–29 horses (mean ≈ 18) | 36-unit guard × 0.4 × uniform[0.5, 2] |
| `garrison_paychest` fate | +75 gold | resolve-gated, so not reliable income |

**The rough exchange rate, if you need one number.** Take a won raid as the unit of effort: it pays
about 30–50 gold, or 2–5 t of food, or ~18 horses. So

> **1 gold ≈ 100 kg food ≈ 0.5 horses**, and materials are not on this scale at all (below).

Use it for order-of-magnitude sanity only — "is 40 gold a fortune or pocket change?" (pocket change
late, a real prize on turn 2) — never as a conversion the design has to honour.

## Pricing something new — rules of thumb

1. **Price it against the sink it competes with, not against the treasury.** Gold's competitor is a
   caster (80–100); materials' is a fort level (50, then 100); food's is the fortnight's upkeep
   (12.4 t and climbing).
2. **A per-turn drip is worth far more than a one-off of the same size**, because the campaign is
   10–20 turns. Anything permanent (a `forage_modifier`) should cost multiples of a one-shot.
3. **Bodies are cheap, upkeep is not** — see above. Price a troop grant by what it will eat, not by
   what it would have cost to hire.
4. **Gold is the only currency with no passive income.** A cost in gold really does bite; the same
   number in materials frequently does not.
5. **Keep the shape, not just the size.** A mounted thing should want horses, a built thing
   materials, a hired thing gold — a price that names the wrong resource reads as arbitrary even
   when the magnitude is right.

## Observations (recorded, not acted on)

Facts a future balancing pass will want; none of them is a bug being fixed here.

- **Materials inflate.** Foraging at the default split yields ≈ 2,500 materials a turn, while the
  authored content prices materials as if a few dozen were a real reward (`RAID_LOOT_MATERIALS` is
  10–30, a fort level is 50–150, a full `line` reinforcement is 20). After the first couple of
  turns, materials stop being a constraint on anything. The 80/20 forage split is where that comes
  from: materials ride free on the food economy, at the same scale.
- **Gold is the genuinely scarce currency**, and reinforcement is now its second sink after casters
  — which is the intended sting of the vanguard archetype (2 replacements a turn at 5 gold and a
  horse each).
- **The forage calibration is slightly optimistic.** `FORAGE_KG_PER_POINT`'s comment calibrates
  "≈70% of the pool breaks even against consumption" by comparing *gathered kg* to consumption — but
  only `FORAGE_FOOD_SHARE` (80%) of it becomes food. Break-even on food alone actually needs ≈87% of
  the pool, before the outer rings' yield penalty. Foraging is therefore a touch tighter than the
  comment claims, which is a note for the balancing pass, not a number to change here.
- **Workers never come back.** There is no replenishment, so the 2,000 the campaign starts with is
  the whole labour supply for the run: every Militia hire and every fort level is a permanent draw
  on the same finite pool.
