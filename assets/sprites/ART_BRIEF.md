# Sprite & Terrain Art Brief — for claude.design

**Audience:** claude.design (art generation).
**Companion files:**
- `manifest.example.json` — the machine-readable contract you fill in and ship alongside the PNGs.
- `../../docs/RENDERING_PLAN.md` — how the C++/SFML engine will consume all of this (for context; you don't need to act on it).

This document is the single source of truth for *what to draw*. The engine team (Claude Code)
reads `manifest.json` + these PNGs and wires up `sf::Texture`/`sf::Sprite` deterministically — it
never guesses filenames, sizes, or frame counts. Keep the manifest and the PNGs in lockstep.

---

## 0. The one open decision (please confirm before drawing the full set)

**Team color strategy.** Every unit belongs to team **Red** (team 1) or **Blue** (team 2), and
the engine also flashes units for status (casting = yellow glow, routing/broken = orange). We need
red/blue to read instantly on a busy battlefield. Three ways to deliver this — **we recommend A**:

| | What you deliver | Pros | Cons |
|---|---|---|---|
| **A. Neutral base + team-mask** ✅ | One full-color, team-neutral sprite per frame **plus** a matching grayscale `_mask` sheet where **white = recolor this pixel, black = leave alone**. Mask covers cape/plume/shield/banner/barding only. | One canonical silhouette → perfect style consistency; ~1× art; engine tints only the mask so team + casting + routing all keep working. | You author a mask layer per sheet (cheap — it's a flat selection). |
| **B. Two full variants** | A `_red` and a `_blue` fully-painted version of every frame. | Zero engine tint logic; looks great. | ~2× the art; status tints need separate handling; palette tweaks touch both sets. |
| **C. Single neutral, tint whole sprite** | One sprite; engine multiplies the entire texture by team color. | Simplest handoff. | Full-texture multiply muddies detailed art and washes out color. Not recommended at 64–128px. |

Default assumption if you don't hear back: **A**. The manifest field `defaults.teamColor` records
the chosen mode (`"mask"` / `"variants"` / `"tint"`).

---

## 1. Rendering context — read this first, it drives everything

The battle view is being rebuilt as **isometric** (2:1 dimetric, the classic tactics look —
think *Final Fantasy Tactics* / *Battle for Wesnoth* staged in true iso). This changes how art
must be authored:

- **Units are upright billboards.** Draw each character standing, in a **3/4 top-down view facing
  down-screen toward the camera** (we see their front). The engine anchors them by the **feet** and
  sorts them back-to-front. Do **not** pre-rotate or pre-skew unit art — units stay screen-upright;
  only terrain is projected into the iso plane.
- **Terrain tiles ARE drawn in iso.** Tile top-faces are flattened hexagons (2:1). Elevation is
  shown by extruding the hex downward — you provide the top face and the vertical "skirt" (cliff
  face) as separate pieces so the engine can stack them for any height.
- **One consistent light source: top-left, slightly high.** Every sprite, tile, and future prop must
  be lit the same way or the scene falls apart. Soft ambient fill, warm key. Shadows fall
  down-right. Give each unit a soft contact shadow ellipse baked at its feet (or as a separate
  `_shadow` — see §6).
- **Readable silhouettes + a subtle dark contour** (1–2px) so units pop against noisy terrain when
  small on screen.

**Style recommendation (adjustable):** high-resolution **pixel art** with a chunky 2–3px "pixel"
and a cohesive ~32-color medieval-fantasy palette — crafted but detailed enough to reward the 64/128
canvas. If you'd rather go hand-painted/painterly at these sizes, that's fine too — **pick one and
lock a shared palette**, then everything (units, terrain, future props) must match it. Confirm the
style choice with the palette swatch in your first delivery so we lock it before the full run.

---

## 2. Canvas sizes — detail scales with unit size

The engine already renders bigger creatures physically larger (a SIZE-20 mount draws ~1.4× a SIZE-10
footman). So bigger units get **more canvas and more detail**:

| Class | Engine SIZE | Frame canvas | Character occupies | Notes |
|---|---|---|---|---|
| Foot (human & undead) | 10 | **64 × 64** | ~40–48px tall, centered, feet near bottom | Soldier, Archer, Mage, Priest, Necromancer, Zombie, Skeleton |
| Mounted composite | 20 | **128 × 128** | tall — horse body + rider fills most of it | Cavalry, Templar Rider, (Scorpion Rider) |
| Large beast / mount alone | 20 | **128 × 96** | wide & low | Scorpion, riderless Horse/Warhorse |
| Terrain top-face tile | — | **128 × 74** | hexagon fills the box edge-to-edge | see §5 |
| Elevation skirt (cliff) | — | **128 × 24** | one 16px-high step of side face | tileable vertically |
| Projectiles / FX | — | **32 × 32** or **64 × 64** | see §4 | |

Power-of-two frames where possible (64, 128, 32). Transparent background (straight alpha).
The **anchor** (feet / center-bottom for units, hex center for tiles) is recorded per-sprite in the
manifest — that's the pixel the engine pins to the tile.

---

## 3. Unit roster — every sprite we need

Each unit ships as **one sprite sheet** containing all its animations (rows), **plus** a parallel
`_mask` sheet (if team mode A). One texture per unit keeps SFML fast.

### Animation rig (standard for every unit)

The reference game uses 2 poses per unit (idle + attack). You asked us to over-request now so the
style is locked in one pass rather than re-commissioned later — so the **standard rig is richer**.
Draw them all in a single sitting for consistency; priority is marked so you can sequence work:

| Row | Animation | Frames | fps | Priority | Notes |
|---|---|---|---|---|---|
| 0 | `idle` | 2 | 3 | **must** | gentle breathing/bob; the resting pose |
| 1 | `walk` | 4 | 8 | should | units cross hexes; a 2-frame shuffle is acceptable if 4 is too much |
| 2 | `attack` | 3 | 10 | **must** | windup → strike → recover. For ranged/casters this is the shoot/cast motion |
| 3 | `death` | 2 | 6 | should | fall → corpse/settle; last frame may linger briefly before cleanup |

Lay each animation out as a **horizontal strip** (frames left→right), animations **stacked as rows**
top→bottom. All frames the same `frameW × frameH`. Record exact `frames`/`fps`/`row` per animation in
the manifest — the table above is the default, deviate freely and just reflect it there.

### 3a. Human foot — 64×64 (`kind: unit`, SIZE 10)

| Key | Name | Read as | Attack = |
|---|---|---|---|
| `soldier` | Soldier | Heavy infantry: helm, sword, kite shield | melee swing |
| `archer` | Archer | Light leather, longbow, quiver | draw & loose (spawns `arrow`) |
| `mage` | Mage | Robed, staff, arcane | cast (spawns `fx_fireball`) |
| `priest` | Priest | Robed, holy symbol, radiant | cast-in-place (spawns `fx_bless` on an ally, no projectile) |
| `necromancer` | Necromancer | Dark robe, skull-topped staff, sickly green | raise-dead cast (spawns `fx_raise` on the ground) |

### 3b. Undead foot — 64×64 (`kind: unit`, SIZE 10)

These are **summoned mid-battle** by the Necromancer and vanish when the battle ends, but they are
fully visible while alive — full rig required.

| Key | Name | Read as |
|---|---|---|
| `zombie` | Zombie | Shambling rotted corpse; slow, lurching attack |
| `skeleton` | Skeleton | Bone warrior, rusty blade/shield |

### 3c. Mounts & large creatures — 128×96 wide (`kind: unit`, SIZE 20)

| Key | Name | Read as | Note |
|---|---|---|---|
| `horse` | Horse (riderless) | A plain horse, no rider, **panicked/fleeing** | This is the "lost its rider" state of a Cavalry — see §3e. Idle = spooked; walk = bolting |
| `warhorse` | Warhorse (riderless) | Barded/armored horse, riderless | Loose state of a Templar Rider; may reuse `horse` rig with armor if cheaper — tell us in the manifest |
| `scorpion` | Scorpion | Large desert beast, armored carapace, **long segmented stinger tail** | The tail is its reach weapon — make it prominent. Wide, low stance |

### 3d. Mounted composites — 128×128 tall (`kind: unit`, SIZE 20)

**A mounted unit is a single sprite showing rider + mount together** — one combined image, its own
sheet, but drawn so the rider clearly reads as the *same* soldier art riding the *same* mount art
(style continuity, see §3e). The rider faces down-screen; the mount is broadside-ish so the animal
reads.

| Key | Name | Composition | Attack = |
|---|---|---|---|
| `cavalry` | Cavalry | `soldier` rider on a plain `horse` | rider melee swing (+ optional hoof) |
| `templar_rider` | Templar Rider | `soldier` rider on an armored `warhorse` (barding, heraldry) | rider melee swing + hoof |
| `scorpion_rider` | Scorpion Rider *(planned/optional)* | rider on a `scorpion` (stinger reach) | rider strike + tail sting |

`scorpion_rider` is **optional for the first drop** — but if you're drawing the scorpion anyway,
doing the rider version now keeps the style matched. Mark it `"planned": true` in the manifest if
you defer it.

### 3e. Decomposition states — why continuity matters

When a mounted unit loses a part mid-battle it visually **decomposes into its components**, so the
composite art must be built from the same soldier + mount you draw standalone:

- Cavalry **loses its mount** → becomes a dismounted **`soldier`** standing in place (reuses 3a).
- Cavalry **loses its rider** → becomes a riderless, bolting **`horse`** (reuses 3c).

So: the soldier on top of `cavalry` should look like `soldier`, and the horse under it like `horse`.
Same for `templar_rider` → `soldier` + `warhorse`. No new art for the decomposed states — just make
the composite from matching parts.

---

## 4. Projectiles & effects (`kind: projectile` / `kind: fx`)

Small, on a transparent field. The engine positions/rotates them.

| Key | kind | Canvas | Frames | Notes |
|---|---|---|---|---|
| `arrow` | projectile | 32×32 | 1 | drawn pointing **right (east, +x)**; engine rotates to flight angle |
| `fx_fireball` | projectile | 32×32 | 2 | traveling flame, flickers between the 2 frames |
| `fx_fireball_impact` | fx | 64×64 | 3–4 | burst on hit, plays once |
| `fx_bless` | fx | 64×64 | 3 | Priest's radiant heal/blessing, plays once over the target |
| `fx_raise` | fx | 64×64 | 3 | Necromancer's ground eruption under a newly raised undead |
| `fx_hit` | fx | 32×32 | 2–3 | generic melee impact spark / small blood puff |

**Status FX (optional — engine can fall back to a color tint):**

| Key | kind | Canvas | Frames | Notes |
|---|---|---|---|---|
| `fx_cast_glow` | fx | 64×64 | 2 (loop) | soft ring/aura under a unit while it's casting (currently shown as a yellow flash) |
| `fx_routing` | fx | 64×64 | 2 (loop) | panic/rout marker over a broken, fleeing unit (currently orange) |

---

## 5. Terrain — isometric hex tiles

Terrain is the biggest new surface. It's modular so we can stack elevation and drop props later.

### 5a. Top-face tiles (`kind: tile`, 128 × 74)

The walkable surface of a hex, drawn as a flat pointy-top hexagon **filling the 128×74 box to its
edges** so neighboring tiles tessellate seamlessly (we'll send a tessellation test image to verify
edge alignment; keep the hexagon centered and edge-accurate). Anchor = hex center `[64, 37]`.

| Key | TerrainType | Base color (from engine) | Read as |
|---|---|---|---|
| `tile_open` | Open | `#5A6441` (90,100,65) | grass / open field |
| `tile_forest` | Forest | `#378228` (55,130,40) | forest floor / undergrowth — **trees are separate props (§7), the tile is just the ground** |
| `tile_marsh` | Marsh | `#286E73` (40,110,115) | murky water / mud |
| `tile_rubble` | Rubble | `#786446` (120,100,70) | broken stone, debris |
| `tile_impassable` | (impassable flag) | `#554B5F` (85,75,95) | sheer rock / deep water — nothing may stand here |

Provide **2–3 variants** per terrain (`variants` in the manifest) so a field of the same terrain
doesn't visibly repeat. Tint the art around the base color above but you own the final look; the
engine currently also **darkens by elevation** (higher = we may skip that once real art lands).

### 5b. Elevation skirts / cliff faces (`kind: skirt`, 128 × 24)

When a hex sits higher than the neighbor in front of it, the engine draws the exposed **side face(s)**
below the top tile. Deliver one **16px-high step** of vertical cliff face, horizontally aligned to the
tile, **tileable vertically** so multiple elevation steps stack cleanly (elevation ranges 0–3).

| Key | Used for |
|---|---|
| `skirt_rock` | generic exposed rock/dirt cliff face (works under any terrain) |
| `skirt_grass` *(optional)* | grassy-topped dirt face, for Open tiles specifically |

### 5c. Hexside overlays (`kind: overlay`)

Individual **hex edges** carry two flags the engine draws today as colored lines; give them real art
(sitting on one edge of the hexagon, matching iso perspective — think a short segment of the hex rim):

| Key | Flag | Read as |
|---|---|---|
| `edge_blocked` | `HexSide.blocked` (cliff/wall; auto when elevation differs by ≥2) | impassable barrier along that edge |
| `edge_fortified` | `HexSide.fortified` | a defensive work — low rampart/palisade (this is the seed of §7 fortifications) |

Provide these for **one canonical edge orientation**; the engine will place/mirror per direction
(6 sides: NE, E, SE, SW, W, NW). If a single mirrored piece won't read from all 6 angles, tell us and
we'll spec per-direction pieces.

---

## 6. Shadows & anchoring

- Every unit needs a **soft contact shadow** so it sits on the ground. Bake a faint ellipse into the
  bottom of the unit frame **or** deliver a separate `_shadow` sprite (say so in the manifest via a
  `shadow` field). Baked-in is simpler and preferred unless you want dynamic shadow scaling.
- The **anchor** pixel = where the unit's feet meet the ground = the point the engine pins to the hex
  center. For a 64×64 foot unit standing with feet near the bottom, anchor ≈ `[32, 60]`. For a
  128×128 mount, the hooves' midpoint, e.g. `[64, 120]`. Record the real value per sprite.

---

## 7. Future graphics — draw them in THIS batch

These aren't wired into the engine yet, but **draw them now, in the same sitting as everything
above.** A prop drawn six months later in a slightly different hand never quite matches; batching the
whole world in one style/palette/light pass is the single biggest thing that makes an isometric scene
read as one coherent place. Treat this as a real part of the commission, not a "someday" list.

All of these follow the **prop convention** (`kind: "prop"` in the manifest): transparent,
screen-upright billboard, bottom-center anchor, top-left light, baked contact shadow — same as units.
Props anchored to a hex **edge** (walls, gates) anchor at the edge midpoint instead of the center.
Give a `variants` count wherever repetition would show.

### 7a. Vegetation & scatter (stand on tiles)
- **Trees** — the payload for Forest hexes. At least: `prop_tree_pine`, `prop_tree_oak`,
  `prop_tree_dead` (bare/blighted, pairs with undead/necromancer themes). 2–3 variants each.
- **Bushes / shrubs** — `prop_bush`, low undergrowth for Forest/Open edges.
- **Rocks / boulders** — `prop_rock_small`, `prop_rock_large`, for Rubble and mountain flavor.
- **Reeds / lilies** — `prop_reeds`, marsh dressing for `tile_marsh`.
- **Stumps / logs / grass tufts** — `prop_stump`, `prop_grass_tuft`, cheap ground scatter.

### 7b. Fortifications (the big future feature — anchor to hex edges/tiles)
`edge_fortified` (§5c) is the seed; the full set:
- **Walls** — `prop_wall_stone`, `prop_wall_wood` (palisade). A straight segment sitting on one hex
  edge, in iso, plus a **corner/junction** piece if a single segment won't turn cleanly.
- **Gate** — `prop_gate` (closed) — an openable version can come later.
- **Rampart / earthwork** — `prop_rampart` (low defensive bank, the "fortified" look).
- **Tower** — `prop_tower`, stands on a tile, taller than a unit (occludes — the iso sort handles it).
- **Banners / standards** — `prop_banner` on a tile or wall; **team-tintable** (give it a `_mask`
  like units so it flies red or blue).

### 7c. Ground decals & battlefield aftermath (flat on the tile, drawn under units)
These are `kind: "decal"` — no billboard, they lie flat in the iso plane like a tile overlay:
- **Corpse / bones** — `decal_corpse`, `decal_bones`; where the dead settle after `death`.
- **Blood / scorch** — `decal_blood`, `decal_scorch` (fireball aftermath), `decal_crater`.
- **Deployment-zone marker** — `decal_zone` (subtle, tintable) to shade the player/enemy setup rows.

### 7d. A bit more combat FX variety (cheap while you're in the FX mindset)
- **Bigger spell hits** — `fx_explosion_large` (64–96px) for future AoE.
- **Buff/debuff auras** — `fx_shield` (defensive buff), `fx_curse` (necro debuff) — loopable rings
  like `fx_cast_glow`.
- **Muzzle/loose puffs** — `fx_arrow_loose` at the bow, `fx_cast_spark` at a staff tip.

If any of these balloon the batch beyond what's reasonable, mark them `"planned": true` and prioritize
7b (fortifications) and 7a (trees) — those are the confirmed next features. But the whole point of the
ask is: **the more of this you can knock out in one style-locked pass, the better it all fits.**

---

### 7e. Extended creature library — draw the whole bestiary in this pass

We want a **large reusable creature library** for future content, commissioned now so the whole
roster shares one hand. None of these are wired into the engine yet — all `kind:"unit"`,
`"planned": true`. The key rule, same as the current units: **canvas and detail scale with the
creature's physical size.** Use these size tiers (the engine `SIZE` is a planning estimate; anchor is
feet/base-center):

| Tier | Engine SIZE (est.) | Canvas | Examples |
|---|---|---|---|
| Small | ~5–10 | 64 × 64 | nymph, sprite, imp, small summons |
| Medium | ~10–20 | 96 × 96 | lizardman, ghoul, wolf, harpy |
| Large | ~20–30 | 128 × 128 | centaur, chariot, minotaur, bear |
| Huge | ~30–60 | 160 × 160 | troll, ogre, treant, wyvern |
| Giant | ~60–100 | 192 × 192 | giant, cyclops, hydra |
| Colossal | ~100+ | 256 × 192 | dragon (winged, wide), behemoth |

Same standard rig (idle/walk/attack/death), same team-mask layer where the creature has cloth/
heraldry (many beasts won't need one — omit `mask` then). Suggested first library (expand freely):

- **Humanoid monsters:** `lizardman`, `orc`, `goblin`, `minotaur`, `troll`, `ogre`, `cyclops`, `giant`.
- **Beasts & mounts:** `wolf`, `bear`, `boar`, `centaur`, `chariot` (2-horse + driver, wide),
  `wyvern`, `dragon`, `hydra`, `basilisk`.
- **Fey / nature:** `nymph`, `dryad`, `treant`, `sprite`, `pixie`.
- **Summons / conjured:** `imp`, `demon`, `elemental_fire`, `elemental_earth`, `elemental_water`,
  `air_elemental`, `golem_stone`, `wisp` (these pair with Mage/Necromancer/Priest summon mechanics).
- **Undead (extends §3b):** `ghoul`, `wraith`, `lich`, `bone_dragon`, `skeleton_archer`.

Chariots and multi-creature units follow the **composite rule** (§3d/§3e): draw as one sprite but
built from parts that match their standalone versions where those exist (a chariot's horses read like
`horse`, its driver like a `soldier`), so future decomposition/damage states stay seamless.

Mark anything you defer `"planned": true` with a best-guess canvas; we'll only pull a creature into
the manifest+engine when its mechanics are built. Prioritize breadth of silhouettes over polish on
the speculative ones — the point is a **style-locked bestiary** we can draw from for years.

## 8. Deliverable checklist

Drop a single folder (we'll place it at `assets/sprites/`) containing:

1. **`manifest.json`** — every sprite keyed as in `manifest.example.json`, with real `frameW/frameH`,
   `anchor`, per-animation `frames/fps/row`, `variants`, and the chosen `defaults.teamColor`.
2. **`units/*.png`** — one sheet per unit (§3) + parallel `_mask.png` if team mode A.
3. **`fx/*.png`** — projectiles & effects (§4).
4. **`terrain/*.png`** — top-face tiles (+variants), skirts, edge overlays (§5).
5. **A palette swatch + one finished `soldier` sheet first**, so we can lock style/palette/team-color
   before you run the full roster. Cheap insurance against a mismatch across 15+ sheets.

Filenames and pixel dimensions in `manifest.json` are the contract — as long as those match the PNGs,
the engine wires everything up automatically.
