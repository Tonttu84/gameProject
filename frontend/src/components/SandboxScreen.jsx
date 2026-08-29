import React, { useEffect, useMemo, useState } from 'react'
import useSandboxStore, { SIDES } from '../stores/useSandboxStore'
import {
  autoPlaceLabSide, launchLabBattle, closeBattleLab, loadLabCastable,
} from '../stores/flows'
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

// One caster BODY's identity — the stack it stands in plus its index within it.
// The index is the whole point of SB-6: the mechanics the lab was asked for (the
// second caster fizzling on a battlefield spell, the duplicate-script warning)
// only appear when two casters on the SAME side differ, so a body has to be
// addressable as itself and not as "a Mage on (4,2)".
const bodyKey = (side, b) => `${side},${b.type},${b.col},${b.row},${b.index}`
const sameBody = (a, b) =>
  Boolean(a && b && a.type === b.type && a.col === b.col && a.row === b.row && a.index === b.index)

// A spinner's value, trimmed to a whole number inside the server's own bound —
// the client never invents the ceiling, it reads it off the reference so the
// two cannot disagree about what "9" means.
const clamp = (value, max) => {
  const n = Math.max(0, Math.floor(Number(value) || 0))
  return Number.isFinite(max) ? Math.min(max, n) : n
}

// What a body's row says about itself: nothing at all when nothing is set,
// which is the honest description of a caster the engine will seed its own way.
const describeConfig = (config) => {
  const paths = Object.keys(config?.paths ?? {}).length
  const script = (config?.script ?? []).length
  const parts = []
  if (paths > 0) parts.push(`${paths} path${paths === 1 ? '' : 's'}`)
  if (script > 0) parts.push(`${script} scripted`)
  return parts.length > 0 ? `— ${parts.join(', ')}` : ''
}

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
  const reference = useSandboxStore((s) => s.reference)
  const castable = useSandboxStore((s) => s.castable)
  const setSchoolLevel = useSandboxStore((s) => s.setSchoolLevel)
  const setChannels = useSandboxStore((s) => s.setChannels)
  const loadEnemyPreset = useSandboxStore((s) => s.loadEnemyPreset)
  const setCasterConfig = useSandboxStore((s) => s.setCasterConfig)

  // Which caster body the editor is open on — SCREEN state, not store state:
  // it is a cursor into the setup, not part of it, and S3's export would have
  // no business serialising where the player's eye was.
  const [openCaster, setOpenCaster] = useState(null)

  const armies = { blue, red }

  // ONE ROW PER BODY, never per stack (SB-6): three Mages on one hex are three
  // men who may each want a different script, and the lab exists precisely to
  // put them beside each other and watch what the once-per-side rules do.
  const casterTypes = reference?.casterTypes ?? []
  const casterBodies = armies[side].placements
    .filter((p) => casterTypes.includes(p.type))
    .flatMap((p) => Array.from({ length: p.count }, (_, index) => ({
      type: p.type, col: p.col, row: p.row, index, config: p.casters?.[index] ?? null,
    })))

  // The body the editor is open on, re-read off the CURRENT list.
  const editing = casterBodies.find((b) => sameBody(b, openCaster)) ?? null

  // A stack the player shrank out from under the panel leaves the cursor
  // pointing at a body that no longer exists. The cursor is DROPPED rather than
  // merely hidden: the store has already thrown that body's config away, so a
  // cursor that survived would silently re-open on whoever next took the index.
  useEffect(() => {
    if (openCaster && !editing) setOpenCaster(null)
  }, [openCaster, editing])

  // Ask the server what the open body can cast, whenever the question changes:
  // a different body, a moved path level, or a moved school level on his side
  // (D3 — raise a path and the list grows immediately). Keyed on the values
  // themselves rather than on object identity, so a re-render that changed
  // nothing asks nothing.
  const openSchools = JSON.stringify(armies[side].magic.schools)
  const openPaths = JSON.stringify(
    openCaster
      ? armies[side].placements.find(
        (p) => p.col === openCaster.col && p.row === openCaster.row && p.type === openCaster.type,
      )?.casters?.[openCaster.index]?.paths ?? {}
      : {},
  )
  useEffect(() => {
    if (!openCaster) return
    loadLabCastable(side, openCaster, openCaster.index)
  }, [side, openCaster, openPaths, openSchools])

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

  // ── The side's magic (D1) ───────────────────────────────────────────────
  // BOTH sides get a block, not just the enemy: SB-8 named the enemy because
  // that was the ask, but the lab composes both armies (SB-1) and SB-5's
  // "anything goes" is per side. The numbers start at the engine's own open
  // default, so what is on screen when the panel first appears is exactly what
  // a battle would have been fought with anyway.
  const magic = armies[side].magic
  const limits = reference?.limits ?? {}

  const magicPanel = () => (
    <section className="lab-magic" data-testid="lab-magic">
      <h3>{SIDE_LABEL[side]} — magic</h3>
      <p className="lab-hint">
        School levels open the forms a caster may reach; the channel pool is what the whole side
        can spend on battlefield enchantments. Both start where the engine leaves them when
        nothing is sent.
      </p>
      {(reference?.schools ?? []).map(({ key, label }) => (
        <label key={key} className="lab-hex-row">
          <span className="lab-unit-name">{label}</span>
          <input
            type="number"
            min="0"
            max={limits.maxSchoolLevel}
            value={magic.schools[key] ?? 0}
            data-testid={`lab-school-${key}`}
            onChange={(e) => setSchoolLevel(side, key, clamp(e.target.value, limits.maxSchoolLevel))}
          />
        </label>
      ))}
      <label className="lab-hex-row">
        <span className="lab-unit-name">Channel pool</span>
        <input
          type="number"
          min="0"
          max={limits.maxChannels}
          value={magic.channels}
          data-testid="lab-channels"
          onChange={(e) => setChannels(side, clamp(e.target.value, limits.maxChannels))}
        />
      </label>
      {/* SB-8: the REAL host's sealed numbers, read live off the balance
          constants, so the button stays accurate for free as they move. Offered
          on either side — the host's numbers are a starting point wherever you
          want them, not a fact about red. */}
      <button data-testid="lab-enemy-preset" onClick={() => loadEnemyPreset(side)}>
        Load the campaign host&apos;s numbers
      </button>
    </section>
  )

  // ── The casters (SB-6) ──────────────────────────────────────────────────
  const castersPanel = () => (
    <section className="lab-casters" data-testid="lab-casters">
      <h3>Casters on this side</h3>
      {casterBodies.length === 0 && (
        <p className="lab-hint">
          No casters placed here yet — place a Mage, a Priest or a Necromancer and each body
          gets its own paths and script.
        </p>
      )}
      {casterBodies.map((b) => (
        <button
          key={bodyKey(side, b)}
          className={`lab-caster-row ${sameBody(b, editing) ? 'active' : ''}`}
          data-testid={`lab-caster-${b.type}-${b.col}-${b.row}-${b.index}`}
          onClick={() => setOpenCaster(sameBody(b, editing) ? null : b)}
        >
          {b.type} · ({b.col},{b.row}) #{b.index + 1}
          {/* What this body actually overrides, so the list says at a glance
              which men are the game's own default and which are not. */}
          <span className="lab-hint"> {describeConfig(b.config)}</span>
        </button>
      ))}
    </section>
  )

  const casterEditor = () => {
    if (!editing) return null
    const paths = editing.config?.paths ?? {}
    const script = editing.config?.script ?? []
    const at = { type: editing.type, col: editing.col, row: editing.row }
    const options = castable.key === bodyKey(side, editing) ? castable.options : []
    const labelOf = (id) => options.find((o) => o.spell === id)?.label ?? id

    return (
      <section className="lab-caster-editor" data-testid="lab-caster-editor">
        <h4>{editing.type} · ({editing.col},{editing.row}) #{editing.index + 1}</h4>
        <p className="lab-hint">
          Anything left untouched is sent as nothing at all, which is how the engine is asked
          for its own choice — an unopened Mage still walks in with the path his craft seeds.
        </p>

        {(reference?.paths ?? []).map(({ key, label }) => (
          <label key={key} className="lab-hex-row">
            <span className="lab-unit-name">{label}</span>
            <input
              type="number"
              min="0"
              max={limits.maxPathLevel}
              value={paths[key] ?? 0}
              data-testid={`lab-path-${key}`}
              onChange={(e) => setCasterConfig(side, at, editing.index, {
                paths: { ...paths, [key]: clamp(e.target.value, limits.maxPathLevel) },
              })}
            />
          </label>
        ))}

        {/* POSITION IS PRIORITY (S4-1), so the list is ordered and the only
            edits are remove and append — the same contract the campaign's own
            chosen-spells picker holds the player to. */}
        <h4>Script</h4>
        {script.length === 0 && (
          <p className="lab-hint">Empty — he casts whatever the engine would pick for him.</p>
        )}
        <ol className="lab-script">
          {script.map((id, i) => (
            <li key={id}>
              <span className="lab-unit-name">{labelOf(id)}</span>
              <button
                data-testid={`lab-script-remove-${id}`}
                onClick={() => setCasterConfig(side, at, editing.index, {
                  script: script.filter((_, k) => k !== i),
                })}
              >
                remove
              </button>
            </li>
          ))}
        </ol>
        {/* Fed by the server (D3): exactly what THIS body can cast under his own
            paths and this side's school levels, refetched whenever either
            moves. The lab holds no copy of the qualification rule. */}
        <select
          data-testid="lab-script-add"
          value=""
          onChange={(e) => {
            if (!e.target.value) return
            setCasterConfig(side, at, editing.index, { script: [...script, e.target.value] })
          }}
        >
          <option value="">Add a spell…</option>
          {options.filter((o) => !script.includes(o.spell)).map((o) => (
            <option key={o.spell} value={o.spell}>{o.label}</option>
          ))}
        </select>

        {/* Back to silence — the one edit that cannot be made with a spinner,
            since a path typed back to 0 is an explicit "no Fire" and not the
            same statement as never having said anything. */}
        <button
          data-testid="lab-caster-reset"
          onClick={() => setCasterConfig(side, at, editing.index, { paths: {}, script: [] })}
        >
          Back to the engine&apos;s own choice
        </button>
      </section>
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

        <div className="lab-casting" data-testid="lab-casting">
          {magicPanel()}
          {castersPanel()}
          {casterEditor()}
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
