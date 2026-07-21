import useAuthStore from './useAuthStore'
import useNoticeStore from './useNoticeStore'
import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'
import useUiStore from './useUiStore'
import { launchSampleBattle, getBattle } from '../services/api'
import { guarded } from './guarded'

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

export const musterForBattle = () => {
  // Safety net: no marching past unsealed fates (e.g. a reload landed on a
  // consulted-but-unaccepted council) — acceptance comes first.
  const augury = useCampaignStore.getState().campaign?.augury
  if (augury?.consulted && !augury.accepted) return acceptFates()
  usePlacementStore.getState().clear()
  useUiStore.getState().setPhase('placement')
}

const toAxial = (col, row) => ({ q: col - Math.floor(row / 2), r: row })

export const startBattle = guarded(async () => {
  const { placements, squadPlacements } = usePlacementStore.getState()
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
  const playerPlacement = [...loosePlacement, ...squadPlacement]

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
