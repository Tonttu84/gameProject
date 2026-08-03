import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { useSquads } from '../stores/selectors'

// Raid opportunities (Stage 4 Part 2): the scouts turn up capacity-limited
// targets each turn — better scouting finds more of them — and launching one
// fights a REAL short battle, watchable in the replay viewer like any other.
// The server owns generation, validation and rewards; this panel only builds
// the party.
//
// SQUAD-ONLY RAIDING (2026-07-21): you send whole SQUADS, not hand-picked
// troop counts. A squad goes whole; several squads may stack onto one target,
// bounded by the target's capacity budget. The per-unit cost mirrors the
// server's raidCapacityCost (size × (40 − speed) / 40) using the
// engine-exported speed/placementSize on info.units, so the panel can sum a
// squad's cost and clamp the launch live without a round-trip.
//
// One shared pool of squads spans every open card: a squad drafted onto one
// target can't also be drafted onto another, and squads already sent on a raid
// today (raid.squadAssignment) are greyed out. A single combined button
// submits every drafted party together in one request. The server re-validates
// the same way regardless — this panel is a convenience, not the trust boundary.

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

// The reward view's shape varies by raid type (loot pays food+materials+gold,
// destroy pays gold, the horse drove pays horses, rescue pays roster; a
// counter_event has no numeric reward — reward is null and there's nothing to
// list or reveal).
const rewardParts = (reward) => {
  if (!reward) return []
  const parts = []
  if (reward.food !== undefined) parts.push(`${formatAmount(reward.food)} food`)
  if (reward.materials !== undefined) parts.push(`${formatAmount(reward.materials)} materials`)
  if (reward.gold !== undefined) parts.push(`${formatAmount(reward.gold)} gold`)
  if (reward.horses !== undefined) parts.push(`${formatAmount(reward.horses)} horses`)
  if (reward.roster) {
    for (const [type, value] of Object.entries(reward.roster)) parts.push(`${formatAmount(value)} ${type}`)
  }
  return parts
}

// raid/scouting/squads come straight from the campaign store; units stays a
// prop (it's the static /api/info catalog, not campaign data).
// onLaunchAll/onScout/onWatch are still props (guarded actions).
const RaidPanel = ({ units, onLaunchAll, onScout, onWatch }) => {
  const raid = useCampaignStore((s) => s.campaign?.raid)
  const scouting = useCampaignStore((s) => s.campaign?.scouting)
  const squads = useSquads()
  const tutorial = useUiStore((s) => s.tutorial)

  // Party drafts per opportunity: {raidId: [squadId, …]}. Mount with
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

  // Squads already sent on a raid today are spent — they can't ride again this
  // turn (the server enforces the same via raid.squadAssignment).
  const committedToday = new Set(raid?.squadAssignment ?? [])
  const raidableSquads = squads.filter((sq) => !committedToday.has(sq.id))

  // A squad's raid cost: the sum of its troops' per-unit capacity cost.
  const squadCost = (squad) =>
    Object.entries(squad.composition).reduce((sum, [type, n]) => {
      const unit = units.find((u) => u.type === type)
      return sum + (unit ? n * unitCost(unit) : 0)
    }, 0)

  const compositionLabel = (squad) =>
    Object.entries(squad.composition)
      .map(([type, n]) => `${n} ${type}`)
      .join(', ')

  // Which card (if any) currently holds a squad — for greying it out on the
  // others (one shared pool: a squad rides at most one target).
  const assignedElsewhere = (squadId, raidId) =>
    Object.entries(parties).some(([id, ids]) => id !== raidId && (ids ?? []).includes(squadId))

  const toggleSquad = (raidId, squadId) => {
    setParties((p) => {
      const cur = p[raidId] ?? []
      const has = cur.includes(squadId)
      return { ...p, [raidId]: has ? cur.filter((x) => x !== squadId) : [...cur, squadId] }
    })
  }

  const partyCost = (raidId) =>
    (parties[raidId] ?? []).reduce((sum, sid) => {
      const squad = squads.find((s) => s.id === sid)
      return sum + (squad ? squadCost(squad) : 0)
    }, 0)

  // Every opportunity with at least one drafted squad, as {raidId: [squadId]}.
  const draftedParties = Object.fromEntries(
    Object.entries(parties)
      .map(([raidId, ids]) => [raidId, (ids ?? []).filter((sid) => raidableSquads.some((s) => s.id === sid))])
      .filter(([, ids]) => ids.length > 0),
  )
  const anyOverBudget = opportunities.some((o) => {
    const ids = draftedParties[o.id]
    return ids && partyCost(o.id) > o.capacity
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
          'Send whole squads on a raid — the target\'s budget limits how many you can commit; fast riders stretch it furthest.',
          'A squad can only raid once a turn, and squads that ride out are spent for the day — they can\'t join another raid.',
          'A raid is a real battle, fought and watchable like any other.',
          'Win to take the prize; lose and the squads come back bloodied for nothing.',
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
              const cost = partyCost(o.id)
              const overBudget = cost > o.capacity
              const drafted = parties[o.id] ?? []
              return (
                <div className="raid-builder">
                  {raidableSquads.length === 0 && (
                    <p className="raid-empty" data-testid={`raid-no-squads-${o.id}`}>
                      No squads free to raid.
                    </p>
                  )}
                  {raidableSquads.map((sq) => {
                    const taken = assignedElsewhere(sq.id, o.id)
                    const selected = drafted.includes(sq.id)
                    return (
                      <label key={sq.id} className="raid-row">
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={taken}
                          data-testid={`raid-squad-${o.id}-${sq.id}`}
                          onChange={() => toggleSquad(o.id, sq.id)}
                        />
                        {sq.name} — {compositionLabel(sq)} (cost {Math.ceil(squadCost(sq))})
                        {taken && ' — on another raid'}
                      </label>
                    )
                  })}
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
