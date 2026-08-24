// What comes off a body when the field is yours (docs/CAMPAIGN_PLAN.md
// DECISION 9, decisions 9-10 and 9-11).
//
// ONE rule, ONE function, both sides. Your fallen and the enemy's are looted by
// the same arithmetic, because the user stated it as one rule:
//   • hold the field and uniques come home, always;
//   • ordinary kit rolls 50%, per item;
//   • lose the field and it all goes down with the bearer, yours and theirs.
//
// Two decisions carry each other here. 9-6 put uniqueness on the ROW, and 9-10
// made the roll read that flag — so a row is priced once and the loot code asks
// the item rather than knowing anything about what kinds of item exist.
//
// 9-12's asymmetry is enforced by `lootable`, also a row flag: banners sit
// outside this path in BOTH directions — never stripped from an enemy (you
// would be flying their colours), never lost when your own charter is wiped
// (decision 14 already keeps the charter and its banner). Written down because
// it is exactly the kind of asymmetry a later reader would "fix".

import { getRandom } from '../utils/dice.js'
import { findItem } from './items.js'

// The per-item chance for ordinary kit, as a percentage. A number rather than a
// 0.5 so it reads the same way every other authored chance in the codebase does.
export const ORDINARY_RECOVERY_PCT = 50

// Split a list of item ids into what is recovered and what is lost.
//
// `won` is the whole of the loss case: hold the field and the rule below
// applies, lose it and nothing comes back. There is no partial recovery on a
// defeat, deliberately — losing the field is the cost, and a consolation roll
// would blunt it.
//
// `rand` is injectable so tests can pin the coin flips.
export function recoverItems(itemIds, won, rand = getRandom) {
  const recovered = []
  const lost = []
  for (const id of itemIds ?? []) {
    const row = findItem(id)
    // An id whose row has left the catalog is neither recovered nor kept: it is
    // already nothing, and the archetypeOf convention says degrade rather than
    // throw. Dropping it here is also what stops a retired row being resurrected
    // into the store by a lucky roll.
    if (!row) continue
    // Outside the loot path entirely (9-12). Not recovered and NOT lost — it
    // stays exactly where it was, which for your own dead means still on the
    // record and for the enemy means still theirs.
    if (row.lootable === false) continue
    if (!won) { lost.push(id); continue }
    if (row.unique) { recovered.push(id); continue }
    if (rand(1, 100) <= ORDINARY_RECOVERY_PCT) recovered.push(id)
    else lost.push(id)
  }
  return { recovered, lost }
}

// Strip what can be recovered from a character who fell, and say what was
// taken. MUTATES the character's item list, which is the point:
//
//   a recovered item LEAVES the dead character's list; an unrecovered one STAYS
//   on the record.
//
// The store's invariant is that "in the store" means "on nothing", and an item
// cannot be in two places — so recovery has to remove it here. Leaving the rest
// behind is what finally gives 5-9's preservation rule teeth: the gear you did
// NOT recover is still on the body for a future recovery spell to find.
//
// Returns the recovered ids; the caller grants them, because grantItem is the
// one acquisition chokepoint (6-13) and this must not become a second one.
export function stripFallen(character, won, rand = getRandom) {
  const worn = [...(character?.items ?? [])]
  const ids = worn.map((w) => w?.itemId).filter(Boolean)
  const { recovered } = recoverItems(ids, won, rand)

  // Remove ONE entry per recovered id, matched by id. Ordinary kit stacks
  // (9-6), so a champion wearing two identical blades of which one is recovered
  // must lose exactly one — a filter would take both.
  const taken = [...recovered]
  character.items = worn.filter((w) => {
    const at = taken.indexOf(w?.itemId)
    if (at < 0) return true
    taken.splice(at, 1)
    return false
  })
  return recovered
}
