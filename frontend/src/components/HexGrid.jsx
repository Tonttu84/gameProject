import { useState } from 'react'
import ReachMenu from './ReachMenu'

const HEX_SIZE = 20
const SQRT3 = Math.sqrt(3)

// Even-r offset (col, row) → SVG pixel center. +HEX_SIZE padding on each edge.
const hexCenter = (col, row) => ({
  x: HEX_SIZE * SQRT3 * (col + 0.5 * (row % 2)) + HEX_SIZE,
  y: HEX_SIZE * 1.5 * row + HEX_SIZE,
})

const hexPoints = (cx, cy) => {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(cx + HEX_SIZE * Math.cos(angle)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(angle)).toFixed(2)}`)
  }
  return pts.join(' ')
}

const HexGrid = ({ info, placements, onPlacementsChange, roster, disabled }) => {
  const [selectedHex, setSelectedHex] = useState(null)

  const { grid, playerZone, enemyZone } = info

  const svgW = Math.ceil(HEX_SIZE * SQRT3 * (grid.width + 0.5) + HEX_SIZE * 2)
  const svgH = Math.ceil(HEX_SIZE * 1.5 * grid.height + HEX_SIZE * 2)

  const inPlayerZone = (row) => row >= playerZone.rowMin && row <= playerZone.rowMax
  const inEnemyZone  = (row) => row >= enemyZone.rowMin  && row <= enemyZone.rowMax

  const placementsAt = (col, row) => placements.filter(p => p.col === col && p.row === row)

  const handleHexClick = (col, row) => {
    if (disabled || !inPlayerZone(row)) return
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
      const inPlayer  = inPlayerZone(row)
      const inEnemy   = inEnemyZone(row)
      const isSelected = selectedHex?.col === col && selectedHex?.row === row
      const stack      = placementsAt(col, row)

      let fill = '#1a1a24'
      if (inEnemy)    fill = '#2a1414'
      if (inPlayer)   fill = '#141428'
      if (isSelected) fill = '#1e2a5a'

      hexElements.push(
        <g
          key={`${col}-${row}`}
          onClick={() => handleHexClick(col, row)}
          style={{ cursor: inPlayer && !disabled ? 'pointer' : 'default' }}
        >
          <polygon points={hexPoints(x, y)} fill={fill} stroke="#3a3a55" strokeWidth="0.8" />
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

  // Zone label strips
  const playerLabelY = hexCenter(0, playerZone.rowMax).y + HEX_SIZE * 0.5
  const enemyLabelY  = hexCenter(0, enemyZone.rowMin).y  - HEX_SIZE * 0.5

  return (
    <div className="hex-grid-wrapper">
      <div className="hex-grid-scroll">
        <svg width={svgW} height={svgH}>
          {hexElements}
          <text x={svgW / 2} y={playerLabelY} textAnchor="middle" fontSize="10" fill="#5566bb" opacity="0.7">
            — player deployment zone —
          </text>
          <text x={svgW / 2} y={enemyLabelY} textAnchor="middle" fontSize="10" fill="#bb5555" opacity="0.7">
            — enemy territory —
          </text>
        </svg>
      </div>
      {selectedHex && !disabled && (
        <ReachMenu
          hex={selectedHex}
          placements={placementsAt(selectedHex.col, selectedHex.row)}
          roster={roster}
          units={info.units}
          onPlace={handlePlace}
          onClose={() => setSelectedHex(null)}
        />
      )}
    </div>
  )
}

export default HexGrid
