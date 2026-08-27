import { CRAFTED_UNIT_CATALOG, ITEM_CATALOG, SPELL_PATH_TEXT } from '../utils/campaignConfig.js'
import { findItem, holdsItem, describeItem } from './items.js'
import { livingCharacters } from './characters.js'
import { schoolOf } from './magic.js'

// The forge — Construction slice C1 (docs/CAMPAIGN_PLAN.md "THE CONSTRUCTION
// INTERVIEW", C-1..C-8).
//
// The shape the interview settled, so a later reader does not re-open it:
//   - A row is craftable iff it carries a `forge` block, and that block is the
//     WHOLE gate: Construction school level, the paths the smith must himself
//     command, and a mithril price (C-6). Nothing else about the item knows it
//     was forged — the action deposits into the store exactly as loot and
//     events do (C-2), and the equipment rules take over from there.
//   - Forging is LOCATION-BLIND (C-1). No away check, no squad check, nothing
//     about where the mage is standing: the cost collapsed to research points
//     plus the once-per-turn stamp, so there is nothing left for "away" to
//     interfere with. Eligibility is exactly three checks — alive, paths,
//     not-forged-today — and adding a fourth is re-opening C-1.
//   - The research half of the price is paid in services/magic.js:
//     researchingMages excludes a mage stamped today, so his 10 points simply
//     never arrive. The BANK is never debited — an empty bank cannot block a
//     forge — and the mithril debit here is the only resource that moves.
//   - Only MAGES forge (2026-08-25): Priests never fed research, so they have
//     no contribution of this kind to spend — and under C-6's cost model an
//     exempt type would forge for free.

export const forgeRows = () => ITEM_CATALOG.filter((row) => row.forge)

// Read a path level off a character record. `paths` is a Mongoose Map on the
// document and a plain object in test fixtures; one reader covers both, the
// same convention entriesOf uses elsewhere.
const pathLevel = (paths, name) =>
  (paths instanceof Map ? paths.get(name) : paths?.[name]) ?? 0

export const meetsForgePaths = (character, row) =>
  Object.entries(row?.forge?.paths ?? {}).every(
    ([path, need]) => pathLevel(character?.paths, path) >= need,
  )

// The smiths who could work this row: living Mages whose own paths qualify
// (C-6 — forging NAMES a mage; research stays fungible, forging never was).
// The once-per-turn stamp is reported rather than filtered on, so the picker
// can show a qualified smith as spent-today instead of vanishing him.
export const smithsFor = (campaign, row) =>
  livingCharacters(campaign)
    .filter((c) => c.type === 'Mage' && meetsForgePaths(c, row))
    .map((c) => ({
      id: c.id,
      name: c.name,
      forgedToday: c.forgedDay != null && c.forgedDay === campaign?.day,
    }))

// "Earth 2" / "Fire 1 · Earth 1" — the path requirement, phrased server-side
// (17-5): the client holds no copy of the path vocabulary.
export const forgePathsText = (row) =>
  Object.entries(row?.forge?.paths ?? {})
    .map(([path, need]) => `${SPELL_PATH_TEXT[path] ?? path} ${need}`)
    .join(' · ')

// The smith half of a plan, shared with the constructions beside the items
// (slice C2): eligibility is exactly C-1's three checks — alive, paths,
// not-forged-today — against ONE row's forge block, whichever catalog the row
// came from. Returns {character} or the {error} the route turns into a 400.
export const planSmith = (campaign, characterId, row) => {
  const character = livingCharacters(campaign).find((c) => c.id === Number(characterId))
  if (!character) return { error: `no such character: ${characterId}` }
  if (character.type !== 'Mage') return { error: `${character.name} is no smith of the arcane` }
  if (!meetsForgePaths(character, row))
    return { error: `${character.name} does not command the paths this work asks for` }
  if (character.forgedDay != null && character.forgedDay === campaign?.day)
    return { error: `${character.name} has already forged this fortnight` }
  return { character }
}

// Validate one forging without committing it — the planEquip contract: an
// {error} the route turns into a 400, or the resolved pieces the route commits.
// Checks run item-first, then smith, so the error the player sees matches the
// order the two-door UI asks its questions in.
export const planForge = (campaign, characterId, itemId) => {
  const row = findItem(itemId)
  if (!row || !row.forge) return { error: 'that item cannot be forged' }

  const level = schoolOf(campaign, 'construction').level
  if (level < row.forge.level)
    return { error: `the work is beyond you — Construction ${row.forge.level} is needed` }

  // The defensive half of uniqueness, before any resource moves; grantItem
  // re-checks at the deposit, the same two-layer shape every other channel has.
  if (row.unique && holdsItem(campaign, itemId))
    return { error: 'the campaign already holds that item' }

  const cost = row.forge.mithril ?? 0
  if ((campaign?.resources?.mithril ?? 0) < cost)
    return { error: 'not enough mithril' }

  const smith = planSmith(campaign, characterId, row)
  if (smith.error) return smith

  return { character: smith.character, row, cost }
}

// ── The foundry (slice C3) — units forged like items ────────────────────────
//
// Same three gates, same smith eligibility, same stamp. What differs from an
// item is only the deposit — the route mints a CHARACTER (C-4) instead of
// granting an item — and that a row never closes: nothing here is unique, so
// there is no `held`/`built` gate. Golems are rare because mithril and
// earth-mages are, not because a counter says so.

export const craftedUnitRows = () => CRAFTED_UNIT_CATALOG

export const findCraftedUnit = (unitId) =>
  CRAFTED_UNIT_CATALOG.find((row) => row.id === unitId) ?? null

// Validate one crafting without committing it — planForge's twin, walking the
// gates in the same order (level, mithril, then the smith) so the error the
// player sees matches the order the UI asks its questions in.
export const planCraftUnit = (campaign, characterId, unitId) => {
  const row = findCraftedUnit(unitId)
  if (!row) return { error: 'no such work of the foundry' }

  const level = schoolOf(campaign, 'construction').level
  if (level < row.forge.level)
    return { error: `the work is beyond you — Construction ${row.forge.level} is needed` }

  const cost = row.forge.mithril ?? 0
  if ((campaign?.resources?.mithril ?? 0) < cost)
    return { error: 'not enough mithril' }

  const smith = planSmith(campaign, characterId, row)
  if (smith.error) return smith

  return { character: smith.character, row, cost }
}

// The foundry block of the view — forgeView's contract: rows stable, gates
// pre-answered, phrased server-side. `unit` names the catalog type so the
// client can say what stands up without holding a copy of the row.
export const craftedUnitView = (campaign) => {
  const level = schoolOf(campaign, 'construction').level
  const mithril = campaign?.resources?.mithril ?? 0
  return {
    rows: craftedUnitRows().map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.unit,
      blurb: row.blurb,
      level: row.forge.level,
      mithril: row.forge.mithril ?? 0,
      pathsText: forgePathsText(row),
      smiths: smithsFor(campaign, row),
      levelMet: level >= row.forge.level,
      mithrilMet: mithril >= (row.forge.mithril ?? 0),
    })),
  }
}

// What the client renders — every craftable row with its three gates resolved
// against THIS campaign, phrased server-side. The row list is stable (locked
// rows are shown locked rather than hidden), so the ladder reads as a ladder:
// the player sees what a higher Construction level is FOR.
export const forgeView = (campaign) => {
  const level = schoolOf(campaign, 'construction').level
  const mithril = campaign?.resources?.mithril ?? 0
  return {
    level,
    rows: forgeRows().map((row) => {
      const smiths = smithsFor(campaign, row)
      return {
        id: row.id,
        name: row.name,
        blurb: row.blurb,
        ...describeItem(row),
        level: row.forge.level,
        mithril: row.forge.mithril ?? 0,
        pathsText: forgePathsText(row),
        smiths,
        // The three gates, pre-answered so the client composes no rule of its
        // own. `held` closes a unique row the campaign already owns.
        levelMet: level >= row.forge.level,
        mithrilMet: mithril >= (row.forge.mithril ?? 0),
        held: Boolean(row.unique) && holdsItem(campaign, row.id),
      }
    }),
  }
}
