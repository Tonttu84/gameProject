# Combat Design Document

Living design document. Sections marked **[PLANNED]** are not yet implemented.

---

## Unit sizes **[PLANNED]**

Human = size 10 is the anchor. Scaling is open-ended in both directions.

| Size | Examples |
|---|---|
| 1–3 | Insects, rats, tiny constructs |
| 10 | Humans, elves, dwarves, orcs |
| 15 | Large humans, half-giants |
| 20 | Cavalry (horse + rider as one unit) |
| 40 | Trolls, ogres, minotaurs |
| 60 | Giants |
| 100 | Smaller dragons, sea monsters |
| 150 | War elephants, greater demons |
| 300 | Avatars, large dragons |
| 1000+ | God manifestations |

---

## Hex grid **[PLANNED]**

**Coordinate system**: cube coordinates (q, r, s where q + r + s = 0).
Standard library for neighbor lookup, distance, rotation and line-of-sight.

**Orientation**: pointy-top hexes. Battle lines run east-west.

```
     /\
    /NW\NE      ← 2 front faces (toward enemy)
   |    |
   | E  W       ← 2 flank faces (touch friendly neighbors in line)
    \SW/SE
     \/          ← 2 rear faces
```

Every hex in a straight battle line has identical engagement geometry — no alternating
junction problem. The NW face maps 1-to-1 onto one enemy hex's SE face; NE maps onto
another enemy's SW face.

**Standard front engagement**: a hex in a battle line is simultaneously engaged through
both its NW and NE faces at once — one HexSide shared with the enemy-left hex, one with
the enemy-right hex. This is the normal state, not a special case.

```
        [Your Hex A]
       /             \
     NW               NE
    /                   \
─────────           ─────────
[Enemy B]  corner  [Enemy C]
─────────           ─────────
```

The corner point is where all three hexes meet. A unit can only advance through it if
both adjacent enemy hexes (B and C) are empty or routing — a contested corner is
impassable.

**Pushing through empty hexsides**: a unit may push through any empty hexside later,
making outflanking natural — if an enemy's E or W flank face is uncontested, friendly
units can advance through it to engage the hex from the side or rear. Design for later.

**Hex capacity**: 640 size-points.
- 64 humans (size 10) per hex at tight formation
- Larger creatures scale naturally: a size 640 entity fills the hex alone
- Creatures above ~size 640 use special multi-hex or boss rules (see Large Creatures below)

Hex borders are rendered visibly, especially during development.

---

## Hexside engagement model **[PLANNED]**

A hex has 6 sides. At any tick some sides are in contact with an enemy hex.

### Frontage

**Front rank width = 4 fighters per engaged hexside.**

A hex in a standard battle line has 2 front faces (NW and NE), giving 8 total front rank
fighters when engaged from the front. Both front faces draw from the same reserve pool
behind them.

Frontage of 4 is a deliberate compromise: small enough that a single hero or player
character is a meaningful fraction of the line, large enough to represent a real formation
front. Easy to tune later.

### Support ranks and weapon reach

Support rank fighters stand behind the front rank (always 100%, regardless of weapon —
reach only gates *support* ranks). Whether a support-rank fighter contributes damage
depends on comparing their weapon's reach directly against how many ranks back they stand
(support rank 1 = immediately behind the front rank, support rank 2 = two ranks back, ...):

- **reach > support rank**: full (100%) contribution.
- **reach == support rank**: half (50%) contribution — just long enough to land glancing
  blows past the ranks in front.
- **reach < support rank**: no direct damage contribution — too short to reach the fight.
  Still provides a push/morale benefit to the front rank (fatigue resistance in prolonged
  grinds), same idea as the old short-weapon case, just no longer a special case: it's
  what "reach < rank" always means.

This applies the same reach-vs-rank comparison as repel (see `AUnit::resolveRepel()`),
just without repel's stricter "strictly longer" requirement — support attacks allow the
boundary case at half strength instead of excluding it outright.

Ranged weapons (bow, crossbow) don't use this table at all — a loose formation's support
rank fires freely over the front rank at full effect; a tight formation blocks missile fire
through its own ranks entirely (see Loose/Tight below).

**By weapon reach** (reach scale per `WeaponList.hpp`: 0 natural, 1 short/one-handed,
2 two-handed, 3 spears, 4 pikes, 5 special/magical):

| Weapon reach | Front rank | Support 1 | Support 2 | Support 3 | Support 4 |
|---|---|---|---|---|---|
| 0 (natural) | 100% | — | — | — | — |
| 1 (short/one-handed) | 100% | 50% | — | — | — |
| 2 (two-handed) | 100% | 100% | 50% | — | — |
| 3 (spear) | 100% | 100% | 100% | 50% | — |
| 4 (pike) | 100% | 100% | 100% | 100% | 50% |
| 5 (special/magical) | 100% | 100% | 100% | 100% | 100% |

**Example — pike block (4 front rank + 3 support ranks of pikes, reach 4):**
100% + 100% + 100% + 100% = 400% of a single rank (no tapering within 3 ranks — a pike
reaches past all of them).
4 front rank positions × 4.0 = effectively ~16 fighters worth of damage output.

**Example — swordsmen (4 front rank + shortswords behind, reach 1):**
100% + 0% = 100%.
4 positions, no multiplier — support rank is push-only. But swordsmen have better
individual defence and armour, so they hold the line better against the pike block's
output.

### Effect of multiple engaged hexsides

Each new engaged hexside draws men from the formation's depth to form a new front rank.
Depth for the original sides decreases accordingly.

| Engaged hexsides | Depth available | Support rank bonus |
|---|---|---|
| 1 | Full | Full reach multiplier |
| 2 | Halved | Reduced multiplier |
| 3 | Minimal | Front rank only, morale penalty |
| 4+ | None | Full encirclement panic |

This makes flanking the natural counter to deep formations. A pike phalanx is devastating
from the front and catastrophically vulnerable from the side — pike shafts are useless at
close quarters when the enemy is already beside you.

### Player character in the front rank

A player character or hero placed in the front rank can personally engage up to 4 enemies
(one per front rank position). This is intentional — the front rank width of 4 means the
hero is always a meaningful fraction of the line rather than lost in a mob.

---

## Formation types **[PLANNED]**

### Tight (phalanx, shield wall, pike block, schiltron)
- Uses full 640 capacity (64 humans)
- Strong defence bonus on engaged hexsides
- Full support rank reach multiplier
- Cannot disengage freely — locked in until enemies retreat or formation breaks
- Cannot fire missile weapons through own ranks
- Flanking is catastrophic (depth nullified, weapons become a liability)

### Normal (standard infantry line)
- ~400 capacity (40 humans)
- No formation bonuses or penalties
- Can rotate to face new threats

### Loose (skirmishers, light infantry, warbands)
- ~200 capacity (20 humans)
- Missile weapons fire freely from support rank
- Faster movement, can disengage
- No push bonus, no depth advantage
- **Compression**: if forced to fall back into an already-occupied hex, the formation
  compresses toward tight — wrong spacing, wrong weapons, wrong mindset. Morale and
  cohesion penalties until it stabilises or breaks.

---

## Cavalry **[PLANNED]**

Cavalry uses a charge cycle rather than static formation logic.

```
READY ──(3+ hexes clear run)──► CHARGING ──(contact)──► ENGAGED
  ▲                                                          │
  └──(N ticks no contact)──── DISENGAGING ◄─────────────────┘
```

- **READY**: lances set, full charge bonus available
- **CHARGING**: the approach tick — massive impact hit, high morale damage, ignores light armour
- **ENGAGED**: lost lance advantage, worse than infantry in prolonged melee. Actively seeks exit
- **DISENGAGING**: moving away, no combat. Lances reset after N ticks, returns to READY

**AI rules:**
- Will charge loose/skirmish formations and isolated units freely
- Will NOT charge tight formation hexes with pikes or spears (historically the whole point
  of pike squares was to stop cavalry)
- Requires a clear exit lane before committing — will not charge into a pocket
- Light cavalry variant: never enters ENGAGED, maintains 2-hex standoff and fires,
  always disengaging if an enemy closes

---

## Large creatures **[PLANNED]**

Creatures at size 640 or below fit entirely within one hex. Creatures above that use
special engagement rules rather than multi-hex presence (multi-hex is a later feature).

**Body part abstraction**: large creatures treat their body parts as front rank and
support rank contributors, mapped to the same weapon reach model.

| Body part | Role | Weapon class equivalent |
|---|---|---|
| Claws, bite, horns | Front rank | Short–medium (reach limited) |
| Tail | Support rank 1 | Long (sweeping reach) |
| Breath weapon | Support rank 1–2 | Ranged (if applicable) |
| Stomp, body slam | Front rank (special) | — |

A dragon fighting from one hexside: claws/bite at the front, tail attacking over its own
body at support rank 1. This maps cleanly onto the standard reach model without special
casing.

As with a human formation, being engaged on multiple hexsides degrades a large creature's
effective depth — more of its body is occupied with immediate threats, fewer parts can
provide support attacks.

---

## Scale **[PLANNED]**

At 64 humans per hex, a Roman century (~80 men) occupies roughly 1–2 hexes.
A playable battle group of 20–30 hexes represents ~1,000–2,000 men.

For larger historical battles (tens of thousands), the tactical layer handles the decisive
engagement while the rest of the battle resolves as an abstracted strategic simulation
feeding morale and reserve results back into the tactical layer.

---

## Future features (not yet designed)

- **Hero / commander**: unit in a hex providing rally, morale aura, personal combat
- **Banner / standard**: magical or mundane; provides hex-wide bonus
- **Multi-hex creatures**: true size 1000+ entities spanning several hexes with
  independent hexside engagement per body section
- **Formation rotation**: facing direction tracked per hex, flanking defined relative
  to facing rather than just "number of engaged sides"

---

## Scope note: this document is the BATTLE layer

Everything above designs the tactical battle (hexes, frontage, formations, cavalry) — the C++
engine's domain. The **strategic campaign layer** is designed elsewhere:

- **`docs/CAMPAIGN_PLAN.md` → "Standing design principles"** — durable constraints that bind all
  future campaign work. Read that section before designing a campaign feature.
- The same file's stage write-ups carry the per-feature design and the reasoning behind it.

The most load-bearing of those principles, repeated here because it is the one most likely to be
violated by accident: **the enemy is an abstract challenge, not an opponent.** The shadowing host
has no behaviour, no AI and no reactions — it is a pressure the player pushes against, whose
numbers answer arithmetic rather than decisions. "The enemy reacts to X" is out of scope by
design, not a gap. (This is why `enemy.stance` was deleted in v19 and why `enemyAi.js` was
renamed `enemyHost.js`.) Note this constrains the CAMPAIGN layer only — in-battle units of course
have tactical behaviour, which is what the rest of this document describes.
