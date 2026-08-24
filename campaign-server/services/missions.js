// Missions — docs/CAMPAIGN_PLAN.md, "DECISION 12 — MISSIONS".
//
// A fate may ask for a charter. Sending one costs its absence for several turns
// and pays prestige when it comes home. The shape the interview settled, because
// a later reader will otherwise fold it back into the raid ledger:
//
//   - A MISSION IS NOT A RAID (12-3). `raid.squadAssignment` is "spent on a raid
//     today" and is wiped at newDay; a mission spans turns and lives on the
//     charter. The user chose two states over one because they promise different
//     things to a player — back tonight is not back on day 9 — so availability
//     asks two questions and the squad screen renders three states.
//   - AWAY IS AWAY (12-5). A charter on a mission is off the raid board, off the
//     battlefield and out of the boss-fight meter's arithmetic. It still eats:
//     they are your men, on your errand.
//   - THE NUMBERS ARE NOT STORED. `turns` and `prestige` are read back off the
//     event's own effect row, so retuning a mission reaches the ones already
//     under way — the same reason `archetype` and `upgrades` store ids rather
//     than resolved values.
//
// THIS MODULE IMPORTS NOTHING, deliberately. events.js owns EVENT_POOL and needs
// these predicates for the `freeSquads` gate; if this file reached back for the
// pool the two would import each other. So the event lookup is passed IN
// (returnMissions takes it), and the dependency runs one way only.

// Mongoose Maps in the DB, plain objects in tests and at creation — one reader
// for both, the entriesOf convention squadReinforce.js already uses.
const entriesOf = (bag) =>
  bag instanceof Map ? [...bag.entries()] : Object.entries(bag ?? {})

// Away or not. Presence-based rather than a date comparison ON PURPOSE: the
// field is cleared by returnMissions() at newDay, so "has a mission" and "is
// away" are the same question asked once. A document carrying a mission whose
// day has passed (a save restored across a schema change, a clock moved) still
// reads as away until the next newDay clears it, which is the safe direction —
// it cannot put a charter on two errands at once.
export const onMission = (squad) => Boolean(squad?.mission)

// Can this charter be sent? Not away already, and not a wiped charter — one at
// composition {} is a normal state (decision 14) and must not be sendable, the
// same rule the raid route enforces per squad.
export const canTakeMission = (squad) =>
  !onMission(squad) && entriesOf(squad?.composition).some(([, n]) => n > 0)

// The charters that could go, in roll order (oldest first, the 13-4 convention).
export const availableSquads = (campaign) =>
  [...(campaign?.squads ?? [])].filter(canTakeMission)

// Bodies currently away, per type. The meter and the take-the-field gate both
// subtract this: a charter on a mission is not in camp, and `roster` holds the
// WHOLE army (squad compositions are a subset of it), so without this the game
// would go on counting men who are three days' march away.
export const missionBodies = (campaign) => {
  const away = new Map()
  for (const squad of campaign?.squads ?? []) {
    if (!onMission(squad)) continue
    for (const [type, n] of entriesOf(squad.composition))
      away.set(type, (away.get(type) ?? 0) + n)
  }
  return away
}

export const missionBodiesOf = (campaign, type) => missionBodies(campaign).get(type) ?? 0

// The offer a mission fate makes (12-1): up to two charters that could go,
// drawn at random from those available, plus the LOCKED near-miss shown when
// only one qualified.
//
// Roguelite on purpose — not the whole roll. The locked slot names a real
// charter rather than a blank, because that is what teaches the mechanic: a
// player who sees the same cohort locked twice learns that a charter can only
// be in one place at a time.
//
// The caller SEALS the result on the pending decision; nothing here is
// idempotent, and drawing twice would let a reload reshuffle the pair.
export const drawMissionOffer = (campaign, count = 2) => {
  const free = availableSquads(campaign)
  const shuffled = [...free]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const picks = shuffled.slice(0, count).map((s) => s.id)
  // The near-miss: a charter that exists but cannot go. Prefer one that is away
  // on a mission (the state this whole mechanic teaches) over a wiped one.
  const others = (campaign?.squads ?? []).filter((s) => !picks.includes(s.id))
  const locked = picks.length < count
    ? (others.find(onMission) ?? others[0])?.id ?? null
    : null
  return { picks, locked }
}

// Why a charter cannot be sent, in the vocabulary the player reads (12-2).
// One word per state, and only states that EXIST — a wiped charter is a real
// one (decision 14), a third reason is not invented here.
export const missionBlocker = (squad) => {
  if (onMission(squad)) return 'mission'
  if (!canTakeMission(squad)) return 'empty'
  return null
}

// Send a charter. Called from the choice route the moment the fate is answered
// (12-7): they are gone from that instant, so the raid board greys them out this
// same turn rather than after one free sortie.
//
// `untilDay` is the day they are BACK — day + turns, so "gone 3 turns" is three
// turns the player plays without them.
export const beginMission = (campaign, squad, { turns, eventId }) => {
  squad.mission = { untilDay: campaign.day + turns, eventId }
  return `${squad.name} marches out — away until day ${squad.mission.untilDay}.`
}

// Homecomings, run at newDay before anything else reads availability. Returns
// the report lines (the day report says what actually happened).
//
// `effectFor` is events.js's missionEffectFor, passed in rather than imported —
// see the note at the top of this file. An event that has left the pool pays
// nothing rather than throwing: the findUpgrade/archetypeOf convention, and it
// matters for the same reason, a campaign in flight must still load after a
// catalog edit.
export const returnMissions = (campaign, effectFor = () => null) => {
  const lines = []
  for (const squad of campaign?.squads ?? []) {
    if (!onMission(squad)) continue
    if (squad.mission.untilDay > campaign.day) continue
    const prestige = effectFor(squad.mission.eventId)?.prestige ?? 0
    squad.prestige = (squad.prestige ?? 0) + prestige
    squad.mission = undefined
    lines.push(
      prestige > 0
        ? `${squad.name} is back from its mission — +${prestige} prestige.`
        : `${squad.name} is back from its mission.`,
    )
  }
  return lines
}
