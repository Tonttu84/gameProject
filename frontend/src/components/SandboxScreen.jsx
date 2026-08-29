import React, { useMemo } from 'react'
import useSandboxStore, { SIDES } from '../stores/useSandboxStore'
import { autoPlaceLabSide, launchLabBattle, closeBattleLab } from '../stores/flows'
import { HEX_SIZE, hexCenter, hexPoints, toAxial, svgSize } from '../utils/hexGeometry'

// THE BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE", slice S1).
//
// Compose BOTH armies from the full engine catalog, place them by hand or by
// button, launch, watch. No campaign is involved at any point (SB-1), which is
// what lets the lab reach the fights a campaign cannot hand you — a battlefield
// enchantment needs Enchantment 2 while the host is sealed at 1, so no
// encounter can currently field one at all.
//
// It is a REAL FEATURE, not a dev hatch (SB-2): *"Player should also be able to
// plan strategies"*. And it leaks nothing — the enemy the player composes here
// is his own hypothesis, so nothing he sees tells him anything about the host
// his campaign is actually shadowing.
//
// This screen deliberately does NOT reuse HexGrid: that grid reads roster,
// squads, characters, fortification and enemy placements straight from the
// campaign stores, and generalising it into something campaign-less is the
// abstraction SB-4 declined to build. What the two DO share is the geometry
// (utils/hexGeometry), which is the only thing they ever needed to agree on.

const SIDE_LABEL = { blue: 'Your army (blue)', red: 'The enemy (red)' }
const SIDE_COLOR = { blue: '#88aaff', red: '#ff8888' }

// A type's role badges, so the palette says what a thing IS — the catalog holds
// units no player can recruit (Zombie, Scorpion, the Necromancer that raises
// them), and in a lab that composes both sides that is a feature to label
// rather than a list to filter.
const ROLE_ORDER = ['Player', 'Enemy', 'Summon', 'Mount', 'Crafted']
const roleBadges = (roles = []) => ROLE_ORDER.filter((r) => roles.includes(r)).join(' · ')

const SandboxScreen = ({ info, map }) => {
  const side = useSandboxStore((s) => s.side)
  const setSide = useSandboxStore((s) => s.setSide)
  const catalog = useSandboxStore((s) => s.catalog)
  const blue = useSandboxStore((s) => s.blue)
  const red = useSandboxStore((s) => s.red)
  const selectedHex = useSandboxStore((s) => s.selectedHex)
  const setSelectedHex = useSandboxStore((s) => s.setSelectedHex)
  const setArmyCount = useSandboxStore((s) => s.setArmyCount)
  const place = useSandboxStore((s) => s.place)
  const clearPlacements = useSandboxStore((s) => s.clearPlacements)
  const launching = useSandboxStore((s) => s.launching)

  const armies = { blue, red }
  const { grid, playerZone, enemyZone } = info
  const zoneFor = (s) => (s === 'red' ? enemyZone : playerZone)
  const { width: svgW, height: svgH } = svgSize(grid)

  const sizeOf = useMemo(() => {
    const m = new Map(catalog.map((u) => [u.name, u.size]))
    return (type) => m.get(type) ?? 1
  }, [catalog])

  const forbiddenFor = useMemo(() => {
    const m = new Map(catalog.map((u) => [u.name, u.forbiddenTerrain ?? []]))
    return (type) => m.get(type) ?? []
  }, [catalog])

  const terrainByAxial = useMemo(() => {
    const m = {}
    map?.hexes?.forEach((h) => { m[`${h.q},${h.r}`] = h })
    return m
  }, [map])

  const terrainColorMap = useMemo(() => {
    const m = {}
    info.terrain.forEach((t) => { m[t.name] = t.color })
    return m
  }, [info.terrain])

  const hexData = (col, row) => {
    const { q, r } = toAxial(col, row)
    return terrainByAxial[`${q},${r}`] ?? { terrain: 'Open', impassable: false }
  }

  const inZone = (s, row) => row >= zoneFor(s).rowMin && row <= zoneFor(s).rowMax
  const placementsAt = (s, col, row) =>
    armies[s].placements.filter((p) => p.col === col && p.row === row)

  // Everything this side has composed but not yet placed. Shown as the palette's
  // running total, because an army left in the wings is the one mistake this
  // screen can make silently — the battle would simply be fought without them.
  const unplaced = (s) => {
    const placed = armies[s].placements.reduce((sum, p) => sum + p.count, 0)
    const composed = Object.values(armies[s].army).reduce((sum, n) => sum + n, 0)
    return composed - placed
  }

  const totalPlaced = (s) => armies[s].placements.reduce((sum, p) => sum + p.count, 0)

  const handleHexClick = (col, row) => {
    if (!inZone(side, row) || hexData(col, row).impassable) return
    setSelectedHex(
      selectedHex?.col === col && selectedHex?.row === row ? null : { col, row },
    )
  }

  // ── The grid ────────────────────────────────────────────────────────────
  // Both zones are live, one at a time: the side tab decides which one accepts
  // clicks, which is what keeps a click unambiguous when the lab is composing
  // two armies on one field (SB-3).
  const hexElements = []
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const { x, y } = hexCenter(col, row)
      const data = hexData(col, row)
      const editable = inZone(side, row) && !data.impassable
      const isSelected = selectedHex?.col === col && selectedHex?.row === row
      const stacks = SIDES.flatMap((s) =>
        placementsAt(s, col, row).map((p) => ({ ...p, side: s })),
      )
      const rowY = (k) => y + (k - (stacks.length - 1) / 2) * 9

      hexElements.push(
        <g
          key={`${col}-${row}`}
          data-testid={`lab-hex-${col}-${row}`}
          onClick={() => handleHexClick(col, row)}
          style={{ cursor: editable ? 'pointer' : 'default' }}
        >
          <polygon
            points={hexPoints(x, y)}
            fill={data.impassable ? '#1a1a1a' : (terrainColorMap[data.terrain] ?? '#5a6441')}
            fillOpacity={editable ? 1 : 0.45}
            stroke={inZone('blue', row) ? '#5566bb' : inZone('red', row) ? '#bb5555' : '#222'}
            strokeWidth="0.8"
          />
          {stacks.map((p, i) => (
            <text
              key={`${p.side}-${p.type}`}
              data-testid={`lab-glyph-${p.side}-${col}-${row}-${p.type}`}
              x={x}
              y={rowY(i)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill={SIDE_COLOR[p.side]}
            >
              {p.type[0]}{p.count}
            </text>
          ))}
          {isSelected && (
            <polygon points={hexPoints(x, y)} fill="none" stroke="#ffcc66" strokeWidth="1.5" />
          )}
        </g>,
      )
    }
  }

  // ── The hex menu ────────────────────────────────────────────────────────
  // Only the types this side has actually composed, so the menu is a list of
  // what is left to place rather than the whole catalog a second time.
  const hexMenu = () => {
    if (!selectedHex) return null
    const { col, row } = selectedHex
    const terrain = hexData(col, row).terrain
    const here = Object.fromEntries(placementsAt(side, col, row).map((p) => [p.type, p.count]))
    const composed = Object.keys(armies[side].army)

    // Room left on this hex once every OTHER type standing here is counted —
    // the same capacity arithmetic the deployment screen does, so an army that
    // fits in the lab fits in a real battle.
    const usedByOthers = (type) =>
      Object.entries(here).reduce(
        (sum, [t, n]) => (t === type ? sum : sum + n * sizeOf(t)), 0,
      )

    const maxFor = (type) => {
      if (forbiddenFor(type).includes(terrain)) return 0
      const room = Math.floor((grid.hexCapacity - usedByOthers(type)) / sizeOf(type))
      // `remaining` already leaves THIS hex out of its sum, so what it returns
      // is the whole budget available here — the army minus everything standing
      // elsewhere. Adding the stack already on this hex back on top of that
      // would count it twice, and let a hex holding 6 of 10 offer 16.
      return Math.min(
        useSandboxStore.getState().remaining(side, type, selectedHex),
        Math.max(0, room),
      )
    }

    return (
      <div className="lab-hex-menu" data-testid="lab-hex-menu">
        <h4>Hex {col},{row} — {terrain}</h4>
        {composed.length === 0 && <p>Compose an army first — nothing to place yet.</p>}
        {composed.map((type) => {
          const max = maxFor(type)
          return (
            <label key={type} className="lab-hex-row">
              <span>{type}</span>
              <input
                type="number"
                min="0"
                max={max}
                value={here[type] ?? 0}
                data-testid={`lab-place-${type}`}
                disabled={max === 0 && !(here[type] > 0)}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0)))
                  place(side, col, row, type, n)
                }}
              />
              <span className="lab-hint">
                {forbiddenFor(type).includes(terrain) ? 'cannot enter this terrain' : `max ${max}`}
              </span>
            </label>
          )
        })}
        <button data-testid="lab-hex-close" onClick={() => setSelectedHex(null)}>Close</button>
      </div>
    )
  }

  const nothingPlaced = totalPlaced('blue') + totalPlaced('red') === 0

  return (
    <div className="sandbox-screen">
      <div className="lab-header">
        <h2>The Battle Lab</h2>
        <p className="lab-blurb">
          Compose both armies from the whole catalog, place them, and fight it out — no campaign,
          nothing spent, nothing learned about the host actually shadowing you.
        </p>
        <div className="lab-actions">
          <button
            className="btn-primary"
            data-testid="lab-launch"
            disabled={launching || nothingPlaced}
            onClick={launchLabBattle}
          >
            {launching ? 'The armies close…' : 'Launch the battle'}
          </button>
          <button data-testid="lab-back" onClick={closeBattleLab}>Leave the lab</button>
        </div>
      </div>

      <div className="lab-sides" role="tablist">
        {SIDES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            className={`lab-side-tab ${side === s ? 'active' : ''}`}
            data-testid={`lab-side-${s}`}
            onClick={() => setSide(s)}
          >
            {SIDE_LABEL[s]} — {totalPlaced(s)} placed
          </button>
        ))}
      </div>

      <div className="lab-body">
        <div className="lab-palette" data-testid="lab-palette">
          <h3>{SIDE_LABEL[side]}</h3>
          <p className="lab-hint" data-testid="lab-unplaced">
            {/* Lowering a composed count does NOT retract bodies already
                placed — the placements are what actually fights, so they are
                left alone and the mismatch is reported instead of hidden. */}
            {unplaced(side) > 0 && `${unplaced(side)} still to place`}
            {unplaced(side) === 0 && 'every composed body is on the field'}
            {unplaced(side) < 0 && `${-unplaced(side)} placed beyond the composed army`}
          </p>
          <div className="lab-actions">
            <button data-testid="lab-auto-place" onClick={() => autoPlaceLabSide(side)}>
              Auto-place
            </button>
            <button data-testid="lab-clear" onClick={() => clearPlacements(side)}>
              Clear placements
            </button>
          </div>
          {catalog.map((unit) => (
            <label key={unit.name} className="lab-palette-row">
              <span className="lab-unit-name">{unit.name}</span>
              <span className="lab-hint">{roleBadges(unit.roles)}</span>
              <input
                type="number"
                min="0"
                value={armies[side].army[unit.name] ?? 0}
                data-testid={`lab-recruit-${unit.name}`}
                onChange={(e) =>
                  setArmyCount(side, unit.name, Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            </label>
          ))}
        </div>

        <div className="lab-field">
          <div className="hex-grid-scroll">
            <svg width={svgW} height={svgH}>
              {hexElements}
              <text
                x={hexCenter(0, playerZone.rowMax).x + HEX_SIZE}
                y={svgH / 2}
                textAnchor="middle"
                fontSize="10"
                fill="#5566bb"
                opacity="0.7"
                transform={`rotate(-90, ${hexCenter(0, playerZone.rowMax).x + HEX_SIZE}, ${svgH / 2})`}
              >
                — blue deployment zone —
              </text>
              <text
                x={hexCenter(0, enemyZone.rowMin).x - HEX_SIZE}
                y={svgH / 2}
                textAnchor="middle"
                fontSize="10"
                fill="#bb5555"
                opacity="0.7"
                transform={`rotate(-90, ${hexCenter(0, enemyZone.rowMin).x - HEX_SIZE}, ${svgH / 2})`}
              >
                — red deployment zone —
              </text>
            </svg>
          </div>
          {hexMenu()}
        </div>
      </div>
    </div>
  )
}

export default SandboxScreen
