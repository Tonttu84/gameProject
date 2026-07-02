# Rendering Do-Over: Isometric Battle View

**Status:** PLAN. **Audience:** engine side (Claude Code / SFML).
**Companions:** `assets/sprites/ART_BRIEF.md` (what the art is), `assets/sprites/manifest.example.json`
(the art contract). This doc is how the engine consumes them.

The current renderer (`backend/render/src/BattleRenderer.cpp`) draws a flat, 90°-rotated pointy-top
hex grid with units as single `sf::Text` letters. We are replacing it wholesale with a **2:1
isometric** renderer that draws real terrain tiles and animated unit sprites. This is a rewrite of
the *view only* — the engine/simulation (`backend/engine/`) is untouched; the renderer still consumes
`HexGrid` + `AUnit` state read-only, exactly as the module boundary in CLAUDE.md requires.

---

## 1. What stays, what goes

**Goes:** the 90° view rotation (`initView`), `sf::Text` unit glyphs, `sf::Text` coord labels as the
primary display, terrain-as-flat-colored-`ConvexShape`, the `symF`/`drawUnit` letter path.

**Stays / reused:** `HexGrid` axial coords + `hexToPixel` as the *flat* basis we project from;
`grid.getHexSize()`; `Hex.terrain/elevation/impassable`; `HexSide.blocked/fortified`; the intra-hex
formation logic in `renderUnitsInHex` (fighters at engaged edges, support massed behind) — that
placement is good and just needs its output positions run through the iso transform instead of the
flat one. Keep a **letters fallback** (env var `BATTLE_RENDER=letters`) during the transition so we
can bisect regressions.

---

## 2. Isometric projection

Pointy-top axial hex `(q, r)` with integer `elevation`. Two-step: flat hex pixel → iso screen.

```
// flat basis: reuse HexGrid::hexToPixel(coord) -> (fx, fy)   (existing)
// iso squash + elevation lift:
screenX = fx
screenY = fy * ISO_SQUASH - elevation * ELEV_PX
```

- `ISO_SQUASH ≈ 0.60` gives the flattened 2:1-ish look; tune against the delivered `tile_*` art so a
  tile's on-screen height matches `projection.tileH` while its width matches `projection.tileW`.
- `ELEV_PX = projection.elevationStep` (16) — one elevation level lifts the tile up by one skirt.
- Screen scale: choose so one hex's flat width maps to `projection.tileW` px. Derive from
  `getHexSize()`; expose zoom via the existing mouse-wheel handler.
- No view rotation. Pan/zoom stay on the `sf::View`.

**Depth order (painter's algorithm).** Draw strictly back-to-front. Depth key per hex:

```
depth = (r * BIG + q) ;  // rows front-to-back; within a row, columns left-to-right
```

Sort all draw items (tiles, skirts, edge overlays, decals, units, props) by `(depth, layer)` where
`layer` orders things sharing a hex: `skirt < tile < decal < edge_overlay < prop_ground < unit <
prop_tall < fx`. This makes raised front terrain and tall props correctly occlude units behind them.
A single `std::vector<DrawItem>` built each frame, `std::stable_sort`, then draw, is simplest and
plenty fast for these grid sizes.

---

## 3. Terrain rendering

Per hex, back-to-front:

1. **Skirts (cliff faces).** For the front-facing directions (SW, and the two lower edges), if this
   hex's `elevation` exceeds the neighbor's (or the neighbor is off-grid), draw `skirt_rock` repeated
   `(elevation - neighborElevation)` times, stacked downward from the tile's lower edge. This is what
   turns elevation into visible cliffs/plateaus. `impassable` hexes render as a full rock column
   (`tile_impassable` top + skirts down to the base).
2. **Top-face tile.** `tile_<terrain>` (pick a `variants` index deterministically, e.g.
   `hash(q,r) % variants`, so the field is stable frame-to-frame but non-repeating). Anchor `[64,37]`
   at the projected hex center.
3. **Ground decals** (future): `decal_blood`/`decal_corpse`/`decal_zone` lie flat on the tile.
4. **Edge overlays.** For each of the 6 `HexSide`s: `edge_blocked` if `blocked` (or auto-cliff
   `|Δelev|>=2`), `edge_fortified` if `fortified`. Place at the edge midpoint, choose the piece
   orientation from the direction (NE/E/SE/SW/W/NW). Later these become the `prop_wall_*`/`prop_rampart`
   props anchored to the same edge.

The engine currently darkens terrain by elevation and blends a team tint into occupied hexes — with
real art, drop the darken (skirts convey height now) and, if desired, keep a *very* subtle team tint
on the tile or move team identity entirely onto the unit sprites (see §5). Terrain colors in
`TERRAIN_META` (HexGrid.hpp) stay the single source of truth and match the tile art (ART_BRIEF §5a).

---

## 4. Manifest + texture loading

New, self-contained in `backend/render/` (keep the engine trust boundary — this only reads asset
files shipped with the build):

- **`SpriteManifest`** — parse `assets/sprites/manifest.json` (reuse the bundled `nlohmann::json`).
  Struct per sprite: kind, texture handle, frame size, anchor, variant count, `map<string, Anim>`
  where `Anim{ row, frames, fps }`. Validate defensively (missing/short files → log + skip that
  sprite, never throw into the render loop).
- **`TextureCache`** — owns `sf::Texture`s keyed by file path; one texture per sheet (+ its `_mask`).
  Load once at renderer init.
- **`AnimatedSprite`** helper — holds a sprite key + current animation + a clock; `frameRect()` =
  `row * frameH` down, `(int(t*fps) % frames) * frameW` across. Sets origin to the manifest `anchor`.

**Team tinting (manifest `defaults.teamColor`):**
- `"mask"` (recommended): draw base sheet, then draw the `_mask` sheet at the same transform with
  `sprite.setColor(teamOrStatusColor)` and additive/multiply blend so only masked (white) pixels take
  color. Cleanest via a tiny fragment shader (`base.rgb + mask.r * tint`), or two draws with
  `sf::BlendAdd`. The existing status precedence still applies: casting → yellow, broken → orange,
  else squad-debug palette or team red/blue. Only the *mask* draw takes that color; the base is
  untouched.
- `"variants"`: pick `<key>_red` / `<key>_blue`; status shown via `fx_cast_glow`/`fx_routing` overlays.
- `"tint"`: `sprite.setColor` on the whole texture (today's behavior, lowest quality).

---

## 5. Units

- Map an `AUnit` to a manifest key. Cleanest: add a virtual `const char* AUnit::spriteKey() const`
  (override per class: Soldier→`"soldier"`, Cavalry→`"cavalry"`, …). This also fixes a latent gap —
  the decomposition states already flip `printSymbol` ('C'→'H' on rider death), so `spriteKey()`
  returns `"horse"` for a riderless Cavalry and `"soldier"` for a dismounted one, and the sprite swap
  is automatic (ART_BRIEF §3e). Fallback: a `switch` on `printSymbol` in the renderer (matches the
  existing `BattleServer.cpp:52` switch) if we don't want to touch the engine header yet.
- Position: reuse `renderUnitsInHex`'s formation math to get each unit's flat sub-position within the
  hex, then project through §2. Anchor the sprite by its feet (`anchor`) at that projected point.
- Animation state from unit flags: `getCast() != 0` → `attack`/cast; `getBroken()` → fleeing (`walk`);
  in an engaged hex and alive → `attack` cycling; otherwise `idle`. Death: when a unit disappears from
  a hex between frames, optionally play `death` + drop a `decal_corpse` (needs a small
  render-side "recently died" cache since the engine prunes dead in `cleanup()`).
- Size already scales in-engine (SIZE 10 vs 20); with real art, scale each sprite so its authored
  canvas maps to the intended on-tile footprint rather than re-deriving from `√(size/CAPACITY)`.

---

## 6. Migration order (incremental, each step shippable)

1. Land `assets/sprites/` (art + real `manifest.json`) and this plan. *(art dependency: claude.design)*
2. `SpriteManifest` + `TextureCache` + `AnimatedSprite`, unit-tested against the manifest — no render
   change yet.
3. Iso projection + terrain tiles + skirts, replacing the `ConvexShape` grid. Units still letters.
4. Swap unit letters → animated sprites at the `// SPRITE SWAP POINT` (BattleRenderer.cpp:216).
5. Edge overlays, decals, projectiles/FX (`arrow`, `fx_fireball`, …) tied to combat events.
6. Props (trees, fortifications) once §7 art lands — same `DrawItem`/depth pipeline, no new plumbing.

Keep `BATTLE_RENDER=letters` working through step 4 so CI/dev can compare.

---

## 7. Open decisions

- **Team color mode** — recommend `"mask"` (ART_BRIEF §0). Locks step 2/4 shader work.
- **Art style** — pixel vs painterly (ART_BRIEF §1). Doesn't affect engine code, only asset bytes.
- **Death corpses** — do we persist a `decal_corpse` where units die, or just fade? Affects the
  render-side death cache in §5.

None block starting steps 1–3; they only affect steps 4–5.
