import { describe, it, expect } from 'vitest'
import { EVENT_POOL } from '../services/events.js'
import {
  priceEffect,
  eventRows,
  eventTotals,
  drawPool,
  raidRows,
  renderMarkdown,
} from '../services/balanceSheet.js'

// The balance sheet is a design tool, not a game mechanic — nothing the player
// sees depends on it. What these tests protect is its USEFULNESS: a sheet that
// silently omits a fate, or prices a new effect type as nothing, is worse than
// no sheet, because it invites a balance decision made on incomplete numbers.
//
// Pure throughout: no DB, no engine binary, so this file runs in any
// environment (see the cloud-session note in docs/CAMPAIGN_PLAN.md).

describe('every authored outcome reaches the sheet', () => {
  it('covers every event in the pool', () => {
    const covered = new Set(eventRows().map((row) => row.id))
    expect([...covered].sort()).toEqual(EVENT_POOL.map((e) => e.id).sort())
  })

  it('gives a choice event one row per branch, and a recon fate one per rung', () => {
    const rows = eventRows()
    const courier = rows.filter((row) => row.id === 'captured_courier')
    expect(courier.map((row) => row.outcomeId)).toEqual(['read_dispatches', 'ransom_courier'])

    const raiders = rows.filter((row) => row.id === 'forage_raiders')
    expect(raiders.map((row) => row.outcomeId)).toEqual(['blind', 'warned', 'anticipated'])
  })

  it('prices no effect as UNPRICED — a new effect type must be taught the sheet', () => {
    const unpriced = eventRows().filter((row) =>
      row.price.notes.some((note) => note.startsWith('UNPRICED') || note.includes('NO BRANCHES')),
    )
    expect(unpriced.map((row) => `${row.id}/${row.outcomeId}`)).toEqual([])
  })
})

describe('effects flatten into comparable columns', () => {
  it('sums a multi bundle into its parts', () => {
    const price = priceEffect({
      type: 'multi',
      effects: [
        { type: 'food', delta: -3000 },
        { type: 'materials', delta: -10 },
        { type: 'roster', unit: 'Soldier', delta: +20 },
      ],
    })
    expect(price.food).toBe(-3000)
    expect(price.materials).toBe(-10)
    expect(price.rosterDelta).toEqual({ Soldier: 20 })
  })

  it('keeps a roster factor apart from a roster delta', () => {
    // ×0.9 on 300 Soldiers and −30 Soldiers are the same blow today and
    // different blows tomorrow; the sheet must never add them together.
    const price = priceEffect({ type: 'roster', unit: 'Soldier', factor: 0.9 })
    expect(price.rosterDelta).toEqual({})
    expect(price.rosterFactor).toEqual({ Soldier: 0.9 })
  })

  it('carries the hidden-bookkeeping effects as notes, with their numbers', () => {
    // Unlike describeEffect (which hides the resolve delta from the PLAYER),
    // the sheet is read by the author and needs the figure it is balancing.
    expect(priceEffect({ type: 'garrison', delta: +15 }).notes).toEqual(['resolve +15'])
    expect(priceEffect({ type: 'schedule', event: 'sprung_ambush', delay: 1 }).notes)
      .toEqual(['schedules sprung_ambush (+1 turn)'])
  })
})

describe('the draw is uniform over the eligible pool', () => {
  it('rates every ungated event at AUGURY_SLOTS / poolSize', () => {
    const pool = drawPool()
    expect(pool.perTurnBaseline).toBeCloseTo(3 / pool.baselineSize, 10)
    // Gates only ever widen the pool, so the per-event rate can only fall.
    expect(pool.perTurnWidest).toBeLessThan(pool.perTurnBaseline)
  })

  it('excludes chained beats — they reach the player only via the schedule', () => {
    const drawable = new Set(drawPool().ungated.map((e) => e.id))
    expect(drawable.has('sprung_ambush')).toBe(false)
    expect(drawable.has('relief_column_arrives')).toBe(false)
  })
})

describe('the per-turn totals are bounds, not predictions', () => {
  it('brackets a choice event by its branches rather than assuming one', () => {
    const totals = eventTotals()
    // refugees can cost 3 t or nothing; sellswords can cost 3 t or nothing;
    // whichever way they fall, the worst case must be strictly poorer than the
    // best, and the best case must not be negative on food alone.
    expect(totals.low.food).toBeLessThan(totals.high.food)
  })

  it('never prices an unmentioned resource as a certainty', () => {
    // The trap this guards, stated exactly: A Captured Herd is the only ungated
    // source of horses, and only ONE of its three branches takes them (+25).
    // So the turn's worst case for horses is 0 — a branch that says nothing
    // about a resource must contribute 0 to it, not be skipped. Skipping would
    // make the worst case +25 × p, i.e. a stockpile the player may never build.
    const totals = eventTotals()
    expect(totals.low.horses).toBe(0)
    expect(totals.high.horses).toBeCloseTo(25 * totals.p, 10)
  })

  it('reports roster multipliers as drift, not as headcount', () => {
    const totals = eventTotals()
    // plague (×0.95 on everything) is ungated, so the all-unit drift is real
    // and negative at the worst end.
    expect(totals.rosterDrift.low['*']).toBeLessThan(0)
  })
})

describe('raids', () => {
  it('rates the four ordinary types as one shared base draw', () => {
    const ordinary = raidRows().filter((row) => row.appears.includes('base draw'))
    expect(ordinary.map((row) => row.type)).toEqual([
      'destroy_detachment',
      'loot_supplies',
      'rescue_troops',
      'seize_horses',
    ])
    for (const row of ordinary) expect(row.appears).toContain('0.25')
  })

  it('scales the per-head payoffs with the host and leaves the flat rolls flat', () => {
    const rows = raidRows()
    const loot = rows.find((row) => row.type === 'loot_supplies')
    // Food is a flat roll: its bounds are exactly the configured range.
    expect(loot.reward.food.min).toBe(2000)
    expect(loot.reward.food.max).toBe(5000)
    // Gold is per-head: destroy pays better than loot at the same target size.
    const destroy = rows.find((row) => row.type === 'destroy_detachment')
    expect(destroy.reward.gold.mean).toBeGreaterThan(loot.reward.gold.mean)
  })

  it('gives the counter-raid no numeric reward — there is nothing to reveal', () => {
    const counter = raidRows().find((row) => row.type === 'counter_event')
    expect(counter.reward).toEqual({})
  })
})

describe('the rendered sheet', () => {
  it('names every event and every raid type', () => {
    const markdown = renderMarkdown()
    for (const event of EVENT_POOL) expect(markdown).toContain(`\`${event.id}\``)
    for (const row of raidRows()) expect(markdown).toContain(row.type)
  })

  it('reads the enemy row from the PLAYER’s side, not the number’s', () => {
    // Every other row's low value is the player's worst case, because it counts
    // the player's own stores. The enemy row inverts: a host that shrinks by
    // 1.4% is the BEST outcome, not the worst. Pinned because the swap looks
    // like a bug to anyone reading the render in isolation.
    const line = renderMarkdown()
      .split('\n')
      .find((row) => row.startsWith('| Enemy host (drift)'))
    // The sheet prints a typographic minus (U+2212), which parseFloat reads as
    // NaN — normalize before comparing rather than weakening the render.
    const cells = line.split('|').map((cell) => parseFloat(cell.trim().replace('−', '-')))
    const [, , worst, best] = cells
    expect(best).toBeLessThan(worst)
  })

  it('says which resources have thin taps', () => {
    const markdown = renderMarkdown()
    expect(markdown).toContain('**gold**')
    expect(markdown).toContain('garrison_paychest')
  })
})
