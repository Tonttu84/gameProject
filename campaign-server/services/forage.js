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

  const capacityKg = forageCapacityKg(points, band)
  const wantP = allocateNearFirst(capacityKg, rings.map((r) => r.richness))
  wantP.forEach((kg, i) => { rings[i].richness -= kg })

  // The enemy drains what's LEFT after the player's sweep, also near-first —
  // no contention, no clash: the two hosts just share a depleting clock.
  const enemyDrainKg = campaign.forage.enemyDrainKg ?? 0
  const wantE = allocateNearFirst(enemyDrainKg, rings.map((r) => r.richness))
  wantE.forEach((kg, i) => { rings[i].richness -= kg })

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
      rings: rings.map((r) => ({ ring: r.ring, richness: r.richness, initialRichness: r.initialRichness })),
    },
    entries,
  }
}
