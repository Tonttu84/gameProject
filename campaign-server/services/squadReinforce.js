import {
  SQUAD_ARCHETYPES,
  SQUAD_REINFORCE_POOL,
  SQUAD_TROOP_BUDGET,
  SQUAD_CHARACTER_RESERVE,
} from '../utils/campaignConfig.js'
import {
  capsBonus,
  intakeBonus,
  formationFighter,
  reinforceSurcharge,
  typeSwaps,
} from './squadUpgrades.js'

// Squad reinforcement — slice 3's teeth (the archetype's caps, the pooled
// intake, the hex fence), now driven by nobody. As of 13-2 THE REFILL IS
// AUTOMATIC: it runs once at end of turn for every charter, and the player has
// no reinforce action at all. `POST /:id/squads/:squadId/reinforce` and
// SquadReinforcePanel are gone; what survives is the arithmetic they used to
// ask for.
//
// The shape is still plan-then-apply, like recruit.js's resolveHire/applyHire:
// `planAutoRefill` decides and prices, `applyReinforcement` is the only thing
// that mutates. The split earns its keep differently now — the plan is what
// slice B's on-screen FORECAST (13-6) renders before the turn ends, so what the
// player is promised and what is applied cannot drift.
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
// A TYPE-SWAP row (4d) is the one exception, and an explicit one: it rewrites
// which type a cap is FOR, so the guard cap replaces the Soldier cap outright
// and Soldier leaves the charter. It applies BEFORE the caps bonus, and that
// ordering is load-bearing — the other way round, a caps row would raise a
// Soldier cap that no longer exists and the guard cap would stay at its base.
export const squadCaps = (squad) => {
  const base = archetypeOf(squad)?.caps ?? {}
  const swaps = typeSwaps(squad)
  const bonus = capsBonus(squad)
  return Object.fromEntries(
    Object.entries(base).map(([type, cap]) => [swaps[type] ?? type, cap + bonus]),
  )
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

// Everything a charter can take on this turn, clamped by every gate rather
// than refused by any of them (13-2/13-3). This is the automatic refill's whole
// arithmetic: nobody asks for replacements any more, so there is no request to
// validate — slice 3's `planReinforcement` and its "you asked for 5, there is
// room for 3" errors went with the route that served them.
//
// CLAMP, DO NOT REFUSE, is the difference that matters. A manual draft could
// say no and leave the player to ask again for less; an end-of-turn pass has
// nobody to ask, so each gate becomes a ceiling and the refill takes what fits
// under all of them at once.
//
// The gates, unchanged from slice 3 and applied in the same spirit:
//   1. per-type CAP — the design knob (over-cap stays inert, never an error);
//   2. pooled INTAKE — bodies that may JOIN this turn, metered on the OUTPUT
//      side so caps, composition and intake stay one currency;
//   3. the hex SIZE BUDGET — the bug fence, independent of the caps;
//   4. the LOOSE POOL — bodies to draw on (13-13: nothing protects it);
//   5. the TREASURY — 13-3 keeps the price, so the refill stops when the money
//      does rather than running up a debt.
//
// TYPE ORDER IS THE CAPS TABLE'S OWN (13-5): `line` is written {Soldier,
// Pikeman} and fills soldiers to cap before it touches pikemen, so a designer
// retunes the priority by reordering one line of config. That is why this walks
// `squadCaps(squad)` rather than, say, the composition or the recipe pool.
//
// Pure: it decides, it never spends. Returns null when nothing can join, which
// is the ordinary case for a charter at full strength.
export const planAutoRefill = ({ squad, sizeOf, loose, resources }) => {
  let intakeLeft = squadIntake(squad)
  if (intakeLeft <= 0) return null

  const packing = formationFighter(squad)
  const surcharge = reinforceSurcharge(squad)
  // The hex is measured ONCE against the composition as it stands, then spent
  // down per body — squadSizePoints over a growing composition each time round
  // would be the same number recomputed, and this keeps the character reserve
  // out of the per-body arithmetic where it does not belong.
  let pointsLeft =
    SQUAD_TROOP_BUDGET -
    SQUAD_CHARACTER_RESERVE -
    squadSizePoints(squad.composition, sizeOf, packing)

  // Working copies: earlier types in this same pass really do eat the pool and
  // the purse, and a RoyalGuard row consumes the very Soldiers a later row
  // might have wanted.
  const poolLeft = { ...(loose ?? {}) }
  const purseLeft = { ...(resources ?? {}) }

  const outputs = {}
  const inputs = {}
  const cost = {}
  let bodies = 0

  for (const type of Object.keys(squadCaps(squad))) {
    const recipe = findReinforceRecipe(type)
    if (!recipe) continue

    const per = recipe.output.count
    // What one application costs, recipe plus the standard the squad's own
    // upgrades hold it to (4c) — per BODY for the surcharge, per application
    // for the recipe, exactly as slice 3 priced it.
    const perCost = { ...recipe.cost }
    for (const [resource, amount] of Object.entries(surcharge))
      perCost[resource] = (perCost[resource] ?? 0) + amount * per

    const size = sizeOf.get(type)
    if (!size) throw new Error(`no catalog size for ${type} — cannot measure the squad against the hex`)

    let apps = Math.min(
      Math.floor(canSquadAccept(squad, type) / per),
      Math.floor(intakeLeft / per),
      Math.floor(pointsLeft / (packedSize(size, packing) * per)),
    )
    for (const [inputType, amount] of Object.entries(recipe.inputs))
      apps = Math.min(apps, Math.floor((poolLeft[inputType] ?? 0) / amount))
    for (const [resource, amount] of Object.entries(perCost))
      apps = Math.min(apps, Math.floor((purseLeft[resource] ?? 0) / amount))
    if (apps <= 0) continue

    const joined = apps * per
    outputs[type] = (outputs[type] ?? 0) + joined
    for (const [inputType, amount] of Object.entries(recipe.inputs)) {
      inputs[inputType] = (inputs[inputType] ?? 0) + amount * apps
      poolLeft[inputType] -= amount * apps
    }
    for (const [resource, amount] of Object.entries(perCost)) {
      cost[resource] = (cost[resource] ?? 0) + amount * apps
      purseLeft[resource] -= amount * apps
    }
    intakeLeft -= joined
    pointsLeft -= packedSize(size, packing) * joined
    bodies += joined
  }

  return bodies === 0 ? null : { inputs, outputs, cost, bodies }
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

  const drawn = bodyLine(plan.inputs)
  const joined = bodyLine(plan.outputs)
  const from = drawn === joined ? 'from the loose ranks' : `out of ${drawn}`
  return [`${squad.name} takes on ${joined} ${from} (${costLine(plan.cost)}).`]
}

// ── The end-of-turn pass (13-2) ─────────────────────────────────────────────
//
// Every charter, in ROLL ORDER (13-4): flat, oldest first, so the shortfall
// lands on whoever is last. Deliberately not neediest-first or by prestige —
// both were considered and rejected as rules the player would have to learn
// before they could predict their own army.
//
// The pool and the purse are re-read per charter rather than tracked across the
// loop, because applyReinforcement has already spent them: whatever the 1st
// Cohort took is simply not there when the Skirmishers are priced. That is the
// whole of 13-4's ordering rule, and it needs no bookkeeping to be true.
//
// Mutates the campaign in place; the caller saves. Returns log lines, the same
// contract as applyHire and applyEffect.
export function refillSquads(campaign, sizeOf) {
  const entries = []
  for (const squad of campaign.squads ?? []) {
    const plan = planAutoRefill({
      squad,
      sizeOf,
      loose: looseRoster(campaign),
      resources: campaign.resources,
    })
    if (!plan) continue
    entries.push(...applyReinforcement(campaign, squad, plan))
  }
  return entries
}
