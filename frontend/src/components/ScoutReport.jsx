import React from 'react'

// What the scouts can tell of the enemy this turn (Stage 4 1b). The server's
// campaignView already gated the fields by scouting band — this renders ONLY
// what arrived, so the same component serves every band: absent intel simply
// doesn't render, and the top-band deployment reveal is drawn by HexGrid, not
// here (this just tells the player to look at the field).
const ScoutReport = ({ scouting, enemy }) => {
  const knowsAnything = enemy.strength || enemy.supplies || enemy.composition || enemy.units
  return (
    <div className="scout-report" data-testid="scout-report">
      <h3>
        Scouting: <span data-testid="scouting-band">{scouting.band}</span>
      </h3>
      {!knowsAnything && (
        <p>Your riders see nothing beyond the enemy pickets — their strength and stores are unknown.</p>
      )}
      {enemy.strength && (
        <p>
          The enemy musters <strong>{enemy.strength}</strong>.
        </p>
      )}
      {enemy.supplies && (
        <p>
          Their supply train looks <strong>{enemy.supplies}</strong>.
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
