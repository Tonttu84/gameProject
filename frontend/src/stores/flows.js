import useAuthStore from './useAuthStore'
import useNoticeStore from './useNoticeStore'
import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'
import useUiStore from './useUiStore'
import useSandboxStore from './useSandboxStore'
import {
  launchSampleBattle, getBattle, getUnits, postSandboxBattle, autoPlaceSandbox,
  getSandboxReference, postSandboxCastable,
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
  const stack = state[side].placements.find(
    (p) => p.col === placement.col && p.row === placement.row && p.type === placement.type,
  )
  const key = `${side},${placement.type},${placement.col},${placement.row},${index}`
  const { options } = await postSandboxCastable({
    paths: stack?.casters?.[index]?.paths ?? {},
    schools: state[side].magic.schools,
  })
  useSandboxStore.getState().setCastable(key, options)
})

export const closeBattleLab = () => useUiStore.getState().closeLab()

// Auto-place one side (SB-3). The spread happens SERVER-side, through the same
// `spreadPlacement` the enemy's daily plan and both sides of a raid use, so the
// lab packs hexes exactly as the real game does. What comes back is axial and
// one entry per body; the grid draws offset stacks, so it is folded back into
// {type, col, row, count} here — the one place that conversion belongs.
export const autoPlaceLabSide = guarded(async (side) => {
  const { army } = useSandboxStore.getState()[side]
  const { placement } = await autoPlaceSandbox(side, army)

  const stacks = new Map()
  for (const entry of placement) {
    const { col, row } = toOffset(entry.q, entry.r)
    const key = `${entry.unit_type},${col},${row}`
    const stack = stacks.get(key)
    if (stack) stack.count += 1
    else stacks.set(key, { type: entry.unit_type, col, row, count: 1 })
  }
  useSandboxStore.getState().setPlacements(side, [...stacks.values()])
})

// Launch the composed battle. Both sides expand to ONE ENTRY PER BODY, which is
// the shape the engine's placement JSON takes everywhere else (see startBattle
// above) — the count on a lab placement is a UI convenience, never a wire
// format. No squad_id rides along: the lab fields loose troops, the same as the
// campaign's own loose roster does, and squads are not part of this slice.
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
        unit_type: p.type, q, r, ...configOf(p, i),
      }))
    })

  const player_placement = expand('blue')
  const enemy_placement = expand('red')
  if (player_placement.length === 0 && enemy_placement.length === 0) return

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
    state.setBattle(await postSandboxBattle({ player_placement, enemy_placement, magic }))
  } finally {
    useSandboxStore.getState().setLaunching(false)
  }
})
