import { EVENT_RUNG_BY_BAND } from '../utils/campaignConfig.js'

// Fortnightly event pool + effect application. Events reach the player only
// as the augur's prophecy (services/augury.js): each turn one TRUE event and
// one DECOY are drawn, the prophecy may show either, and the true effect
// applies at end-of-turn regardless of what was foretold.

// severity 1–3 IS the pool: minor / normal / major. A slot's true and false
// events are always drawn from the same pool, and the reading's legibility
// modifier belongs to the POOL, never the event (user, 2026-07-05): the
// displayed odds are identical whichever pool member is true, so they tell
// the player how murky the reading was — never which card to believe. The
// player does learn the pool (the card's gravity says as much), so every
// pool must hold BOTH good and bad events: magnitude leaks, direction never.
// augury.test.js tripwires all of this (≥2 events per pool, mixed valence).
//
// Everyday small fates read easily; great fates are murky.
export const POOL_LEGIBILITY = { 1: 2, 2: 1, 3: 0 } // reading-roll bonus by pool

// Food deltas are kg on the fortnight-turn scale (the starting army eats
// ~12,400 kg a turn, stores start at 50,000). Player-facing text speaks in
// tonnes, the effect values stay kg.
export const EVENT_POOL = [
  // ── minor (severity 1): everyday ups and downs ──
  { id: 'supply',        title: 'Supply Cache',      description: 'Scouts find an abandoned depot. +3 t of food.',           severity: 1, effect: { type: 'food',       delta: +3000 } },
  { id: 'traders',       title: 'Traveling Traders', description: 'Merchants sell supplies. +1.5 t of food.',                severity: 1, effect: { type: 'food',       delta: +1500 } },
  { id: 'weather',       title: 'Harsh Weather',     description: 'A hard fortnight drains rations. -1 t of food.',          severity: 1, effect: { type: 'food',       delta: -1000 } },
  // ── normal (severity 2): the ranks swell or thin ──
  { id: 'reinforcement', title: 'Reinforcements',    description: 'A company joins your banner. +20 Soldiers.',              severity: 2, effect: { type: 'roster',     unit: 'Soldier', delta: +20 } },
  { id: 'desertion',     title: 'Desertion',         description: 'Low morale: 10% of soldiers desert overnight.',           severity: 2, effect: { type: 'roster',     unit: 'Soldier', factor: 0.9 } },
  // ── recon-sensitive fates (Stage 4 1c): thematic threats — ambush / raid /
  // night-attack, never plague or weather — carry a three-rung ladder. The
  // event itself IS the Blind rung (the full blow, and always what the augur
  // foretells); the scouting band at end-of-turn picks the rung that actually
  // fires (EVENT_RUNG_BY_BAND → firedRung below). Ladders live HERE, not in
  // the stored slot copy (the augury schema keeps display fields only), so a
  // mid-campaign pool edit changes rungs, never an already-sealed fate.
  {
    id: 'forage_raiders', title: 'Forage Raiders', description: 'Enemy riders fall on your foraging parties: stores plundered, wagons burned, foragers cut down.', severity: 2,
    effect: { type: 'multi', effects: [{ type: 'food', delta: -4000 }, { type: 'materials', delta: -20 }, { type: 'roster', unit: 'Soldier', factor: 0.97 }] },
    reconSensitive: true,
    rungs: {
      warned:      { title: 'Raiders Intercepted', description: 'Your escorts meet the riders at the treeline — a few sacks lost, nothing more.', effect: { type: 'food', delta: -1000 } },
      anticipated: { title: 'Raiders Destroyed',   description: 'Your scouts tracked the raiding party for days; it rides into a killing ground and is wiped out.', effect: { type: 'enemy_losses', factor: 0.95 } },
    },
  },
  {
    id: 'night_raid', title: 'Night Raid', description: 'Raiders slip past the pickets in the dark: stores stolen, and shaken men desert by morning.', severity: 2,
    effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'roster', unit: 'Soldier', factor: 0.98 }] },
    reconSensitive: true,
    rungs: {
      warned:      { title: 'Pickets Hold',    description: 'The pickets catch the raiders at the ditch; they flee with next to nothing.', effect: { type: 'food', delta: -500 } },
      anticipated: { title: 'Prisoners Taken', description: 'The raiders walk into waiting spears. By dawn the prisoners have betrayed the enemy camp.', effect: { type: 'enemy_reveal' } },
    },
  },
  // ── major (severity 3): fates that bend the campaign ──
  { id: 'defection',     title: 'Mass Defection',    description: 'Enemy soldiers slip across in the night. +40 Soldiers.',  severity: 3, effect: { type: 'roster',     unit: 'Soldier', delta: +40 } },
  { id: 'plague',        title: 'Plague',            description: 'Disease thins the ranks by 5%.',                          severity: 3, effect: { type: 'all_roster', factor: 0.95 } },
  // Blind and warned differ only in the telling until a battlefield surprise
  // penalty exists — the rung machinery is what the later mechanic hooks into.
  {
    id: 'ambush', title: 'Enemy Ambush', description: 'Enemy scouts have located your camp.', severity: 3,
    effect: { type: 'enemy_advance' },
    reconSensitive: true,
    rungs: {
      warned:      { title: 'Ambush Foreseen', description: 'They advance, but your pickets give warning — you will meet them in good order.', effect: { type: 'enemy_advance' } },
      anticipated: { title: 'Counter-Ambush',  description: 'You bait the trap; the ambushers are cut apart as they spring it.', effect: { type: 'enemy_losses', factor: 0.93 } },
    },
  },
  // ── materials fates (Stage 3 sink feeds fortifications/militia) ──
  { id: 'quarry',        title: 'Quarry Found',      description: 'A workable seam of stone and timber. +25 materials.',     severity: 1, effect: { type: 'materials',  delta: +25 } },
  { id: 'tool_rot',      title: 'Tool Rot',          description: 'Damp ruins tools and cordage. -15 materials.',            severity: 2, effect: { type: 'materials',  delta: -15 } },
  // ── prerequisite-gated fates (R1) ── An event may carry a `requires` block
  // (eventEligible below); it only enters a draw when the campaign state
  // satisfies it, as truth OR decoy. Gated events are ADDITIVE — the
  // unconditional events already keep every tier legible (augury.test.js
  // tripwire), so a prerequisite can only widen a pool, never collapse it.
  // horse_sickness is the proof: a murrain among the mounts that can only
  // befall an army that actually fields cavalry.
  { id: 'horse_sickness', title: 'Horse Sickness', description: 'Murrain runs the picket lines; your mounts sicken and the worst must be put down.', severity: 2, effect: { type: 'roster', unit: 'Cavalry', factor: 0.9 }, requires: { hasUnit: 'Cavalry' } },
  // ── fates with choices (resolve-then-choose) ── The fired rung's `choices`
  // hand the player a decision instead of an effect: end-day pends it
  // (dayResolution) and a follow-up POST applies the picked branch. Branches
  // live HERE like the rung ladders (the slot copy stores display fields plus
  // the `choice` sentinel — the schema requires an effect; it never applies).
  // Option text is phrases only, NO numbers (augury.test.js tripwires it) —
  // the player weighs directions, never exact magnitudes. A choice event has
  // no single effect, so it DECLARES its valence for the augur's header and
  // the counter_event raid draw (eventValenceFor below).
  {
    id: 'merchant_caravan', title: 'A Merchant Caravan', description: 'A well-guarded trade caravan makes camp within sight of your pickets, its masters keen to deal.', severity: 1,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'buy_provisions',     label: 'Buy up their provisions',   description: 'Pay in tools and timber to fill the larder against the lean weeks ahead.', effect: { type: 'multi', effects: [{ type: 'materials', delta: -15 }, { type: 'food', delta: +3000 }] } },
      { id: 'sell_for_materials', label: 'Trade rations for their wares', description: 'Part with some of your stores for the cordage, nails and worked timber the camp sorely needs.', effect: { type: 'multi', effects: [{ type: 'food', delta: -2000 }, { type: 'materials', delta: +25 }] } },
    ],
  },
  {
    id: 'refugees', title: 'Refugees at the Palisade', description: 'A column of burned-out villagers begs shelter at the camp gates.', severity: 1,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'turn_away', label: 'Turn them away',                    description: 'The war is not theirs to eat through. They trudge on; the stores stay whole.', effect: { type: 'none' } },
      { id: 'take_in',   label: 'Take them in — more mouths, more hands', description: 'Feeding them will cost stores, but the able-bodied among them will take up arms as militia.', effect: { type: 'multi', effects: [{ type: 'food', delta: -3000 }, { type: 'roster', unit: 'Militia', delta: +20 }] } },
    ],
  },
  {
    id: 'baggage_plague', title: 'Plague in the Baggage Train', description: 'Fever breaks out among the wagons; the sick multiply by the day.', severity: 2,
    effect: { type: 'choice' }, valence: 'bad',
    choices: [
      { id: 'quarantine', label: 'Quarantine and burn the tainted stores', description: 'Harsh, but sure: the sickness dies with the supplies it touched.', effect: { type: 'food', delta: -4000 } },
      { id: 'march_on',   label: 'March on and trust to providence',       description: 'Keep the stores and the pace — and let the fever take whom it takes.', effect: { type: 'all_roster', factor: 0.98 } },
    ],
  },
  // A major boon with a real fork: turn footmen into a mounted arm, or cash
  // the herd in for supply. The mount branch is the `convert` mechanic's first
  // use — Soldiers become Cavalry (a placeable/spawnable engine unit), at a
  // cost in materials for tack and shoeing.
  {
    id: 'horses', title: 'A Captured Herd', description: 'Your outriders drive in a herd of enemy remounts — sound warhorses by the dozen, yours to use as you will.', severity: 3,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'mount_veterans', label: 'Mount your veterans as cavalry', description: 'Put your steadiest footmen in the saddle. Saddlery and shoeing eat into your materials, but you raise a mounted arm from your own ranks.', effect: { type: 'multi', effects: [{ type: 'convert', from: 'Soldier', to: 'Cavalry', count: 25 }, { type: 'materials', delta: -20 }] } },
      { id: 'sell_herd',      label: 'Sell the herd to the baggage train', description: 'Trade the horses to the quartermasters for supply. The stores swell and the wagons roll a little heavier.', effect: { type: 'multi', effects: [{ type: 'materials', delta: +30 }, { type: 'food', delta: +4000 }] } },
    ],
  },
  {
    id: 'sellswords', title: 'Sellswords at the Camp', description: 'A free company of veteran mercenaries rides in and offers their spears — for the right price in supply.', severity: 2,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'hire', label: 'Hire the company', description: 'Pay them out of your stores and swell your line with hardened fighters who ask no oath but coin.', effect: { type: 'multi', effects: [{ type: 'roster', unit: 'Soldier', delta: +20 }, { type: 'food', delta: -3000 }, { type: 'materials', delta: -10 }] } },
      { id: 'decline', label: 'Send them on their way', description: 'You keep your stores whole; they shrug and ride off to sell their steel elsewhere.', effect: { type: 'none' } },
    ],
  },
  {
    id: 'drillmaster', title: 'A Hard-Handed Drillmaster', description: 'A grizzled sergeant offers to break your raw levy into proper soldiers — if you can feed them through the drilling.', severity: 2,
    effect: { type: 'choice' }, valence: 'neutral',
    choices: [
      { id: 'drill', label: 'Drill the levy into soldiers', description: 'Weeks of hard training on full rations turn militia into line troops — at a real cost in food.', effect: { type: 'multi', effects: [{ type: 'convert', from: 'Militia', to: 'Soldier', count: 20 }, { type: 'food', delta: -3000 }] } },
      { id: 'leave_be', label: 'Leave them to forage', description: 'Keep the levy at their sacks and spades. Green they stay, but the stores stay fuller.', effect: { type: 'none' } },
    ],
  },
  {
    id: 'deserter_lord', title: 'An Enemy Captain Defects', description: 'An enemy officer, out of favour with his warlord, slips into camp under a white flag with his whole company at his back.', severity: 3,
    effect: { type: 'choice' }, valence: 'good',
    choices: [
      { id: 'take_the_oath', label: 'Take his oath and his men', description: 'Swell your banner with a full company of turncoats — trusting that a man who betrayed once will not do it twice.', effect: { type: 'roster', unit: 'Soldier', delta: +35 } },
      { id: 'send_home', label: 'Send him back to sow discord', description: 'Refuse the oath but let him return whispering mutiny — his warlord\'s ranks thin as the rot spreads.', effect: { type: 'enemy_losses', factor: 0.93 } },
    ],
  },
  // ── neutral fates: something happens, nothing tips the scales. One per pool
  // so all three magnitudes of the "neutral" reading show up in play. A
  // `none` effect is a genuine no-op at end-of-turn — the drama is in the
  // reading, not the result (a "dire" omen that comes to nothing is a relief).
  { id: 'lull',          title: 'A Quiet Fortnight', description: 'The days pass without incident — no gift, no blow.',       severity: 1, effect: { type: 'none' } },
  { id: 'rains',         title: 'Season of Rains',   description: 'Downpours foul every bowstring, yours and theirs alike. Neither host gains an edge.', severity: 2, effect: { type: 'none' } },
  { id: 'comet',         title: 'A Comet Overhead',  description: 'A comet burns across the sky for a fortnight. The men mutter of doom, but nothing comes of it.', severity: 3, effect: { type: 'none' } },
]
// (The old 'intel' event died with auguryScore; a defector event returns as a
// scouting-points effect when the scouting stage lands.)

export const rosterTotal = (roster) =>
  [...roster.values()].reduce((a, b) => a + b, 0)

// The augur's state (roster, eventFlags) reaches here as a Mongoose Map on the
// live doc but a plain object at creation-time draws and in tests — read both.
const bagGet = (bag, key) => (bag instanceof Map ? bag.get(key) : bag?.[key]) ?? 0

// Prerequisites (R1): does this event's `requires` block hold against the
// current campaign context {day, roster, eventFlags}? An event with no
// `requires` is always eligible. Every clause is ANDed; the context is
// duck-typed so the same predicate serves the draw path (live doc), the
// creation route (plain STARTING_ROSTER), and the unit tests. Ineligible
// events are dropped from the draw entirely — a gated fate can be neither the
// truth nor the decoy until its trigger is met, so a chain's later beat can't
// surface early and a state-flavoured fate can't fire on the wrong army.
export const eventEligible = (event, ctx = {}) => {
  const req = event.requires
  if (!req) return true
  const day = ctx.day ?? 1
  if (req.minDay != null && day < req.minDay) return false
  if (req.maxDay != null && day > req.maxDay) return false
  if (req.flags && !req.flags.every((f) => bagGet(ctx.eventFlags, f) > 0)) return false
  if (req.notFlags && req.notFlags.some((f) => bagGet(ctx.eventFlags, f) > 0)) return false
  if (req.hasUnit && bagGet(ctx.roster, req.hasUnit) <= 0) return false
  return true
}

// The draw pool as the campaign state currently allows it. The augur draws
// both the truth and the decoy from here (augury.js), so nothing ineligible
// can ever reach the player.
export const eligiblePool = (ctx) => EVENT_POOL.filter((e) => eventEligible(e, ctx))

// The single source of an event's mood: good / bad / neutral, derived from its
// own effect. The augur's header labels the SHOWN card with this (so a bluff
// reads as the flavour it shows), and the pool leak-guards use it too — one
// classifier, so the two can never disagree. Anything without a clear gain or
// loss (a no-op `none`, or an unknown effect) is neutral.
export const eventValence = (effect) => {
  if (!effect) return 'neutral'
  switch (effect.type) {
    case 'food':
    case 'materials':
      return effect.delta > 0 ? 'good' : effect.delta < 0 ? 'bad' : 'neutral'
    case 'roster':
      if (effect.delta !== undefined)
        return effect.delta > 0 ? 'good' : effect.delta < 0 ? 'bad' : 'neutral'
      return effect.factor > 1 ? 'good' : effect.factor < 1 ? 'bad' : 'neutral'
    case 'all_roster':
      return effect.factor > 1 ? 'good' : effect.factor < 1 ? 'bad' : 'neutral'
    case 'enemy_advance':
      return 'bad'
    // The enemy's losses and betrayed secrets are our gain.
    case 'enemy_losses':
    case 'enemy_reveal':
      return 'good'
    // Upgrading units in place (mount soldiers as cavalry) is a gain.
    case 'convert':
      return 'good'
    // A bundle reads as its parts' shared mood; genuinely mixed bundles
    // (a gain and a loss in one fate) net out to neutral.
    case 'multi': {
      const moods = new Set(
        effect.effects.map(eventValence).filter((v) => v !== 'neutral'),
      )
      return moods.size === 1 ? [...moods][0] : 'neutral'
    }
    default:
      return 'neutral'
  }
}

// An EVENT's mood, where eventValence above classifies an EFFECT: honours a
// declared `valence` (looked up in the pool by id, since a stored slot copy
// carries neither the declaration nor the choices it stands in for), falling
// back to the effect-derived one. Use this wherever the input is an event —
// the augur's header (campaignView) and the counter_event raid draw both do.
export const eventValenceFor = (event) => {
  const pooled = EVENT_POOL.find((e) => e.id === event?.id)
  return pooled?.valence ?? eventValence(event?.effect)
}

// The choice set a pending decision points at: pool lookup by event id +
// fired rung (the sealed-fate rule — a mid-campaign pool edit changes the
// branches, never an already-recorded decision's identity). Null when the id
// is gone from the pool or the rung carries no choices.
export const choiceRung = (eventId, rung) => {
  const pooled = EVENT_POOL.find((e) => e.id === eventId)
  const def = rung === 'blind' ? pooled : pooled?.rungs?.[rung]
  if (!def?.choices) return null
  return { title: def.title, description: def.description, choices: def.choices }
}

// Mutates the campaign in place; caller saves. Returns log lines.
export function applyEffect(campaign, effect) {
  const log = []
  if (effect.type === 'food') {
    campaign.resources.food = Math.max(0, campaign.resources.food + effect.delta)
    log.push(`Food ${effect.delta > 0 ? '+' : ''}${+(effect.delta / 1000).toFixed(1)} t.`)
  } else if (effect.type === 'materials') {
    campaign.resources.materials = Math.max(0, campaign.resources.materials + effect.delta)
    log.push(`Materials ${effect.delta > 0 ? '+' : ''}${effect.delta}.`)
  } else if (effect.type === 'roster') {
    const cur = campaign.roster.get(effect.unit) ?? 0
    const next =
      effect.delta !== undefined
        ? Math.max(0, cur + effect.delta)
        : Math.floor(cur * effect.factor)
    campaign.roster.set(effect.unit, next)
    log.push(`${effect.unit}: ${cur} → ${next}.`)
  } else if (effect.type === 'all_roster') {
    for (const [type, n] of campaign.roster)
      campaign.roster.set(type, Math.floor(n * effect.factor))
    log.push(`All units ×${effect.factor}.`)
  } else if (effect.type === 'enemy_advance') {
    // The enemy comes looking for a fight tomorrow.
    campaign.enemy.stance = 'offering_battle'
    log.push('The enemy host is moving on your camp.')
  } else if (effect.type === 'enemy_losses') {
    // The scouts' reversal (anticipated rung): the blow lands on the enemy
    // instead. The log is player-visible, so it stays a phrase — enemy
    // numbers never leak through it.
    for (const [type, n] of campaign.enemy.army)
      campaign.enemy.army.set(type, Math.floor(n * effect.factor))
    log.push('The enemy detachment is cut down to a man.')
  } else if (effect.type === 'enemy_reveal') {
    // Prisoners talk: the enemy is an open book for the coming turn (applied
    // at end-of-day N, so day N+1 — campaignView widens the enemy view to the
    // full Overwhelming tier while it holds).
    campaign.enemy.revealedUntilDay = campaign.day + 1
    log.push('Prisoners betray the enemy camp — their host is laid bare.')
  } else if (effect.type === 'convert') {
    // Upgrade units in place: up to `count` of `from` become `to` (mount
    // soldiers as cavalry). Capped at what the source holds — no negative
    // roster, and you only ever upgrade troops you actually have.
    const cur = campaign.roster.get(effect.from) ?? 0
    const moved = Math.min(effect.count, cur)
    campaign.roster.set(effect.from, cur - moved)
    campaign.roster.set(effect.to, (campaign.roster.get(effect.to) ?? 0) + moved)
    log.push(`${moved} ${effect.from} → ${effect.to}.`)
  } else if (effect.type === 'flag') {
    // Chain/prerequisite bookkeeping (R0): mark campaign state so a later fate
    // can gate on it (eventEligible). `value` sets, `delta` increments,
    // default set-to-1 (a plain "this happened" marker). Produces NO log line
    // — a flag is hidden state; the chain's narrative lives in event text, and
    // a numeric line here would leak that state to the player.
    if (!campaign.eventFlags) campaign.eventFlags = new Map()
    const flags = campaign.eventFlags
    const cur = bagGet(flags, effect.name)
    const next = effect.delta !== undefined ? cur + effect.delta : (effect.value ?? 1)
    if (flags instanceof Map) flags.set(effect.name, next)
    else flags[effect.name] = next
  } else if (effect.type === 'multi') {
    // A bundled fate: every part lands, in order.
    for (const part of effect.effects) log.push(...applyEffect(campaign, part))
  } else if (effect.type === 'none') {
    // A neutral fate: it passes without tipping the scales.
    log.push('The fortnight passes without consequence.')
  }
  return log
}

// Which rung of a fate actually fires at the given scouting band (Stage 4
// 1c). Takes the event AS STORED in an augury slot (display fields + effect
// only) and looks its ladder up in EVENT_POOL by id — plain events, and ids
// no longer in the pool, pass through as their own 'blind' rung. The
// `intervened` flag is the day report's "scouts intervened" signal.
// A specific rung by NAME — used when a deferred slot's recorded rung must
// apply at end-day exactly as it was revealed at acceptance, even if the
// scouting band has shifted since. Unknown names (or a plain event) degrade
// to the blind rung of the stored card.
export const rungOf = (event, rungName) => {
  const pooled = EVENT_POOL.find((e) => e.id === event.id)
  if (rungName !== 'blind' && pooled?.rungs?.[rungName])
    return { rung: rungName, intervened: true, reconSensitive: true, ...pooled.rungs[rungName] }
  return {
    rung: 'blind',
    intervened: false,
    reconSensitive: !!pooled?.reconSensitive,
    title: event.title,
    description: event.description,
    effect: event.effect,
    // A choice-fate's branches ride along (from the pool, never the stored
    // copy) so dayResolution can pend the decision instead of applying.
    choices: pooled?.choices,
  }
}

export const firedRung = (event, band) => {
  const pooled = EVENT_POOL.find((e) => e.id === event.id)
  const rungName = pooled?.reconSensitive ? (EVENT_RUNG_BY_BAND[band] ?? 'blind') : 'blind'
  return rungOf(event, rungName)
}
