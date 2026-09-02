import React, { useEffect, useMemo, useState } from 'react'
import useSandboxStore, { SIDES } from '../stores/useSandboxStore'
import useCampaignStore from '../stores/useCampaignStore'
import {
  autoPlaceLabSide, launchLabBattle, closeBattleLab, loadLabCastable, loadLabSquadCaps,
  squadCapsKey, exportLabScenario, importLabScenario, prefillLabFromCampaign,
} from '../stores/flows'
import { HEX_SIZE, hexCenter, hexPoints, toAxial, svgSize, wallSegment } from '../utils/hexGeometry'

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
//
// R2 adds the COMPANY to the address, because a company's attached Mage and a
// loose Mage may stand on the same hex and are two different men. Loose bodies
// keep the shorter test id they have always had; a company's carry their
// charter's number, which is also what tells the two rows apart on screen.
const bodyKey = (side, b) =>
  `${side},${b.squadId ?? 'loose'},${b.type},${b.col},${b.row},${b.index}`
const bodyTestId = (b) =>
  `lab-caster-${b.squadId == null ? '' : `sq${b.squadId}-`}${b.type}-${b.col}-${b.row}-${b.index}`
const sameBody = (a, b) =>
  Boolean(a && b && a.type === b.type && a.col === b.col && a.row === b.row && a.index === b.index
    && (a.squadId ?? null) === (b.squadId ?? null))

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
  const runs = useSandboxStore((s) => s.runs)
  const setRuns = useSandboxStore((s) => s.setRuns)
  const seed = useSandboxStore((s) => s.seed)
  const setSeed = useSandboxStore((s) => s.setSeed)
  const batch = useSandboxStore((s) => s.batch)
  // S4's two scenario-level lists — NOT per side (F1/F3): a wall belongs to the
  // field, and one wave list carries both sides' arrivals.
  const walls = useSandboxStore((s) => s.walls)
  const toggleWall = useSandboxStore((s) => s.toggleWall)
  const setWallDurability = useSandboxStore((s) => s.setWallDurability)
  const reinforcements = useSandboxStore((s) => s.reinforcements)
  const addReinforcement = useSandboxStore((s) => s.addReinforcement)
  const setReinforcement = useSandboxStore((s) => s.setReinforcement)
  const removeReinforcement = useSandboxStore((s) => s.removeReinforcement)
  // R2's companies. The sheets are per side like the armies; the caps answer is
  // one slot, like the castable answer, because one sheet is open at a time.
  const addSquad = useSandboxStore((s) => s.addSquad)
  const setSquad = useSandboxStore((s) => s.setSquad)
  const removeSquad = useSandboxStore((s) => s.removeSquad)
  const placeSquad = useSandboxStore((s) => s.placeSquad)
  const unplaceSquad = useSandboxStore((s) => s.unplaceSquad)
  const setHexCapacity = useSandboxStore((s) => s.setHexCapacity)
  const squadCapsAnswer = useSandboxStore((s) => s.squadCaps)
  // SB-13's prefill is offered only when there is a campaign to read (F5). The
  // lab itself needs none — that is SB-1 — so this is the one place the screen
  // looks at campaign state at all, and it looks at the player's OWN.
  const campaign = useCampaignStore((s) => s.campaign)

  // Which caster body the editor is open on — SCREEN state, not store state:
  // it is a cursor into the setup, not part of it, and S3's export would have
  // no business serialising where the player's eye was.
  const [openCaster, setOpenCaster] = useState(null)
  // Which company's sheet is open, by id, for the same reason (R2).
  const [openSquad, setOpenSquad] = useState(null)

  const armies = { blue, red }

  // The engine's per-hex capacity, handed to the store so "does this block
  // still fit where it stands" is answered in ONE place — by the control that
  // offers to place a company and by the re-sync that follows an edit to it.
  useEffect(() => {
    setHexCapacity(info.grid.hexCapacity)
  }, [info.grid.hexCapacity, setHexCapacity])

  // ONE ROW PER BODY, never per stack (SB-6): three Mages on one hex are three
  // men who may each want a different script, and the lab exists precisely to
  // put them beside each other and watch what the once-per-side rules do.
  const casterTypes = reference?.casterTypes ?? []
  //
  // A COMPANY'S ATTACHED CASTERS APPEAR HERE TOO (D-R2-1) and are configured
  // with this same editor: they are caster bodies on the field like any other,
  // so a second editor for them would be a second place to keep the same rule.
  const casterBodies = armies[side].placements
    .filter((p) => casterTypes.includes(p.type))
    .flatMap((p) => Array.from({ length: p.count }, (_, index) => ({
      type: p.type, col: p.col, row: p.row, index,
      squadId: p.squadId ?? null,
      config: p.casters?.[index] ?? null,
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
        (p) => p.col === openCaster.col && p.row === openCaster.row && p.type === openCaster.type
          && (p.squadId ?? null) === (openCaster.squadId ?? null),
      )?.casters?.[openCaster.index]?.paths ?? {}
      : {},
  )
  useEffect(() => {
    if (!openCaster) return
    loadLabCastable(side, openCaster, openCaster.index)
  }, [side, openCaster, openPaths, openSchools])

  // The open company's sheet, re-read off the current list, and the ONE
  // question its composition spinners are drawn from: what may this company
  // field, per type? Asked of the server (R2, the D3 pattern) and re-asked
  // whenever the archetype or the upgrades move, because a caps row and a
  // type-swap row both change the answer — and `squadCaps` resolves them in an
  // order the lab must not hold a second copy of.
  //
  // Keyed on the values themselves rather than on the sheet's identity, exactly
  // as the castable question above is: renaming a company is not a new question
  // about its caps, and a re-render that changed neither asks nothing.
  const openSheet = armies[side].squads.find((q) => q.id === openSquad) ?? null
  const openArchetype = openSheet?.archetype ?? ''
  const openUpgrades = (openSheet?.upgrades ?? []).join('|')
  useEffect(() => {
    if (openSquad === null) return
    const sheet = useSandboxStore.getState()[side].squads.find((q) => q.id === openSquad)
    if (sheet) loadLabSquadCaps(side, sheet)
  }, [side, openSquad, openArchetype, openUpgrades])

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
  //
  // LOOSE BODIES ONLY, both halves (D-R2-1): `army` is what the palette
  // composed, and a company's bodies come from its sheet rather than from that
  // budget — counting them here would report a surplus no spinner could close.
  // A company that is not placed says so on its own row instead.
  const unplaced = (s) => {
    const placed = armies[s].placements
      .filter((p) => p.squadId == null)
      .reduce((sum, p) => sum + p.count, 0)
    const composed = Object.values(armies[s].army).reduce((sum, n) => sum + n, 0)
    return composed - placed
  }

  // Every body on the field, companies included — this is what the side tab
  // counts and what decides whether there is a battle to launch at all.
  const totalPlaced = (s) => armies[s].placements.reduce((sum, p) => sum + p.count, 0)

  // ANY passable hex may be SELECTED, not only one in the side being edited:
  // a wall stands where it stands and both armies meet it (F1), so the wall
  // panel has to be able to reach the middle of the field. What stays
  // zone-gated is PLACEMENT — the hex menu below draws its unit rows only for
  // the side's own zone, which is what keeps a click on a hex unambiguous about
  // whose army it is composing.
  const handleHexClick = (col, row) => {
    if (hexData(col, row).impassable) return
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
              key={`${p.side}-${p.squadId ?? 'loose'}-${p.type}`}
              // A company's stack is its OWN row on the hex, even where a loose
              // stack of the same type stands beside it — they are budgeted and
              // edited apart, so they are named apart.
              data-testid={
                `lab-glyph-${p.side}-${col}-${row}-${p.type}`
                + (p.squadId == null ? '' : `-sq${p.squadId}`)
              }
              x={x}
              y={rowY(i)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill={SIDE_COLOR[p.side]}
              // Companies wear an outline (D-R2-6): a block on a hex is a
              // different thing from bodies that merely happen to share one,
              // and the field is where that has to be visible at a glance.
              stroke={p.squadId == null ? 'none' : '#ffcc66'}
              strokeWidth={p.squadId == null ? 0 : 0.4}
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
    // Placement is the side's own business; a hex outside its zone offers the
    // wall panel and nothing else.
    if (!inZone(side, row)) return null
    const terrain = hexData(col, row).terrain
    const standing = placementsAt(side, col, row)
    // The LOOSE stacks are what the spinners edit; a company's bodies are
    // edited through its sheet and nowhere else (D-R2-1), so the menu shows the
    // block as ONE row rather than offering its types as loose counts.
    const here = Object.fromEntries(
      standing.filter((p) => p.squadId == null).map((p) => [p.type, p.count]),
    )
    const composed = Object.keys(armies[side].army)
    const blocks = armies[side].squads
      .map((sheet) => ({
        sheet,
        bodies: standing.filter((p) => p.squadId === sheet.id),
      }))
      .filter((b) => b.bodies.length > 0)

    // Room left on this hex once every OTHER body standing here is counted —
    // the same capacity arithmetic the deployment screen does, so an army that
    // fits in the lab fits in a real battle. A COMPANY'S BODIES COUNT LIKE ANY
    // OTHERS: they are outside the loose budget, not outside the hex.
    const usedByOthers = (type) =>
      standing.reduce(
        (sum, p) => (p.type === type && p.squadId == null ? sum : sum + p.count * sizeOf(p.type)),
        0,
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
        {/* The companies standing here, one row each — a block is placed and
            taken up whole, so there is nothing per-type to offer. */}
        {blocks.map(({ sheet, bodies }) => (
          <div key={sheet.id} className="lab-hex-row" data-testid={`lab-hex-squad-${sheet.id}`}>
            <span className="lab-unit-name">
              {sheet.name} — {bodies.reduce((sum, p) => sum + p.count, 0)} bodies
            </span>
            <button
              data-testid={`lab-hex-squad-unplace-${sheet.id}`}
              onClick={() => unplaceSquad(side, sheet.id)}
            >
              Unplace
            </button>
          </div>
        ))}
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
          data-testid={bodyTestId(b)}
          onClick={() => setOpenCaster(sameBody(b, editing) ? null : b)}
        >
          {b.type} · ({b.col},{b.row}) #{b.index + 1}
          {/* Whose company he rides with, if any — an attached caster is
              covered by its banner and carries its mods (13-17), so which
              charter he is in is a fact about him, not decoration. */}
          {b.squadId != null && (
            <span className="lab-hint">
              {' '}· {armies[side].squads.find((q) => q.id === b.squadId)?.name ?? `Company ${b.squadId}`}
            </span>
          )}
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
    const at = {
      type: editing.type, col: editing.col, row: editing.row, squadId: editing.squadId ?? null,
    }
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

  // ── The walls (SB-9 / F1) ───────────────────────────────────────────────
  //
  // ONE LIST FOR THE SCENARIO, edited whichever side the palette is on: a
  // rampart is a property of the FIELD, not of an army, and both armies meet
  // the one that stands between them. Painting is select-a-hex then toggle a
  // side, and the six names come off the reference — the lab keeps no copy of
  // the engine's vocabulary (17-5), here or anywhere else.
  const wallAt = (q, r, dir) => walls.find((w) => w.q === q && w.r === r && w.dir === dir) ?? null

  const wallMenu = () => {
    if (!selectedHex) return null
    const { q, r } = toAxial(selectedHex.col, selectedHex.row)

    return (
      <div className="lab-wall-menu" data-testid="lab-wall-menu">
        <h4>Walls on hex {q},{r}</h4>
        <p className="lab-hint">
          A rampart stands on the edge between two hexes, and both armies meet it — so these
          belong to the field rather than to a side. Left empty, a wall takes whatever the engine
          gives it.
        </p>
        {(reference?.hexDirections ?? []).map((dir) => {
          const wall = wallAt(q, r, dir)
          return (
            <div key={dir} className="lab-hex-row">
              <button
                className={`lab-wall-side ${wall ? 'active' : ''}`}
                data-testid={`lab-wall-${dir}`}
                onClick={() => toggleWall(q, r, dir)}
              >
                {dir}{wall ? ' — walled' : ''}
              </button>
              {wall && (
                <input
                  type="number"
                  min="0"
                  max={limits.maxWallDurability}
                  placeholder="engine default"
                  value={wall.durability ?? ''}
                  data-testid={`lab-wall-durability-${dir}`}
                  onChange={(e) => setWallDurability(
                    q, r, dir,
                    // An emptied field is the engine's own default, NOT zero — a
                    // wall at 0 is a work that falls to the first blow, which is
                    // a different thing to say.
                    e.target.value === '' ? null : clamp(e.target.value, limits.maxWallDurability),
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── The scheduled waves (SB-9 / F3) ─────────────────────────────────────
  //
  // Each row names its own SIDE in the lab's own words; the route turns that
  // into the engine's team integer, so nothing here holds a team number. A wave
  // is bodies that arrive late, and they count against the same per-side cap
  // the placed ones do (F4) — the server says so by name if a launch goes over.
  const reinforcementsPanel = () => (
    <section className="lab-reinforcements" data-testid="lab-reinforcements">
      <h3>Reinforcements</h3>
      <p className="lab-hint">
        Bodies that march on mid-battle, at the turn you name — the garrison sally the campaign
        fights with, posed as a question. They count against the same per-side limit as the
        troops already on the field.
      </p>
      {reinforcements.map((wave, index) => (
        // Index-keyed on purpose: a wave has no identity of its own, and the
        // list is only ever appended to or cut from, never reordered.
        <div key={index} className="lab-reinforce-row" data-testid={`lab-reinforce-${index}`}>
          <select
            value={wave.side}
            data-testid={`lab-reinforce-side-${index}`}
            onChange={(e) => setReinforcement(index, { side: e.target.value })}
          >
            {SIDES.map((s) => <option key={s} value={s}>{SIDE_LABEL[s]}</option>)}
          </select>
          <select
            value={wave.unit_type}
            data-testid={`lab-reinforce-type-${index}`}
            onChange={(e) => setReinforcement(index, { unit_type: e.target.value })}
          >
            {catalog.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
          </select>
          <label className="lab-launch-field">
            <span>Count</span>
            <input
              type="number"
              min="1"
              max={limits.maxReinforceCount}
              value={wave.count}
              data-testid={`lab-reinforce-count-${index}`}
              onChange={(e) => setReinforcement(index, {
                count: Math.max(1, clamp(e.target.value, limits.maxReinforceCount)),
              })}
            />
          </label>
          <label className="lab-launch-field">
            <span>Turn</span>
            <input
              type="number"
              min="1"
              value={wave.tick}
              data-testid={`lab-reinforce-tick-${index}`}
              onChange={(e) => setReinforcement(index, { tick: Math.max(1, clamp(e.target.value)) })}
            />
          </label>
          <input
            type="text"
            placeholder="what the log says when they arrive"
            value={wave.message}
            data-testid={`lab-reinforce-message-${index}`}
            onChange={(e) => setReinforcement(index, { message: e.target.value })}
          />
          <button
            data-testid={`lab-reinforce-remove-${index}`}
            onClick={() => removeReinforcement(index)}
          >
            remove
          </button>
        </div>
      ))}
      <button
        data-testid="lab-reinforce-add"
        disabled={catalog.length === 0 || reinforcements.length >= (limits.maxReinforcements ?? 0)}
        onClick={() => addReinforcement({
          // The side being edited, the first type in the catalog, one body on
          // turn one — a row that is legal the moment it appears, so nothing
          // has to be filled in before the next one can be added.
          side, unit_type: catalog[0]?.name ?? '', count: 1, tick: 1, message: '',
        })}
      >
        Schedule a wave
      </button>
    </section>
  )

  // ── The companies (R2 / R-7 / D-R2-6) ───────────────────────────────────
  //
  // THE LAB SETS THE WHOLE SHEET DIRECTLY: any catalog charter, any prestige,
  // any upgrades regardless of the slots a campaign would make you earn, any
  // banner regardless of the rank a campaign would make you reach, and any
  // attached lab caster. What it does NOT set is what the engine is told about
  // all that — `squad_mods` and `squad_abilities` are composed server-side from
  // this sheet, so what fights here is exactly what a campaign company with
  // this sheet would field.
  //
  // The one rule kept is the ARCHETYPE'S CAPS, and the spinners take their
  // ceilings from the server's own answer rather than from a table here.
  const ranks = reference?.ranks ?? []
  const rankWord = (prestige) =>
    (ranks.find((rung) => (prestige ?? 0) >= rung.min) ?? ranks.at(-1))?.label ?? ''
  const capsFor = (sheet) =>
    (squadCapsAnswer.key === squadCapsKey(side, sheet) ? squadCapsAnswer.caps : null)

  const describeComposition = (composition) =>
    Object.entries(composition ?? {})
      .filter(([, n]) => n > 0)
      .map(([type, n]) => `${n} ${type}`)
      .join(', ')

  // Enrol a company from the picker. A CHARTER prefills the sheet from its row
  // (name, archetype, composition, prestige) — R-3's "it arrives with its row's
  // opening composition", which is what makes the catalog worth offering at all
  // — while a blank one is that archetype and nothing else yet.
  const enrol = (value) => {
    const [kind, id] = value.split(':')
    if (kind === 'charter') {
      const row = (reference?.charters ?? []).find((c) => c.id === id)
      if (!row) return
      addSquad(side, {
        name: row.name,
        archetype: row.archetype,
        prestige: row.prestige ?? 0,
        composition: { ...row.composition },
      })
      return
    }
    if (kind === 'custom') addSquad(side, { archetype: id })
  }

  const squadEditor = (sheet) => {
    const caps = capsFor(sheet)
    const at = useSandboxStore.getState().squadHex(side, sheet.id)
    const canPlace = Boolean(selectedHex) && inZone(side, selectedHex?.row)
      && useSandboxStore.getState().squadFits(side, sheet.id, selectedHex.col, selectedHex.row)

    return (
      <div className="lab-squad-editor">
        <label className="lab-hex-row">
          <span className="lab-unit-name">Name</span>
          <input
            type="text"
            className="lab-squad-name"
            value={sheet.name}
            data-testid={`lab-squad-name-${sheet.id}`}
            onChange={(e) => setSquad(side, sheet.id, { name: e.target.value })}
          />
        </label>
        <label className="lab-hex-row">
          <span className="lab-unit-name">Prestige</span>
          <input
            type="number"
            min="0"
            max={limits.maxPrestige}
            value={sheet.prestige}
            data-testid={`lab-squad-prestige-${sheet.id}`}
            onChange={(e) => setSquad(side, sheet.id, {
              prestige: clamp(e.target.value, limits.maxPrestige),
            })}
          />
          {/* The rank WORD beside the number, off the served ladder — the lab
              holds no copy of the thresholds (17-5). */}
          <span className="lab-hint">{rankWord(sheet.prestige)}</span>
        </label>

        <h4>Composition</h4>
        {caps === null && <p className="lab-hint">Asking what this charter may field…</p>}
        {caps !== null && Object.keys(caps).length === 0 && (
          <p className="lab-hint">
            This archetype fields nothing the catalog knows — pick another one.
          </p>
        )}
        {Object.entries(caps ?? {}).map(([type, cap]) => (
          <label key={type} className="lab-hex-row">
            <span className="lab-unit-name">{type}</span>
            <input
              type="number"
              min="0"
              max={cap}
              value={sheet.composition[type] ?? 0}
              data-testid={`lab-squad-comp-${sheet.id}-${type}`}
              onChange={(e) => setSquad(side, sheet.id, {
                composition: { ...sheet.composition, [type]: clamp(e.target.value, cap) },
              })}
            />
            <span className="lab-hint">of {cap}</span>
          </label>
        ))}

        {/* Attached casters sit OUTSIDE the caps (decision 3, as characters do)
            and inside the hex — they are the lab's version of a character
            posted to a charter, and they are configured in the casters panel
            like every other caster body on the field. */}
        <h4>Attached casters</h4>
        {casterTypes.map((type) => (
          <label key={type} className="lab-hex-row">
            <span className="lab-unit-name">{type}</span>
            <input
              type="number"
              min="0"
              value={sheet.attached[type] ?? 0}
              data-testid={`lab-squad-attached-${sheet.id}-${type}`}
              onChange={(e) => setSquad(side, sheet.id, {
                attached: { ...sheet.attached, [type]: clamp(e.target.value) },
              })}
            />
          </label>
        ))}

        {/* ANY upgrades, regardless of slots (R-7). The slot cost is printed
            because it is what the row would cost a campaign, not because
            anything here charges it. */}
        <h4>Upgrades</h4>
        {(reference?.upgrades ?? []).map((row) => (
          <label key={row.id} className="lab-squad-upgrade">
            <input
              type="checkbox"
              checked={sheet.upgrades.includes(row.id)}
              data-testid={`lab-squad-upgrade-${sheet.id}-${row.id}`}
              onChange={(e) => setSquad(side, sheet.id, {
                upgrades: e.target.checked
                  ? [...sheet.upgrades, row.id]
                  : sheet.upgrades.filter((id) => id !== row.id),
              })}
            />
            <span className="lab-unit-name">{row.name}</span>
            <span className="lab-hint">
              {row.slots} slot{row.slots === 1 ? '' : 's'} — {row.blurb}
            </span>
          </label>
        ))}

        {/* One entry today (banner_unbroken_line), which is a fact about the
            item catalog rather than about this picker: the list is every row
            whose kind is `banner`, so a second one appears the day it is
            authored. No rank check — R-7 again. */}
        <h4>Banner</h4>
        <select
          value={sheet.banner ?? ''}
          data-testid={`lab-squad-banner-${sheet.id}`}
          onChange={(e) => setSquad(side, sheet.id, { banner: e.target.value || null })}
        >
          <option value="">No banner</option>
          {(reference?.banners ?? []).map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>

        <div className="lab-actions">
          <button
            data-testid={`lab-squad-place-${sheet.id}`}
            disabled={!canPlace}
            onClick={() => placeSquad(side, sheet.id, selectedHex.col, selectedHex.row)}
          >
            {at ? 'Move to selected hex' : 'Place on selected hex'}
          </button>
          <button
            data-testid={`lab-squad-unplace-${sheet.id}`}
            disabled={!at}
            onClick={() => unplaceSquad(side, sheet.id)}
          >
            Unplace
          </button>
          <button
            data-testid={`lab-squad-remove-${sheet.id}`}
            onClick={() => {
              removeSquad(side, sheet.id)
              setOpenSquad(null)
            }}
          >
            Remove
          </button>
        </div>
        {!canPlace && !at && (
          <p className="lab-hint">
            Select a hex in this side&apos;s zone with room for the whole block — one company
            stands on one hex.
          </p>
        )}
      </div>
    )
  }

  const squadsPanel = () => (
    <section className="lab-squads" data-testid="lab-squads">
      <h3>Companies</h3>
      <p className="lab-hint">
        A charter fights as one block on one hex. Set its sheet however you like — any prestige,
        any upgrades, any banner — and what the engine is told is composed from it, exactly as it
        would be for a campaign company with the same sheet.
      </p>
      <select
        value=""
        data-testid="lab-squad-add"
        disabled={!reference}
        onChange={(e) => {
          if (!e.target.value) return
          enrol(e.target.value)
          e.target.value = ''
        }}
      >
        <option value="">Add a company…</option>
        {(reference?.charters ?? []).map((row) => (
          <option key={row.id} value={`charter:${row.id}`}>
            {row.name} — {row.archetype} — {describeComposition(row.composition)}
            {' — '}{rankWord(row.prestige)}
          </option>
        ))}
        {(reference?.archetypes ?? []).map((row) => (
          <option key={`custom-${row.id}`} value={`custom:${row.id}`}>
            Custom company — {row.id}
          </option>
        ))}
      </select>

      {armies[side].squads.map((sheet) => {
        const at = useSandboxStore.getState().squadHex(side, sheet.id)
        return (
          <div key={sheet.id} className="lab-squad">
            <button
              className={`lab-caster-row ${openSquad === sheet.id ? 'active' : ''}`}
              data-testid={`lab-squad-${sheet.id}`}
              onClick={() => setOpenSquad(openSquad === sheet.id ? null : sheet.id)}
            >
              {sheet.name} · {sheet.archetype || 'no archetype'} · {rankWord(sheet.prestige)}
              <span className="lab-hint">
                {' '}{at ? `— at (${at.col},${at.row})` : '— not placed'}
              </span>
            </button>
            {openSquad === sheet.id && squadEditor(sheet)}
          </div>
        )
      })}
    </section>
  )

  // ── The batch readout (SB-10 / E3) ──────────────────────────────────────
  //
  // What a batch can honestly say and nothing more: how often each side won,
  // and how many of each type walked off the field on average. The rate is over
  // the runs that COMPLETED, which is the same number the server averaged over
  // (E4) — so a batch cut short reports the samples it really has rather than
  // diluting them with the runs that never happened.
  //
  // It survives the replay: launching shows the fight, and Back lands here with
  // the aggregate still on screen, which is the order the two are read in.
  const batchReadout = () => {
    if (!batch) return null
    const done = batch.runs
    const rate = (n) => (done > 0 ? Math.round((n / done) * 100) : 0)
    const meansFor = (s) => Object.entries(batch.averageSurvivors?.[s] ?? {})

    return (
      <section className="lab-batch" data-testid="lab-batch">
        <h3>
          Last launch — {done} of {batch.requested} run{batch.requested === 1 ? '' : 's'}
          {batch.seed !== null && batch.seed !== undefined && `, seed ${batch.seed}`}
        </h3>
        <p data-testid="lab-batch-wins">
          Blue {batch.wins.blue} ({rate(batch.wins.blue)}%)
          {' · '}Red {batch.wins.red} ({rate(batch.wins.red)}%)
          {' · '}Draw {batch.wins.draw} ({rate(batch.wins.draw)}%)
        </p>
        {SIDES.map((s) => (
          <p key={s} className="lab-batch-survivors" data-testid={`lab-batch-survivors-${s}`}>
            <span className="lab-unit-name">{SIDE_LABEL[s]} survivors per run:</span>{' '}
            {meansFor(s).length === 0
              ? 'none'
              : meansFor(s).map(([type, mean]) => `${type} ${mean.toFixed(1)}`).join(', ')}
          </p>
        ))}
        {/* E4: the batch ENDED, it was not voided — the runs above really
            happened, and this says why there are not more of them. */}
        {batch.incomplete && (
          <p className="lab-hint" data-testid="lab-batch-incomplete">
            The batch stopped early: {batch.incomplete}
          </p>
        )}
      </section>
    )
  }

  const nothingPlaced = totalPlaced('blue') + totalPlaced('red') === 0

  // A seed collapses the batch to a single run (E2) — DECIDED SERVER-SIDE; the
  // greyed-out spinner and the note beside it are the courtesy of saying so
  // before the launch rather than after it.
  const seeded = seed !== null
  const launchLabel = !seeded && runs > 1 ? `Fight ${runs} battles` : 'Launch the battle'

  return (
    <div className="sandbox-screen">
      <div className="lab-header">
        <h2>The Battle Lab</h2>
        <p className="lab-blurb">
          Compose both armies from the whole catalog, place them, and fight it out — no campaign,
          nothing spent, nothing learned about the host actually shadowing you.
        </p>
        {/* ── The launch panel (SB-10) ────────────────────────────────────
            One battle is one sample from a noisy distribution, so a win rate
            needs a batch; the seed answers the other question — why did THAT
            happen — and the two do not mix, which is what the note below says
            out loud rather than letting the spinner lie. */}
        <div className="lab-actions lab-launch">
          <label className="lab-launch-field">
            <span>Runs</span>
            <input
              type="number"
              min="1"
              max={limits.maxRuns}
              value={runs}
              data-testid="lab-runs"
              disabled={seeded}
              onChange={(e) => setRuns(clamp(e.target.value, limits.maxRuns))}
            />
          </label>
          <label className="lab-launch-field">
            <span>Seed</span>
            {/* Text, not a number spinner: empty is a state this field must be
                able to hold, and it means "draw fresh" rather than zero. */}
            <input
              type="text"
              inputMode="numeric"
              placeholder="fresh draw"
              value={seed ?? ''}
              data-testid="lab-seed"
              onChange={(e) => setSeed(e.target.value)}
            />
          </label>
          <button
            className="btn-primary"
            data-testid="lab-launch"
            disabled={launching || nothingPlaced}
            onClick={launchLabBattle}
          >
            {launching ? 'The armies close…' : launchLabel}
          </button>
          <button data-testid="lab-back" onClick={closeBattleLab}>Leave the lab</button>
        </div>
        {seeded && (
          <p className="lab-hint" data-testid="lab-seed-note">
            A seed repeats the whole battle exactly, so a batch of them would be one fight counted
            many times — this launch fights once.
          </p>
        )}

        {/* ── The scenario file (SB-11) ───────────────────────────────────
            Browser-local: a plain JSON file, no route and no collection, which
            is what makes a setup checkable into the repo as a fixture or
            handed over to reproduce a bug exactly. */}
        <div className="lab-actions">
          <button data-testid="lab-export" onClick={exportLabScenario}>Export setup</button>
          {/* SB-13's bonus (F5): the player's OWN campaign, composed into blue.
              Offered only when there is one loaded, and DESTRUCTIVE — it
              replaces blue's army, placements and school levels, which the
              label says out loud rather than discovering afterwards. */}
          {campaign && (
            <button data-testid="lab-prefill" onClick={prefillLabFromCampaign}>
              Prefill blue from your campaign (replaces it)
            </button>
          )}
          <label className="lab-import">
            Import setup
            <input
              type="file"
              accept="application/json,.json"
              data-testid="lab-import"
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Cleared afterwards so importing the SAME file twice fires
                // again — a re-import after an edit is the normal way to get
                // back to a known setup.
                e.target.value = ''
                if (file) importLabScenario(file)
              }}
            />
          </label>
        </div>
        {batchReadout()}
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
          {/* R2's companies, under the loose palette: the two are composed the
              same way and budgeted apart, so they read best one above the
              other rather than in separate columns. */}
          {squadsPanel()}
        </div>

        <div className="lab-casting" data-testid="lab-casting">
          {magicPanel()}
          {castersPanel()}
          {casterEditor()}
          {reinforcementsPanel()}
        </div>

        <div className="lab-field">
          <div className="hex-grid-scroll">
            <svg width={svgW} height={svgH}>
              {hexElements}
              {/* The ramparts, drawn on the edge SHARED by the walled hex and
                  its neighbour — the same wallSegment the campaign's own
                  deployment grid draws its fort with, which is why it moved
                  into utils/hexGeometry (F2). */}
              {walls.map((w) => {
                const seg = wallSegment(w.q, w.r, w.dir)
                if (!seg) return null
                return (
                  <line
                    key={`wall-${w.q}-${w.r}-${w.dir}`}
                    data-testid={`lab-wall-line-${w.q}-${w.r}-${w.dir}`}
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
          {wallMenu()}
        </div>
      </div>
    </div>
  )
}

export default SandboxScreen
