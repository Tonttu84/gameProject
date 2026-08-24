import useCampaignStore from './useCampaignStore'
import usePlacementStore from './usePlacementStore'

// One canonical computation site for values that used to be scattered
// through App.jsx's render body and re-derived independently by every
// consumer — the pattern flagged (docs/CAMPAIGN_PLAN.md, 2026-07-16) as the
// root cause behind a past bug (militia units invisible to placement UI).
// Plain hooks, not a store: each composes reads from campaign/placement
// state and has no state of its own.

// Stable fallback references for zustand selectors below: a fresh `{}`/`[]`
// literal in a selector's `??` branch is a NEW object on every call, which
// useSyncExternalStore treats as "changed" every render — an infinite
// render loop. Fall back to one shared empty instance instead.
export const EMPTY_OBJECT = {}
export const EMPTY_ARRAY = []

export const useRoster = () => useCampaignStore((s) => s.campaign?.roster ?? EMPTY_OBJECT)

export const useTotalUnits = () => {
  const roster = useRoster()
  return Object.values(roster).reduce((a, b) => a + b, 0)
}

export const useSquads = () => useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)

export const useRaidAssignment = () =>
  useCampaignStore((s) => s.campaign?.raid?.assignment ?? EMPTY_OBJECT)

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

// Units out raiding are unavailable for this turn's battle line — foraging is
// passive since S2 and no longer holds anyone back (docs/CAMPAIGN_PLAN.md
// "Effort slider" decision 2). Squad members are earmarked to their squad and
// aren't offered individually under "Troops" — a squad is placed as a whole,
// not built up unit-by-unit.
export const useAvailableRoster = () => {
  const roster = useRoster()
  const raidAssignment = useRaidAssignment()
  const squadCommitted = useSquadCommitted()
  return Object.fromEntries(
    Object.entries(roster).map(([type, n]) =>
      [type, n - (raidAssignment[type] ?? 0) - (squadCommitted[type] ?? 0)]),
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

// Lone characters placed by hand (13-18). Counted SEPARATELY from the troop
// tallies below and never folded into them: a character is not a roster count
// (5-1), so the "whole army on the field" arithmetic — roster minus raiders
// minus placed — has nothing to weigh them against. The server draws the same
// line, budgeting characters against the character list and the roster against
// itself.
export const useCharacterPlacedCount = () =>
  usePlacementStore((s) => Object.keys(s.characterPlacements).length)

// Battle commits the WHOLE army (user, 2026-07-05): only raiders stay behind
// (foraging is passive since S2). Fight unlocks when every available unit —
// loose stock AND every squad — is on the field; the server enforces the
// same rule.
export const useTotalAvailableCount = () => {
  const totalUnits = useTotalUnits()
  const raidAssignment = useRaidAssignment()
  return totalUnits - Object.values(raidAssignment).reduce((a, b) => a + b, 0)
}

export const useInCamp = () => {
  const totalAvailableCount = useTotalAvailableCount()
  const placedCount = usePlacedCount()
  const squadPlacedCount = useSquadPlacedCount()
  return totalAvailableCount - placedCount - squadPlacedCount
}

// A charter's availability, in one sentence (docs/CAMPAIGN_PLAN.md 12-2/13-11).
// THREE states now that decision 12 has landed: in camp, out raiding today, or
// away on a mission until a named day. Two fields, because a raid and a mission
// are deliberately different things (12-3) — a raid is spent-today and wiped at
// newDay, a mission spans turns and lives on the charter.
//
// One canonical phrasing site, per the store convention: the roll and the
// charter page both read it, so the army cannot describe itself two ways.
// `long` is the charter page's fuller line, which also says what it costs you.
export const availabilityOf = (squad, raidingIds, { long = false } = {}) => {
  if (squad?.mission)
    return long
      ? `Away on a mission — back on day ${squad.mission.untilDay}. It will not raid or stand in the line until then.`
      : `On a mission until day ${squad.mission.untilDay}`
  if (raidingIds.has?.(squad?.id) ?? raidingIds.includes?.(squad?.id))
    return long ? 'Out raiding today — it will not stand in the line.' : 'Out raiding today'
  return long ? 'In camp, ready.' : 'In camp, ready'
}
