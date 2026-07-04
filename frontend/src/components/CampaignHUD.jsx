import React from 'react'
import { tons } from '../utils/format'

// Top bar of the active campaign. One turn = two weeks; the server computes
// food in kg (resources.foodNeedPerTurn comes from the view — the client
// never re-derives campaign math), the player reads tonnes.
const CampaignHUD = ({ day, food, foodNeed, materials, roster, forage }) => {
  const landLeft = forage?.rings?.reduce((s, r) => s + r.richness, 0) ?? 0
  const landTotal = forage?.rings?.reduce((s, r) => s + r.initialRichness, 0) ?? 0
  const landPct = landTotal > 0 ? Math.round((100 * landLeft) / landTotal) : 0

  return (
    <header className="hud">
      <span className="hud-day">Turn {day}</span>
      <span className="hud-food">
        Food: {tons(food)} (−{tons(foodNeed)}/turn)
      </span>
      <span className="hud-materials">Materials: {tons(materials)}</span>
      <span className="hud-land" data-testid="hud-land">Land: {landPct}% left</span>
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
