import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'

// Raid opportunities (Stage 4 Part 2): the scouts turn up capacity-limited
// targets each turn — better scouting finds more of them — and launching one
// fights a REAL short battle, watchable in the replay viewer like any other.
// The server owns generation, validation and rewards; this panel only builds
// the party. The per-unit cost mirrors the server's raidCapacityCost
// (size × (40 − speed) / 40) using the engine-exported speed/placementSize on
// info.units, so the Launch button can clamp live without a round-trip.

const RAID_CAPACITY_SPEED_SCALE = 40

const unitCost = (unit) =>
  Math.max(
    0,
    (unit.placementSize * (RAID_CAPACITY_SPEED_SCALE - (unit.speed ?? 10))) /
      RAID_CAPACITY_SPEED_SCALE,
  )

const RaidPanel = ({ raid, scouting, roster, forageAssignment, units, onLaunch, onWatch, tutorial }) => {
  // Party drafts per opportunity: {raidId: {unitType: count}}. Mount with
  // key={campaign.day} so a new turn's fresh opportunities reset the drafts.
  const [parties, setParties] = useState({})
  const [busy, setBusy] = useState(false)

  const opportunities = raid?.opportunities ?? []
  if (opportunities.length === 0) return null

  // Units out foraging are unavailable for a raid (the server enforces the
  // same rule); squad members may ride — raiding is squad-agnostic in v1.
  const availableOf = (type) => (roster[type] ?? 0) - (forageAssignment[type] ?? 0)
  const raidable = units.filter((u) => availableOf(u.type) > 0)

  const setCount = (raidId, type, raw) => {
    const count = Math.max(0, Math.min(availableOf(type), Math.floor(Number(raw) || 0)))
    setParties((p) => ({ ...p, [raidId]: { ...p[raidId], [type]: count } }))
  }

  const costOf = (party) =>
    Object.entries(party ?? {}).reduce((sum, [type, count]) => {
      const unit = units.find((u) => u.type === type)
      return sum + (unit ? count * unitCost(unit) : 0)
    }, 0)

  const launch = async (opportunity) => {
    const party = Object.fromEntries(
      Object.entries(parties[opportunity.id] ?? {}).filter(([, n]) => n > 0),
    )
    setBusy(true)
    try {
      await onLaunch(opportunity.id, party)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="raid-panel" data-testid="raid-panel">
      <TutorialIntro
        id="raids"
        enabled={tutorial}
        title="Raids"
        lines={[
          'Your scouts have found targets of opportunity — the better your scouting, the more they find.',
          'Each raid takes a small party, limited by the target: fast riders stretch the budget furthest.',
          'A raid is a real battle, fought and watchable like any other. Raiders can still fight in today\'s main battle.',
          'Win to take the prize; lose and the party is spent for nothing.',
        ]}
      />
      <h3>Raids</h3>
      <p className="raid-band" data-testid="raid-band">
        Scouting: {scouting?.band ?? 'Unknown'}
      </p>
      {opportunities.map((o) => (
        <div className="raid-card" key={o.id} data-testid={`raid-card-${o.id}`}>
          <strong>{o.title}</strong>
          <p>{o.description}</p>
          <p data-testid={`raid-strength-${o.id}`}>
            The scouts judge it {o.strengthBand}. Party budget: {o.capacity}.
          </p>
          {o.resolved ? (
            <div className="raid-outcome" data-testid={`raid-outcome-${o.id}`}>
              <span>
                {o.outcome?.winner === 'blue'
                  ? 'The raid succeeded.'
                  : o.outcome?.winner === 'red'
                    ? 'The raid was beaten back.'
                    : 'The raid ended in a standoff.'}
              </span>
              {o.outcome?.battleId && (
                <button
                  className="login-toggle"
                  data-testid={`raid-watch-${o.id}`}
                  onClick={() => onWatch(o.outcome.battleId)}
                >
                  Watch the raid
                </button>
              )}
            </div>
          ) : (
            (() => {
              const party = parties[o.id] ?? {}
              const cost = costOf(party)
              const partySize = Object.values(party).reduce((a, b) => a + b, 0)
              const overBudget = cost > o.capacity
              return (
                <div className="raid-builder">
                  {raidable.map((u) => (
                    <label key={u.type} className="raid-row">
                      {u.type} (cost {+unitCost(u).toFixed(2)}, {availableOf(u.type)} available)
                      <input
                        type="number"
                        min="0"
                        max={availableOf(u.type)}
                        value={party[u.type] ?? 0}
                        data-testid={`raid-input-${o.id}-${u.type}`}
                        onChange={(e) => setCount(o.id, u.type, e.target.value)}
                      />
                    </label>
                  ))}
                  <div className="raid-summary">
                    <span data-testid={`raid-cost-${o.id}`} className={overBudget ? 'warning' : undefined}>
                      Party cost: {Math.ceil(cost)} / {o.capacity}
                    </span>
                    <button
                      className="btn-primary"
                      data-testid={`raid-launch-${o.id}`}
                      onClick={() => launch(o)}
                      disabled={busy || partySize === 0 || overBudget}
                      title={overBudget ? 'The party exceeds the raid\'s budget' : undefined}
                    >
                      Launch the raid
                    </button>
                  </div>
                </div>
              )
            })()
          )}
        </div>
      ))}
    </div>
  )
}

export default RaidPanel
