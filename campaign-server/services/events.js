// Fortnightly event pool + effect application. Events reach the player only
// as the augur's prophecy (services/augury.js): each turn one TRUE event and
// one DECOY are drawn, the prophecy may show either, and the true effect
// applies at end-of-turn regardless of what was foretold.

// severity 1–3 drives display flavor; baseAccuracy is the omen's legibility
// BONUS on the consult roll (+0…+3): mild everyday events are easy to read,
// catastrophes are murky — severe events mispredict more. Maluses come later.

// Food deltas are kg on the fortnight-turn scale (the starting army eats
// ~12,400 kg a turn, stores start at 50,000). Player-facing text speaks in
// tonnes, the effect values stay kg.
export const EVENT_POOL = [
  { id: 'supply',        title: 'Supply Cache',      description: 'Scouts find an abandoned depot. +3 t of food.',    severity: 1, baseAccuracy: 3, effect: { type: 'food',       delta: +3000 } },
  { id: 'reinforcement', title: 'Reinforcements',    description: 'A company joins your banner. +20 Soldiers.',       severity: 1, baseAccuracy: 2, effect: { type: 'roster',     unit: 'Soldier', delta: +20 } },
  { id: 'desertion',     title: 'Desertion',         description: 'Low morale: 10% of soldiers desert overnight.',    severity: 2, baseAccuracy: 1, effect: { type: 'roster',     unit: 'Soldier', factor: 0.9 } },
  { id: 'plague',        title: 'Plague',            description: 'Disease thins the ranks by 5%.',                   severity: 3, baseAccuracy: 0, effect: { type: 'all_roster', factor: 0.95 } },
  { id: 'ambush',        title: 'Enemy Ambush',      description: 'Enemy scouts have located your camp.',             severity: 3, baseAccuracy: 0, effect: { type: 'enemy_advance' } },
  { id: 'weather',       title: 'Harsh Weather',     description: 'A hard fortnight drains rations. -1 t of food.',   severity: 2, baseAccuracy: 1, effect: { type: 'food',       delta: -1000 } },
  { id: 'traders',       title: 'Traveling Traders', description: 'Merchants sell supplies. +1.5 t of food.',         severity: 1, baseAccuracy: 3, effect: { type: 'food',       delta: +1500 } },
]
// (The old 'intel' event died with auguryScore; a defector event returns as a
// scouting-points effect when the scouting stage lands.)

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
  } else if (effect.type === 'enemy_advance') {
    // The enemy comes looking for a fight tomorrow.
    campaign.enemy.stance = 'offering_battle'
    log.push('The enemy host is moving on your camp.')
  }
  return log
}
