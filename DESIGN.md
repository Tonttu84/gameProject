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

**Corner rule**: a unit can only advance through the corner point between NW and NE if
both adjacent enemy hexes are empty or routing. A contested corner is impassable.

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

Support rank fighters stand behind the front rank. Whether they contribute damage depends
entirely on whether their weapon is long enough to reach past the man in front.

| Weapon class | Front rank | Support rank 1 | Support rank 2 | Support rank 3+ |
|---|---|---|---|---|
| Short (dagger, axe, shortsword) | 100% | morale/push only | — | — |
| Medium (longsword, 1h spear) | 100% | ~30% | — | — |
| Long (pike, halberd, 2h spear) | 100% | ~60% | ~40% | ~20% |
| Ranged (bow, crossbow) | — | 100% (loose only) | reduced | — |

**Push** (short weapons in support): no direct damage contribution but improves front rank
morale and fatigue resistance. Matters in prolonged grinds.

**Example — pike block (4 front rank + 3 support ranks of pikes):**
100% + 60% + 40% + 20% = 220% of a single rank.
4 front rank positions × 2.2 = effectively ~9 fighters worth of damage output.

**Example — swordsmen (4 front rank + swordsmen behind):**
100% + 0% = 100%.
4 positions, no multiplier. But swordsmen have better individual defence and armour,
so they hold the line better against the pike block's output.

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
