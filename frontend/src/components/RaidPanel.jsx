import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { useRoster, useForageAssignment } from '../stores/selectors'

// Raid opportunities (Stage 4 Part 2): the scouts turn up capacity-limited
// targets each turn — better scouting finds more of them — and launching one
// fights a REAL short battle, watchable in the replay viewer like any other.
// The server owns generation, validation and rewards; this panel only builds
// the party. The per-unit cost mirrors the server's raidCapacityCost
// (size × (40 − speed) / 40) using the engine-exported speed/placementSize on
// info.units, so the Launch button can clamp live without a round-trip.
//
// Every opportunity draws from ONE shared troop pool (roster minus foragers
// minus raid.assignment — troops already sent on a raid today — minus
// whatever every OTHER still-open card currently has drafted), and a single
// combined button submits every drafted party together in one request. This
// is what makes double-booking the same troops across two raids impossible
// from the UI: the fix for the playtest finding that troops could join every
// raid opportunity the same day (docs/CAMPAIGN_PLAN.md). The server
// re-validates the same way regardless — this panel is a convenience, not
// the trust boundary.

const RAID_CAPACITY_SPEED_SCALE = 40

const unitCost = (unit) =>
  Math.max(
    0,
    (unit.placementSize * (RAID_CAPACITY_SPEED_SCALE - (unit.speed ?? 10))) /
      RAID_CAPACITY_SPEED_SCALE,
  )

// One amount from a reward/enemy view field: a [lo, hi] pair pre-reveal, the
// exact number once bought. Same rendering either side of the reveal — the
// caller doesn't need to know which it got.
const formatAmount = (value) => (Array.isArray(value) ? `${value[0]}–${value[1]}` : value)

// The reward view's shape varies by raid type (loot pays food+materials,
// rescue pays roster, destroy/counter_event have no numeric reward — reward
// is null and there's nothing to list or reveal).
const rewardParts = (reward) => {
  if (!reward) return []
  const parts = []
  if (reward.food !== undefined) parts.push(`${formatAmount(reward.food)} food`)
  if (reward.materials !== undefined) parts.push(`${formatAmount(reward.materials)} materials`)
  if (reward.roster) {
    for (const [type, value] of Object.entries(reward.roster)) parts.push(`${formatAmount(value)} ${type}`)
  }
  return parts
}

// raid/scouting/roster/forageAssignment come straight from the campaign
// store; units stays a prop (it's the static /api/info catalog, not
// campaign data). onLaunchAll/onScout/onWatch are still props (guarded actions).
const RaidPanel = ({ units, onLaunchAll, onScout, onWatch }) => {
  const raid = useCampaignStore((s) => s.campaign?.raid)
  const scouting = useCampaignStore((s) => s.campaign?.scouting)
  const roster = useRoster()
  const forageAssignment = useForageAssignment()
  const tutorial = useUiStore((s) => s.tutorial)

  // Party drafts per opportunity: {raidId: {unitType: count}}. Mount with
  // key={campaign.day} so a new turn's fresh opportunities reset the drafts.
  const [parties, setParties] = useState({})
  const [busy, setBusy] = useState(false)
  // Separate busy flag for the scouting mini-game (add-target/reveal) so a
  // reveal click doesn't disable the unrelated launch button, and vice versa.
  const [scoutBusy, setScoutBusy] = useState(false)

  const opportunities = raid?.opportunities ?? []
  if (opportunities.length === 0) return null

  const scoutingPoints = raid?.scoutingPoints ?? 0
  const scoutCost = raid?.scoutCost ?? { addTarget: 0, reveal: 0 }

  const addTarget = async () => {
    setScoutBusy(true)
    try {
      await onScout({ action: 'add_target' })
    } finally {
      setScoutBusy(false)
    }
  }

  const revealField = async (raidId, field) => {
    setScoutBusy(true)
    try {
      await onScout({ action: 'reveal', raidId, field })
    } finally {
      setScoutBusy(false)
    }
  }

  const raidAssignment = raid?.assignment ?? {}
  // Units out foraging, or already sent on a raid today, are unavailable for
  // ANOTHER raid this turn (squad members may ride — raiding is
  // squad-agnostic in v1). This is the pool BEFORE accounting for what other
  // still-open cards currently have drafted — see remaining() below.
  const availableOf = (type) =>
    (roster[type] ?? 0) - (forageAssignment[type] ?? 0) - (raidAssignment[type] ?? 0)
  const raidable = units.filter((u) => availableOf(u.type) > 0)

  // How much of `type` is left for `raidId`'s own input: the pool minus every
  // OTHER open card's current draft (deliberately not this card's own — that
  // draft is exactly what this card is allowed to hold).
  const draftedElsewhere = (type, excludeRaidId) =>
    Object.entries(parties).reduce(
      (sum, [id, party]) => (id === excludeRaidId ? sum : sum + (party?.[type] ?? 0)),
      0,
    )
  const remaining = (type, raidId) => Math.max(0, availableOf(type) - draftedElsewhere(type, raidId))

  const setCount = (raidId, type, raw) => {
    const count = Math.max(0, Math.min(remaining(type, raidId), Math.floor(Number(raw) || 0)))
    setParties((p) => ({ ...p, [raidId]: { ...p[raidId], [type]: count } }))
  }

  const costOf = (party) =>
    Object.entries(party ?? {}).reduce((sum, [type, count]) => {
      const unit = units.find((u) => u.type === type)
      return sum + (unit ? count * unitCost(unit) : 0)
    }, 0)

  // Every opportunity with a non-empty drafted party, cleaned of zero counts.
  const draftedParties = Object.fromEntries(
    Object.entries(parties)
      .map(([raidId, party]) => [raidId, Object.fromEntries(Object.entries(party ?? {}).filter(([, n]) => n > 0))])
      .filter(([, party]) => Object.keys(party).length > 0),
  )
  const anyOverBudget = opportunities.some((o) => {
    const party = draftedParties[o.id]
    return party && costOf(party) > o.capacity
  })
  const canLaunch = !busy && Object.keys(draftedParties).length > 0 && !anyOverBudget

  const launchAll = async () => {
    setBusy(true)
    try {
      await onLaunchAll(draftedParties)
      setParties({})
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
          'Harrying the besiegers is how the weaker army fights — bleed their supply and slow their assault on the walls.',
          'Your scouts have found targets of opportunity — the better your scouting, the more they find.',
          'Each raid takes a small party, limited by the target: fast riders stretch the budget furthest.',
          'Every raid draws from one shared pool of troops — the same soldiers can\'t join two raids the same day.',
          'A raid is a real battle, fought and watchable like any other. Raiders can still fight in today\'s main battle.',
          'Win to take the prize; lose and the party is spent for nothing.',
        ]}
      />
      <h3>Raids</h3>
      <p className="raid-band" data-testid="raid-band">
        Scouting: {scouting?.band ?? 'Unknown'}
      </p>
      <div className="raid-scouting-header">
        <span data-testid="raid-points">Scouting points: {Math.floor(scoutingPoints)}</span>
        <button
          className="login-toggle"
          data-testid="raid-scout-add"
          onClick={addTarget}
          disabled={scoutBusy || scoutingPoints < scoutCost.addTarget}
          title={`Scout a new target (−${scoutCost.addTarget})`}
        >
          Scout new target (−{scoutCost.addTarget})
        </button>
      </div>
      {opportunities.map((o) => (
        <div className="raid-card" key={o.id} data-testid={`raid-card-${o.id}`}>
          <strong>{o.title}</strong>
          <p>{o.description}</p>
          <p data-testid={`raid-strength-${o.id}`}>
            The scouts judge it {o.strengthBand}. Party budget: {o.capacity}.
          </p>
          {!o.resolved && (
            <div className="raid-intel">
              {rewardParts(o.reward).length > 0 && (
                <p data-testid={`raid-reward-${o.id}`}>
                  Reward: {rewardParts(o.reward).join(', ')}
                  {o.rewardReveal < 1 && (
                    <button
                      className="login-toggle"
                      data-testid={`raid-reveal-reward-${o.id}`}
                      onClick={() => revealField(o.id, 'reward')}
                      disabled={scoutBusy || scoutingPoints < scoutCost.reveal}
                    >
                      Reveal (−{scoutCost.reveal})
                    </button>
                  )}
                </p>
              )}
              <p data-testid={`raid-enemy-${o.id}`}>
                Enemy: {Object.entries(o.enemy ?? {})
                  .map(([type, value]) => `${formatAmount(value)} ${type}`)
                  .join(', ')}
                {o.enemyReveal < 1 && (
                  <button
                    className="login-toggle"
                    data-testid={`raid-reveal-enemy-${o.id}`}
                    onClick={() => revealField(o.id, 'enemy')}
                    disabled={scoutBusy || scoutingPoints < scoutCost.reveal}
                  >
                    Reveal (−{scoutCost.reveal})
                  </button>
                )}
              </p>
            </div>
          )}
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
              const overBudget = cost > o.capacity
              return (
                <div className="raid-builder">
                  {raidable.map((u) => (
                    <label key={u.type} className="raid-row">
                      {u.type} (cost {+unitCost(u).toFixed(2)}, {remaining(u.type, o.id)} available)
                      <input
                        type="number"
                        min="0"
                        max={remaining(u.type, o.id)}
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
                  </div>
                </div>
              )
            })()
          )}
        </div>
      ))}
      <div className="raid-launch-all-bar">
        <button
          className="btn-primary"
          data-testid="raid-launch-all"
          onClick={launchAll}
          disabled={!canLaunch}
          title={anyOverBudget ? 'A drafted party exceeds its raid\'s budget' : undefined}
        >
          Launch raids
        </button>
      </div>
    </div>
  )
}

export default RaidPanel
