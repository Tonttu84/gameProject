import React from 'react'
import { tons, estimate } from '../utils/format'
import useCampaignStore from '../stores/useCampaignStore'
import { useRoster } from '../stores/selectors'

// Top bar of the active campaign. One turn = two weeks; the server computes
// food in kg (resources.foodNeedPerTurn comes from the view — the client
// never re-derives campaign math), the player reads tonnes. Reads straight
// from the campaign store — only ever mounted once a campaign exists.
const CampaignHUD = () => {
  const { day, resources, fortification, forage, meter, bossFightDue, raid, scouting } =
    useCampaignStore((s) => s.campaign)
  const roster = useRoster()

  const landLeft = forage?.rings?.reduce((s, r) => s + r.richness, 0) ?? 0
  const landTotal = forage?.rings?.reduce((s, r) => s + r.initialRichness, 0) ?? 0
  const landPct = landTotal > 0 ? Math.round((100 * landLeft) / landTotal) : 0

  return (
    <header className="hud">
      <span className="hud-day">Turn {day}</span>
      <span className="hud-food">
        Food: {tons(resources.food)} (−{tons(resources.foodNeedPerTurn)}/turn)
      </span>
      <span className="hud-materials">Materials: {resources.materials}</span>
      <span className="hud-forts" data-testid="hud-forts">Forts: Lv {fortification?.level ?? 0}</span>
      <span className="hud-land" data-testid="hud-land">Land: {landPct}% left</span>
      <span className="hud-meter" data-testid="hud-meter">
        {/* Progress toward the decisive pitched battle. Recon reveals it: a
            numeric estimate ([low,high], exact at the top recon level) once
            recon.level > 0, the banded phrase while Blind — never the exact
            hidden value. Once it's due, the estimate is moot: the fight is now. */}
        {bossFightDue
          ? 'Pitched battle: now!'
          : meter?.estimate
            ? `Pitched battle: ${estimate(meter.estimate)}`
            : `Pitched battle: ${meter?.band ?? 'calm'}`}
      </span>
      <span className="hud-recon" data-testid="hud-recon">
        Recon: {scouting?.band ?? 'Blind'}
      </span>
      <span className="hud-scouting" data-testid="hud-scouting">
        Scout pts: {Math.floor(raid?.scoutingPoints ?? 0)}
      </span>
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
