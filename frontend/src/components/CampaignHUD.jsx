import React from 'react'

// Top bar of the active campaign. One turn = two weeks; food is kg and the
// per-turn need comes from the server view (resources.foodNeedPerTurn) — the
// client never re-derives campaign math.
const CampaignHUD = ({ day, food, foodNeed, materials, augury, roster, forage }) => {
  const landLeft = forage?.rings?.reduce((s, r) => s + r.richness, 0) ?? 0
  const landTotal = forage?.rings?.reduce((s, r) => s + r.initialRichness, 0) ?? 0
  const landPct = landTotal > 0 ? Math.round((100 * landLeft) / landTotal) : 0

  return (
    <header className="hud">
      <span className="hud-day">Turn {day}</span>
      <span className="hud-food">
        Food: {food} kg (−{foodNeed}/turn)
      </span>
      <span className="hud-materials">Materials: {materials}</span>
      <span className="hud-land" data-testid="hud-land">Land: {landPct}% left</span>
      <span className="hud-augury">Augury: {augury}%</span>
      <span className="hud-roster">
        {Object.entries(roster)
          .filter(([, n]) => n > 0)
          .map(([type, n]) => `${n} ${type}`)
          .join('  ·  ')}
      </span>
    </header>
  )
}

export default CampaignHUD
