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

  // Group this tick's units into per-hex stacks of {type, team → count}.
  const stacksByHex = useMemo(() => {
    const m = new Map()
    tick?.units?.forEach((u) => {
      const key = `${u.q},${u.r}`
      if (!m.has(key)) m.set(key, { q: u.q, r: u.r, counts: new Map() })
      const stack = m.get(key).counts
      const stackKey = `${u.type}|${u.team}`
      stack.set(stackKey, (stack.get(stackKey) ?? 0) + 1)
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
  // 2026-07-05), matching the SFML renderer's unit-per-marker look. Glyphs
  // pack into a near-square grid that shrinks to stay inside the hex. True
  // SFML parity (files along engaged hex sides by rank) needs side/rank data
  // from the engine's ReplayRecorder — see CAMPAIGN_PLAN.md.
  const unitElements = stacksByHex.flatMap(({ q, r, counts }) => {
    const { col, row } = toOffset(q, r)
    const { x, y } = hexCenter(col, row)
    const glyphs = []
    for (const [key, count] of counts) {
      const [type, team] = key.split('|')
      for (let n = 0; n < count; n++) glyphs.push({ symbol: type[0], team })
    }
    const perRow = Math.ceil(Math.sqrt(glyphs.length))
    const rows = Math.ceil(glyphs.length / perRow)
    const cell = Math.min(9, (HEX_SIZE * 1.7) / Math.max(perRow, rows))
    return glyphs.map((g, i) => (
      <text
        key={`${q},${r},${i}`}
        x={x + ((i % perRow) - (perRow - 1) / 2) * cell}
        y={y + (Math.floor(i / perRow) - (rows - 1) / 2) * cell}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={Math.max(4, cell - 1)}
        fontWeight="bold"
        fill={TEAM_COLOR[g.team] ?? '#ffffff'}
      >
        {g.symbol}
      </text>
    ))
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
