import useAuthStore from './useAuthStore'
import useNoticeStore from './useNoticeStore'
import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'
import useUiStore from './useUiStore'
import useSandboxStore, { squadBodies } from './useSandboxStore'
import {
  launchSampleBattle, getBattle, getUnits, postSandboxBattle, autoPlaceSandbox,
  getSandboxReference, postSandboxCastable, postSandboxSquadCaps,
} from '../services/api'
import { guarded } from './guarded'
import { toAxial, toOffset } from '../utils/hexGeometry'

// Composite actions that span more than one store — the "conductor" layer.
// Each individual store only ever mutates its own slice; this is the one
// place that orchestrates across them, mirroring the flow functions that
// used to live inline in App.jsx.

export const handleLogin = (u) => {
  useNoticeStore.getState().clear()
  useAuthStore.getState().login(u)
}

export const handleLogout = () => {
  useAuthStore.getState().logout()
  useUiStore.getState().setPhase('prepare')
}

export const startCampaign = guarded(async () => {
  await useCampaignStore.getState().create()
  // Open the new campaign on its scene-setter (CampaignIntro), even if the
  // player just finished one this session.
  useUiStore.getState().setIntroSeen(false)
  useUiStore.getState().setPhase('prepare')
})

// Accept the fates at the tent: they come to pass right there (server-side),
// and the reveal plays before anything else — while the player still
// remembers why they rerolled. Continue lands back on the council.
export const acceptFates = guarded(async () => {
  const report = await useCampaignStore.getState().acceptFates()
  if (!report) return
  useUiStore.getState().setDayReport({ kind: 'fates', ...report })
  useUiStore.getState().setPhase('report')
})

// The Recruiting screen's one exit — the end of the turn's decisions.
//
// Deployment exists ONLY for the decisive pitched battle: the server 400s the
// battle route until `bossFightDue`, and the placement the screen collects is
// battle-only state that nothing else reads. So on a quiet turn there is
// nothing to deploy FOR and the turn simply ends here. Walking the player
// through an empty deployment screen instead read as the game offering a battle
// that was never on offer (user, 2026-08-08).
export const breakCamp = async () => {
  // Safety net: no ending the turn past unsealed fates (e.g. a reload landed on
  // a consulted-but-unaccepted council) — acceptance comes first.
  const campaign = useCampaignStore.getState().campaign
  if (campaign?.augury?.consulted && !campaign.augury.accepted) return acceptFates()
  if (!campaign?.bossFightDue) return nextDay()
  // Marching out is a real phase step (the server's last one), so it goes
  // through the server like every other: recruiting closes behind you.
  if (await guarded(useCampaignStore.getState().advancePhase)('deploy') === undefined) return
  usePlacementStore.getState().clear()
  useUiStore.getState().setPhase('placement')
}

export const startBattle = guarded(async () => {
  const { placements, squadPlacements, characterPlacements } = usePlacementStore.getState()
  if (placements.length === 0 && Object.keys(squadPlacements).length === 0) return
  useUiStore.getState().setPhase('battling')

  const loosePlacement = placements.flatMap((p) => {
    const { q, r } = toAxial(p.col, p.row)
    const holdTurns = p.holdTurns ?? 0
    return Array.from({ length: p.count }, () => ({ unit_type: p.type, q, r, hold_turns: holdTurns }))
  })
  // Each placed squad expands into one entry per member, all tagged with
  // its squad_id/squad_name so the engine groups them into one formation
  // and the campaign server can regroup survivors after battle.
  const squads = useCampaignStore.getState().campaign?.squads ?? []
  const squadPlacement = Object.entries(squadPlacements).flatMap(([id, p]) => {
    const sq = squads.find((s) => String(s.id) === String(id))
    if (!sq) return []
    const { q, r } = toAxial(p.col, p.row)
    const holdTurns = p.holdTurns ?? 0
    return Object.entries(sq.composition).flatMap(([unit_type, n]) =>
      Array.from({ length: n }, () => ({
        unit_type, q, r, hold_turns: holdTurns, squad_id: sq.id, squad_name: sq.name,
      })),
    )
  })
  // A LONE character (13-18): one entry carrying their character_id, which is
  // how the server tells them from a roster body — casters are individuals now
  // (5-1) and there is no roster count to budget them against. Their type comes
  // from the record here only to name the entry; the server stamps every field
  // that matters from its own copy, and refuses an id that is not a living,
  // unattached character of yours.
  const characters = useCampaignStore.getState().campaign?.characters ?? []
  const characterPlacement = Object.entries(characterPlacements).flatMap(([id, p]) => {
    const character = characters.find((c) => String(c.id) === String(id))
    if (!character || !character.alive || character.squadId != null) return []
    const { q, r } = toAxial(p.col, p.row)
    return [{ unit_type: character.type, q, r, hold_turns: 0, character_id: character.id }]
  })
  const playerPlacement = [...loosePlacement, ...squadPlacement, ...characterPlacement]

  const result = await useCampaignStore.getState().fight(playerPlacement)
  if (!result) {
    useUiStore.getState().setPhase('placement') // guarded() already surfaced the error
    return
  }
  useUiStore.getState().setBattleResult(result)
  useUiStore.getState().setPhase('result')
})

// Watch a raid's replay: raids resolve server-side, so the view only knows
// the battle id — fetch the battle doc for its tick count, then play it
// through the same ReplayView every battle uses.
export const watchRaid = guarded(async (battleId) => {
  const battle = await getBattle(battleId)
  useUiStore.getState().setRaidBattle({ id: battleId, tickCount: battle.tickCount })
})

// End the turn and show the fortnight's report — the augury reveal lives
// there, so the report gets its own beat before the next council.
export const nextDay = guarded(async () => {
  const report = await useCampaignStore.getState().endDay()
  usePlacementStore.getState().clear()
  useUiStore.getState().setBattleResult(null)
  useUiStore.getState().setRaidBattle(null)
  useUiStore.getState().setDayReport(report)
  useUiStore.getState().setPhase('report')
})

// Login-screen demo: launch the hardcoded sample battle through the SAME
// engine→DB pipeline a real battle uses, then play it in ReplayView (the only
// renderer — it reads ticks back from the DB). No login needed.
export const watchDemo = async () => {
  const ui = useUiStore.getState()
  ui.setDemoLoading(true)
  useNoticeStore.getState().clear()
  try {
    ui.setDemoBattle(await launchSampleBattle())
  } catch {
    useNoticeStore.getState().show('Could not launch the demo battle — is the game server running?')
  } finally {
    ui.setDemoLoading(false)
  }
}

// ── THE BATTLE LAB (docs/CAMPAIGN_PLAN.md, "TEST / SANDBOX MODE", slice S1) ──

// Open the lab, fetching the FULL engine catalog once. Every type, not just the
// placeable ones (SB-1): composing the hypothetical enemy is half of what the
// lab is for, and Necromancers and Scorpions appear in no player roster.
//
// S2 adds a second fetch on the same terms — the caster vocabulary (paths,
// schools, caster types, SB-8's live host preset and the spinner bounds), which
// is static for the life of the build and therefore fetched exactly once, in
// the same try as the catalog: neither is any use without the other, and one
// dead server is one message.
//
// Both are fetched only if not already held, and the composed armies survive
// closing the screen — a player who ducks out to look something up comes back
// to the setup he built.
export const openBattleLab = async () => {
  // The demo replay is checked BEFORE the lab in App's screen order (it is the
  // one screen a logged-out visitor can reach), so a logged-in player watching
  // the demo would otherwise press this and see nothing happen.
  useUiStore.getState().setDemoBattle(null)
  useUiStore.getState().openLab()
  const held = useSandboxStore.getState()
  const needCatalog = held.catalog.length === 0
  const needReference = held.reference === null
  if (!needCatalog && !needReference) return
  try {
    if (needCatalog) useSandboxStore.getState().setCatalog(await getUnits())
    if (needReference) useSandboxStore.getState().setReference(await getSandboxReference())
  } catch {
    useNoticeStore.getState().show('Could not load the unit catalog — is the game server running?')
  }
}

// What ONE caster body could cast, under his own paths and his SIDE's school
// levels (D3). Asked of the server, which folds the catalog through the very
// gate The Study's own picker uses — the lab holds no copy of the rule, so
// raising a path grows the list by exactly the rule the engine applies at cast.
//
// The answer is stored under the KEY it was asked for, so a reply that arrives
// after the player has selected a different body (or moved a level again) is
// shown against nobody rather than against the wrong man.
export const loadLabCastable = guarded(async (side, placement, index) => {
  const state = useSandboxStore.getState()
  // The address carries the COMPANY too (R2): a company's attached Mage and a
  // loose Mage may share a hex and a type, and they are two different men.
  const squadId = placement.squadId ?? null
  const stack = state[side].placements.find(
    (p) => p.col === placement.col && p.row === placement.row && p.type === placement.type
      && (p.squadId ?? null) === squadId,
  )
  const key = `${side},${squadId ?? 'loose'},${placement.type},${placement.col},${placement.row},${index}`
  const { options } = await postSandboxCastable({
    paths: stack?.casters?.[index]?.paths ?? {},
    schools: state[side].magic.schools,
  })
  useSandboxStore.getState().setCastable(key, options)
})

// What ONE company may field per type (R2, the D3 pattern one field over). The
// sheet ASKS: `squadCaps` resolves the archetype row through the upgrades — a
// type-swap row before the caps bonus, an ordering that is load-bearing — so a
// copy of it here would drift the first time an effect kind is added.
//
// Keyed by the question, exactly as the castable answer is, so a reply that
// lands after the player has ticked another upgrade is shown against nobody
// rather than against a sheet it does not describe.
export const squadCapsKey = (side, sheet) =>
  `${side},${sheet?.id},${sheet?.archetype},${[...(sheet?.upgrades ?? [])].join('|')}`

export const loadLabSquadCaps = guarded(async (side, sheet) => {
  const key = squadCapsKey(side, sheet)
  const { caps } = await postSandboxSquadCaps({
    archetype: sheet?.archetype ?? '',
    upgrades: [...(sheet?.upgrades ?? [])],
  })
  useSandboxStore.getState().setSquadCaps(key, caps)
})

export const closeBattleLab = () => useUiStore.getState().closeLab()

// Auto-place one side (SB-3). The spread happens SERVER-side, through the same
// `spreadPlacement` the enemy's daily plan and both sides of a raid use, so the
// lab packs hexes exactly as the real game does. What comes back is axial and
// one entry per body; the grid draws offset stacks, so it is folded back into
// {type, col, row, count} here — the one place that conversion belongs.
// Unguarded, because the prefill below calls it as one STEP of a longer flow
// and needs a failure to abort that flow rather than be swallowed into an
// undefined the next step would build on.
const spreadLabSide = async (side) => {
  const { army, squads } = useSandboxStore.getState()[side]
  // THE BLOCKS GO WITH IT (D-R2-4). A company is placed by `addBlock` — one
  // company, one hex — and the loose army is scattered around the blocks
  // afterwards, so the server has to be told about both in one call or the two
  // halves would be laid without knowing about each other. What each company
  // sends is its BODIES: its composition plus its attached casters.
  const blocks = squads
    .map((sheet) => ({
      id: sheet.id,
      army: Object.fromEntries(squadBodies(sheet).map(({ type, count }) => [type, count])),
    }))
    .filter((block) => Object.keys(block.army).length > 0)

  const { placement } = await autoPlaceSandbox(side, army, blocks)

  const stacks = new Map()
  for (const entry of placement) {
    const { col, row } = toOffset(entry.q, entry.r)
    // A company's bodies fold into their OWN stack: the same type on the same
    // hex may be two stacks, one loose and one in a company, and the two are
    // budgeted, edited and drawn differently.
    const squadId = entry.squad_id ?? null
    const key = `${squadId ?? 'loose'},${entry.unit_type},${col},${row}`
    const stack = stacks.get(key)
    if (stack) stack.count += 1
    else stacks.set(key, {
      type: entry.unit_type, col, row, count: 1, ...(squadId === null ? {} : { squadId }),
    })
  }
  useSandboxStore.getState().setPlacements(side, [...stacks.values()])
}

export const autoPlaceLabSide = guarded(spreadLabSide)

// The seed as the WIRE wants it: an integer, or null for a fresh draw. The
// store holds what was typed, so this is the one place that reading happens.
const seedNumber = (seed) => {
  if (seed === null || seed === undefined || String(seed).trim() === '') return null
  const n = Math.trunc(Number(seed))
  return Number.isFinite(n) ? n : null
}

// Launch the composed battle. Both sides expand to ONE ENTRY PER BODY, which is
// the shape the engine's placement JSON takes everywhere else (see startBattle
// above) — the count on a lab placement is a UI convenience, never a wire
// format.
//
// R2 adds the companies, and adds them in TWO pieces that must not be confused:
// each body of a company carries `squad_id`, and the SHEETS ride at the top
// level. The sheet sends who the company is (name, archetype, prestige,
// upgrades, banner) and NOT what it is made of — the bodies above are the
// composition, and sending it twice would be inviting the two to disagree. The
// server composes `squad_mods`/`squad_abilities`/`squad_name` from the sheet
// (R-7), so nothing here computes what the engine is told about a company.
export const launchLabBattle = guarded(async () => {
  const state = useSandboxStore.getState()

  // A caster's config rides on the BODY it configures (SB-6/D2), and an EMPTY
  // field is left OFF rather than sent as {} or []: absence is how the engine's
  // own default is asked for (SB-7) — no `script` is the default walk, and no
  // `paths` leaves the constructor's own seeding alone, so an untouched Mage
  // still walks in with his Fire 1. Sending empties would overwrite that seed
  // with nothing and field a mute mage.
  const configOf = (stack, index) => {
    const caster = stack.casters?.[index]
    if (!caster) return {}
    const paths = caster.paths ?? {}
    const script = caster.script ?? []
    return {
      ...(Object.keys(paths).length > 0 ? { paths } : {}),
      ...(script.length > 0 ? { script } : {}),
    }
  }

  const expand = (side) =>
    state[side].placements.flatMap((p) => {
      const { q, r } = toAxial(p.col, p.row)
      return Array.from({ length: p.count }, (_, i) => ({
        unit_type: p.type, q, r,
        ...(p.squadId == null ? {} : { squad_id: p.squadId }),
        ...configOf(p, i),
      }))
    })

  const player_placement = expand('blue')
  const enemy_placement = expand('red')
  if (player_placement.length === 0 && enemy_placement.length === 0) return

  // The sheets, per side — identity only, since the bodies above are the
  // composition. Omitted entirely when neither side has enrolled one, so a lab
  // with no companies sends byte-for-byte the launch it sent before R2.
  const sheetOf = ({ id, name, archetype, prestige, upgrades, banner }) =>
    ({ id, name, archetype, prestige, upgrades: [...upgrades], banner })
  const squads = { blue: state.blue.squads.map(sheetOf), red: state.red.squads.map(sheetOf) }
  const anyCompanies = squads.blue.length > 0 || squads.red.length > 0

  // Scenario-level, not per side (F1/F3): a wall belongs to the FIELD, and one
  // wave list carries both sides' arrivals with each row naming whose it is.
  const { walls, reinforcements } = state

  // BOTH blocks, always (D1). The lab's default is the engine's own — every
  // school at its open level and no pool — so sending them changes nothing
  // until the player moves a spinner, and the numbers on screen are then the
  // numbers fought with rather than a silent override appearing on first touch.
  const magic = { blue: state.blue.magic, red: state.red.magic }

  state.setLaunching(true)
  try {
    // guarded() surfaces a refusal (the size cap, an unknown type) in the
    // notice bar and returns undefined, so a failed launch simply leaves the
    // player on his setup with the reason on screen.
    const summary = await postSandboxBattle({
      player_placement, enemy_placement, magic,
      ...(anyCompanies ? { squads } : {}),
      // S4's two extras, and both are OMITTED when empty — a scenario with no
      // walls sends no `fortified_sides`, which is byte-for-byte the launch the
      // lab made before this slice. A wall's `durability` follows the same rule
      // one level down: null is "whatever the engine puts there itself"
      // (DEFAULT_FORT_DURABILITY), and the way to ask for it is to say nothing.
      ...(walls.length > 0
        ? {
          fortified_sides: walls.map(({ q, r, dir, durability }) => ({
            q, r, dir, ...(durability === null || durability === undefined ? {} : { durability }),
          })),
        }
        : {}),
      // The side stays a WORD on this wire (F3): the route turns blue and red
      // into the engine's team integers, so the browser never holds one.
      ...(reinforcements.length > 0
        ? {
          reinforcements: reinforcements.map(({ side, unit_type, count, tick, message }) => ({
            side, unit_type, count, tick, ...(message ? { message } : {}),
          })),
        }
        : {}),
      runs: state.runs,
      // Sanitised HERE, once (the store keeps the string the player typed):
      // an unreadable field is no seed at all, which is the engine's own fresh
      // draw. The server sanitises it again and decides E2 — a seed collapses
      // the batch to one run — so the spinner greying out is a courtesy, not
      // the rule.
      seed: seedNumber(state.seed),
    })
    useSandboxStore.getState().setBattle(summary)
    // The aggregate rides alongside the summary on EVERY launch, a batch of one
    // included, so the readout never has to reconstruct it from a single run.
    useSandboxStore.getState().setBatch(summary?.batch ?? null)
  } finally {
    useSandboxStore.getState().setLaunching(false)
  }
})

// ── S3: the scenario file (SB-11) ───────────────────────────────────────────
//
// A saved setup is a plain JSON file and nothing else — no route, no schema, no
// collection. That is the whole of SB-11, and it is what makes a scenario
// checkable into the repo as a regression fixture or handed over to reproduce a
// bug exactly.
//
// The store IS the scenario, so the format is the store's own shape minus the
// things that are not part of a setup: the catalog and the reference (fetched),
// the selected hex and the castable answer (cursors), and the battle just
// fought (an outcome, not an input).
// BUMPED TO 2 BY S4, which added two fields to the format (the walls and the
// scheduled waves). The version is what a file is refused BY, so a format
// change has to move it.
//
// A V1 FILE STILL LOADS, deliberately: the two new fields are simply empty in
// one, so an old scenario is not a file this build has to guess at — it is a
// file that says nothing about walls, and "no walls" is a complete answer.
// Refusing it would have thrown away every fixture already saved to buy
// nothing, since there is no v1 shape this build would read wrongly. A version
// this build has never heard of is still refused rather than guessed at.
// BUMPED TO 3 BY R2, which added the companies: a side's SHEETS, and the
// `squadId` that says which body belongs to which. v1 and v2 files still load
// for the same reason a v1 file still loaded into S4 — a build that could
// enrol no company has nothing to say about them, and "no companies" is a
// complete answer rather than a shape this build would read wrongly.
export const LAB_SCENARIO_VERSION = 3
const LAB_SCENARIO_READABLE = [1, 2, 3]

const scenarioSide = (side) => ({
  army: { ...side.army },
  // Casters ride ON the stack they belong to (D2), so serialising the
  // placements serialises them — a config is a fact about the i-th body of one
  // stack, and it would mean nothing anywhere else.
  placements: side.placements.map((p) => ({
    type: p.type, col: p.col, row: p.row, count: p.count,
    // Which company this stack belongs to, or nothing at all for a loose one —
    // the absence rule this file keeps everywhere else.
    ...(p.squadId == null ? {} : { squadId: p.squadId }),
    ...(p.casters?.length > 0
      ? { casters: p.casters.map((c) => ({ paths: { ...c?.paths }, script: [...(c?.script ?? [])] })) }
      : {}),
  })),
  magic: { schools: { ...side.magic.schools }, channels: side.magic.channels },
  // The SHEETS, whole — composition and attached included, unlike the launch
  // wire. A scenario is a setup rather than a battle: the file has to be able
  // to rebuild a company that was never placed, so it carries what the company
  // IS and lets the import lay the bodies out again from it.
  squads: side.squads.map((q) => ({
    id: q.id,
    name: q.name,
    archetype: q.archetype,
    prestige: q.prestige,
    composition: { ...q.composition },
    attached: { ...q.attached },
    upgrades: [...q.upgrades],
    banner: q.banner ?? null,
  })),
})

// The scenario object as it is written to file. Split out from the download so
// the shape has one definition and the import below has something to be the
// inverse of.
export const labScenario = () => {
  const state = useSandboxStore.getState()
  return {
    version: LAB_SCENARIO_VERSION,
    blue: scenarioSide(state.blue),
    red: scenarioSide(state.red),
    runs: state.runs,
    seed: seedNumber(state.seed),
    // Scenario-level, like the two numbers above: a wall belongs to the field
    // rather than to a side (F1), and one wave list carries both sides'.
    walls: state.walls.map((w) => ({ ...w })),
    reinforcements: state.reinforcements.map((w) => ({ ...w })),
  }
}

// Hand the browser a file. Returns the serialised text as well, which is what
// makes the round trip testable without a filesystem — the download itself is
// the browser's business and nothing reads it back.
export const exportLabScenario = () => {
  const text = JSON.stringify(labScenario(), null, 2)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lab-scenario.json'
  link.click()
  // Revoked on the NEXT tick rather than this one. An object URL nobody revokes
  // holds its Blob for the life of the document, but the click only STARTS the
  // save — tearing the URL down in the same turn is a download some browsers
  // cancel out from under the player.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return text
}

// ── Import: VALIDATE FIRST, then apply through the store's own setters ───────
//
// Two rules, and both are about not half-applying a file. A wrong shape must
// leave the setup the player has standing completely untouched — an import that
// wiped an army and then failed on the magic block would be the worst outcome
// this feature could have — and nothing may enter the store except through the
// setters, so an imported scenario cannot hold a shape the store could not have
// produced itself (a caster config past the end of its stack, say).
const isBag = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isCount = (v) => Number.isFinite(v) && v >= 0

// One company sheet, on the same terms as everything else here: the shape the
// store's own setters could have produced. A v1/v2 file has no `squads` field
// at all, which reads as the empty list a side is born with.
const isBagOfCounts = (bag) => isBag(bag) && Object.values(bag).every(isCount)

const validSquad = (q) =>
  isBag(q) && Number.isInteger(q.id) && q.id > 0
  && typeof q.name === 'string' && typeof q.archetype === 'string' && isCount(q.prestige)
  && isBagOfCounts(q.composition) && isBagOfCounts(q.attached)
  && Array.isArray(q.upgrades) && q.upgrades.every((id) => typeof id === 'string')
  && (q.banner === null || typeof q.banner === 'string')

const validSide = (side) => {
  if (!isBag(side) || !isBag(side.army) || !Array.isArray(side.placements)) return false
  if (!Object.values(side.army).every(isCount)) return false
  if (!isBag(side.magic) || !isBag(side.magic.schools) || !isCount(side.magic.channels)) return false
  if (!Object.values(side.magic.schools).every(isCount)) return false
  if (side.squads !== undefined && !(Array.isArray(side.squads) && side.squads.every(validSquad)))
    return false
  // A placement's `squadId` must NAME A COMPANY OF THIS SIDE. It is the same
  // guard placing the bodies before configuring their casters is: a tag with no
  // sheet behind it would enter the store in a state the store itself could
  // never have produced, and nothing downstream could then say whose body it is.
  const ids = new Set((side.squads ?? []).map((q) => q.id))
  return side.placements.every((p) =>
    isBag(p) && typeof p.type === 'string' && Number.isFinite(p.col) && Number.isFinite(p.row)
    && isCount(p.count) && p.count > 0
    && (p.squadId === undefined || p.squadId === null || ids.has(p.squadId))
    && (p.casters === undefined || (Array.isArray(p.casters) && p.casters.every((c) =>
      isBag(c) && isBag(c.paths) && Object.values(c.paths).every(isCount)
      && Array.isArray(c.script) && c.script.every((id) => typeof id === 'string')))),
  )
}

// S4's two lists, validated on the same terms as a side: the shape the store's
// own setters could have produced, and nothing else. A v1 file has neither
// field at all, which reads as the empty list both are born as.
const validWalls = (walls) =>
  walls === undefined
  || (Array.isArray(walls) && walls.every((w) =>
    isBag(w) && Number.isFinite(w.q) && Number.isFinite(w.r) && typeof w.dir === 'string'
    && (w.durability === null || w.durability === undefined || isCount(w.durability))))

const validReinforcements = (waves) =>
  waves === undefined
  || (Array.isArray(waves) && waves.every((w) =>
    isBag(w) && (w.side === 'blue' || w.side === 'red') && typeof w.unit_type === 'string'
    && Number.isFinite(w.count) && w.count > 0 && Number.isFinite(w.tick) && w.tick >= 1
    && (w.message === undefined || typeof w.message === 'string')))

const applySide = (side, data) => {
  const store = useSandboxStore.getState()
  // Every setter mutates through set((s) => …), so this snapshot's functions
  // read the CURRENT state each time — the reads below are of a state that is
  // already being replaced.
  for (const type of Object.keys(store[side].army)) store.setArmyCount(side, type, 0)
  store.clearPlacements(side)
  // The SHEETS go in before anything is placed (D-R2-7): a company's bodies are
  // written from its sheet by placeSquad, so a block placed before its sheet
  // existed would be a block of nothing.
  store.setSquads(side, data.squads ?? [])

  for (const [type, count] of Object.entries(data.army)) store.setArmyCount(side, type, count)
  const laid = new Set()
  for (const p of data.placements) {
    // A COMPANY IS PLACED THROUGH THE SQUAD PLACER, never through `place`: its
    // bodies come from the sheet, so the file names only WHERE the block
    // stands and the store rebuilds what stands there. Once per company — the
    // file carries one row per type and they are all on the one hex.
    if (p.squadId == null) store.place(side, p.col, p.row, p.type, p.count)
    else if (!laid.has(p.squadId)) {
      store.placeSquad(side, p.squadId, p.col, p.row)
      laid.add(p.squadId)
    }
    // The bodies are placed FIRST, because setCasterConfig refuses an index
    // past the stack — which is exactly the guard that keeps an imported file
    // from configuring a man who is not there.
    ;(p.casters ?? []).forEach((caster, index) =>
      store.setCasterConfig(
        side,
        { col: p.col, row: p.row, type: p.type, squadId: p.squadId ?? null },
        index,
        { paths: { ...caster.paths }, script: [...caster.script] },
      ))
  }

  for (const [school, level] of Object.entries(data.magic.schools))
    store.setSchoolLevel(side, school, level)
  store.setChannels(side, data.magic.channels)
}

// One file's text. `Blob.text()` is the modern one-liner, but a FileReader is
// two lines rather than a dependency and covers the environments that lack it
// (jsdom, and Safari before 14) — an import is the one place a scenario can
// arrive from, so it is worth it working everywhere the lab renders.
const fileText = (file) =>
  typeof file.text === 'function'
    ? file.text()
    : new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error ?? new Error('unreadable file'))
      reader.readAsText(file)
    })

// Load a scenario from a File (the import control) or from text (a fixture, a
// paste). Anything it cannot read leaves the standing setup alone and says so.
export const importLabScenario = async (source) => {
  const notice = useNoticeStore.getState()
  let scenario
  try {
    scenario = JSON.parse(typeof source === 'string' ? source : await fileText(source))
  } catch {
    notice.show('That file could not be read as JSON — the setup is unchanged.')
    return false
  }

  // A version this build does not know is refused rather than guessed at: a
  // scenario is a fixture other people's builds will read, and half-applying a
  // future format would be a worse answer than saying no.
  if (!isBag(scenario) || !LAB_SCENARIO_READABLE.includes(scenario.version)) {
    // "1, 2 and 3" rather than a join: the list grows by one every slice that
    // moves the format, and "1 and 2 and 3" reads as a bug in the sentence.
    const readable = LAB_SCENARIO_READABLE.length > 1
      ? `${LAB_SCENARIO_READABLE.slice(0, -1).join(', ')} and ${LAB_SCENARIO_READABLE.at(-1)}`
      : String(LAB_SCENARIO_READABLE[0])
    notice.show(
      'That file is not a lab scenario this build can read (versions '
      + `${readable} are read here) — the setup is unchanged.`,
    )
    return false
  }
  if (!validSide(scenario.blue) || !validSide(scenario.red)) {
    notice.show('That lab scenario is malformed — the setup is unchanged.')
    return false
  }
  if (!validWalls(scenario.walls) || !validReinforcements(scenario.reinforcements)) {
    notice.show('That lab scenario is malformed — the setup is unchanged.')
    return false
  }

  applySide('blue', scenario.blue)
  applySide('red', scenario.red)
  const store = useSandboxStore.getState()
  store.setRuns(Number.isFinite(scenario.runs) ? scenario.runs : 1)
  store.setSeed(Number.isFinite(scenario.seed) ? String(scenario.seed) : null)
  // Absent in a v1 file, which is the same thing as empty: that build could
  // paint no walls and schedule no waves, so it has nothing to say about them.
  store.setWalls((scenario.walls ?? []).map((w) => ({ ...w, durability: w.durability ?? null })))
  store.setReinforcements((scenario.reinforcements ?? []).map((w) => ({ ...w })))
  // The outcome of the LAST setup is not the outcome of this one.
  store.setBatch(null)
  notice.show('Lab scenario loaded.')
  return true
}

// ── S4: prefill blue from the campaign (SB-13 / F5) ─────────────────────────
//
// The bonus the interview parked: *"allow the player to easily export his
// research level, units etc to plan better"*. It is the player's OWN data, so
// it raises no recon question — nothing here can tell him anything about the
// host his campaign is shadowing, which is what kept SB-1 free-standing in the
// first place.
//
// CLIENT-SIDE AND BLUE-ONLY, with no new route: every field it wants is already
// on screen somewhere in the campaign view the browser is holding. What it
// composes is what the player would otherwise type in by hand — his roster, his
// living characters, his research levels, his casters' paths and scripts.
//
// IT REPLACES BLUE'S SETUP, army, placements and schools alike. That is
// destructive, and the control says so; a prefill that merged would leave a
// half-campaign army nobody could reason about.
export const prefillLabFromCampaign = guarded(async () => {
  const campaign = useCampaignStore.getState().campaign
  if (!campaign) return
  const notice = useNoticeStore.getState()

  // 1. THE COMPANIES (R2). Every charter becomes a lab SHEET carrying its own
  // id, so the characters posted to it (character.squadId) still name the right
  // company on this side of the copy. It is the campaign's own sheet — name,
  // archetype, prestige, composition, the upgrades it has earned and the banner
  // bound to it — which is precisely what R-7 lets the lab set by hand: the
  // prefill is that typing done for you.
  const living = (campaign.characters ?? []).filter((c) => c.alive)
  const casterTypes = useSandboxStore.getState().reference?.casterTypes ?? []
  const attachedTo = (squadId) => {
    const counts = {}
    for (const character of living) {
      if (character.squadId !== squadId || !casterTypes.includes(character.type)) continue
      counts[character.type] = (counts[character.type] ?? 0) + 1
    }
    return counts
  }
  const squads = (campaign.squads ?? []).map((squad) => ({
    id: squad.id,
    name: squad.name,
    archetype: squad.archetype ?? '',
    prestige: squad.prestige ?? 0,
    composition: { ...(squad.composition ?? {}) },
    // An attached character rides with their company (5-8) — no separate
    // placement step, because the block places as one. In the lab that is a
    // caster BODY on the company's own hex, which is what `attached` is.
    attached: attachedTo(squad.id),
    upgrades: (squad.upgrades ?? []).map((row) => row.id),
    // The view sends the tier WORD in `banner` and the bound relic in
    // `bannerItem` (6-8); the sheet wants the item id, and no relic is null.
    banner: squad.bannerItem?.id ?? null,
  }))

  // 2. THE LOOSE ARMY: the roster MINUS every company's composition (a
  // composition is always a subset of the roster, which is the standing
  // campaign invariant), plus ONE BODY PER LIVING UNATTACHED CHARACTER. A
  // character is not a roster count (5-1), so the Mage who leads the army has
  // to be added here or he would not take the field at all; a Mage posted to a
  // company is already one of its bodies above. The dead stay on the rolls
  // (5-9) and off the field.
  const army = { ...(campaign.roster ?? {}) }
  for (const squad of squads)
    for (const [type, count] of Object.entries(squad.composition))
      army[type] = Math.max(0, (army[type] ?? 0) - count)
  for (const [type, count] of Object.entries(army)) if (count === 0) delete army[type]
  for (const character of living) {
    if (character.squadId != null) continue
    army[character.type] = (army[character.type] ?? 0) + 1
  }

  const store = useSandboxStore.getState()
  for (const type of Object.keys(store.blue.army)) store.setArmyCount('blue', type, 0)
  store.setSquads('blue', squads)
  for (const [type, count] of Object.entries(army)) store.setArmyCount('blue', type, count)

  // 3. THE SCHOOLS, straight off the research the player has already paid for.
  //
  // THE CHANNEL POOL IS LEFT ALONE, DELIBERATELY. A campaign's pool is decided
  // by which BANNERED SQUADS take the field (channelsForSquads) — and the lab
  // does NOT derive it even now that it has companies: SB-8 made the pool a
  // direct input here, so a number computed from the charters would be the lab
  // quietly answering a question its own spinner already asks.
  for (const [school, block] of Object.entries(campaign.research?.schools ?? {}))
    store.setSchoolLevel('blue', school, block?.level ?? 0)

  // 4. PLACE THEM THROUGH THE SERVER'S OWN SPREAD, so the lab packs hexes
  // exactly as the real game does — the same function the enemy's daily plan
  // and both sides of a raid use. The companies go with it (D-R2-4): each block
  // lands on ONE hex and the loose army is scattered around them.
  await spreadLabSide('blue')

  // 5. THE CASTERS, matched to bodies OF THEIR OWN TYPE IN PLACEMENT ORDER —
  // the same rule withCasterPaths already follows server-side, because eleven
  // Necromancers are eleven individuals and the only thing that can tell them
  // apart is the order they were laid out in. A character with no paths and no
  // script attaches nothing, which leaves that body at the engine's own choice.
  //
  // A POSTED CHARACTER QUEUES BEHIND HIS OWN COMPANY (R2), never behind a loose
  // body of the same type: he rides with the charter he is attached to, and the
  // block he is standing in is what the campaign would have put him in.
  const after = useSandboxStore.getState()
  const queueKey = (squadId, type) => `${squadId ?? 'loose'},${type}`
  const queues = new Map()
  for (const character of living) {
    if (!casterTypes.includes(character.type)) continue
    const key = queueKey(character.squadId, character.type)
    const queue = queues.get(key) ?? []
    queue.push(character)
    queues.set(key, queue)
  }

  for (const stack of after.blue.placements) {
    const queue = queues.get(queueKey(stack.squadId, stack.type))
    if (!queue?.length) continue
    for (let index = 0; index < stack.count && queue.length > 0; index++) {
      const character = queue.shift()
      after.setCasterConfig(
        'blue',
        { col: stack.col, row: stack.row, type: stack.type, squadId: stack.squadId ?? null },
        index,
        {
          // The view sends `paths: [{path, label, level}]` phrased (17-5); the
          // store wants the engine's own {path: level} bag.
          paths: Object.fromEntries((character.paths ?? []).map((p) => [p.path, p.level])),
          // His chosen script, in the order he chose it — position is priority
          // (S4-1) on both sides of this copy.
          script: (character.chosenSpells?.chosen ?? []).map((row) => row.spell),
        },
      )
    }
  }

  notice.show(
    'Blue is now your campaign army — roster, charters, characters, research and all.',
  )
})
