import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import { EMPTY_ARRAY, EMPTY_OBJECT } from '../stores/selectors'

// Squad reinforcement (docs/CAMPAIGN_PLAN.md "SLICE 3 — reinforcement"), the
// Recruit phase's other sink: a hire adds bodies to the ARMY, this moves loose
// bodies into a CHARTER. Once per turn per squad, bounded by the archetype's
// pooled intake, paid in gold/materials (and horses for riders).
//
// The server owns every rule — caps, intake, the hex budget, the price. The
// panel only previews them from the numbers campaignView ships (`caps`,
// `intake`, `loose`, `reinforceRecipes`), so there is no second copy of the
// config here: a rebalance server-side moves this screen with it. An
// over-request is refused whole by the route rather than clamped, which is
// exactly why the inputs bound themselves — a disagreement between this
// arithmetic and the server's should be impossible to submit by accident.
//
// Deliberately NOT the squad inspection screen (decision 13, which stays last):
// this is the minimum that makes the mechanic playable, since the elite-recovery
// trade it exists to test can only be judged by playing it.

const applicationsFor = (recipe, bodies) => bodies / (recipe?.count ?? 1)

// What one squad's whole draft costs, summed across types. Same shape the
// server sums server-side; the numbers themselves come off the wire.
const draftCost = (draft, recipes) => {
  const cost = {}
  for (const [type, bodies] of Object.entries(draft)) {
    const recipe = recipes[type]
    if (!recipe || !bodies) continue
    for (const [resource, per] of Object.entries(recipe.cost))
      cost[resource] = (cost[resource] ?? 0) + per * applicationsFor(recipe, bodies)
  }
  return cost
}

const costLabel = (cost) =>
  Object.entries(cost)
    .map(([resource, n]) => `${n} ${resource}`)
    .join(', ')

const SquadReinforcePanel = ({ onReinforce }) => {
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const loose = useCampaignStore((s) => s.campaign?.loose ?? EMPTY_OBJECT)
  const recipes = useCampaignStore((s) => s.campaign?.reinforceRecipes ?? EMPTY_OBJECT)
  const resources = useCampaignStore((s) => s.campaign?.resources ?? EMPTY_OBJECT)
  // {squadId: {type: bodies}} — local until submitted; the server is the only
  // authority on what actually joined.
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)

  if (squads.length === 0) return null

  const submit = async (squad) => {
    const draft = drafts[squad.id] ?? {}
    const reinforce = Object.fromEntries(Object.entries(draft).filter(([, n]) => n > 0))
    if (Object.keys(reinforce).length === 0) return
    setBusy(true)
    try {
      await onReinforce(squad.id, { reinforce })
      // Clear this squad's draft either way: on success the view now holds the
      // new composition, and on failure the numbers it was built from are the
      // ones the server just rejected.
      setDrafts((prev) => ({ ...prev, [squad.id]: {} }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="reinforce-panel" data-testid="reinforce-panel">
      <h3>Replacements</h3>
      <p className="reinforce-intro">
        Squads take replacements out of your unassigned troops — once a fortnight each, as many as
        the formation can absorb and equip.
      </p>
      {squads.map((squad) => {
        const caps = squad.caps ?? EMPTY_OBJECT
        const draft = drafts[squad.id] ?? EMPTY_OBJECT
        const asked = Object.values(draft).reduce((a, b) => a + b, 0)
        const intakeLeft = (squad.intake ?? 0) - asked
        const cost = draftCost(draft, recipes)
        const affordable = Object.entries(cost).every(([resource, n]) => (resources[resource] ?? 0) >= n)
        const types = Object.keys(caps)

        return (
          <div className="raid-card" key={squad.id} data-testid={`reinforce-squad-${squad.id}`}>
            <strong>
              {squad.name} — {squad.rank}
            </strong>
            {types.length === 0 ? (
              <p data-testid={`reinforce-none-${squad.id}`}>
                This squad has no charter of types — it takes no replacements.
              </p>
            ) : squad.reinforcedToday ? (
              <p data-testid={`reinforce-done-${squad.id}`}>Replacements have joined this fortnight.</p>
            ) : (
              <>
                <p data-testid={`reinforce-intake-${squad.id}`}>
                  Intake: {asked} of {squad.intake} this fortnight
                </p>
                {types.map((type) => {
                  const held = squad.composition?.[type] ?? 0
                  const headroom = Math.max(0, caps[type] - held)
                  const spentOnOthers = asked - (draft[type] ?? 0)
                  const recipe = recipes[type]
                  // The three bounds the server checks, applied as one: the
                  // per-type cap, the pooled intake, and the unassigned bodies
                  // this reinforcement would destroy. (The hex budget is the
                  // fourth and is the server's alone — it needs unit sizes.)
                  const room = Math.min(
                    headroom,
                    Math.max(0, (squad.intake ?? 0) - spentOnOthers),
                    Math.floor(loose[type] ?? 0),
                  )
                  const step = recipe?.count ?? 1
                  const max = Math.floor(room / step) * step
                  return (
                    <div className="reinforce-row" key={type}>
                      <label htmlFor={`reinforce-${squad.id}-${type}`}>
                        {held}/{caps[type]} {type}
                        <span className="reinforce-loose"> ({loose[type] ?? 0} unassigned)</span>
                      </label>
                      <input
                        id={`reinforce-${squad.id}-${type}`}
                        data-testid={`reinforce-input-${squad.id}-${type}`}
                        type="number"
                        min="0"
                        max={max}
                        step={step}
                        value={draft[type] ?? 0}
                        disabled={busy || max === 0}
                        onChange={(e) => {
                          const wanted = Math.max(0, Math.min(max, Number(e.target.value) || 0))
                          setDrafts((prev) => ({
                            ...prev,
                            [squad.id]: { ...(prev[squad.id] ?? {}), [type]: wanted },
                          }))
                        }}
                      />
                    </div>
                  )
                })}
                <p data-testid={`reinforce-cost-${squad.id}`}>
                  Cost: {asked === 0 ? 'nothing yet' : costLabel(cost)}
                </p>
                <button
                  className="btn-primary"
                  data-testid={`reinforce-submit-${squad.id}`}
                  onClick={() => submit(squad)}
                  disabled={busy || asked === 0 || intakeLeft < 0 || !affordable}
                  title={affordable ? undefined : 'Not enough stores for these replacements'}
                >
                  Reinforce
                </button>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default SquadReinforcePanel
