# Balance sheet — every fate and raid reward, priced

<!--
  GENERATED FILE — do not hand-edit. Regenerate with:
      npm --prefix campaign-server run balance-sheet
  Source of truth is services/events.js + utils/campaignConfig.js; this file is a
  snapshot so the numbers can be diffed in review and read on a machine without node.
-->

A read-only view of the authored content, for the balancing pass. It prices nothing in a
single currency on purpose — whether +40 Soldiers beats 4 t of food is the design call this
exists to inform, not to make.

## The scale everything sits on

| Reference | Value |
| --- | --- |
| Starting stores | 50.0 t food, 200 materials, 0 gold, 0 horses |
| Starting army eats | ~12.4 t / turn |
| Fates per turn | 3 slots, each a uniform draw |
| Ungated draw pool | 27 events → each ~11.1% of a slot, 0.111 appearances/turn |
| With every gate open | 37 events → 0.081 appearances/turn each |
| Enemy host | 721 units → a raid target is 22–50 units (mean 36) |
| Scouting costs | 200 pts a new target, 50 pts a reveal |

**Severity does not weight the draw.** It sets `POOL_LEGIBILITY` (how trustworthy the
reading is) and nothing else, so a severity-3 fate is exactly as frequent as a
severity-1 one. If the majors should be rarer than the minors, that is a mechanism that
does not exist yet, not a number to retune.

## Fates, outcome by outcome

One row per OUTCOME: a choice event contributes one row per branch, a recon-sensitive
one row per rung. Food in tonnes; blank means the outcome does not touch that column.

| Event | Reach | Sev | Outcome | Food t | Mat | Gold | Horses | Roster | Enemy × | Other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Wagons Bound for the Siege `supply` | draw | 1 | — | +3 |  |  |  |  |  |  |
| Sutlers from Downriver `traders` | draw | 1 | — | +1.5 |  |  |  |  |  |  |
| A Bitter Fortnight `weather` | draw | 1 | — | −1 |  |  |  |  |  |  |
| The Rearguard Catches Up `reinforcement` | draw | 2 | — |  |  |  |  | Soldier +20 |  |  |
| Desertion in the Lines `desertion` | draw | 2 | — |  |  |  |  | Soldier ×0.9 |  |  |
| Forage Raiders `forage_raiders` | draw | 2 | Blind | −4 | −20 |  |  | Soldier ×0.97 |  |  |
| Forage Raiders `forage_raiders` | draw | 2 | Warned (Outmatched/Contested) | −1 |  |  |  |  |  |  |
| Forage Raiders `forage_raiders` | draw | 2 | Anticipated (Superior/Overwhelming) |  |  |  |  |  | 0.95 |  |
| Night Raid `night_raid` | draw | 2 | Blind | −2 |  |  |  | Soldier ×0.98 |  |  |
| Night Raid `night_raid` | draw | 2 | Warned (Outmatched/Contested) | −0.5 |  |  |  |  |  |  |
| Night Raid `night_raid` | draw | 2 | Anticipated (Superior/Overwhelming) |  |  |  |  |  |  | enemy reveal (1 turn) |
| Turncoats from the Vanguard `defection` | draw | 3 | — |  |  |  |  | Soldier +40 |  |  |
| Camp Fever `plague` | draw | 3 | — |  |  |  |  | all ×0.95 |  |  |
| A Workable Seam `quarry` | draw | 1 | — |  | +25 |  |  |  |  |  |
| Damp Ruins the Stores `tool_rot` | draw | 2 | — |  | −15 |  |  |  |  |  |
| A Wandering Adept `wandering_adept` | draw | 2 | — |  |  |  |  |  |  | research +1 mage/turn, permanent |
| Horse Sickness `horse_sickness` | gated draw (has Cavalry) | 2 | — |  |  |  |  | Cavalry ×0.9 |  |  |
| A Captured Courier `captured_courier` | draw | 2 | Read the dispatches and lay a trap |  |  |  |  |  |  | schedules sprung_ambush (+1 turn) |
| A Captured Courier `captured_courier` | draw | 2 | Ransom him back to the enemy | +2 |  |  |  |  |  |  |
| The Trap Is Sprung `sprung_ambush` | chain (scheduled only) | 2 | — |  |  |  |  |  | 0.90 |  |
| A Rider from the Relief Host `relief_rider` | draw | 2 | Send your best scouts to guide them in |  |  |  |  |  |  | schedules relief_column_arrives (+1 turn) |
| A Rider from the Relief Host `relief_rider` | draw | 2 | Keep your scouts foraging the valley | +2 |  |  |  |  |  |  |
| The Relief Column Arrives `relief_column_arrives` | chain (scheduled only) | 2 | — |  |  |  |  | Soldier +30 |  |  |
| The Siege Lines Close `siege_lines_close` | spine (turn 2) | 2 | Send a working party to shore up the wall | −1.5 |  |  |  |  |  | resolve +15 |
| The Siege Lines Close `siege_lines_close` | spine (turn 2) | 2 | Hold your stores and your men |  |  |  |  |  |  |  |
| A Breach Threatens `breach_threatens` | spine (turn 5) | 2 | Throw men into the breach beside them | −2 |  |  |  | Soldier ×0.98 |  | resolve +15 |
| A Breach Threatens `breach_threatens` | spine (turn 5) | 2 | You cannot spare them |  |  |  |  |  |  | resolve -10 |
| The Warden's Van `wardens_van` | spine (turn 8) | 2 | Pin the besiegers so the van breaks through |  |  |  |  |  |  | schedules relief_van_arrives (+2 turn) |
| The Warden's Van `wardens_van` | spine (turn 8) | 2 | Husband your strength for the walls | +2 |  |  |  |  |  |  |
| The Warden's Van Arrives `relief_van_arrives` | chain (scheduled only) | 2 | — |  |  |  |  | Soldier +25 |  |  |
| The Garrison Calls `garrison_call` | draw | 2 | Send provisions and a working party to the walls | −1.5 |  |  |  |  |  | resolve +15 |
| The Garrison Calls `garrison_call` | draw | 2 | Keep your men and stores at their own work |  |  |  |  |  |  |  |
| The Ford Must Be Held `ford_watch` | draw | 2 | Send a charter to hold the ford |  |  |  |  |  |  | mission: 3 turns away, +12 prestige |
| The Ford Must Be Held `ford_watch` | draw | 2 | Leave the fords unwatched |  |  |  |  |  |  |  |
| Word from the Ramparts `garrison_lookout` | gated draw (resolve ≥60) | 2 | — |  |  |  |  |  |  | enemy reveal (1 turn) |
| The Garrison Turns Its Back `garrison_spurned` | gated draw (resolve ≤33) | 2 | — |  |  |  |  | Soldier ×0.97 |  |  |
| Stores from the Wall `garrison_stores` | gated draw (resolve ≥67) | 1 | — | +2 |  |  |  |  |  |  |
| The Garrison's Paychest `garrison_paychest` | gated draw (resolve ≥67) | 1 | — |  |  | +75 |  |  |  |  |
| The Standard Comes Down `garrison_standard` | gated draw (resolve ≥75) | 3 | — |  |  |  |  |  |  | item: The Unbroken Line (fearless) |
| The Warders' Notebooks `garrison_lorebooks` | gated draw (resolve ≥67) | 2 | — |  |  |  |  |  |  | research +40 pts |
| A Sally in the Night `garrison_night_sally` | gated draw (resolve ≥67) | 3 | — |  |  |  |  |  | 0.92 |  |
| A Chance to Mend the Bond `garrison_recovery` | gated draw (resolve ≤33) | 2 | Send stores and stand the watch with them | −2 |  |  |  |  |  | resolve +15 |
| A Chance to Mend the Bond `garrison_recovery` | gated draw (resolve ≤33) | 2 | Turn away — you have your own to feed |  |  |  |  |  |  | resolve -10 |
| A Merchant Caravan `merchant_caravan` | draw | 1 | Buy up their provisions | +3 | −15 |  |  |  |  |  |
| A Merchant Caravan `merchant_caravan` | draw | 1 | Trade rations for their wares | −2 | +25 |  |  |  |  |  |
| Refugees at the Palisade `refugees` | draw | 1 | Turn them away |  |  |  |  |  |  |  |
| Refugees at the Palisade `refugees` | draw | 1 | Take them in — more mouths, more hands | −3 |  |  |  | Militia +20 |  |  |
| Plague in the Baggage Train `baggage_plague` | draw | 2 | Quarantine and burn the tainted stores | −4 |  |  |  |  |  |  |
| Plague in the Baggage Train `baggage_plague` | draw | 2 | March on and trust to providence |  |  |  |  | all ×0.98 |  |  |
| Riders in the Foraging Grounds `foraging_riders` | draw | 2 | Escort every party |  |  |  |  |  |  | own yield ×0.85, permanent |
| Riders in the Foraging Grounds `foraging_riders` | draw | 2 | Let them forage unguarded |  |  |  |  |  |  | own yield ×0.6, raidable |
| The Enemy Digs In `enemy_supply_depot` | draw | 2 | — |  |  |  |  |  |  | enemy drain +4000 kg/turn, raidable |
| A Captured Herd `horses` | draw | 3 | Mount your veterans as cavalry |  | −20 |  |  |  |  | convert ≤25 Soldier→Cavalry |
| A Captured Herd `horses` | draw | 3 | Keep the herd at the horse lines |  |  |  | +25 |  |  |  |
| A Captured Herd `horses` | draw | 3 | Sell the herd to the baggage train | +4 | +30 |  |  |  |  |  |
| Sellswords at the Camp `sellswords` | draw | 2 | Hire the company | −3 | −10 |  |  | Soldier +20 |  |  |
| Sellswords at the Camp `sellswords` | draw | 2 | Send them on their way |  |  |  |  |  |  |  |
| A Hard-Handed Drillmaster `drillmaster` | draw | 2 | Drill the levy into soldiers | −3 |  |  |  |  |  | convert ≤20 Militia→Soldier |
| A Hard-Handed Drillmaster `drillmaster` | draw | 2 | Leave them to forage |  |  |  |  |  |  |  |
| An Enemy Captain Defects `deserter_lord` | draw | 3 | Take his oath and his men |  |  |  |  | Soldier +35 |  |  |
| An Enemy Captain Defects `deserter_lord` | draw | 3 | Send him back to sow discord |  |  |  |  |  | 0.93 |  |
| A Quiet Fortnight `lull` | draw | 1 | — |  |  |  |  |  |  |  |
| Season of Rains `rains` | draw | 2 | — |  |  |  |  |  |  |  |
| A Comet Overhead `comet` | draw | 3 | — |  |  |  |  |  |  |  |

## What a turn of fates is worth

Expected value over the **27 ungated** events, at 0.111 appearances
per event per turn. Choice and recon-sensitive events resolve to one of several
outcomes, so they contribute a band — the columns are the worst and best the turn can
do, not a prediction of play. Gated fates are excluded (they widen the pool and dilute
these rates when their gates open).

Numeric resources only. `resolve`, `schedule` and the forage modifiers appear in the
table above but are not summed here — they move hidden bookkeeping or a standing
multiplier, and adding them to a per-turn resource total would be inventing a rate.

| Resource | Worst for the player / turn | Best for the player / turn |
| --- | --- | --- |
| Food | −2.11 t | 1.61 t |
| Materials | −6.11 | 7.22 |
| Gold | 0.00 | 0.00 |
| Horses | 0.00 | 2.78 |
| Soldier (headcount) | 6.67 | 12.78 |
| Militia (headcount) | 0.00 | 2.22 |
| Soldier (drift) | −1.67% | −1.11% |
| every unit (drift) | −0.78% | −0.56% |
| Enemy host (drift) | 0.00% | −1.33% |

Drift rows are linearized (Σ p × (factor − 1)) — the multiplicative fates all sit within
a few percent of 1, so summing them is exact enough to compare, and compounding them
over an unknown turn count would be a fiction.

## Raids

Payoffs that scale with the target force move with the host and shrink as it is worn
down; flat rolls do not. Columns are min–max with the mean in brackets.

| Raid | Appears | Food t | Mat | Gold | Horses | Roster | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `destroy_detachment` | 0.25 / turn (base draw) |  |  | 13–121 (54) |  |  | the target force leaves the host — the thinning IS the reward |
| `loot_supplies` | 0.25 / turn (base draw) | 2.0–5.0 (3.5) | 10–30 (20) | 9–81 (36) |  |  | food/materials are flat rolls — they do NOT scale with the target |
| `rescue_troops` | 0.25 / turn (base draw) |  |  |  |  | Soldier 10–25 (18) | flat roll, independent of the host |
| `seize_horses` | 0.25 / turn (base draw) |  |  |  | 4–40 (18) |  | hired guard — a win never thins the host |
| `counter_event` | 1 per sealed BAD fate |  |  |  |  |  | unmakes the fate; no numeric reward, so only enemy intel is buyable |
| `garrison_sortie (sortie_probe)` | while resolve ≥50 |  |  |  |  |  | resolve +10, thins the host (resolve is hidden from the player) |
| `garrison_sortie (sortie_grand)` | while resolve ≥75 |  | 250 |  |  |  | resolve +14 (resolve is hidden from the player) |
| `forage_modifier card` | persistent, one per raidable modifier |  |  |  |  |  | winning LIFTS the standing forage pressure — priced by the modifier it undoes |

## Where the thin resources come from

Gold and horses are the newest resources and have the fewest taps — worth checking
against what the Recruit phase charges for them.

- **gold** — events: The Garrison's Paychest `garrison_paychest` (+75). Raids: `destroy_detachment` (54 mean), `loot_supplies` (36 mean).
- **horses** — events: A Captured Herd `horses` → keep_the_herd (+25). Raids: `seize_horses` (18 mean).

