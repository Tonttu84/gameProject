import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'

// One canonical computation site for values that used to be scattered
// through App.jsx's render body and re-derived independently by every
// consumer — the pattern flagged (docs/CAMPAIGN_PLAN.md, 2026-07-16) as the
// root cause behind a past bug (militia units invisible to placement UI).
// Plain hooks, not a store: each composes reads from campaign/placement
// state and has no state of its own.

export const useRoster = () => useCampaignStore((s) => s.campaign?.roster ?? {})

export const useTotalUnits = () => {
  const roster = useRoster()
  return Object.values(roster).reduce((a, b) => a + b, 0)
}

export const useSquads = () => useCampaignStore((s) => s.campaign?.squads ?? [])

export const useForageAssignment = () =>
  useCampaignStore((s) => s.campaign?.forage?.assignment ?? {})

export const useSquadCommitted = () => {
  const squads = useSquads()
  const committed = {}
  squads.forEach((sq) =>
    Object.entries(sq.composition).forEach(([type, n]) => {
      committed[type] = (committed[type] ?? 0) + n
    }),
  )
  return committed
}

// Units out foraging are unavailable for this turn's battle line. Squad
// members are earmarked to their squad and aren't offered individually
// under "Troops" — a squad is placed as a whole, not built up unit-by-unit.
export const useAvailableRoster = () => {
  const roster = useRoster()
  const forageAssignment = useForageAssignment()
  const squadCommitted = useSquadCommitted()
  return Object.fromEntries(
    Object.entries(roster).map(([type, n]) =>
      [type, n - (forageAssignment[type] ?? 0) - (squadCommitted[type] ?? 0)]),
  )
}

export const usePlacedCount = () =>
  usePlacementStore((s) => s.placements.reduce((sum, p) => sum + p.count, 0))

export const useSquadPlacedCount = () => {
  const squadPlacements = usePlacementStore((s) => s.squadPlacements)
  const squads = useSquads()
  return Object.keys(squadPlacements).reduce((sum, id) => {
    const sq = squads.find((s) => String(s.id) === String(id))
    if (!sq) return sum
    return sum + Object.values(sq.composition).reduce((a, b) => a + b, 0)
  }, 0)
}

// Battle commits the WHOLE army (user, 2026-07-05): only foragers stay
// behind. Fight unlocks when every available unit — loose stock AND every
// squad — is on the field; the server enforces the same rule.
export const useTotalAvailableCount = () => {
  const roster = useRoster()
  const forageAssignment = useForageAssignment()
  return (
    Object.values(roster).reduce((a, b) => a + b, 0) -
    Object.values(forageAssignment).reduce((a, b) => a + b, 0)
  )
}

export const useInCamp = () => {
  const totalAvailableCount = useTotalAvailableCount()
  const placedCount = usePlacedCount()
  const squadPlacedCount = useSquadPlacedCount()
  return totalAvailableCount - placedCount - squadPlacedCount
}
