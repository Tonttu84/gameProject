import { getInfo } from './engine.js'
import UnitType from '../models/unitType.js'
import { withCasterPaths, withEnemyScripts } from './magic.js'
import { getSpellCatalog } from '../utils/spellCatalog.js'
import { ENEMY_CHANNELS, ENEMY_SCHOOLS } from '../utils/campaignConfig.js'

// Capacity-aware random spread of an army over a deployment zone — the shared
// auto-placement core (Stage 4 Part 2 extraction): the enemy's daily plan and
// BOTH sides of a raid use this one function, so auto-placement can't drift
// between them. `army` is {type: count} (object or Map); `zone` carries
// {rowMin, rowMax, width, hexCapacity}; `sizeOf` is a Map name → size.
//
// Placement entries are AXIAL {unit_type, q, r} — same convention the
// frontend uses: q = col - floor(row / 2).
//
// A zone placer is a stateful spread over ONE shuffled hex pool: `add(army)`
// may be called repeatedly and the shared cursor/used tracking carries across
// calls, so several armies (e.g. one raid party's squads) fill the same zone
// without overstacking each other. `extra` is merged onto every entry — this
// is how squad members carry `squad_id` into the engine's placement JSON so a
// raid returns a per-squad survivor breakdown (`blue_squads`), the same as the
// main battle route.
//
// `add` scatters unit by unit (the enemy host, and any loose troops). A CAMPAIGN
// SQUAD must use `addBlock` instead: the engine groups placement entries into
// formations by (hex, squad_id), so a squad scattered one-unit-per-hex arrives as
// N one-member squads with no cohesion, no shared morale and no squad movement.
// The main battle route gets this right because the frontend drops a whole squad
// on a single hex; `addBlock` is that same "one squad, one hex" placement done
// server-side.

// The room one body takes on a hex, which is not always the size of the body
// (4c). A squad's Formation Fighters upgrade travels in `extra.squad_mods` —
// the very object the engine will apply — so the placer reads the adjustment
// from there rather than being told twice. Floored at 1, the same floor
// AUnit::getPackingSize applies: this function and the engine measure the same
// hex, and if they disagree the placer either overfills it or refuses a block
// that would have fitted.
const packedSize = (size, extra) =>
  Math.max(1, size - (extra?.squad_mods?.formationFighter ?? 0))

export function makeZonePlacer({ rowMin, rowMax, width, hexCapacity }, sizeOf) {
  // Candidate hexes with remaining capacity, shuffled once for this placer.
  const cells = []
  for (let row = rowMin; row <= rowMax; row++)
    for (let col = 0; col < width; col++)
      cells.push({ q: col - Math.floor(row / 2), r: row, used: 0 })
  const shuffled = cells.sort(() => Math.random() - 0.5)

  const placement = []
  let cursor = 0
  // Spread a LOOSE army unit by unit. It keeps its drop — the zone is bounded
  // and the enemy host grows across a campaign, so a full zone must mean "the
  // rear ranks camp this battle", not a hard-failed battle mid-campaign — but
  // it no longer SWALLOWS it: the count left off the field is returned.
  // (addBlock, below, is the opposite case and throws; the difference is that a
  // squad has an invariant to protect and a loose army does not.)
  const add = (army, extra = {}) => {
    const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
    let unplaced = 0
    for (const [type, count] of entries) {
      const catalogSize = sizeOf.get(type)
      if (!catalogSize) { // unknown type — engine would reject it anyway
        unplaced += count
        continue
      }
      const size = packedSize(catalogSize, extra)
      for (let i = 0; i < count; i++) {
        // Advance past full hexes; wrap once. If the zone is truly full the
        // remaining units are left off the field (they guard the camp).
        let tries = 0
        while (tries < shuffled.length && shuffled[cursor % shuffled.length].used + size > hexCapacity) {
          cursor++
          tries++
        }
        const cell = shuffled[cursor % shuffled.length]
        if (cell.used + size > hexCapacity) {
          unplaced += count - i
          break
        }
        cell.used += size
        placement.push({ unit_type: type, q: cell.q, r: cell.r, ...extra })
        cursor++
      }
    }
    return unplaced
  }

  // Place one whole group (a campaign squad) on a SINGLE hex, so the engine
  // builds it as one formation. Prefers an untouched hex — two squads sharing a
  // hex would still be two formations, but they'd be drawn stacked on top of
  // each other — then any hex with room for the whole block.
  //
  // EVERY FAILURE HERE THROWS (docs/CAMPAIGN_PLAN.md "SLICE 3", decision H:
  // no silent fallbacks while the design is early). This used to degrade three
  // ways, and each degradation was worse than a crash because nothing reported
  // it: a block too big for one hex was packed across several (which the engine
  // reads as N one-member squads — no cohesion, no shared morale, no squad
  // movement, i.e. a squad one body too fat silently fights as loners); a full
  // zone dropped the remainder; an unknown type was skipped. The first violates
  // "one squad, one hex", which is settled and load-bearing; the last is a data
  // bug, not a degradation. The reinforcement route's size-budget gate
  // (services/squadReinforce.js) is what keeps the first from happening — this
  // is the assertion that the gate holds.
  const addBlock = (army, extra = {}) => {
    const entries = army instanceof Map ? [...army.entries()] : Object.entries(army)
    const units = []
    for (const [type, count] of entries) {
      const catalogSize = sizeOf.get(type)
      if (!catalogSize) throw new Error(`cannot place ${type}: no such unit type in the catalog`)
      const size = packedSize(catalogSize, extra)
      for (let i = 0; i < count; i++) units.push({ type, size })
    }
    if (units.length === 0) return

    const total = units.reduce((sum, u) => sum + u.size, 0)
    if (total > hexCapacity)
      throw new Error(
        `a squad of ${total} size points cannot stand on one hex (capacity ${hexCapacity}) — one squad, one hex`,
      )

    // An untouched hex is guaranteed to hold the block (total ≤ hexCapacity is
    // checked above), so the fallback only matters once the zone is part-full.
    const whole = shuffled.find((c) => c.used === 0) ?? shuffled.find((c) => c.used + total <= hexCapacity)
    if (!whole) throw new Error(`no hex in the zone has room for a squad of ${total} size points`)
    for (const unit of units) {
      whole.used += unit.size
      placement.push({ unit_type: unit.type, q: whole.q, r: whole.r, ...extra })
    }
  }

  return { add, addBlock, result: () => placement }
}

// One-shot spread of a single army over a zone (the enemy's daily plan and the
// enemy side of a raid): a placer used once.
export function spreadPlacement(army, zone, sizeOf) {
  const placer = makeZonePlacer(zone, sizeOf)
  placer.add(army)
  return placer.result()
}

// Build a concrete enemy_placement array from the campaign's hidden enemy
// army: a random spread over the enemy zone. Stored on the campaign (HIDDEN)
// so that (a) the engine receives exactly it, and (b) a scouting reveal can
// show the player the truth rather than a guess.
//
// `magic` is the encounter's sealed {schools, channels} — the ONLY thing that
// decides which authored scripts this host's casters can carry (E-7/E-8), so it
// is threaded in rather than read off a document this function does not have.
// Creation passes the constants it is about to write onto the campaign;
// end-of-turn passes enemyMagic(campaign). The default is those same constants,
// which keeps a caller that has no campaign in hand honest rather than silently
// scriptless. `spells` defaults to the boot-filled roster and degrades to an
// empty one (utils/spellCatalog.js), so a test that never loaded a catalog gets
// no scripts instead of a crash.
export async function buildEnemyPlacement(
  army,
  magic = { schools: ENEMY_SCHOOLS, channels: ENEMY_CHANNELS },
  spells = getSpellCatalog(),
) {
  const info = await getInfo()

  // Sizes for ALL types (info.units only lists placeable ones; the enemy
  // fields spawnable-only types like Necromancer too).
  const types = await UnitType.find({})
  const sizeOf = new Map(types.map((t) => [t.name, t.size]))

  const placement = spreadPlacement(
    army,
    { ...info.enemyZone, width: info.grid.width, hexCapacity: info.grid.hexCapacity },
    sizeOf,
  )

  // The host's casters roll the same spread the player's hires do (S2-10), and
  // are SEALED HERE — onto the placement the campaign stores — rather than at
  // launch. That is the whole point of the seal: the plan is written down once
  // and the engine receives exactly it, so a reload cannot reroll the enemy,
  // which is precisely the bug the v40 bearer sealing exists to prevent.
  //
  // PER ENTRY, not per type: eleven Necromancers are eleven individuals, and
  // one of them coming up Death 3 is one of them reaching the major raise.
  // Their Death is declared by the craft (S2-14) — that is what keeps the host
  // raising skeletons from the first battle while the player starts at nothing
  // (S2-9), which is the story M-6's fluff already tells.
  //
  // The scripts go on AFTER the paths and are DERIVED rather than sealed with
  // them (E-8): the walk needs the rolled paths to match against, and it draws
  // nothing itself, so rebuilding this placement tomorrow from the same roll
  // yields the same scripts. One pass over the whole host, which is also what
  // makes "at most one battlefield script per side" mean the host and not a hex.
  return withEnemyScripts(withCasterPaths(placement), magic, spells)
}
