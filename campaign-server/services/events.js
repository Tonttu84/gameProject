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
export const firedRung = (event, band) => {
  const pooled = EVENT_POOL.find((e) => e.id === event.id)
  const rungName = pooled?.reconSensitive ? (EVENT_RUNG_BY_BAND[band] ?? 'blind') : 'blind'
  if (rungName === 'blind')
    return {
      rung: 'blind',
      intervened: false,
      reconSensitive: !!pooled?.reconSensitive,
      title: event.title,
      description: event.description,
      effect: event.effect,
    }
  const rung = pooled.rungs[rungName]
  return { rung: rungName, intervened: true, reconSensitive: true, ...rung }
}
