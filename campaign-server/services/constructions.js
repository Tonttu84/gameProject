import { CONSTRUCTION_CATALOG } from '../utils/campaignConfig.js'
import { smithsFor, planSmith, forgePathsText } from './forge.js'
import { describeEffect } from './events.js'
import { schoolOf } from './magic.js'

// Constructions — Construction slice C2 (docs/CAMPAIGN_PLAN.md "THE
// CONSTRUCTION INTERVIEW", C-3).
//
// A construction is FORTIFICATION GENERALIZED: built from camp, felt where
// its effect points, and ONLY through channels that already exist. The shape
// mirrors services/forge.js deliberately — same three gates (C-6), same smith
// eligibility (C-1), same once-per-turn stamp: building and forging are one
// fortnight's work in the ledger's eyes, so a mage does one or the other.
// Where the two differ, and it is the ONE difference: an item deposits into
// the store and stacks; a construction STANDS — built at most once, its
// campaign-side effects applied at build time through applyEffect (the fates'
// own chokepoint) and its battlefield sides derived at read time beside the
// fort's own (walledSides in services/fortification.js).

export const constructionRows = () => CONSTRUCTION_CATALOG

export const findConstruction = (id) =>
  CONSTRUCTION_CATALOG.find((row) => row.id === id)

export const hasConstruction = (campaign, id) =>
  (campaign?.constructions ?? []).includes(id)

// The battlefield half (C-3): every built row's `sides`, in the exact
// FORTIFICATION_PRESETS entry shape. Derived from the built list on every
// read, exactly as the fort's own sides derive from fortificationLevel — the
// engine sees one `fortified_sides` array and never learns which wall was
// whose.
export const constructionSidesFor = (campaign) =>
  (campaign?.constructions ?? [])
    .map(findConstruction)
    .filter(Boolean)
    .flatMap((row) => (row.sides ?? []).map(({ q, r, dir, durability }) => ({ q, r, dir, durability })))

// Validate one building without committing it — planForge's contract, walked
// in the same order (row gates first, then the smith) so the error the player
// sees matches the order the UI asks its questions in.
export const planConstruction = (campaign, characterId, constructionId) => {
  const row = findConstruction(constructionId)
  if (!row) return { error: 'no such working is known' }

  const level = schoolOf(campaign, 'construction').level
  if (level < row.forge.level)
    return { error: `the work is beyond you — Construction ${row.forge.level} is needed` }

  // A construction stands once: the built gate is the uniqueness gate, and
  // unlike an item's it has no stacking case to carve out.
  if (hasConstruction(campaign, constructionId))
    return { error: 'those works already stand' }

  const cost = row.forge.mithril ?? 0
  if ((campaign?.resources?.mithril ?? 0) < cost)
    return { error: 'not enough mithril' }

  const smith = planSmith(campaign, characterId, row)
  if (smith.error) return smith

  return { character: smith.character, row, cost }
}

// What a row DOES, phrased server-side (17-5): the campaign-side effects
// through the same describeEffect the fates and the modifier cards use, and a
// battlefield row as one composed sentence — the client holds no copy of
// either vocabulary.
export const constructionEffectsText = (row) => [
  ...(row.effects ?? []).flatMap(describeEffect),
  ...(row.sides?.length
    ? [`Walls ${row.sides.length} hexsides of your front for every pitched battle`]
    : []),
]

// What the client renders — forgeView's contract: every row with its three
// gates resolved against THIS campaign, locked rows shown locked so the
// Construction ladder reads as a ladder, built rows shown standing.
export const constructionView = (campaign) => {
  const level = schoolOf(campaign, 'construction').level
  const mithril = campaign?.resources?.mithril ?? 0
  return {
    rows: constructionRows().map((row) => ({
      id: row.id,
      name: row.name,
      blurb: row.blurb,
      effects: constructionEffectsText(row),
      level: row.forge.level,
      mithril: row.forge.mithril ?? 0,
      pathsText: forgePathsText(row),
      smiths: smithsFor(campaign, row),
      levelMet: level >= row.forge.level,
      mithrilMet: mithril >= (row.forge.mithril ?? 0),
      built: hasConstruction(campaign, row.id),
    })),
  }
}
