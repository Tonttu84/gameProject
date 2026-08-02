import { getRandom, chanceRoll } from '../utils/dice.js'
import { eventEligible } from './events.js'
import {
  RECRUITING_FERVOR_START,
  RECRUIT_BOOST_DISCOUNT,
  FREE_MILITIA_AMOUNT,
} from '../utils/campaignConfig.js'

// Recruit phase (docs/CAMPAIGN_PLAN.md "Recruit phase — hiring troops"),
// grilled + locked 2026-08-02, Stage 1: pure pool/eligibility/affordability/
// Fervor-roll/hire-resolution logic. No route or day-resolution wiring yet
// (Stage 2) — this is the mechanic in isolation, tested directly like
// events.js's EVENT_POOL + eventEligible.
//
// Two lanes:
//   - troop: batch/count hires drawn from the `workers` pool + food/materials,
//     tiered via the same presence-only `requires: {hasUnit}` gate events.js
//     already uses (own >=1 of the prerequisite type, not a minimum count).
//     Cavalry/LightCavalry additionally cost `horses`.
//   - caster: individual (count-1) hires, gold only, no tier gate.
export const RECRUIT_POOL = [
  { id: 'militia', unit: 'Militia', lane: 'troop', count: 20, cost: { food: 40, materials: 20, workers: 20 } },
  { id: 'soldier', unit: 'Soldier', lane: 'troop', count: 15, cost: { food: 60, materials: 30, workers: 15 }, requires: { hasUnit: 'Militia' } },
  { id: 'archer', unit: 'Archer', lane: 'troop', count: 15, cost: { food: 50, materials: 25, workers: 15 }, requires: { hasUnit: 'Militia' } },
  { id: 'cavalry', unit: 'Cavalry', lane: 'troop', count: 5, cost: { food: 40, materials: 20, workers: 5, horses: 5 }, requires: { hasUnit: 'Soldier' } },
  { id: 'light_cavalry', unit: 'LightCavalry', lane: 'troop', count: 5, cost: { food: 35, materials: 15, workers: 5, horses: 5 }, requires: { hasUnit: 'Soldier' } },
  { id: 'mage', unit: 'Mage', lane: 'caster', count: 1, cost: { gold: 100 } },
  { id: 'priest', unit: 'Priest', lane: 'caster', count: 1, cost: { gold: 80 } },
]

const RESOURCE_COST_KEYS = ['food', 'materials', 'gold', 'horses']

// Does the campaign have enough of everything an entry's cost names? `workers`
// is checked separately (it's a derived total-minus-used figure, not a
// resources.* field) — same split the militia-purchase route already uses.
export const canAfford = (cost, resources = {}, workersFree = 0) => {
  for (const key of RESOURCE_COST_KEYS) {
    if (cost[key] && (resources[key] ?? 0) < cost[key]) return false
  }
  if (cost.workers && workersFree < cost.workers) return false
  return true
}

// Prerequisite gate only — reuses events.js's presence-only `hasUnit` check
// (own >=1 of the type, not a minimum count) so the two systems can't drift.
export const eligiblePool = (ctx) => RECRUIT_POOL.filter((e) => eventEligible(e, ctx))

// Eligible AND currently affordable — what the day's offer is actually drawn
// from.
export const affordablePool = (ctx) =>
  eligiblePool(ctx).filter((e) => canAfford(e.cost, ctx.resources, ctx.workersFree))

// Recruiting Fervor is a straight 1:1 percent chance, clamped to [0,100] for
// the roll only — the stored value itself is uncapped in both directions (see
// campaign.recruit.fervor). <=0 never boosts.
export const rollBoost = (fervor = RECRUITING_FERVOR_START) =>
  chanceRoll(Math.max(0, Math.min(100, fervor)) / 100)

const scaleCost = (cost, factor) => {
  const scaled = {}
  for (const [key, value] of Object.entries(cost)) scaled[key] = Math.round(value * factor)
  return scaled
}

const mergeCost = (a, b) => {
  const merged = { ...a }
  for (const [key, value] of Object.entries(b)) merged[key] = (merged[key] ?? 0) + value
  return merged
}

// What a hire of `entry` actually costs/yields once boost is decided. Boost
// means something different per lane (locked in the grilling session):
//   - troop: double the count at double the cost, if affordable; otherwise
//     the normal count at a discount off the normal cost.
//   - caster: a bonus SECOND individual hire of the other caster type, if the
//     combined cost is affordable; otherwise the normal single hire at a
//     discount.
// Never mutates anything — applyHire is the one place that does.
export const resolveHire = (entry, boosted, ctx) => {
  if (!boosted) return { count: entry.count, cost: entry.cost, secondUnit: null }

  if (entry.lane === 'troop') {
    const doubled = scaleCost(entry.cost, 2)
    if (canAfford(doubled, ctx.resources, ctx.workersFree))
      return { count: entry.count * 2, cost: doubled, secondUnit: null }
    return { count: entry.count, cost: scaleCost(entry.cost, 1 - RECRUIT_BOOST_DISCOUNT), secondUnit: null }
  }

  // Caster lane: exactly one "other" caster entry exists today (Mage<->Priest).
  const other = RECRUIT_POOL.find((e) => e.lane === 'caster' && e.id !== entry.id)
  if (other) {
    const combined = mergeCost(entry.cost, other.cost)
    if (canAfford(combined, ctx.resources, ctx.workersFree))
      return { count: entry.count, cost: combined, secondUnit: other.unit }
  }
  return { count: entry.count, cost: scaleCost(entry.cost, 1 - RECRUIT_BOOST_DISCOUNT), secondUnit: null }
}

// Mutates the campaign in place; caller saves. Returns log lines, same
// contract as events.js's applyEffect.
export function applyHire(campaign, entryId, boosted = false) {
  const entry = RECRUIT_POOL.find((e) => e.id === entryId)
  const workersFree = (campaign.workers?.total ?? 0) - (campaign.workers?.used ?? 0)
  const { count, cost, secondUnit } = resolveHire(entry, boosted, {
    resources: campaign.resources,
    workersFree,
  })

  if (cost.food) campaign.resources.food = Math.max(0, campaign.resources.food - cost.food)
  if (cost.materials) campaign.resources.materials = Math.max(0, campaign.resources.materials - cost.materials)
  if (cost.gold) campaign.resources.gold = Math.max(0, campaign.resources.gold - cost.gold)
  if (cost.horses) campaign.resources.horses = Math.max(0, campaign.resources.horses - cost.horses)
  // Hired troops leave the workforce entirely, like militia purchase today —
  // `total` shrinks, `used` (fort labour) is untouched.
  if (cost.workers) campaign.workers.total = Math.max(0, campaign.workers.total - cost.workers)

  campaign.roster.set(entry.unit, (campaign.roster.get(entry.unit) ?? 0) + count)
  const log = [`${count} ${entry.unit} join the roster.`]
  if (secondUnit) {
    campaign.roster.set(secondUnit, (campaign.roster.get(secondUnit) ?? 0) + 1)
    log.push(`A second hire besides: 1 ${secondUnit}.`)
  }
  return log
}

// The automatic fallback when nothing in the pool is affordable — no choice
// shown, a small flat grant so a stalled economy can still recruit.
export function grantFreeMilitia(campaign) {
  campaign.roster.set('Militia', (campaign.roster.get('Militia') ?? 0) + FREE_MILITIA_AMOUNT)
  return [`No hire was affordable — ${FREE_MILITIA_AMOUNT} Militia join anyway.`]
}

// The day's offer: up to 2 distinct options drawn from the affordable pool,
// with ONE boost roll for the day (applies to whichever option is chosen) —
// or the free-Militia fallback if nothing is affordable at all.
export const pickDailyOptions = (ctx) => {
  const pool = affordablePool(ctx)
  if (pool.length === 0) return { options: [], boosted: false, freeMilitia: FREE_MILITIA_AMOUNT }

  const boosted = rollBoost(ctx.fervor)
  const remaining = [...pool]
  const options = []
  const n = Math.min(2, remaining.length)
  for (let i = 0; i < n; i++) {
    const idx = getRandom(0, remaining.length - 1)
    options.push(remaining.splice(idx, 1)[0])
  }
  return { options, boosted, freeMilitia: null }
}

// S2 wiring (docs/CAMPAIGN_PLAN.md): the fields campaign.recruit needs for a
// day, from pickDailyOptions — ids only (never the resolved cost/count,
// which can drift between draw and hire as resources/workers change; hire
// time re-resolves against RECRUIT_POOL, the sealed-pool-lookup convention
// pendingChoices already uses). Pure — does NOT grant the free-Militia
// fallback itself (that's a real roster mutation); the caller applies
// grantFreeMilitia when `freeMilitia` comes back non-null, exactly like
// events.js's applyEffect is a separate step from picking what fired.
export const drawRecruitOffer = (ctx) => {
  const offer = pickDailyOptions(ctx)
  if (offer.options.length === 0)
    return { dailyOptions: [], boosted: false, hiredToday: true, freeMilitia: offer.freeMilitia }
  return {
    dailyOptions: offer.options.map((e) => e.id),
    boosted: offer.boosted,
    hiredToday: false,
    freeMilitia: null,
  }
}

// The ctx drawRecruitOffer/affordablePool need, from a live campaign
// document: `workers` is a running total/used split (like fortify's cost
// check), not a resources.* field.
export const recruitCtx = (campaign) => ({
  roster: campaign.roster,
  resources: campaign.resources,
  workersFree: (campaign.workers?.total ?? 0) - (campaign.workers?.used ?? 0),
  fervor: campaign.recruit?.fervor ?? RECRUITING_FERVOR_START,
})
