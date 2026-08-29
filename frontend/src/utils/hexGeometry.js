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
