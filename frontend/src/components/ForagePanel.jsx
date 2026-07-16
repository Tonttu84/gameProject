import React, { useState } from 'react'
import TutorialIntro from './TutorialIntro'
import { tons } from '../utils/format'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { useRoster } from '../stores/selectors'

// Forager assignment for the turn: per-type steppers against the roster,
// a live capacity preview from the server-provided kg-per-unit values, and
// ring gauges showing how much the land has left. All math the client shows
// comes from the campaign view — the server owns the formulas. forage/roster
// come straight from the campaign store; only onAssign (the guarded action)
// is still a prop.
//
// Mount with key={campaign.day} so a new turn resets the local draft.

const RING_NAMES = ['Near', 'Middle', 'Far']

const ForagePanel = ({ onAssign }) => {
  const forage = useCampaignStore((s) => s.campaign.forage)
  const roster = useRoster()
  const tutorial = useUiStore((s) => s.tutorial)
  const [assignment, setAssignment] = useState({ ...forage.assignment })
  const [saved, setSaved] = useState(true)

  const setCount = (type, raw) => {
    const max = roster[type] ?? 0
    const count = Math.max(0, Math.min(max, Math.floor(Number(raw) || 0)))
    setAssignment((a) => ({ ...a, [type]: count }))
    setSaved(false)
  }

  const capacity = Object.entries(assignment).reduce(
    (sum, [type, count]) => sum + count * (forage.kgPerUnit[type] ?? 0),
    0,
  )
  const assignedTotal = Object.values(assignment).reduce((a, b) => a + b, 0)

  const submit = async () => {
    await onAssign(assignment)
    setSaved(true)
  }

  return (
    <div className="forage-panel" data-testid="forage-panel">
      <TutorialIntro
        id="forage"
        enabled={tutorial}
        title="Foraging"
        lines={[
          'Send troops to strip the countryside for food and materials; riders sweep the widest area.',
          'The near ring empties first and nothing grows back — the land is a clock.',
          'The enemy forages the same rings: the further out and the more crowded, the likelier a clash.',
          'Foragers are away for the turn and cannot fight in a battle.',
        ]}
      />
      <h3>Foraging Parties</h3>
      <div className="forage-rings">
        {forage.rings.map((r) => (
          <div className="forage-ring" key={r.ring} data-testid={`forage-ring-${r.ring}`}>
            <span>{RING_NAMES[r.ring] ?? `Ring ${r.ring}`}</span>
            <meter min="0" max={r.initialRichness} value={r.richness} />
            <span>{tons(r.richness)} left</span>
          </div>
        ))}
      </div>
      <div className="forage-assign">
        {Object.entries(roster)
          .filter(([type, n]) => n > 0 && (forage.kgPerUnit[type] ?? 0) > 0)
          .map(([type, n]) => (
            <label key={type} className="forage-row">
              {type} ({forage.kgPerUnit[type]} kg each, {n} available)
              <input
                type="number"
                min="0"
                max={n}
                value={assignment[type] ?? 0}
                data-testid={`forage-input-${type}`}
                onChange={(e) => setCount(type, e.target.value)}
              />
            </label>
          ))}
      </div>
      <div className="forage-summary">
        <span data-testid="forage-capacity">
          {assignedTotal} foragers — up to {tons(capacity)} this turn
        </span>
        <button
          className="btn-primary"
          data-testid="forage-submit"
          onClick={submit}
          disabled={saved}
        >
          {!saved ? 'Send foragers' : assignedTotal > 0 ? 'Foragers assigned' : 'No foragers'}
        </button>
      </div>
    </div>
  )
}

export default ForagePanel
