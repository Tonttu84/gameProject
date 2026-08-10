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
//   - troop: batch/count hires costing food/materials, tiered via the same
//     presence-only `requires: {hasUnit}` gate events.js already uses (own >=1
//     of the prerequisite type). Cavalry/LightCavalry additionally cost
//     `horses`.
//
//     WHERE THE BODIES COME FROM is the ladder (user, 2026-08-10 — "better
//     troops trained from militia rather than directly from workers"). Only
//     Militia is raised from the `workers` pool. Everything above it carries
//     `from`, and TRAINS one of those instead: 15 Soldier consumes 15 Militia,
//     5 Cavalry consumes 5 Soldier. The militiaman IS the soldier, promoted —
//     the body already exists, so only kit and rations are new, which is why
//     those rows no longer cost workers at all. The ladder is therefore
//     workers → Militia → Soldier/Archer → Cavalry/LightCavalry.
//
//     Consumption is 1:1 with the RESOLVED count, deliberately not a separate
//     cost key: a boosted hire doubles the count, so it must eat double the
//     trainees, and tying the two together makes that automatic rather than
//     something a future boost rule can forget to scale.
//   - caster: individual (count-1) hires, gold only, no tier gate.
export const RECRUIT_POOL = [
  { id: 'militia', unit: 'Militia', lane: 'troop', count: 20, cost: { food: 40, materials: 20, workers: 20 } },
  { id: 'soldier', unit: 'Soldier', lane: 'troop', count: 15, cost: { food: 60, materials: 30 }, from: 'Militia', requires: { hasUnit: 'Militia' } },
  { id: 'archer', unit: 'Archer', lane: 'troop', count: 15, cost: { food: 50, materials: 25 }, from: 'Militia', requires: { hasUnit: 'Militia' } },
  // Third Militia promotion (2026-08-10). Cheapest of the three in materials —
  // a pike is a shaft and a head, against Archer's bow and Soldier's sword,
  // shield and heavy armour. Accepted consequence: the Militia tier is now
  // three options wide against a 2-slot daily draw, so each is rarer. That
  // dilution is the honest cost of a bigger roster and was chosen over
  // widening the draw, which would have made every future unit cheaper to see
  // as well (see docs/CAMPAIGN_PLAN.md).
  { id: 'pikeman', unit: 'Pikeman', lane: 'troop', count: 15, cost: { food: 50, materials: 20 }, from: 'Militia', requires: { hasUnit: 'Militia' } },
  { id: 'cavalry', unit: 'Cavalry', lane: 'troop', count: 5, cost: { food: 40, materials: 20, horses: 5 }, from: 'Soldier', requires: { hasUnit: 'Soldier' } },
  { id: 'light_cavalry', unit: 'LightCavalry', lane: 'troop', count: 5, cost: { food: 35, materials: 15, horses: 5 }, from: 'Soldier', requires: { hasUnit: 'Soldier' } },
  { id: 'mage', unit: 'Mage', lane: 'caster', count: 1, cost: { gold: 100 } },
  { id: 'priest', unit: 'Priest', lane: 'caster', count: 1, cost: { gold: 80 } },
]

// The Travellers card (grilled 2026-08-03): deliberately NOT a RECRUIT_POOL
// row. It never competes for a draw slot against a real option — it only tops
// the day's offer up to two when the affordable pool can't. Because it costs
// NOTHING it is affordable in every state the campaign can reach, which is
// what lets the hire be the ONLY exit from the Recruit phase (there is no
// skip): whatever else has gone wrong, there is always a legal play. Worth
// less than a real Militia purchase by design — it's the consolation prize,
// and it should never be the correct pick when a real option is on the table.
export const FALLBACK_HIRE = {
  id: 'travellers',
  unit: 'Militia',
  lane: 'troop',
  count: FREE_MILITIA_AMOUNT,
  cost: {},
}

// The one guarded lookup for both sources. Everything that resolves an id
// sealed in `recruit.dailyOptions` goes through this — an id that has left the
// pool (a mid-campaign edit) comes back undefined and degrades to a 400,
// rather than throwing on `.cost` and 500ing.
export const findRecruitEntry = (id) =>
  id === FALLBACK_HIRE.id ? FALLBACK_HIRE : RECRUIT_POOL.find((e) => e.id === id)

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

// Are there enough bodies on the rung below to train `count` of this entry?
// Entries without `from` (Militia, the casters) are raised from workers or coin
// and always pass. `requires.hasUnit` is a presence gate and deliberately stays
// — it decides whether the option is OFFERED at all; this decides whether it
// can actually be paid for, which is a different question once one Militia no
// longer buys fifteen Soldier.
export const hasTrainees = (entry, roster, count = entry.count) =>
  !entry.from || (roster?.get?.(entry.from) ?? roster?.[entry.from] ?? 0) >= count

// Prerequisite gate only — reuses events.js's presence-only `hasUnit` check
// (own >=1 of the type, not a minimum count) so the two systems can't drift.
export const eligiblePool = (ctx) => RECRUIT_POOL.filter((e) => eventEligible(e, ctx))

// Eligible AND currently affordable — what the day's offer is actually drawn
// from. Affordable now means the trainees exist as well as the resources: an
// offer you cannot pay for would break the "the hire is the only exit from the
// Recruit phase" rule, since there is no skip.
export const affordablePool = (ctx) =>
  eligiblePool(ctx).filter(
    (e) => canAfford(e.cost, ctx.resources, ctx.workersFree) && hasTrainees(e, ctx.roster),
  )

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
    // Double the count eats double the trainees, so the rung below has to hold
    // them — otherwise a boost would conjure Soldier out of Militia that were
    // never there.
    if (canAfford(doubled, ctx.resources, ctx.workersFree) && hasTrainees(entry, ctx.roster, entry.count * 2))
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
  const entry = findRecruitEntry(entryId)
  const workersFree = (campaign.workers?.total ?? 0) - (campaign.workers?.used ?? 0)
  const { count, cost, secondUnit } = resolveHire(entry, boosted, {
    resources: campaign.resources,
    workersFree,
    roster: campaign.roster,
  })

  if (cost.food) campaign.resources.food = Math.max(0, campaign.resources.food - cost.food)
  if (cost.materials) campaign.resources.materials = Math.max(0, campaign.resources.materials - cost.materials)
  if (cost.gold) campaign.resources.gold = Math.max(0, campaign.resources.gold - cost.gold)
  if (cost.horses) campaign.resources.horses = Math.max(0, campaign.resources.horses - cost.horses)
  // Hired troops leave the workforce entirely, like militia purchase today —
  // `total` shrinks, `used` (fort labour) is untouched.
  if (cost.workers) campaign.workers.total = Math.max(0, campaign.workers.total - cost.workers)

  // Promotion, not recruitment: the bodies come off the rung below, 1:1 with
  // the count. Clamped at what is actually there so a stale offer can never
  // drive the source negative — and `trained` is what the roster then gains,
  // so an entry can never mint more troops than it consumed.
  const available = campaign.roster.get(entry.from) ?? 0
  const trained = entry.from ? Math.min(count, available) : count
  if (entry.from) campaign.roster.set(entry.from, available - trained)

  campaign.roster.set(entry.unit, (campaign.roster.get(entry.unit) ?? 0) + trained)
  const log = entry.from
    ? [`${trained} ${entry.from} are trained up as ${entry.unit}.`]
    : [`${trained} ${entry.unit} join the roster.`]
  if (secondUnit) {
    campaign.roster.set(secondUnit, (campaign.roster.get(secondUnit) ?? 0) + 1)
    log.push(`A second hire besides: 1 ${secondUnit}.`)
  }
  return log
}

// The day's offer: up to 2 distinct options drawn from the affordable pool,
// with ONE boost roll for the day (applies to whichever option is chosen).
// Short draws are padded with the Travellers card, appended last — so the
// offer is never empty and never a single take-it-or-leave-it card, and the
// mandatory hire always has something it can legally resolve against. The
// boost roll happens FIRST, unconditionally, so it doesn't depend on how many
// options the pool happened to yield.
export const pickDailyOptions = (ctx) => {
  const boosted = rollBoost(ctx.fervor)
  const remaining = affordablePool(ctx)
  const options = []
  const n = Math.min(2, remaining.length)
  for (let i = 0; i < n; i++) {
    const idx = getRandom(0, remaining.length - 1)
    options.push(remaining.splice(idx, 1)[0])
  }
  if (options.length < 2) options.push(FALLBACK_HIRE)
  return { options, boosted }
}

// The fields campaign.recruit needs for a day, from pickDailyOptions — ids
// only (never the resolved cost/count; hire time re-resolves through
// findRecruitEntry, the sealed-pool-lookup convention pendingChoices already
// uses). Pure. `hiredToday` is always false: with Travellers padding the
// offer there is no longer a state where the day resolves itself, so the
// player always owes a hire.
export const drawRecruitOffer = (ctx) => {
  const offer = pickDailyOptions(ctx)
  return {
    dailyOptions: offer.options.map((e) => e.id),
    boosted: offer.boosted,
    hiredToday: false,
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
