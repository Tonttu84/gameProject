import {
  FORAGE_KG_PER_POINT,
  FORAGE_FOOD_SHARE,
  FORAGE_MATERIALS_SHARE,
  FORAGE_YIELD_BY_BAND,
  FORAGE_RING_YIELD,
} from '../utils/campaignConfig.js'

// Foraging step of day resolution — S2 "effort slider" (docs/CAMPAIGN_PLAN.md):
// foraging is now PASSIVE. There is no per-unit assignment and no forager
// clash — the player's slider share of the turn's ONE field-points pool
// converts straight to kg, and the enemy drains the same rings by a flat,
// abstract amount with no credit of its own. Both strip the same three rings,
// near depletes first, nothing grows back.

// Forage posture (Stage 4 1d): the scouting band's yield multiplier, ×1 for
// an unknown/absent band (same degrade-safely convention as the catalog
// guards).
export const forageYieldMultiplier = (band) => FORAGE_YIELD_BY_BAND[band] ?? 1

// Pool points → raw kg capacity this turn, before the ring distance curve.
export const forageCapacityKg = (points, band) =>
  Math.floor(Math.max(0, points) * FORAGE_KG_PER_POINT * forageYieldMultiplier(band))

// Standing pressures (S3): fold every modifier aimed at `target` into one kg
// figure — all the factors multiply, all the deltas then add, and the result
// floors at 0 (a big enough setback zeroes the figure, it never goes negative).
// Multiply-then-add so a factor always scales the BASE rather than someone
// else's flat grant, which keeps the result independent of array order.
// Collapse every modifier aimed at `target` into the single {factor, deltaKg}
// pair that describes their combined effect. campaignView ships this pair to
// the client so the slider's live preview applies the same bend the server will
// (the client interpolates capacity as the share moves, so it needs the
// coefficients, not a precomputed total).
export const foldForageModifiers = (modifiers, target) =>
  (modifiers ?? [])
    .filter((m) => m.target === target)
    .reduce(
      (acc, m) => ({ factor: acc.factor * (m.factor ?? 1), deltaKg: acc.deltaKg + (m.deltaKg ?? 0) }),
      { factor: 1, deltaKg: 0 },
    )

// Age the standing pressures by one turn, returning the survivors. Called at
// newDay AFTER the day they were in force has resolved, so a turnsLeft:1
// modifier bends that day's foraging and is gone the next. null never counts
// down — permanent is the default, and the common case.
export const ageForageModifiers = (modifiers) =>
  (modifiers ?? [])
    .map((m) => (m.turnsLeft == null ? m : { ...(m.toObject?.() ?? m), turnsLeft: m.turnsLeft - 1 }))
    .filter((m) => m.turnsLeft == null || m.turnsLeft > 0)

export const applyForageModifiers = (baseKg, modifiers, target) => {
  const { factor, deltaKg } = foldForageModifiers(modifiers, target)
  return Math.max(0, Math.floor(baseKg * factor + deltaKg))
}

// Fill rings nearest-first, spilling leftover capacity outward. Returns the
// kg PHYSICALLY taken from each ring (before the ring-distance yield curve
// reduces what's actually credited — see resolveForaging).
export const allocateNearFirst = (capacityKg, richnessByRing) => {
  const want = richnessByRing.map(() => 0)
  let left = capacityKg
  for (let i = 0; i < richnessByRing.length && left > 0; i++) {
    want[i] = Math.min(left, richnessByRing[i])
    left -= want[i]
  }
  return want
}

// Mutates the campaign (rings, resources) and returns { forage: <report
// block>, entries: [log lines] }. `band` is the turn's scouting band — the
// forage posture (Stage 4 1d): it scales how much ground the player's share
// sweeps. Omitted (older tests) it behaves as Contested, the neutral posture.
// Takes no catalog: S2's pool is precomputed (fieldPointsFor) before this
// runs, so nothing here needs per-unit stats any more.
export function resolveForaging(campaign, band) {
  const rings = campaign.forage.rings
  const pool = campaign.forage.pool ?? 0
  const share = campaign.forage.share ?? 0
  const points = pool * share

  // Standing pressures bend BOTH kg figures before either touches the rings, so
  // a modifier changes how much ground is swept as well as what's credited.
  const modifiers = campaign.forage.modifiers ?? []
  const capacityKg = applyForageModifiers(forageCapacityKg(points, band), modifiers, 'playerYield')
  const wantP = allocateNearFirst(capacityKg, rings.map((r) => r.richness))
  wantP.forEach((kg, i) => { rings[i].richness -= kg })

  // The enemy drains what's LEFT after the player's sweep, also near-first —
  // no contention, no clash: the two hosts just share a depleting clock.
  const enemyDrainKg = applyForageModifiers(
    campaign.forage.enemyDrainKg ?? 0, modifiers, 'enemyDrain',
  )
  const wantE = allocateNearFirst(enemyDrainKg, rings.map((r) => r.richness))
  wantE.forEach((kg, i) => { rings[i].richness -= kg })

  // S4 "starve the enemy": what the host actually FED ITSELF on this turn — the
  // same ring-distance curve the player is credited by, applied to the same
  // near-first allocation. This is the whole mechanism: the enemy takes from the
  // near ring while it lasts (a surplus), and as the shared land empties it is
  // pushed outward into thinner ground (break-even, then starvation). Stripping
  // the inner rings yourself is therefore an attack on their supply, and the S3
  // enemyDrain modifiers feed in for free by changing what they take at all.
  // Reverses S2 decision 4 ("gets no credit") deliberately — that was the
  // placeholder this stage exists to replace.
  const enemyIncomeKg = wantE.reduce((sum, kg, i) => sum + kg * (FORAGE_RING_YIELD[i] ?? 1), 0)

  // Ring-distance yield (decision 5): what's credited from a ring is a
  // fraction of what was physically swept from it — the far ring costs more
  // capacity to net the same kg. The enemy gets no credit at all (decision 4).
  const gatheredP = wantP.reduce((sum, kg, i) => sum + kg * (FORAGE_RING_YIELD[i] ?? 1), 0)
  const food = Math.floor(gatheredP * FORAGE_FOOD_SHARE)
  const materials = Math.floor(gatheredP * FORAGE_MATERIALS_SHARE)
  campaign.resources.food += food
  campaign.resources.materials += materials

  const entries = []
  // Player-facing text speaks in tonnes; the numbers stay kg everywhere else.
  const inTons = (kg) => `${+(kg / 1000).toFixed(1)} t`
  if (points > 0)
    entries.push(`Foragers brought in ${inTons(food)} of food and ${inTons(materials)} of materials.`)

  return {
    forage: {
      posture: band ?? 'Contested',
      capacity: capacityKg,
      harvested: { food, materials },
      // S4: handed to enemyTurn, which turns it into the host's supply state.
      // Reported here because this is where the rings are actually consumed.
      enemyIncomeKg,
      rings: rings.map((r) => ({ ring: r.ring, richness: r.richness, initialRichness: r.initialRichness })),
    },
    entries,
  }
}
