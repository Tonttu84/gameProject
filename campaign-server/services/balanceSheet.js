import {
  EVENT_POOL,
  GARRISON_SORTIE_EVENTS,
  SIEGE_SPINE,
} from './events.js'
import { findItem } from './items.js'
import {
  AUGURY_SLOTS,
  ENEMY_ARMY,
  RAID_BASE_TARGETS,
  RAID_TARGET_FRACTION,
  RAID_LOOT_FOOD,
  RAID_LOOT_MATERIALS,
  RAID_GOLD_PER_UNIT,
  RAID_GOLD_VARIANCE,
  RAID_HORSES_PER_UNIT,
  RAID_HORSES_VARIANCE,
  RAID_RESCUE_UNIT,
  RAID_RESCUE_COUNT,
  RAID_SCOUT_COST_ADD,
  RAID_SCOUT_COST_REVEAL,
  STARTING_FOOD,
  STARTING_MATERIALS,
  STARTING_GOLD,
  STARTING_HORSES,
} from '../utils/campaignConfig.js'

// The balance sheet: every fate and every raid reward, priced side by side in
// one table, so the numbers can be compared to each other instead of read one
// card at a time out of events.js.
//
// This is a READ-ONLY view of the authored content — it computes nothing the
// game does not already compute, applies no effects, and must never become a
// second source of truth for a number. Everything here is derived from
// EVENT_POOL / GARRISON_SORTIE_EVENTS / campaignConfig at call time, so an
// authoring change shows up in the sheet on the next run and cannot drift.
//
// What it deliberately does NOT do: rank fates, score them against one
// currency, or suggest a value. Whether +40 Soldiers is worth 4 t of food is
// the design judgement this exists to inform, not to pre-empt.

// ── the resource columns every outcome is flattened into ────────────────────
// Scalars sum; the rest are per-unit-type or non-numeric and are carried as
// their own shapes (a ×0.9 on Soldiers cannot be added to a +20).
const zeroed = () => ({
  food: 0, // kg (rendered as tonnes)
  materials: 0,
  gold: 0,
  horses: 0,
  rosterDelta: {}, // unit → ± headcount
  rosterFactor: {}, // unit → multiplier (all_roster keys as '*')
  enemyFactor: 1, // enemy_losses multipliers, composed
  notes: [], // everything without a number: reveals, garrison, schedules…
})

const addInto = (acc, effect) => {
  if (!effect) return acc
  switch (effect.type) {
    case 'food':
    case 'materials':
    case 'gold':
    case 'horses':
      acc[effect.type] += effect.delta
      break
    case 'roster':
      if (effect.delta !== undefined)
        acc.rosterDelta[effect.unit] = (acc.rosterDelta[effect.unit] ?? 0) + effect.delta
      else acc.rosterFactor[effect.unit] = (acc.rosterFactor[effect.unit] ?? 1) * effect.factor
      break
    case 'all_roster':
      acc.rosterFactor['*'] = (acc.rosterFactor['*'] ?? 1) * effect.factor
      break
    case 'convert':
      acc.notes.push(`convert ≤${effect.count} ${effect.from}→${effect.to}`)
      break
    case 'enemy_losses':
      acc.enemyFactor *= effect.factor
      break
    case 'enemy_reveal':
      acc.notes.push('enemy reveal (1 turn)')
      break
    case 'garrison':
      // The delta IS shown here, unlike describeEffect's player-facing line:
      // this sheet is a design tool read by the author, and the resolve
      // thresholds are exactly what needs balancing against the gain.
      acc.notes.push(`resolve ${effect.delta > 0 ? '+' : ''}${effect.delta}`)
      break
    case 'schedule':
      acc.notes.push(`schedules ${effect.event} (+${effect.delay ?? 1} turn)`)
      break
    case 'forage_modifier':
      acc.notes.push(
        effect.target === 'enemyDrain'
          ? `enemy drain ${effect.deltaKg >= 0 ? '+' : ''}${effect.deltaKg} kg/turn${effect.raidable ? ', raidable' : ''}`
          : `own yield ×${effect.factor}${effect.raidable ? ', raidable' : ', permanent'}`,
      )
      break
    case 'flag':
      acc.notes.push(`flag ${effect.flag ?? ''}`.trim())
      break
    case 'item': {
      // A magic item (slice 6). Priced as a NOTE rather than a number, and
      // deliberately: it grants no resource and no bodies, so any figure here
      // would be invented. What the author needs to see on the sheet is which
      // unique relic a fate hands over and what it does — the abilities line is
      // the closest thing to its cost, since ability strength is what the
      // balancing pass will argue about.
      const row = findItem(effect.itemId)
      acc.notes.push(
        row
          ? `item: ${row.name}${row.abilities?.length ? ` (${row.abilities.join(', ')})` : ''}`
          : `item: ${effect.itemId}`,
      )
      break
    }
    case 'multi':
      for (const sub of effect.effects ?? []) addInto(acc, sub)
      break
    case 'none':
      break
    case 'choice':
      // Handled a level up (one row per branch) — reaching here means an
      // event declared `choice` without `choices`, which is an authoring bug.
      acc.notes.push('CHOICE WITH NO BRANCHES')
      break
    default:
      // Loud on purpose: a new effect type must be taught to this sheet, or it
      // silently prices as nothing. balanceSheet.test.js fails on this string.
      acc.notes.push(`UNPRICED EFFECT: ${effect.type}`)
  }
  return acc
}

export const priceEffect = (effect) => addInto(zeroed(), effect)

// ── how an event reaches the player ─────────────────────────────────────────
// Three doors, and they have completely different frequencies: the random
// draw (which is what the per-turn EV below is about), the schedule queue
// (guaranteed, once), and the siege spine (guaranteed, on a named turn).
const spineDay = new Map(SIEGE_SPINE.map(({ eventId, day }) => [eventId, day]))

const gateText = (requires) => {
  if (!requires) return null
  const parts = []
  if (requires.minResolve != null) parts.push(`resolve ≥${requires.minResolve}`)
  if (requires.maxResolve != null) parts.push(`resolve ≤${requires.maxResolve}`)
  if (requires.hasUnit) parts.push(`has ${requires.hasUnit}`)
  if (requires.minDay != null) parts.push(`day ≥${requires.minDay}`)
  if (requires.maxDay != null) parts.push(`day ≤${requires.maxDay}`)
  if (requires.flags) parts.push(`flags ${requires.flags.join('+')}`)
  if (requires.notFlags) parts.push(`not ${requires.notFlags.join('+')}`)
  return parts.join(', ')
}

export const reachOf = (event) => {
  if (spineDay.has(event.id)) return { door: 'spine', detail: `turn ${spineDay.get(event.id)}` }
  if (event.chained) return { door: 'chain', detail: 'scheduled only' }
  const gate = gateText(event.requires)
  return gate ? { door: 'gated draw', detail: gate } : { door: 'draw', detail: '' }
}

// ── the draw ────────────────────────────────────────────────────────────────
// The truth of every slot is drawn UNIFORMLY from the eligible pool
// (augury.js randomSlot → pickUnused): severity does NOT weight the draw, it
// only sets POOL_LEGIBILITY, i.e. how well the reading can be trusted. So a
// severity-3 fate is exactly as frequent as a severity-1 one.
//
// pickUnused prefers ids no other slot took, which makes the turn's three
// truths a sample WITHOUT replacement — but every pool member is still
// exchangeable, so each one's expected appearances per turn is exactly
// AUGURY_SLOTS / poolSize. Gated fates widen the pool when their gate opens,
// which lowers this rate for everyone; that is why the sheet reports the
// ungated baseline and the gate-open pool size separately.
export const drawPool = () => {
  const drawable = EVENT_POOL.filter((e) => !e.chained)
  const ungated = drawable.filter((e) => !e.requires)
  return {
    ungated,
    gated: drawable.filter((e) => e.requires),
    baselineSize: ungated.length,
    widestSize: drawable.length,
    perTurnBaseline: AUGURY_SLOTS / ungated.length,
    perTurnWidest: AUGURY_SLOTS / drawable.length,
  }
}

// ── one row per OUTCOME, not per event ──────────────────────────────────────
// A choice event has no single price — each branch is its own row, because the
// branch is what the player actually buys. A recon-sensitive event likewise
// resolves to one of three rungs depending on the scouting band at end-of-turn.
export const eventRows = () => {
  const rows = []
  for (const event of EVENT_POOL) {
    const reach = reachOf(event)
    const base = {
      id: event.id,
      title: event.title,
      severity: event.severity,
      reach,
    }
    if (event.choices) {
      for (const choice of event.choices)
        rows.push({
          ...base,
          kind: 'choice',
          outcome: choice.label,
          outcomeId: choice.id,
          price: priceEffect(choice.effect),
        })
      continue
    }
    if (event.reconSensitive) {
      rows.push({
        ...base,
        kind: 'rung',
        outcome: 'Blind',
        outcomeId: 'blind',
        price: priceEffect(event.effect),
      })
      for (const [rung, def] of Object.entries(event.rungs ?? {}))
        rows.push({
          ...base,
          kind: 'rung',
          outcome: rung === 'warned' ? 'Warned (Outmatched/Contested)' : 'Anticipated (Superior/Overwhelming)',
          outcomeId: rung,
          price: priceEffect(def.effect),
        })
      continue
    }
    rows.push({ ...base, kind: 'fixed', outcome: '—', outcomeId: null, price: priceEffect(event.effect) })
  }
  return rows
}

// ── expected value of a turn's fates ────────────────────────────────────────
// Three independent slots, each a uniform draw. An event with one outcome
// contributes p × its value; an event whose outcome is chosen (a choice) or
// conditional (a recon rung) contributes a BAND — the worst and best outcome
// it can resolve to. Bands are bounds, not predictions: the sheet will not
// guess which branch a player takes.
const SCALARS = ['food', 'materials', 'gold', 'horses']

export const eventTotals = () => {
  const { ungated, perTurnBaseline: p } = drawPool()
  const low = zeroed()
  const high = zeroed()
  // Linearized roster drift: Σ p × (factor − 1), i.e. the per-turn expected
  // percentage a multiplicative fate moves a roster line. Linear because the
  // factors are all within a few percent of 1 and compounding them over an
  // unknown turn count would be a fiction; exact enough to compare fates.
  const rosterDrift = { low: {}, high: {} }
  // The enemy column is a drift too, not a composed multiplier: zeroed() seeds
  // it at 1 because a single outcome's value IS a multiplier, but here it
  // accumulates Σ p × (factor − 1) like the roster drifts above.
  low.enemyFactor = 0
  high.enemyFactor = 0

  const byEvent = new Map()
  for (const row of eventRows()) {
    if (!byEvent.has(row.id)) byEvent.set(row.id, [])
    byEvent.get(row.id).push(row.price)
  }

  // An outcome that never mentions a resource contributes 0 to it, NOT nothing
  // — otherwise a choice between "+2 t of food" and "no consequence" would
  // price as if the food branch were certain, and every band would read too
  // rich. The `?? 0` / `?? 1` defaults below are that padding.
  for (const event of ungated) {
    const prices = byEvent.get(event.id) ?? []
    if (prices.length === 0) continue
    for (const key of SCALARS) {
      const values = prices.map((price) => price[key])
      low[key] += p * Math.min(...values)
      high[key] += p * Math.max(...values)
    }
    for (const unit of new Set(prices.flatMap((price) => Object.keys(price.rosterDelta)))) {
      const values = prices.map((price) => price.rosterDelta[unit] ?? 0)
      low.rosterDelta[unit] = (low.rosterDelta[unit] ?? 0) + p * Math.min(...values)
      high.rosterDelta[unit] = (high.rosterDelta[unit] ?? 0) + p * Math.max(...values)
    }
    for (const unit of new Set(prices.flatMap((price) => Object.keys(price.rosterFactor)))) {
      const drifts = prices.map((price) => (price.rosterFactor[unit] ?? 1) - 1)
      rosterDrift.low[unit] = (rosterDrift.low[unit] ?? 0) + p * Math.min(...drifts)
      rosterDrift.high[unit] = (rosterDrift.high[unit] ?? 0) + p * Math.max(...drifts)
    }
    const enemy = prices.map((price) => price.enemyFactor - 1)
    low.enemyFactor += p * Math.min(...enemy)
    high.enemyFactor += p * Math.max(...enemy)
  }
  return { p, poolSize: ungated.length, low, high, rosterDrift }
}

// ── raids ───────────────────────────────────────────────────────────────────
// A raid's payoff scales with the TARGET FORCE, which is a jittered
// RAID_TARGET_FRACTION slice of the hidden host — so every gold and horse
// figure below moves with ENEMY_ARMY, and shrinks as the host is worn down.
const enemyTotal = Object.values(ENEMY_ARMY).reduce((a, b) => a + b, 0)
const TARGET_JITTER = [0.6, 1.4] // sliceTargetForce's inline roll

export const targetForceSize = () => ({
  host: enemyTotal,
  min: enemyTotal * RAID_TARGET_FRACTION * TARGET_JITTER[0],
  mean: enemyTotal * RAID_TARGET_FRACTION,
  max: enemyTotal * RAID_TARGET_FRACTION * TARGET_JITTER[1],
})

const perUnitPayoff = (rate, variance) => {
  const force = targetForceSize()
  return {
    min: force.min * rate * variance[0],
    mean: force.mean * rate * ((variance[0] + variance[1]) / 2),
    max: force.max * rate * variance[1],
  }
}

// The four ordinary types are a uniform draw for each base target, so each
// carries RAID_BASE_TARGETS / 4 expected cards a turn. The other three doors
// are conditional and are described rather than rated.
const ORDINARY = ['destroy_detachment', 'loot_supplies', 'rescue_troops', 'seize_horses']

export const raidRows = () => {
  const perOrdinary = RAID_BASE_TARGETS / ORDINARY.length
  const rows = [
    {
      type: 'destroy_detachment',
      appears: `${perOrdinary} / turn (base draw)`,
      reward: { gold: perUnitPayoff(RAID_GOLD_PER_UNIT.destroy_detachment, RAID_GOLD_VARIANCE) },
      notes: 'the target force leaves the host — the thinning IS the reward',
    },
    {
      type: 'loot_supplies',
      appears: `${perOrdinary} / turn (base draw)`,
      reward: {
        food: { min: RAID_LOOT_FOOD[0], mean: (RAID_LOOT_FOOD[0] + RAID_LOOT_FOOD[1]) / 2, max: RAID_LOOT_FOOD[1] },
        materials: {
          min: RAID_LOOT_MATERIALS[0],
          mean: (RAID_LOOT_MATERIALS[0] + RAID_LOOT_MATERIALS[1]) / 2,
          max: RAID_LOOT_MATERIALS[1],
        },
        gold: perUnitPayoff(RAID_GOLD_PER_UNIT.loot_supplies, RAID_GOLD_VARIANCE),
      },
      notes: 'food/materials are flat rolls — they do NOT scale with the target',
    },
    {
      type: 'rescue_troops',
      appears: `${perOrdinary} / turn (base draw)`,
      reward: {
        roster: {
          unit: RAID_RESCUE_UNIT,
          min: RAID_RESCUE_COUNT[0],
          mean: (RAID_RESCUE_COUNT[0] + RAID_RESCUE_COUNT[1]) / 2,
          max: RAID_RESCUE_COUNT[1],
        },
      },
      notes: 'flat roll, independent of the host',
    },
    {
      type: 'seize_horses',
      appears: `${perOrdinary} / turn (base draw)`,
      reward: { horses: perUnitPayoff(RAID_HORSES_PER_UNIT, RAID_HORSES_VARIANCE) },
      notes: 'hired guard — a win never thins the host',
    },
    {
      type: 'counter_event',
      appears: '1 per sealed BAD fate',
      reward: {},
      notes: 'unmakes the fate; no numeric reward, so only enemy intel is buyable',
    },
    ...GARRISON_SORTIE_EVENTS.map((event) => ({
      type: `garrison_sortie (${event.id})`,
      appears: `while ${gateText(event.requires)}`,
      reward: event.sortie.materials
        ? { materials: { min: event.sortie.materials, mean: event.sortie.materials, max: event.sortie.materials } }
        : {},
      notes: `resolve +${event.sortie.resolve}${event.sortie.thinsEnemy ? ', thins the host' : ''} (resolve is hidden from the player)`,
    })),
    {
      type: 'forage_modifier card',
      appears: 'persistent, one per raidable modifier',
      reward: {},
      notes: 'winning LIFTS the standing forage pressure — priced by the modifier it undoes',
    },
  ]
  return rows
}

// ── rendering ───────────────────────────────────────────────────────────────
// Signed like describeEffect's player-facing lines (+ and the U+2212 minus), so
// a column skimmed at speed reads its direction before its magnitude. Zero
// renders empty rather than "0": the outcome does not touch that resource.
const sign = (n) => (n > 0 ? '+' : '−')
const t = (kg) => (kg === 0 ? '' : `${sign(kg)}${+(Math.abs(kg) / 1000).toFixed(2)}`)
const signed = (n, digits = 0) => (n === 0 ? '' : `${sign(n)}${Math.abs(n).toFixed(digits)}`)

const rosterText = (price) => {
  const parts = []
  for (const [unit, n] of Object.entries(price.rosterDelta)) parts.push(`${unit} ${n > 0 ? '+' : ''}${n}`)
  for (const [unit, f] of Object.entries(price.rosterFactor))
    parts.push(`${unit === '*' ? 'all' : unit} ×${f}`)
  return parts.join(', ')
}

// A fixed reward (min === max) is one number, not a degenerate range: printing
// "250–250 (250)" invites a reader to look for a spread that isn't there.
const range = (r, digits = 0) =>
  !r
    ? ''
    : r.min === r.max
      ? r.mean.toFixed(digits)
      : `${r.min.toFixed(digits)}–${r.max.toFixed(digits)} (${r.mean.toFixed(digits)})`

// Decimals in the totals table, with the same U+2212 minus the tables above
// use — one house style across the sheet.
const dec = (n, digits = 2) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`

export const renderMarkdown = () => {
  const pool = drawPool()
  const totals = eventTotals()
  const rows = eventRows()
  const force = targetForceSize()
  const out = []

  out.push('# Balance sheet — every fate and raid reward, priced')
  out.push('')
  out.push('<!--')
  out.push('  GENERATED FILE — do not hand-edit. Regenerate with:')
  out.push('      npm --prefix campaign-server run balance-sheet')
  out.push('  Source of truth is services/events.js + utils/campaignConfig.js; this file is a')
  out.push('  snapshot so the numbers can be diffed in review and read on a machine without node.')
  out.push('-->')
  out.push('')
  out.push(
    'A read-only view of the authored content, for the balancing pass. It prices nothing in a',
    'single currency on purpose — whether +40 Soldiers beats 4 t of food is the design call this',
    'exists to inform, not to make.',
  )
  out.push('')
  out.push('## The scale everything sits on')
  out.push('')
  out.push('| Reference | Value |')
  out.push('| --- | --- |')
  out.push(`| Starting stores | ${(STARTING_FOOD / 1000).toFixed(1)} t food, ${STARTING_MATERIALS} materials, ${STARTING_GOLD} gold, ${STARTING_HORSES} horses |`)
  out.push('| Starting army eats | ~12.4 t / turn |')
  out.push(`| Fates per turn | ${AUGURY_SLOTS} slots, each a uniform draw |`)
  out.push(`| Ungated draw pool | ${pool.baselineSize} events → each ~${(pool.perTurnBaseline * 100).toFixed(1)}% of a slot, ${pool.perTurnBaseline.toFixed(3)} appearances/turn |`)
  out.push(`| With every gate open | ${pool.widestSize} events → ${pool.perTurnWidest.toFixed(3)} appearances/turn each |`)
  out.push(`| Enemy host | ${force.host} units → a raid target is ${force.min.toFixed(0)}–${force.max.toFixed(0)} units (mean ${force.mean.toFixed(0)}) |`)
  out.push(`| Scouting costs | ${RAID_SCOUT_COST_ADD} pts a new target, ${RAID_SCOUT_COST_REVEAL} pts a reveal |`)
  out.push('')
  out.push('**Severity does not weight the draw.** It sets `POOL_LEGIBILITY` (how trustworthy the')
  out.push('reading is) and nothing else, so a severity-3 fate is exactly as frequent as a')
  out.push('severity-1 one. If the majors should be rarer than the minors, that is a mechanism that')
  out.push('does not exist yet, not a number to retune.')
  out.push('')

  out.push('## Fates, outcome by outcome')
  out.push('')
  out.push('One row per OUTCOME: a choice event contributes one row per branch, a recon-sensitive')
  out.push('one row per rung. Food in tonnes; blank means the outcome does not touch that column.')
  out.push('')
  out.push('| Event | Reach | Sev | Outcome | Food t | Mat | Gold | Horses | Roster | Enemy × | Other |')
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    const p = row.price
    out.push(
      `| ${row.title} \`${row.id}\` | ${row.reach.door}${row.reach.detail ? ` (${row.reach.detail})` : ''} | ${row.severity} | ${row.outcome} | ` +
        `${t(p.food)} | ${signed(p.materials)} | ${signed(p.gold)} | ${signed(p.horses)} | ${rosterText(p)} | ` +
        `${p.enemyFactor === 1 ? '' : p.enemyFactor.toFixed(2)} | ${p.notes.join('; ')} |`,
    )
  }
  out.push('')

  out.push('## What a turn of fates is worth')
  out.push('')
  out.push(`Expected value over the **${totals.poolSize} ungated** events, at ${totals.p.toFixed(3)} appearances`)
  out.push('per event per turn. Choice and recon-sensitive events resolve to one of several')
  out.push('outcomes, so they contribute a band — the columns are the worst and best the turn can')
  out.push('do, not a prediction of play. Gated fates are excluded (they widen the pool and dilute')
  out.push('these rates when their gates open).')
  out.push('')
  out.push('Numeric resources only. `resolve`, `schedule` and the forage modifiers appear in the')
  out.push('table above but are not summed here — they move hidden bookkeeping or a standing')
  out.push('multiplier, and adding them to a per-turn resource total would be inventing a rate.')
  out.push('')
  out.push('| Resource | Worst for the player / turn | Best for the player / turn |')
  out.push('| --- | --- | --- |')
  out.push(`| Food | ${dec(totals.low.food / 1000)} t | ${dec(totals.high.food / 1000)} t |`)
  out.push(`| Materials | ${dec(totals.low.materials)} | ${dec(totals.high.materials)} |`)
  out.push(`| Gold | ${dec(totals.low.gold)} | ${dec(totals.high.gold)} |`)
  out.push(`| Horses | ${dec(totals.low.horses)} | ${dec(totals.high.horses)} |`)
  for (const unit of new Set([
    ...Object.keys(totals.low.rosterDelta),
    ...Object.keys(totals.high.rosterDelta),
  ]))
    out.push(
      `| ${unit} (headcount) | ${dec(totals.low.rosterDelta[unit] ?? 0)} | ${dec(totals.high.rosterDelta[unit] ?? 0)} |`,
    )
  for (const unit of new Set([
    ...Object.keys(totals.rosterDrift.low),
    ...Object.keys(totals.rosterDrift.high),
  ]))
    out.push(
      `| ${unit === '*' ? 'every unit' : unit} (drift) | ${dec((totals.rosterDrift.low[unit] ?? 0) * 100)}% | ${dec((totals.rosterDrift.high[unit] ?? 0) * 100)}% |`,
    )
  // The enemy row's columns are SWAPPED against the numeric min/max, and must
  // be: a smaller enemy host is always better for the player, so the low drift
  // belongs in the "best" column. Every other row's low is the player's worst
  // because it is the player's own stores or troops being counted.
  out.push(
    `| Enemy host (drift) | ${dec(totals.high.enemyFactor * 100)}% | ${dec(totals.low.enemyFactor * 100)}% |`,
  )
  out.push('')
  out.push('Drift rows are linearized (Σ p × (factor − 1)) — the multiplicative fates all sit within')
  out.push('a few percent of 1, so summing them is exact enough to compare, and compounding them')
  out.push('over an unknown turn count would be a fiction.')
  out.push('')

  out.push('## Raids')
  out.push('')
  out.push('Payoffs that scale with the target force move with the host and shrink as it is worn')
  out.push('down; flat rolls do not. Columns are min–max with the mean in brackets.')
  out.push('')
  out.push('| Raid | Appears | Food t | Mat | Gold | Horses | Roster | Notes |')
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of raidRows()) {
    const r = row.reward
    out.push(
      `| \`${row.type}\` | ${row.appears} | ${r.food ? `${(r.food.min / 1000).toFixed(1)}–${(r.food.max / 1000).toFixed(1)} (${(r.food.mean / 1000).toFixed(1)})` : ''} | ` +
        `${range(r.materials)} | ${range(r.gold)} | ${range(r.horses)} | ` +
        `${r.roster ? `${r.roster.unit} ${range(r.roster)}` : ''} | ${row.notes} |`,
    )
  }
  out.push('')

  out.push('## Where the thin resources come from')
  out.push('')
  out.push('Gold and horses are the newest resources and have the fewest taps — worth checking')
  out.push('against what the Recruit phase charges for them.')
  out.push('')
  for (const key of ['gold', 'horses']) {
    const sources = rows
      .filter((row) => row.price[key] > 0)
      .map((row) => `${row.title} \`${row.id}\`${row.outcomeId ? ` → ${row.outcomeId}` : ''} (+${row.price[key]})`)
    const raids = raidRows()
      .filter((row) => row.reward[key])
      .map((row) => `\`${row.type}\` (${row.reward[key].mean.toFixed(0)} mean)`)
    out.push(`- **${key}** — events: ${sources.length ? sources.join(', ') : 'none'}. Raids: ${raids.length ? raids.join(', ') : 'none'}.`)
  }
  out.push('')
  return out.join('\n')
}
