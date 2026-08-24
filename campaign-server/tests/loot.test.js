import { describe, expect, test } from 'vitest'
import { recoverItems, stripFallen, ORDINARY_RECOVERY_PCT } from '../services/loot.js'
import { ITEM_CATALOG } from '../utils/campaignConfig.js'

// What comes off a body when the field is yours (docs/CAMPAIGN_PLAN.md
// DECISION 9, decisions 9-10 / 9-11 / 9-12).
//
// ONE rule, ONE function, both sides — so these cases are as much about the
// enemy's dead as about your own. What they really guard is the pair of row
// flags the rule reads: `unique` decides whether the roll happens at all, and
// `lootable` takes banners out of the path in BOTH directions.

const BANNER = ITEM_CATALOG.find((r) => r.kind === 'banner')
const RELIC = 'relic_the_long_watch'
const HELM = 'gear_iron_helm'
const BLADE = 'gear_soldiers_blade'

// A `rand(min, max)` that returns the queued values in order. The production
// signature is getRandom(min, max), so a percentage roll asks for 1..100.
const rolls = (...values) => {
  const queue = [...values]
  return () => queue.shift()
}
const ALWAYS = () => 1                        // 1 <= 50, so every roll succeeds
const NEVER = () => 100                       // 100 > 50, so every roll fails

describe('recovering items from a body', () => {
  test('lose the field and it all goes down with the bearer', () => {
    // No partial recovery on a defeat, deliberately: losing the field IS the
    // cost, and a consolation roll would blunt it.
    const { recovered, lost } = recoverItems([RELIC, HELM], false, ALWAYS)
    expect(recovered).toEqual([])
    expect(lost).toEqual([RELIC, HELM])
  })

  test('a unique always comes home on a win, however the dice fall', () => {
    expect(recoverItems([RELIC], true, NEVER).recovered).toEqual([RELIC])
  })

  test('ordinary kit rolls, and the roll is honoured both ways', () => {
    expect(recoverItems([HELM], true, ALWAYS).recovered).toEqual([HELM])
    expect(recoverItems([HELM], true, NEVER).recovered).toEqual([])
    expect(recoverItems([HELM], true, NEVER).lost).toEqual([HELM])
  })

  test('the roll is PER ITEM, not one roll for the lot', () => {
    // 9-10 says "the roll is per item". A single roll for the whole kit would
    // make a champion an all-or-nothing prize.
    const { recovered, lost } = recoverItems([HELM, BLADE], true, rolls(1, 100))
    expect(recovered).toEqual([HELM])
    expect(lost).toEqual([BLADE])
  })

  test('the boundary is inclusive — exactly the chance recovers', () => {
    expect(recoverItems([HELM], true, () => ORDINARY_RECOVERY_PCT).recovered).toEqual([HELM])
    expect(recoverItems([HELM], true, () => ORDINARY_RECOVERY_PCT + 1).recovered).toEqual([])
  })

  test('a banner is neither recovered nor lost — it is outside the path', () => {
    // 9-12, and the direction that matters most: your own charter keeps its
    // banner when it is wiped (decision 14 already says the charter survives),
    // so a banner must not be "lost" here either.
    const { recovered, lost } = recoverItems([BANNER.id], true, ALWAYS)
    expect(recovered).toEqual([])
    expect(lost).toEqual([])
    expect(recoverItems([BANNER.id], false, ALWAYS)).toEqual({ recovered: [], lost: [] })
  })

  test('an id whose row has left the catalog is quietly dropped', () => {
    // Already nothing. Dropping it is also what stops a lucky roll resurrecting
    // a retired row into the store.
    expect(recoverItems(['gear_of_a_previous_build'], true, ALWAYS))
      .toEqual({ recovered: [], lost: [] })
  })

  test('an empty or missing list is not an error', () => {
    expect(recoverItems([], true, ALWAYS)).toEqual({ recovered: [], lost: [] })
    expect(recoverItems(undefined, true, ALWAYS)).toEqual({ recovered: [], lost: [] })
  })
})

describe('stripping the fallen', () => {
  const fallen = (...items) => ({
    name: 'Isolde',
    items: items.map((itemId, index) => ({ slot: 'misc', index, itemId })),
  })

  test('a recovered item LEAVES the record; an unrecovered one STAYS', () => {
    // The store's invariant is that "in the store" means "on nothing", so
    // recovery has to remove it here. Leaving the rest behind is what gives
    // 5-9's preservation rule teeth: the gear you did NOT recover is still on
    // the body for a later recovery spell to find.
    const dead = fallen(RELIC, HELM)
    const taken = stripFallen(dead, true, NEVER)
    expect(taken).toEqual([RELIC])          // unique: always
    expect(dead.items.map((w) => w.itemId)).toEqual([HELM]) // ordinary: rolled and lost
  })

  test('losing the field leaves everything on the body', () => {
    const dead = fallen(RELIC, HELM)
    expect(stripFallen(dead, false, ALWAYS)).toEqual([])
    expect(dead.items).toHaveLength(2)
  })

  test('two identical blades, one recovered, loses exactly one', () => {
    // Ordinary kit stacks (9-6), so a filter by id would take both — the same
    // remove-one bug the store had.
    const dead = fallen(BLADE, BLADE)
    const taken = stripFallen(dead, true, rolls(1, 100))
    expect(taken).toEqual([BLADE])
    expect(dead.items.map((w) => w.itemId)).toEqual([BLADE])
  })

  test('a banner on the body is never stripped', () => {
    const dead = fallen(BANNER.id)
    expect(stripFallen(dead, true, ALWAYS)).toEqual([])
    expect(dead.items).toHaveLength(1)
  })

  test('a character with nothing on them is not an error', () => {
    const dead = { name: 'Isolde', items: [] }
    expect(stripFallen(dead, true, ALWAYS)).toEqual([])
    expect(stripFallen({ name: 'Nobody' }, true, ALWAYS)).toEqual([])
  })
})
