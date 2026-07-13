import React, { useState, useMemo } from 'react'
import ReachMenu from './ReachMenu'

const HEX_SIZE = 20
const SQRT3 = Math.sqrt(3)

// row → x (left-to-right), col → y (top-to-bottom) so the map matches combat orientation.
const hexCenter = (col, row) => ({
  x: HEX_SIZE * 1.5 * row + HEX_SIZE,
  y: HEX_SIZE * SQRT3 * (col + 0.5 * (row % 2)) + HEX_SIZE,
})

const hexPoints = (cx, cy) => {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

// visual offset (col, row) → axial (q, r)
const toAxial = (col, row) => ({ q: col - Math.floor(row / 2), r: row })
// axial (q, r) → visual offset (col, row)
const toOffset = (q, r) => ({ col: q + Math.floor(r / 2), row: r })

// Engine hexside direction → axial neighbor offset (mirrors HexGrid.cpp DQ/DR).
const DIR_OFFSET = {
  NE: [1, -1], E: [1, 0], SE: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [0, -1],
}

// A fortified side {q, r, dir} draws a rampart on the edge SHARED between the
// defended hex and its neighbor in `dir`. That edge is the perpendicular
// bisector of the two hex centers — computing it from the centers avoids having
// to reason about vertex order under the row→x / col→y axis swap.
const wallSegment = (q, r, dir) => {
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

// blend a hex color string with an RGB overlay
const blendColor = (hex, oR, oG, oB, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const nr = Math.round(r * (1 - alpha) + oR * alpha)
  const ng = Math.round(g * (1 - alpha) + oG * alpha)
  const nb = Math.round(b * (1 - alpha) + oB * alpha)
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
}

const HexGrid = ({
  info, map, placements, onPlacementsChange, roster, disabled, fortifiedSides = [],
  squads = [], squadPlacements = {}, onSquadPlacementsChange,
}) => {
  const [selectedHex, setSelectedHex] = useState(null)

  const { grid, playerZone, enemyZone } = info

  const svgW = Math.ceil(HEX_SIZE * 1.5 * grid.height + HEX_SIZE * 2)
  const svgH = Math.ceil(HEX_SIZE * SQRT3 * (grid.width + 0.5) + HEX_SIZE * 2)

  // axial coord → hex entry from map JSON (only non-default hexes are present)
  const terrainByAxial = useMemo(() => {
    const m = {}
    map?.hexes?.forEach(h => { m[`${h.q},${h.r}`] = h })
    return m
  }, [map])

  // terrain name → hex color string from /api/info
  const terrainColorMap = useMemo(() => {
    const m = {}
    info.terrain.forEach(t => { m[t.name] = t.color })
    return m
  }, [info.terrain])

  const getHexData = (col, row) => {
    const { q, r } = toAxial(col, row)
    return terrainByAxial[`${q},${r}`] ?? { terrain: 'Open', impassable: false }
  }

  const inPlayerZone = (row) => row >= playerZone.rowMin && row <= playerZone.rowMax
  const inEnemyZone  = (row) => row >= enemyZone.rowMin  && row <= enemyZone.rowMax

  const placementsAt = (col, row) => placements.filter(p => p.col === col && p.row === row)

  // Catalog types the player has none of are not placement options. A type with
  // placements but a zero roster (e.g. after reassigning to forage) stays visible
  // so those placements can still be edited or cleared.
  const ownedUnits = info.units.filter(u =>
    (roster[u.type] ?? 0) > 0 || placements.some(p => p.type === u.type)
  )

  // Roster remaining after subtracting units placed on every hex OTHER than (col,row).
  const rosterForHex = (col, row) => {
    const remaining = { ...roster }
    placements.forEach(p => {
      if (p.col === col && p.row === row) return
      remaining[p.type] = Math.max(0, (remaining[p.type] ?? 0) - p.count)
    })
    return remaining
  }

  const handleHexClick = (col, row) => {
    if (disabled || !inPlayerZone(row)) return
    if (getHexData(col, row).impassable) return
    setSelectedHex(prev =>
      prev && prev.col === col && prev.row === row ? null : { col, row }
    )
  }

  const handlePlace = (col, row, type, count, holdTurns = 0) => {
    onPlacementsChange(prev => {
      const filtered = prev.filter(p => !(p.col === col && p.row === row && p.type === type))
      if (count > 0) return [...filtered, { type, col, row, count, holdTurns }]
      return filtered
    })
  }

  // Squads are atomic: one placement (whole formation on one hex) and one
  // hold order, applied immediately rather than staged behind a commit
  // button — there's no per-type quantity to type, just where and how long.
  const handlePlaceSquad = (col, row, squadId, squadName, holdTurns = 0) => {
    onSquadPlacementsChange(prev => ({ ...prev, [squadId]: { col, row, holdTurns, squadName } }))
  }
  const handleRemoveSquad = (squadId) => {
    onSquadPlacementsChange(prev => {
      const { [squadId]: _removed, ...rest } = prev
      return rest
    })
  }

  const squadsAt = (col, row) =>
    squads.filter(sq => squadPlacements[sq.id]?.col === col && squadPlacements[sq.id]?.row === row)

  const hexElements = []
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { x, y } = hexCenter(col, row)
      const inPlayer   = inPlayerZone(row)
      const inEnemy    = inEnemyZone(row)
      const isSelected = selectedHex?.col === col && selectedHex?.row === row
      const stack      = placementsAt(col, row)
      const hexSquads  = squadsAt(col, row)
      const hexData    = getHexData(col, row)
      const baseColor  = terrainColorMap[hexData.terrain] ?? '#5a6441'

      let fill
      if (hexData.impassable) {
        fill = '#1a1a1a'
      } else if (inPlayer) {
        fill = baseColor
      } else if (inEnemy) {
        fill = blendColor(baseColor, 60, 0, 0, 0.5)
      } else {
        fill = blendColor(baseColor, 0, 0, 0, 0.45)
      }

      hexElements.push(
        <g
          key={`${col}-${row}`}
          data-testid={`hex-${col}-${row}`}
          data-zone={inPlayer ? 'player' : inEnemy ? 'enemy' : undefined}
          onClick={() => handleHexClick(col, row)}
          style={{ cursor: inPlayer && !disabled && !hexData.impassable ? 'pointer' : 'default' }}
        >
          <polygon points={hexPoints(x, y)} fill={fill} stroke="#222" strokeWidth="0.8" />
          {stack.map((p, i) => {
            const rowY = y + (i - (stack.length - 1) / 2) * 9
            return (
              <text
                key={p.type}
                x={x}
                y={rowY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="8"
                fill="#88aaff"
              >
                {p.type[0]}{p.count}
              </text>
            )
          })}
          {/* One hold badge for the whole square — loose units share a single
              order (only a squad carries its own, drawn separately below). */}
          {stack.length > 0 && stack[0].holdTurns > 0 && (
            <text
              data-testid={`hold-badge-${col}-${row}`}
              x={x + HEX_SIZE * 0.55}
              y={y + (0 - (stack.length - 1) / 2) * 9}
              textAnchor="start"
              dominantBaseline="middle"
              fontSize="7"
              fill="#ffcc66"
            >
              ⌛{stack[0].holdTurns}
            </text>
          )}
          {hexSquads.map((sq, i) => {
            const rowY = y + (stack.length + i - (stack.length + hexSquads.length - 1) / 2) * 9
            const holdTurns = squadPlacements[sq.id]?.holdTurns ?? 0
            return (
              <React.Fragment key={`squad-${sq.id}`}>
                <text
                  data-testid={`squad-marker-${col}-${row}-${sq.id}`}
                  x={x}
                  y={rowY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8"
                  fill="#ffaa44"
                >
                  {sq.name}
                </text>
                {holdTurns > 0 && (
                  <text
                    x={x + HEX_SIZE * 0.55}
                    y={rowY}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fontSize="7"
                    fill="#ffcc66"
                  >
                    ⌛{holdTurns}
                  </text>
                )}
              </React.Fragment>
            )
          })}
          {isSelected && (
            <polygon points={hexPoints(x, y)} fill="none" stroke="#6688ff" strokeWidth="1.5" />
          )}
        </g>
      )
    }
  }

  const playerLabelX = hexCenter(0, playerZone.rowMax).x + HEX_SIZE
  const enemyLabelX  = hexCenter(0, enemyZone.rowMin).x  - HEX_SIZE

  const selectedHexData = selectedHex ? getHexData(selectedHex.col, selectedHex.row) : null

  return (
    <div className="hex-grid-wrapper">
      <div className="hex-grid-scroll">
        <svg width={svgW} height={svgH}>
          {hexElements}
          {/* Fortified sides: a rampart drawn on the enemy-facing edge of each
              defended front hex, so the player deploys behind the wall. */}
          {fortifiedSides.map((s) => {
            const seg = wallSegment(s.q, s.r, s.dir)
            if (!seg) return null
            return (
              <line
                key={`fort-${s.q}-${s.r}-${s.dir}`}
                data-testid={`fort-side-${s.q}-${s.r}-${s.dir}`}
                x1={seg.x1}
                y1={seg.y1}
                x2={seg.x2}
                y2={seg.y2}
                stroke="#d9a441"
                strokeWidth="3"
                strokeLinecap="round"
              />
            )
          })}
          <text x={playerLabelX} y={svgH / 2} textAnchor="middle" fontSize="10" fill="#5566bb" opacity="0.7"
                transform={`rotate(-90, ${playerLabelX}, ${svgH / 2})`}>
            — player deployment zone —
          </text>
          <text x={enemyLabelX} y={svgH / 2} textAnchor="middle" fontSize="10" fill="#bb5555" opacity="0.7"
                transform={`rotate(-90, ${enemyLabelX}, ${svgH / 2})`}>
            — enemy territory —
          </text>
        </svg>
      </div>
      {selectedHex && !disabled && (
        <ReachMenu
          hex={selectedHex}
          placements={placementsAt(selectedHex.col, selectedHex.row)}
          roster={rosterForHex(selectedHex.col, selectedHex.row)}
          units={ownedUnits}
          hexTerrain={selectedHexData?.terrain ?? 'Open'}
          hexCapacity={grid.hexCapacity}
          onPlace={handlePlace}
          onClose={() => setSelectedHex(null)}
          squads={squads}
          squadPlacements={squadPlacements}
          onPlaceSquad={handlePlaceSquad}
          onRemoveSquad={handleRemoveSquad}
        />
      )}
    </div>
  )
}

export default HexGrid
