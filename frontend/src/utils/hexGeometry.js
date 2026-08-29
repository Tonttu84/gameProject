// The hex field's LAYOUT — the one place that knows how a (col, row) becomes a
// point on an SVG, and how the engine's axial coordinates map onto that grid.
//
// Extracted 2026-08-29 (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE", SB-4),
// doing what ReplayView.jsx's own comment had been asking for since it was
// written: *"Same geometry as HexGrid.jsx (kept in sync — extract if a third
// user appears)"*. The battle lab is that third user, and three hand-synced
// copies of a coordinate transform is two too many — a drift between them would
// show up as units drawn on the wrong hexes in one screen and not the others,
// which is exactly the kind of bug nobody thinks to look for in a `toOffset`.
//
// WHAT BELONGS HERE IS LAYOUT, NEVER RULES. Who may stand where, what a zone
// means, which hexes a wall defends — those live with the screen (or the
// server) that owns the question. This module knows only where things are
// DRAWN, which is why it can be shared by a deployment grid, a replay and a
// lab without any of them having to agree about anything else.

export const HEX_SIZE = 20
export const SQRT3 = Math.sqrt(3)

// row → x (left-to-right), col → y (top-to-bottom) so the map matches combat
// orientation: the two armies face each other across the screen's width.
export const hexCenter = (col, row) => ({
  x: HEX_SIZE * 1.5 * row + HEX_SIZE,
  y: HEX_SIZE * SQRT3 * (col + 0.5 * (row % 2)) + HEX_SIZE,
})

export const hexPoints = (cx, cy) => {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

// visual offset (col, row) → axial (q, r), the engine's own convention
export const toAxial = (col, row) => ({ q: col - Math.floor(row / 2), r: row })
// axial (q, r) → visual offset (col, row) — the exact inverse
export const toOffset = (q, r) => ({ col: q + Math.floor(r / 2), row: r })

// The canvas a whole grid needs. Both dimensions swap width and height on
// purpose — the axis transpose above is why — and every caller was computing
// the same two expressions from the same `info.grid`.
export const svgSize = (grid) => ({
  width: Math.ceil(HEX_SIZE * 1.5 * grid.height + HEX_SIZE * 2),
  height: Math.ceil(HEX_SIZE * SQRT3 * (grid.width + 0.5) + HEX_SIZE * 2),
})

// Engine hexside direction → axial neighbor offset (mirrors HexGrid.cpp DQ/DR).
export const DIR_OFFSET = {
  NE: [1, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [0, -1],
}

// A fortified side {q, r, dir} draws a rampart on the edge SHARED between the
// defended hex and its neighbor in `dir`. That edge is the perpendicular
// bisector of the two hex centers — computing it from the centers avoids having
// to reason about vertex order under the row→x / col→y axis swap.
//
// MOVED HERE 2026-08-29 (S4), doing what S1's own note said it would: this
// stayed in HexGrid while it had exactly one user, and the lab's wall painting
// is the second. LAYOUT only, as SB-4 drew that line — WHERE an edge is drawn,
// never who may wall it or what a wall does when it is hit. An unknown
// direction returns null and the caller draws nothing, which is how a map file
// carrying a typo still renders.
export const wallSegment = (q, r, dir) => {
  const off = DIR_OFFSET[dir]
  if (!off) return null
  const a = toOffset(q, r)
  const nb = toOffset(q + off[0], r + off[1])
  const c = hexCenter(a.col, a.row)
  const n = hexCenter(nb.col, nb.row)
  const mx = (c.x + n.x) / 2
  const my = (c.y + n.y) / 2
  const dx = n.x - c.x
  const dy = n.y - c.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len // unit perpendicular
  const py = dx / len
  const half = HEX_SIZE * 0.5 // hex edge length ≈ HEX_SIZE
  return { x1: mx - px * half, y1: my - py * half, x2: mx + px * half, y2: my + py * half }
}
