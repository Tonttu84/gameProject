import React, { useEffect, useMemo, useState } from 'react'
import useReplay from '../hooks/useReplay'
import useUiStore from '../stores/useUiStore'
import TutorialIntro from './TutorialIntro'
import { HEX_SIZE, hexCenter, hexPoints, toAxial, toOffset, svgSize } from '../utils/hexGeometry'

// The battle log's three tiers (docs/CAMPAIGN_PLAN.md, "TIERED BATTLE LOGGING").
//
// CUMULATIVE: choosing a depth shows that tier and every shallower one, so
// Detail includes Basic and Trace includes both. The order here IS the ladder.
//
// The control opens on Basic and Basic is never removable, which is what makes
// the user's rule — "spells cast should however appear on any level" — true by
// construction: casts are logged at Basic engine-side, so no setting this
// control offers can hide them.
const LOG_TIERS = ['basic', 'detail', 'trace']
const TIER_LABELS = { basic: 'Basic', detail: 'Detail', trace: 'Trace' }

// A line whose tier the client does not recognise is shown rather than dropped.
// A replay recorded by a newer engine should read as slightly noisy, never as
// silently missing the line that explains what happened.
const tierDepth = (tier) => {
  const i = LOG_TIERS.indexOf(tier)
  return i === -1 ? 0 : i
}

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

// Visual cues ported from the SFML renderer (BattleRenderer::renderUnitsInHex),
// so the browser replay is a lossless stand-in for the retired live window:
//   • casting → yellow, broken → orange (broken wins over casting);
//   • rank-alpha dims reserves when engaged — RANK_ALPHA indexed by rank, with
//     RANK_ALPHA[0] the fallback for engaged-but-off-rank; solid when the unit
//     isn't engaged (no `side` recorded).
const CAST_COLOR = '#ffff00' // sf::Color::Yellow
const BROKEN_COLOR = '#ff8c00' // sf::Color(255,140,0)
const RANK_ALPHA = [140, 255, 200, 160]

const unitColor = (u) => {
  if (u.broken) return BROKEN_COLOR
  if (u.cast) return CAST_COLOR
  return u.squad ? squadColor(u.squad) : (TEAM_COLOR[u.team] ?? '#ffffff')
}

const unitOpacity = (u) => {
  if (u.side === undefined || u.side === null) return 1 // not engaged → solid
  const a = u.rank >= 1 && u.rank <= 3 ? RANK_ALPHA[u.rank] : RANK_ALPHA[0]
  return a / 255
}

// Web glyphs draw a bit larger than strict SFML-pixel parity (uniform factor,
// layout untouched) — at 20px hexes a 1:1 mapping is unreadably small.
const GLYPH_SCALE = 1.5
const MIN_GLYPH_PX = 4

// Replays a stored battle: terrain grid + per-tick unit stacks, scrub slider,
// step/play controls, and the tick's log lines. All data comes from the DB
// via useReplay — no re-simulation, so scrubbing backward is exact.
const ReplayView = ({ battleId, tickCount, info, map, onBack, autoPlay = false, backLabel = 'Back to result' }) => {
  const { current, tick, seek, next, prev, playing, setPlaying } = useReplay(battleId, tickCount)
  const tutorial = useUiStore((s) => s.tutorial)
  // How deep the log is shown. Per-viewing rather than persisted: it is a way
  // of LOOKING at a battle, not a setting about the campaign.
  const [depth, setDepth] = useState('basic')

  // The login-screen demo starts playing on its own — the visitor launched it
  // to watch a battle, not to press Play. Real battle replays open paused.
  useEffect(() => {
    if (autoPlay) setPlaying(true)
  }, [autoPlay, setPlaying])

  const { grid } = info
  const { width: svgW, height: svgH } = svgSize(grid)

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

  const hexElements = []
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { x, y } = hexCenter(col, row)
      const { q } = toAxial(col, row)
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
  const glyph = (u, gx, gy, size, key) => (
    <text
      key={key}
      x={gx}
      y={gy}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={size}
      fontWeight="bold"
      fill={unitColor(u)}
      fillOpacity={unitOpacity(u)}
    >
      {u.type[0]}
    </text>
  )

  // In-hex layout comes from the DB: ox/oy/sz are the engine FormationLayout
  // offsets ReplayRecorder stored on every unit (hex-radius units). This view
  // owns no formation geometry — it draws center + offset × size, with one
  // axis transpose (engine flat x runs along this view's y). side/rank remain
  // available on the unit as facts, never as layout inputs.
  const unitElements = (tick?.units ?? []).map((u) => {
    const { col, row } = toOffset(u.q, u.r)
    const { x, y } = hexCenter(col, row)
    return glyph(
      u,
      x + (u.oy ?? 0) * HEX_SIZE,
      y + (u.ox ?? 0) * HEX_SIZE,
      Math.max(MIN_GLYPH_PX, (u.sz ?? 0.2) * HEX_SIZE * GLYPH_SCALE),
      `u${u.id}`,
    )
  })

  return (
    <div className="replay-view">
      <TutorialIntro
        id="replay"
        enabled={tutorial}
        title="Watching the battle"
        lines={[
          'Each glyph is one soldier, colored by its squad; the log below narrates what happens each tick.',
          'Play, step with ◀ ▶, or drag the slider to scrub — the recording is exact, so you can rewind freely.',
        ]}
      />
      <div className="replay-header">
        <h2>Battle Replay — turn {current} / {Math.max(0, tickCount - 1)}</h2>
        {onBack && (
          <button className="btn-primary" data-testid="replay-back" onClick={onBack}>
            {backLabel}
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

      <div className="replay-log-head">
        <span className="replay-depth-label">Depth:</span>
        {LOG_TIERS.map((tier) => (
          <button
            key={tier}
            className={`replay-depth ${depth === tier ? 'active' : ''}`}
            data-testid={`replay-depth-${tier}`}
            aria-pressed={depth === tier}
            onClick={() => setDepth(tier)}
          >
            {TIER_LABELS[tier]}
          </button>
        ))}
      </div>

      <div className="replay-log" data-testid="replay-log">
        {(tick?.log ?? [])
          // A line older than the tiered log crossed as a bare string; render it
          // as Basic rather than dropping it, so an already-stored replay does
          // not go blank when the engine that wrote it predates the ladder.
          .map((line) => (typeof line === 'string' ? { tier: 'basic', text: line } : line))
          .filter((line) => tierDepth(line.tier) <= tierDepth(depth))
          .map((line, i) => (
            <div key={i} className={`replay-log-line tier-${line.tier}`}>{line.text}</div>
          ))}
      </div>
    </div>
  )
}

export default ReplayView
