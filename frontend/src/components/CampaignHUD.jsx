import React from 'react'
import { tons } from '../utils/format'
import useCampaignStore from '../stores/useCampaignStore'
import { useRoster } from '../stores/selectors'

// Display-only mirror of the server's BOSS_FIGHT_METER_THRESHOLD, used purely to
// scale the walls gauge (server owns the real value + all gating). The meter
// climbs 0→threshold as the enemy batters Karrowgate; we render that as the
// walls DRAINING from whole to breached, so integrity = 1 − value/threshold.
const WALLS_METER_THRESHOLD = 1000
const clamp01 = (x) => Math.max(0, Math.min(1, x))
// Coarse fill per band while the player is Blind (exact integrity is what recon
// sells — never leak it): a rough whole/half/low so the bar still reads.
const BAND_FILL = { intact: 0.85, damaged: 0.5, breached: 0.2 }
const BAND_COLOR = { intact: '#3f9d4f', damaged: '#d99a1c', breached: '#c0392b' }

// Karrowgate's walls readout: a draining integrity bar (green→amber→red) plus a
// status word, going finer (a recon estimate range) once scouting reveals one.
// bossFightDue = the walls are breached and the pitched battle is upon you.
const wallsGauge = ({ band = 'intact', estimate } = {}, bossFightDue) => {
  if (bossFightDue)
    return { fill: 0, color: BAND_COLOR.breached, status: 'BREACHED — give battle!' }
  if (estimate) {
    const intLow = clamp01(1 - estimate.high / WALLS_METER_THRESHOLD)
    const intHigh = clamp01(1 - estimate.low / WALLS_METER_THRESHOLD)
    const lo = Math.round(intLow * 100)
    const hi = Math.round(intHigh * 100)
    return {
      fill: (intLow + intHigh) / 2,
      color: BAND_COLOR[band] ?? BAND_COLOR.intact,
      status: lo === hi ? `~${lo}% sound` : `~${lo}–${hi}% sound`,
    }
  }
  return { fill: BAND_FILL[band] ?? BAND_FILL.intact, color: BAND_COLOR[band] ?? BAND_COLOR.intact, status: band }
}

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
      {/* Karrowgate's walls under the enemy's assault. The bar drains as the
          hidden meter climbs; it stays coarse (3 band steps) while Blind and
          only shows a numeric integrity range once recon buys an estimate —
          never the exact hidden value. Breached ⇒ the pitched battle is now. */}
      {(() => {
        const { fill, color, status } = wallsGauge(meter, bossFightDue)
        return (
          <span className="hud-walls" data-testid="hud-meter" title="Karrowgate's walls">
            <span className="hud-walls-label">Karrowgate&apos;s walls:</span>
            <span
              className="hud-walls-bar"
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '70px',
                height: '9px',
                margin: '0 6px',
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '3px',
                overflow: 'hidden',
                verticalAlign: 'middle',
              }}
            >
              <span
                className="hud-walls-fill"
                style={{ display: 'block', height: '100%', width: `${Math.round(fill * 100)}%`, background: color }}
              />
            </span>
            <span className="hud-walls-status" style={{ color }}>{status}</span>
          </span>
        )
      })()}
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
