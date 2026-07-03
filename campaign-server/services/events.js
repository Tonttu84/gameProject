// Daily event pool + effect application, moved server-side from App.jsx.
// v1 port of the pick-a-card augury: three cards are drawn, the player's pick
// applies. The true-event/decoy prediction rework replaces drawEvents() in a
// later stage; applyEffect() stays.

// Food deltas are kg on the fortnight-turn scale (the starting army eats
// ~12,400 kg a turn, stores start at 50,000). Player-facing text speaks in
// tonnes, the effect values stay kg.
export const EVENT_POOL = [
  { id: 'supply',        title: 'Supply Cache',     description: 'Scouts find an abandoned depot. +3 t of food.',    effect: { type: 'food',       delta: +3000 } },
  { id: 'reinforcement', title: 'Reinforcements',   description: 'A company joins your banner. +20 Soldiers.',       effect: { type: 'roster',     unit: 'Soldier', delta: +20 } },
  { id: 'desertion',     title: 'Desertion',        description: 'Low morale: 10% of soldiers desert overnight.',    effect: { type: 'roster',     unit: 'Soldier', factor: 0.9 } },
  { id: 'plague',        title: 'Plague',           description: 'Disease thins the ranks by 5%.',                   effect: { type: 'all_roster', factor: 0.95 } },
  { id: 'intel',         title: 'Enemy Intel',      description: 'A defector brings battle plans.',                  effect: { type: 'augury',     delta: +15 } },
  { id: 'ambush',        title: 'Enemy Ambush',     description: 'Enemy scouts have located your camp.',             effect: { type: 'enemy_advance' } },
  { id: 'weather',       title: 'Harsh Weather',    description: 'A hard fortnight drains rations. -1 t of food.',   effect: { type: 'food',       delta: -1000 } },
  { id: 'traders',       title: 'Traveling Traders', description: 'Merchants sell supplies. +1.5 t of food.',        effect: { type: 'food',       delta: +1500 } },
]

// Unbiased Fisher-Yates (the old frontend sort(() => random-0.5) was biased).
const shuffle = (arr) => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Three cards: one flagged real, display probabilities scaled by the augury
// score. isReal is HIDDEN (stripped by campaignView) — with pick-a-card
// semantics it is cosmetic, but it must still never leak.
export function drawEvents(auguryScore) {
  const [real, decoy1, decoy2] = shuffle(EVENT_POOL)
  const realPct = auguryScore
  const half = Math.round((100 - auguryScore) / 2)
  const other = 100 - realPct - half
  return shuffle([
    { ...real, probability: realPct, isReal: true },
    { ...decoy1, probability: half, isReal: false },
    { ...decoy2, probability: other, isReal: false },
  ])
}

export const rosterTotal = (roster) =>
  [...roster.values()].reduce((a, b) => a + b, 0)

// Mutates the campaign in place; caller saves. Returns log lines.
export function applyEffect(campaign, effect) {
  const log = []
  if (effect.type === 'food') {
    campaign.resources.food = Math.max(0, campaign.resources.food + effect.delta)
    log.push(`Food ${effect.delta > 0 ? '+' : ''}${+(effect.delta / 1000).toFixed(1)} t.`)
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
  } else if (effect.type === 'augury') {
    campaign.auguryScore = Math.min(100, Math.max(0, campaign.auguryScore + effect.delta))
    log.push(`Augury ${effect.delta > 0 ? '+' : ''}${effect.delta}.`)
  } else if (effect.type === 'enemy_advance') {
    // Finally does something: the enemy comes looking for a fight tomorrow.
    campaign.enemy.stance = 'offering_battle'
    log.push('The enemy host is moving on your camp.')
  }
  return log
}
