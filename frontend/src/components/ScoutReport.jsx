import React from 'react'
import { estimate } from '../utils/format'

// What the scouts can tell of the enemy this turn (Stage 4 1b). The server's
// campaignView already gated the fields by scouting band — this renders ONLY
// what arrived, so the same component serves every band: absent intel simply
// doesn't render, and the top-band deployment reveal is drawn by HexGrid, not
// here (this just tells the player to look at the field).
const ScoutReport = ({ scouting, enemy }) => {
  const knowsAnything = enemy.count || enemy.supplies || enemy.composition || enemy.units
  return (
    <div className="scout-report" data-testid="scout-report">
      <h3>
        Scouting: <span data-testid="scouting-band">{scouting.band}</span>
      </h3>
      {!knowsAnything && (
        <p>Your riders see nothing beyond the enemy pickets — their strength and stores are unknown.</p>
      )}
      {enemy.revealed && (
        <p className="scout-revealed" data-testid="scout-revealed">
          Prisoners have betrayed the enemy camp — their host is laid bare this turn.
        </p>
      )}
      {enemy.count && (
        <p data-testid="scout-count">
          {/* Recon numeric estimate: a [low,high] range while intel is partial,
              a single exact figure at the top recon level (or a free reveal). */}
          The enemy host numbers <strong>{estimate(enemy.count)}</strong>
          {enemy.count.low === enemy.count.high ? '' : ', by our scouts’ reckoning'}.
        </p>
      )}
      {enemy.supplies && (
        <p>
          {/* S4: this reads the enemy's per-turn supply BALANCE now, not the
              size of a stockpile — "are they feeding themselves off this
              country", which is what the player changes by stripping the inner
              rings first. Worded for the host rather than its wagons to match.
              Accurate whenever it shows at all: the server gates it on recon
              (Outmatched+) instead of fuzzing it. */}
          Their host looks <strong>{enemy.supplies}</strong>.
        </p>
      )}
      {enemy.composition && (
        <p data-testid="scout-composition">
          Their makeup:{' '}
          {Object.entries(enemy.composition)
            .map(([category, pct]) => `${pct}% ${category}`)
            .join(', ')}
          .
        </p>
      )}
      {enemy.units && (
        <p data-testid="scout-units">
          Counted banners:{' '}
          {Object.entries(enemy.units)
            .map(([type, count]) => `${count} ${type}`)
            .join(', ')}
          .
        </p>
      )}
      {enemy.placements && (
        <p>Their deployment is known — the enemy line is drawn on the field.</p>
      )}
    </div>
  )
}

export default ScoutReport
