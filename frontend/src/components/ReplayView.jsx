import React, { useMemo } from 'react'
import useReplay from '../hooks/useReplay'

// Same geometry as HexGrid.jsx (kept in sync — extract if a third user appears).
const HEX_SIZE = 20
const SQRT3 = Math.sqrt(3)

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

// axial (q, r) → visual offset (col, row) — inverse of HexGrid's toAxial
const toOffset = (q, r) => ({ col: q + Math.floor(r / 2), row: r })

const TEAM_COLOR = { blue: '#88aaff', red: '#ff8888' }

// Mirror of the SFML renderer's SQUAD_PALETTE (BattleRenderer.cpp): one
// distinct color per squad, hashed from the squad name.
const SQUAD_PALETTE = [
  '#ffd700', '#00ffb4', '#ff50dc', '#00c8ff', '#b4ff00',
  '#ff7800', '#c850ff', '#50ff78', '#ffff78', '#78c8ff',
]
const squadColor = (name) => {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SQUAD_PALETTE[h % SQUAD_PALETTE.length]
}

// Axial neighbor offsets per engine HexDirection (NE E SE SW W NW) — mirror
// of HexGrid.cpp's DQ/DR; a unit's `side` indexes these.
const DQ = [1, 1, 0, -1, -1, 0]
const DR = [-1, 0, 1, 1, 0, -1]

// Replays a stored battle: terrain grid + per-tick unit stacks, scrub slider,
// step/play controls, and the tick's log lines. All data comes from the DB
// via useReplay — no re-simulation, so scrubbing backward is exact.
const ReplayView = ({ battleId, tickCount, info, map, onBack }) => {
  const { current, tick, seek, next, prev, playing, setPlaying } = useReplay(battleId, tickCount)

  const { grid } = info
  const svgW = Math.ceil(HEX_SIZE * 1.5 * grid.height + HEX_SIZE * 2)
  const svgH = Math.ceil(HEX_SIZE * SQRT3 * (grid.width + 0.5) + HEX_SIZE * 2)

  const terrainByAxial = useMemo(() => {
    const m = {}
    map?.hexes?.forEach((h) => {
      m[`${h.q},${h.r}`] = h
    })
    return m
  }, [map])

  const terrainColorMap = useMemo(() => {
    const m = {}
    info.terrain.forEach((t) => {
      m[t.name] = t.color
    })
    return m
  }, [info.terrain])

  // Group this tick's units per hex; layout happens per hex below.
  const unitsByHex = useMemo(() => {
    const m = new Map()
    tick?.units?.forEach((u) => {
      const key = `${u.q},${u.r}`
      if (!m.has(key)) m.set(key, { q: u.q, r: u.r, units: [] })
      m.get(key).units.push(u)
    })
    return [...m.values()]
  }, [tick])

  const hexElements = []
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { x, y } = hexCenter(col, row)
      const q = col - Math.floor(row / 2)
      const hexData = terrainByAxial[`${q},${row}`] ?? { terrain: 'Open', impassable: false }
      const fill = hexData.impassable
        ? '#1a1a1a'
        : (terrainColorMap[hexData.terrain] ?? '#5a6441')
      hexElements.push(
        <polygon
          key={`${col}-${row}`}
          points={hexPoints(x, y)}
          fill={fill}
          stroke="#222"
          strokeWidth="0.8"
        />,
      )
    }
  }

  // One glyph per unit — 5 Mages render as MMMMM, not "M5" (user,
  // 2026-07-05), matching the SFML renderer's unit-per-marker look. Units in
  // a squad take the squad's palette color; loners keep their team color.
  // Engaged units file along their engaged hex side by rank (side/rank come
  // from the engine's ReplayRecorder — same layout idea as BattleRenderer);
  // everyone else packs into a small central block.
  const glyph = (u, gx, gy, size, key) => (
    <text
      key={key}
      x={gx}
      y={gy}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={size}
      fontWeight="bold"
      fill={u.squad ? squadColor(u.squad) : (TEAM_COLOR[u.team] ?? '#ffffff')}
    >
      {u.type[0]}
    </text>
  )

  const unitElements = unitsByHex.flatMap(({ q, r, units }) => {
    const { col, row } = toOffset(q, r)
    const { x, y } = hexCenter(col, row)
    const els = []

    // Engaged files: group by (side, rank), place toward the side's edge,
    // deeper ranks stepping back toward the hex center.
    const engaged = units.filter((u) => u.side !== undefined && u.side !== null)
    const files = new Map()
    engaged.forEach((u) => {
      const key = `${u.side}|${u.rank ?? 0}`
      if (!files.has(key)) files.set(key, [])
      files.get(key).push(u)
    })
    for (const [key, file] of files) {
      const [side, rank] = key.split('|').map(Number)
      const n = toOffset(q + DQ[side], r + DR[side])
      const nc = hexCenter(n.col, n.row)
      const len = Math.hypot(nc.x - x, nc.y - y) || 1
      const dx = (nc.x - x) / len
      const dy = (nc.y - y) / len
      const dist = HEX_SIZE * 0.68 - rank * 6
      file.forEach((u, i) => {
        const spread = (i - (file.length - 1) / 2) * 5.5
        els.push(glyph(u, x + dx * dist - dy * spread, y + dy * dist + dx * spread, 6, `${q},${r},e${key},${u.id}`))
      })
    }

    // Unengaged block: near-square grid that shrinks to stay inside the hex.
    const rest = units.filter((u) => u.side === undefined || u.side === null)
    if (rest.length > 0) {
      const perRow = Math.ceil(Math.sqrt(rest.length))
      const rows = Math.ceil(rest.length / perRow)
      const cell = Math.min(9, (HEX_SIZE * 1.4) / Math.max(perRow, rows))
      rest.forEach((u, i) => {
        els.push(glyph(
          u,
          x + ((i % perRow) - (perRow - 1) / 2) * cell,
          y + (Math.floor(i / perRow) - (rows - 1) / 2) * cell,
          Math.max(4, cell - 1),
          `${q},${r},u${u.id}`,
        ))
      })
    }
    return els
  })

  return (
    <div className="replay-view">
      <div className="replay-header">
        <h2>Battle Replay — turn {current} / {Math.max(0, tickCount - 1)}</h2>
        {onBack && (
          <button className="btn-primary" data-testid="replay-back" onClick={onBack}>
            Back to result
          </button>
        )}
      </div>

      <div className="hex-grid-scroll">
        <svg width={svgW} height={svgH}>
          {hexElements}
          {unitElements}
        </svg>
      </div>

      <div className="replay-controls">
        <button data-testid="replay-prev" onClick={prev} disabled={current === 0}>
          ◀
        </button>
        <button data-testid="replay-play" onClick={() => setPlaying(!playing)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          data-testid="replay-next"
          onClick={next}
          disabled={current >= tickCount - 1}
        >
          ▶
        </button>
        <input
          data-testid="replay-slider"
          type="range"
          min="0"
          max={Math.max(0, tickCount - 1)}
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </div>

      <div className="replay-log" data-testid="replay-log">
        {(tick?.log ?? []).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  )
}

export default ReplayView
