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

const HexGrid = ({ info, map, placements, onPlacementsChange, roster, disabled }) => {
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

  const handlePlace = (col, row, type, count) => {
    onPlacementsChange(prev => {
      const filtered = prev.filter(p => !(p.col === col && p.row === row && p.type === type))
      if (count > 0) return [...filtered, { type, col, row, count }]
      return filtered
    })
  }

  const hexElements = []
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { x, y } = hexCenter(col, row)
      const inPlayer   = inPlayerZone(row)
      const inEnemy    = inEnemyZone(row)
      const isSelected = selectedHex?.col === col && selectedHex?.row === row
      const stack      = placementsAt(col, row)
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
          {stack.map((p, i) => (
            <text
              key={p.type}
              x={x}
              y={y + (i - (stack.length - 1) / 2) * 9}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill="#88aaff"
            >
              {p.type[0]}{p.count}
            </text>
          ))}
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
          units={info.units}
          hexTerrain={selectedHexData?.terrain ?? 'Open'}
          hexCapacity={grid.hexCapacity}
          onPlace={handlePlace}
          onClose={() => setSelectedHex(null)}
        />
      )}
    </div>
  )
}

export default HexGrid
