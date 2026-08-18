import {
  SQUAD_ARCHETYPES,
  SQUAD_REINFORCE_POOL,
  SQUAD_TROOP_BUDGET,
  SQUAD_CHARACTER_RESERVE,
} from '../utils/campaignConfig.js'
import { capsBonus, intakeBonus, formationFighter, reinforceSurcharge } from './squadUpgrades.js'

// Squad reinforcement — the squad overhaul's slice 3 (docs/CAMPAIGN_PLAN.md
// "SLICE 3 — reinforcement"). Slice 2 stored the archetype and its caps and
// enforced nothing, deliberately: nothing added troops to a squad until this
// file existed. These are the teeth.
//
// The shape is plan-then-apply, like recruit.js's resolveHire/applyHire:
// `planReinforcement` prices and refuses, `applyReinforcement` is the only
// thing that mutates. That split is what makes the route's ATOMIC contract
// cheap — a rejection has spent nothing because nothing ran.
//
// Three independent gates, in order of what they protect:
//   1. the per-type CAP — a design knob. Over-cap is INERT, never an error:
//      the user is content for squads to run over-strength, so a full squad
//      simply offers no room and shrinks back through casualties.
//   2. the pooled INTAKE — how many bodies may JOIN this turn, metered on the
//      OUTPUT side (decision C), so caps, composition and intake are all one
//      currency and the arithmetic is min(capHeadroom, intakeRemaining).
//   3. the hex SIZE BUDGET — not a knob but a bug fence. A squad is one
//      formation on one hex; a squad that outgrows the hex loses cohesion on
//      the raid route (see enemyPlacement.addBlock, which now throws rather
//      than scattering it).

// Composition, roster and request are Maps in the DB and plain objects in the
// pure tests; mongoose Maps ARE Maps, so one reader covers both.
const readCount = (bag, key) => (bag instanceof Map ? bag.get(key) : bag?.[key]) ?? 0
const entriesOf = (bag) => (bag instanceof Map ? [...bag.entries()] : Object.entries(bag ?? {}))

// The archetype row a charter points at, or null. Unknown ids degrade to null
// rather than throwing: acquisition (decision 11) can add rows, and a campaign
// carrying an id a later edit removed must still load.
export const archetypeOf = (squad) => SQUAD_ARCHETYPES[squad?.archetype] ?? null

// Permitted types are the KEYS of `caps` — never a second list beside them
// (see the config comment: that is the placeable/spawnable mistake UnitRole
// fixed). No archetype ⇒ nothing is permitted and nothing is reinforceable.
//
// UPGRADES SIT BETWEEN THE ARCHETYPE ROW AND HERE (slice 4a): the archetype is
// the base, a caps row widens it. Only the types the archetype already NAMES
// are raised — an upgrade widens the muster, it never admits a type the charter
// was not written for, so the keys are untouched and a squad with no archetype
// still gets nothing. Every caller reads caps through this function, so the
// bonus reaches the reinforcement gates, campaignView and the panel at once.
export const squadCaps = (squad) => {
  const base = archetypeOf(squad)?.caps ?? {}
  const bonus = capsBonus(squad)
  if (bonus === 0) return base
  return Object.fromEntries(Object.entries(base).map(([type, cap]) => [type, cap + bonus]))
}

// Same shape: no archetype ⇒ 0 and no upgrade can lift it off the floor, since
// a charter with nothing to reinforce into cannot take replacements at all.
export const squadIntake = (squad) => {
  const archetype = archetypeOf(squad)
  if (!archetype) return 0
  return archetype.intake + intakeBonus(squad)
}

// Guarded lookup by OUTPUT type, the findRecruitEntry convention: a type whose
// row has left the pool comes back undefined and degrades to a 400 rather than
// throwing on `.inputs`.
export const findReinforceRecipe = (type) => SQUAD_REINFORCE_POOL.find((r) => r.output.type === type)

// Room for more of one type: cap − what is there, floored at 0. A type the
// archetype does not name has no cap and therefore no room — it keeps
// fighting, it just can never be replaced.
export const canSquadAccept = (squad, type) => {
  const cap = squadCaps(squad)[type]
  if (cap === undefined) return 0
  return Math.max(0, cap - readCount(squad?.composition, type))
}

// One body's PACKING size — the room it takes on a hex, as opposed to the body
// itself (4c). The engine's AUnit::getPackingSize is the original and this must
// stay its twin, floor included: the two measure the same hex, and a layer that
// floors differently would let this gate pass a squad the engine then refuses
// to seat. `packing` is the squad's formation-fighter value, 0 for a squad
// without the upgrade.
export const packedSize = (size, packing = 0) => Math.max(1, size - packing)

// A composition's footprint in engine SIZE POINTS (troops only — the character
// reserve is added by the gate below, not here, so this stays "what the bodies
// occupy"). PACKING points, because this measures the hex: a drilled squad
// really does leave room behind it. An unknown type THROWS: a squad holding a
// type the catalog does not know is a data bug, and slice 3's standing call is
// loud failures while the design is early — a size silently read as 0 would
// overfill a hex.
export const squadSizePoints = (composition, sizeOf, packing = 0) => {
  let points = 0
  for (const [type, count] of entriesOf(composition)) {
    const size = sizeOf.get(type)
    if (!size) throw new Error(`no catalog size for ${type} — cannot measure the squad against the hex`)
    points += packedSize(size, packing) * count
  }
  return points
}

// loose = roster − Σ squads[*].composition, per type: the unassigned bodies a
// reinforcement destroys. The campaign layer's standing invariant (a squad's
// composition is always a subset already reflected in the roster, never a
// separate pool) written down as one function, since slice 3 is the first
// thing that moves a body ACROSS that line rather than adding to both sides.
export const looseRoster = (campaign) => {
  const loose = {}
  for (const [type, count] of entriesOf(campaign.roster)) loose[type] = count
  for (const squad of campaign.squads ?? [])
    for (const [type, count] of entriesOf(squad.composition)) loose[type] = (loose[type] ?? 0) - count
  return loose
}

// Price a whole request — `{ Cavalry: 1, LightCavalry: 1 }`, counts of OUTPUT
// bodies — against every gate, and return either `{ error }` or the plan
// applyReinforcement consumes. Pure: it decides, it never spends. The request
// is all-or-nothing, so the first refusal ends it and the caller has nothing
// to unwind.
export const planReinforcement = ({ squad, request, sizeOf, loose, resources }) => {
  const asked = Object.entries(request ?? {})
  if (asked.length === 0) return { error: 'name at least one troop type to reinforce' }
  for (const [type, count] of asked)
    if (!Number.isInteger(count) || count <= 0)
      return { error: `${type}: ask for a whole number of replacements` }

  if (!archetypeOf(squad))
    return { error: `${squad?.name ?? 'that squad'} has no archetype, so nothing can be trained into it` }

  const inputs = {}
  const cost = {}
  let bodies = 0
  for (const [type, count] of asked) {
    const recipe = findReinforceRecipe(type)
    if (!recipe) return { error: `there is no way to train replacement ${type}` }

    const headroom = canSquadAccept(squad, type)
    if (headroom === 0 && squadCaps(squad)[type] === undefined)
      return { error: `${squad.name} does not take ${type} into its ranks` }
    if (count > headroom)
      return { error: `${squad.name} has room for ${headroom} more ${type}, not ${count}` }

    // Output-side metering means a one-to-many recipe is only orderable in
    // whole applications — asking for 5 of a 3-at-a-time row would otherwise
    // have to round, and a silent clamp is exactly what decision F forbids.
    if (count % recipe.output.count !== 0)
      return { error: `${type} is trained ${recipe.output.count} at a time` }
    const applications = count / recipe.output.count

    for (const [inputType, per] of Object.entries(recipe.inputs))
      inputs[inputType] = (inputs[inputType] ?? 0) + per * applications
    for (const [resource, per] of Object.entries(recipe.cost))
      cost[resource] = (cost[resource] ?? 0) + per * applications
    bodies += count
  }

  // The upgrade surcharge (4c): what a squad's taken ROWS add to every body it
  // brings in, on top of the recipe. Per BODY rather than per application, so a
  // one-to-many recipe pays for each body it produces — the recipe prices the
  // transformation, this prices the standard the squad now has to meet.
  for (const [resource, per] of Object.entries(reinforceSurcharge(squad)))
    cost[resource] = (cost[resource] ?? 0) + per * bodies

  // Gate 2: the pooled intake, in bodies that JOIN — however many were
  // destroyed to make them. Pooled rather than per type on purpose: a per-type
  // allowance would let an archetype's real refill rate scale with how many
  // types it admits, so vanguard (2) would quietly outpace line (10).
  const intake = squadIntake(squad)
  if (bodies > intake)
    return { error: `${squad.name} takes at most ${intake} replacements a turn, not ${bodies}` }

  // Gate 3: the hex. Independent of the caps by design — over-cap is a design
  // knob, over-hex is a bug (decision G).
  const after = Object.fromEntries(entriesOf(squad.composition))
  for (const [type, count] of asked) after[type] = (after[type] ?? 0) + count
  const points = squadSizePoints(after, sizeOf, formationFighter(squad)) + SQUAD_CHARACTER_RESERVE
  if (points > SQUAD_TROOP_BUDGET)
    return {
      error: `${squad.name} would not fit its own hex (${points} of ${SQUAD_TROOP_BUDGET} size points, characters included)`,
    }

  for (const [type, count] of Object.entries(inputs)) {
    const available = loose?.[type] ?? 0
    if (available < count)
      return { error: `only ${available} unassigned ${type} to draw on, and ${count} are needed` }
  }

  for (const [resource, count] of Object.entries(cost))
    if ((resources?.[resource] ?? 0) < count)
      return { error: `not enough ${resource} — ${count} needed` }

  return { inputs, outputs: Object.fromEntries(asked), cost, bodies }
}

const costLine = (cost) =>
  Object.entries(cost)
    .map(([resource, count]) => `−${count} ${resource}`)
    .join(', ')

const bodyLine = (bag) =>
  Object.entries(bag)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ')

// Mutates the campaign in place; the caller saves. Returns log lines, the same
// contract as recruit.js's applyHire and events.js's applyEffect.
//
// The two sides move INDEPENDENTLY — destroy the inputs, create the outputs —
// because they are unconnected (decision A). Do not "optimise" this into a
// net-zero swap on the strength of today's 1:1 rows: a many-to-one recipe
// really does shrink the army, and the roster is not conserved in general.
export function applyReinforcement(campaign, squad, plan) {
  for (const [resource, count] of Object.entries(plan.cost))
    campaign.resources[resource] -= count

  for (const [type, count] of Object.entries(plan.inputs))
    campaign.roster.set(type, (campaign.roster.get(type) ?? 0) - count)

  for (const [type, count] of Object.entries(plan.outputs)) {
    campaign.roster.set(type, (campaign.roster.get(type) ?? 0) + count)
    squad.composition.set(type, (squad.composition.get(type) ?? 0) + count)
  }

  // The once-per-turn ledger: a day stamp on the charter, mirroring
  // recruit.drawnDay's sealed-day convention. It survives a wipe with the
  // charter and needs no end-of-day clearing.
  squad.reinforcedDay = campaign.day

  const drawn = bodyLine(plan.inputs)
  const joined = bodyLine(plan.outputs)
  const from = drawn === joined ? 'from the loose ranks' : `out of ${drawn}`
  return [`${squad.name} takes on ${joined} ${from} (${costLine(plan.cost)}).`]
}
