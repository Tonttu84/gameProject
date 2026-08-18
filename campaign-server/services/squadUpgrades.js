import { getRandom } from '../utils/dice.js'
import { squadRank } from '../utils/capabilities.js'
import {
  SQUAD_RANKS,
  SQUAD_UPGRADE_POOL,
  SQUAD_UPGRADE_SLOTS_BY_RANK,
  SQUAD_UPGRADE_DRAW,
  SQUAD_BANNER_RANK,
} from '../utils/campaignConfig.js'

// Squad upgrades — the squad overhaul's slice 4a (docs/CAMPAIGN_PLAN.md
// "SLICE 4 — THE UPGRADE CATALOG"). Slice 1 made prestige a permanent rank and
// deliberately gated nothing with it; this is what it was for.
//
// The shape the interview settled (2026-08-13), because it is unusual enough
// that a later reader will otherwise "fix" it:
//   - Rank gates BOTH which rows a squad may draw and HOW MANY it may hold.
//   - A pick is a DRAFT: three random eligible rows, keep one, PERMANENTLY.
//     There is no swap at any price — with upgrades free, permanence IS the
//     cost, and it is what makes the choice an identity rather than a shopping
//     list.
//   - Taking one costs NO resources and NO prestige. Reaching the rank and
//     having a free slot is the whole price (decision 5 stands: prestige is
//     never spent). The ongoing cost lands on REINFORCEMENT instead, for the
//     rows that change gear or unit type.
//   - Luck decides, and that is deliberate: "we are also meant to have
//     roguelite, not super balanced everything" (user). Do NOT add a pity
//     timer, a reroll or a guarantee to make a draw feel fairer.
//
// Slots and the banner are DERIVED from prestige, never stored — the rank
// ladder is the single source and a document cannot drift out of step with it.
// Only two things need persisting: what a squad has TAKEN, and the offer it is
// currently looking at.

export const findUpgrade = (id) => SQUAD_UPGRADE_POOL.find((row) => row.id === id) ?? null

// Mongoose arrays are array-likes, plain tests pass arrays; one reader covers
// both, and a charter written before the field existed reads as empty.
const takenIds = (squad) => [...(squad?.upgrades ?? [])]

// The rows a squad HAS, resolved. An id whose row has left the catalog degrades
// to nothing rather than throwing — the archetypeOf convention, for the same
// reason: a campaign in flight must still load after a catalog edit.
export const squadUpgrades = (squad) => takenIds(squad).map(findUpgrade).filter(Boolean)

export const slotsFor = (squad) => SQUAD_UPGRADE_SLOTS_BY_RANK[squadRank(squad?.prestige)] ?? 0

// Unfilled slots. Floored at 0 so a squad holding more than its rank allows —
// only reachable if the ladder is retuned downward under a live campaign — is
// simply full rather than negative, and never loses what it already earned.
export const picksAvailable = (squad) => Math.max(0, slotsFor(squad) - takenIds(squad).length)

// The banner is a rank fact, not an inventory one: at or above the banner rung,
// a squad has it. Compared on PRESTIGE against that rung's threshold rather
// than on the rank word, so it stays true for every rank above it too.
const BANNER_MIN = SQUAD_RANKS.find((r) => r.label === SQUAD_BANNER_RANK)?.min ?? Infinity
export const hasBanner = (squad) => (squad?.prestige ?? 0) >= BANNER_MIN

// What this charter could still draw: its archetype's rows, minus what it
// already holds. A squad with no archetype is eligible for nothing.
export const eligibleUpgrades = (squad) => {
  const taken = new Set(takenIds(squad))
  return SQUAD_UPGRADE_POOL.filter(
    (row) => row.archetypes.includes(squad?.archetype) && !taken.has(row.id),
  )
}

// Draw an offer, or null when there is nothing to offer (no free slot, or no
// eligible row left). Ids only on the document — the sealed-pool-lookup
// convention recruit.dailyOptions uses, so a blurb edit reaches an offer that
// is already on a player's screen.
//
// Fewer than SQUAD_UPGRADE_DRAW rows means a SHORTER offer, never a padded one:
// there is no filler row to pad with, and inventing one would put a choice in
// front of the player that the catalog does not contain.
export const drawUpgradeOffer = (squad) => {
  if (picksAvailable(squad) === 0) return null
  const remaining = eligibleUpgrades(squad)
  if (remaining.length === 0) return null

  const options = []
  const n = Math.min(SQUAD_UPGRADE_DRAW, remaining.length)
  for (let i = 0; i < n; i++) {
    const idx = getRandom(0, remaining.length - 1)
    options.push(remaining.splice(idx, 1)[0].id)
  }
  // Stamped with the rank that paid for it, so a draw cannot outlive the reason
  // it was made: if a squad somehow reaches its next rung before spending this
  // offer, the stamp is what tells the two apart.
  return { rank: squadRank(squad?.prestige), options }
}

// Pure: decides, never mutates — planReinforcement's split, for the same reason
// (the route's rejection must have spent nothing).
export const planUpgrade = (squad, id) => {
  if (picksAvailable(squad) === 0)
    return { error: `${squad?.name ?? 'that squad'} has no upgrade slot free` }

  const offer = squad?.upgradeOffer
  const options = [...(offer?.options ?? [])]
  if (options.length === 0) return { error: `${squad?.name ?? 'that squad'} has no upgrades on offer` }
  if (!options.includes(id)) return { error: `${id} is not one of the upgrades on offer` }

  // Belt and braces against a document that already holds the row: the offer is
  // built from eligibleUpgrades and so cannot contain one, but a replayed
  // request against a stale offer could.
  if (takenIds(squad).includes(id)) return { error: `${squad.name} already has that upgrade` }

  const row = findUpgrade(id)
  if (!row) return { error: `there is no such upgrade: ${id}` }
  if (!row.archetypes.includes(squad?.archetype))
    return { error: `${squad.name} cannot train for ${row.name}` }

  return { row }
}

// Mutates in place; the caller saves. Returns log lines, the applyReinforcement
// contract. The offer is CONSUMED whether or not more slots remain — the next
// one is drawn fresh at newDay, so a pick can never be re-taken from a stale
// list.
export function applyUpgrade(campaign, squad, plan) {
  squad.upgrades = [...takenIds(squad), plan.row.id]
  squad.upgradeOffer = undefined
  return [`${squad.name} takes up ${plan.row.name}.`]
}

// ── What the upgrades DO ─────────────────────────────────────────────────────
// One reader per effect kind, each folding over the squad's rows. Consumers
// call these instead of reading `effects` themselves, so a new kind is added in
// one place and an unknown kind stays inert.

// A row is a BUNDLE of effects (4c), so every reader folds over the flattened
// list rather than one `effect` per row: a single pick can raise a cost AND
// grant an ability. `effects` is read defensively so a row that has lost its
// list — or a campaign loading against an edited catalog — contributes nothing
// instead of throwing.
const effectsOf = (squad) => squadUpgrades(squad).flatMap((row) => row.effects ?? [])

const sumOf = (squad, kind, field) =>
  effectsOf(squad).reduce((sum, e) => (e.kind === kind ? sum + e[field] : sum), 0)

// Per-type caps with every caps row applied. Only the types the ARCHETYPE names
// are raised — a caps row widens the muster, it never admits a type the charter
// was not written for (that is what an archetype is).
export const capsBonus = (squad) => sumOf(squad, 'caps', 'bonus')

export const intakeBonus = (squad) => sumOf(squad, 'intake', 'bonus')

// Multiplicative so two discounts compose without ever reaching free; 1 = no
// discount. Applied per squad to its own contribution to a party's cost.
export const raidCostFactor = (squad) =>
  effectsOf(squad).reduce((factor, e) => (e.kind === 'raidCost' ? factor * e.factor : factor), 1)

// How much LESS room than its real size each body in this squad takes when
// packed (4c). Summed, so two such rows would stack. The engine floors the
// result at 1 per body (AUnit::getPackingSize) — this layer must apply the same
// floor wherever it measures a squad against a hex, or the two disagree about
// what fits.
export const formationFighter = (squad) => sumOf(squad, 'formationFighter', 'value')

// What this squad's upgrades ADD to the cost of every body it reinforces, as
// `{ gold: 1 }`. The price rides the ROW, never the ability (user, 2026-08-18):
// an upgrade that changes how a squad fights may or may not also make its
// replacements dearer, and the two are set independently on the same row.
// Additive per body and merged across rows, so a second such row stacks.
export const reinforceSurcharge = (squad) => {
  const add = {}
  for (const e of effectsOf(squad)) {
    if (e.kind !== 'reinforceCost') continue
    for (const [resource, amount] of Object.entries(e.add ?? {}))
      add[resource] = (add[resource] ?? 0) + amount
  }
  return add
}

// The squad's flat stat modifiers as `{ attack: 1, armour: 1 }` — 4b's engine
// side. This is the ONE place a squad's rows become the `squad_mods` object the
// placement JSON carries, and it is attached SERVER-SIDE: the browser never
// sends its own, so a forged one is a request the campaign layer simply
// overwrites (and which AUnit::applyStatMod bounds regardless).
//
// Stat NAMES are the engine's, exactly as the unit catalog exports them
// ("attack", "armour", "speed", "ballisticSkill", "formationFighter") — an
// unknown one is inert at the far end rather than mis-applied, so a typo here
// costs a dead upgrade rather than a wrong battle. Returns an empty object when
// there is nothing to say, which the callers use to leave the field off the
// entry entirely.
//
// formationFighter (4c) travels the same road even though it is not a `stat`
// row: it IS an engine stat, applied by the same AUnit::applyStatMod, and
// giving it a private transport would mean a second thing to attach at both
// battle routes and a second thing to forget.
export const statMods = (squad) => {
  const mods = {}
  for (const e of effectsOf(squad)) {
    if (e.kind !== 'stat') continue
    mods[e.stat] = (mods[e.stat] ?? 0) + e.bonus
  }
  const packing = formationFighter(squad)
  if (packing !== 0) mods.formationFighter = (mods.formationFighter ?? 0) + packing
  return mods
}
