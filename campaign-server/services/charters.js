import { CHARTER_CATALOG, CHARTER_DRAW } from '../utils/campaignConfig.js'
import { getRandom } from '../utils/dice.js'

// Charter recruitment — docs/CAMPAIGN_PLAN.md, "CHARTER RECRUITMENT + SQUADS
// IN THE LAB", decisions R-1..R-8.
//
// Where companies come from. Events hand them over and nothing else does
// (R-1: decision 11 stands, there is no purchase route), on guaranteed
// set-turn beats (R-5), as a roguelite draft: some rows offered, exactly one
// taken (R-2, R-6). The draft pattern for the THIRD time — the upgrade offer
// and the recruit offer are the other two — so it is deliberately the same
// gesture in the same order: eligible rows, drawn without replacement through
// the queueable dice seam, never padded when fewer remain, and SEALED by the
// caller onto the decision so a reload cannot reshuffle it.
//
// THIS MODULE IMPORTS NOTHING BUT CONFIG AND THE DICE, deliberately — the same
// rule missions.js keeps, and for the same reason. events.js owns EVENT_POOL
// and needs to call enrolCharter from the `squad` effect; if this file reached
// back for the pool the two would import each other.

// Mongoose Maps on a live doc, plain objects at creation and in tests — one
// reader for both, the entriesOf convention missions.js and events.js use.
const entriesOf = (bag) =>
  bag instanceof Map ? [...bag.entries()] : Object.entries(bag ?? {})
const bagGet = (bag, key) => (bag instanceof Map ? bag.get(key) : bag?.[key]) ?? 0
const bagSet = (bag, key, value) => {
  if (bag instanceof Map) bag.set(key, value)
  else bag[key] = value
}

// A catalog row by id, or null. Tolerant like findItem/findUpgrade and for the
// same reason: this runs against ids already sealed on a live campaign, and a
// row deleted mid-campaign must degrade to "no company came forward" rather
// than throw a save out of the water.
export const findCharter = (id) => CHARTER_CATALOG.find((row) => row.id === id) ?? null

// The rows a draft may offer: everything that is not one of the opening three
// (those are the company you START with — offering them back would be an
// empty card) and that is not already on the rolls.
//
// Held-ness is asked of `charterId`, the id the squad carries, NOT of its name
// or composition: a company that has since been reinforced, upgraded or wiped
// is still the same company, and the row it came from must stay spent. A squad
// from before v45 carries no charterId and so fences nothing off, which is the
// safe direction — it can only widen the draw.
export const eligibleCharters = (campaign) => {
  const held = new Set(
    (campaign?.squads ?? []).map((sq) => sq.charterId).filter(Boolean),
  )
  return CHARTER_CATALOG.filter((row) => !row.opening && !held.has(row.id))
}

// The offer a charter fate makes (R-2): CHARTER_DRAW rows, drawn WITHOUT
// replacement so no card is offered twice, through getRandom rather than
// Math.random so a test can pin exactly which companies came forward — the
// same seam and the same loop as drawUpgradeOffer.
//
// A SHORT offer when fewer rows remain eligible, never a padded one: the draft
// convention throughout, and the catalog sweep guarantees a fresh campaign has
// enough rows that every authored beat can still deal a full hand.
//
// The caller SEALS the result on the pending decision. Nothing here is
// idempotent, and drawing twice would let a reload reshuffle the hand.
export const drawCharterOffer = (campaign, count = CHARTER_DRAW) => {
  const remaining = eligibleCharters(campaign)
  const picks = []
  const n = Math.min(count, remaining.length)
  for (let i = 0; i < n; i++) {
    const idx = getRandom(0, remaining.length - 1)
    picks.push(remaining.splice(idx, 1)[0].id)
  }
  return { picks }
}

// The next squad id. Small campaign-scoped ints, because the number flows
// straight into the engine's placement JSON as squad_id — max + 1 rather than
// length + 1, so a future disband cannot make two live squads share an id.
export const nextSquadId = (campaign) =>
  (campaign?.squads ?? []).reduce((max, sq) => Math.max(max, sq.id ?? 0), 0) + 1

// A company takes service (R-3, R-4). It arrives with its row's composition
// and its row's prestige, and its bodies join the ROSTER — a squad's
// composition is always a subset of the roster (see the schema note on
// `squads`), so a charter enrolled without adding to the roster would be a
// company of men who do not eat, do not fill the meter and cannot take the
// field. Free bodies through a fate is the house norm; the relief column does
// exactly this with +30 Soldiers, one type at a time.
//
// The row's values are COPIED onto the document rather than looked up through
// `charterId` later. That is not the ids-only rule being broken but the same
// distinction `archetype` draws: what a company IS stays config, what a
// company HAS is its own from the moment it enrols and diverges immediately —
// it reinforces, it takes upgrades, it gets wiped.
export const enrolCharter = (campaign, row) => {
  const squad = {
    id: nextSquadId(campaign),
    name: row.name,
    archetype: row.archetype,
    composition: { ...row.composition },
    prestige: row.prestige ?? 0,
    upgrades: [],
    charterId: row.id,
  }
  campaign.squads.push(squad)

  if (!campaign.roster) campaign.roster = new Map()
  const bodies = []
  for (const [type, n] of entriesOf(row.composition)) {
    bagSet(campaign.roster, type, bagGet(campaign.roster, type) + n)
    bodies.push(`${n} ${type}`)
  }
  return `${row.name} takes service under your banner — ${bodies.join(', ')}.`
}
