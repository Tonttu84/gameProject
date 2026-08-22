import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// Squad upgrades (docs/CAMPAIGN_PLAN.md "SLICE 4 — THE UPGRADE CATALOG"): what
// prestige is actually FOR. A squad that reaches a rank with a slot free is
// dealt three rows and keeps ONE — permanently.
//
// The whole draft is the server's: it draws at newDay and seals the offer on
// the document, so this panel renders `squad.upgradeOffer` and never picks from
// a catalog of its own. That is deliberate — the draw is random, and a client
// that could re-roll it by reloading would not be a draft at all.
//
// PERMANENCE IS THE COST. Upgrades charge no resources and no prestige, so the
// only thing a pick costs is every other pick; the confirm step below exists
// for that reason and should not be smoothed away. There is no undo endpoint.
//
// A SCREEN OF ITS OWN, reached from the squad screen (13-15). Decision 13 was
// going to dissolve this panel into the charter page; the interview amended
// that — the three cards and the permanence confirm want room to themselves,
// and the roll MARKS which charters have a draft waiting, so the hub is what
// you navigate from rather than what swallows everything.
//
// What a charter HOLDS — its banner, its honours, its free slots — lives on the
// charter page instead. This screen is the DRAFT and nothing else: two screens
// listing the same honours would be the "managed in three places" problem 13-1
// exists to end.

const SquadUpgradePanel = ({ onTakeUpgrade }) => {
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  // {squadId: upgradeId} — which row the player has selected but not yet
  // confirmed. Local: nothing is real until the server says so.
  const [picked, setPicked] = useState({})
  const [busy, setBusy] = useState(false)

  const offering = squads.filter((squad) => (squad.upgradeOffer?.options?.length ?? 0) > 0)

  const confirm = async (squad) => {
    const upgrade = picked[squad.id]
    if (!upgrade) return
    setBusy(true)
    try {
      await onTakeUpgrade(squad.id, upgrade)
      setPicked((prev) => ({ ...prev, [squad.id]: undefined }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="upgrade-panel" data-testid="upgrade-panel">
      <h3>Honours</h3>
      {offering.length === 0 ? (
        <p data-testid="upgrade-none">
          No charter has an honour waiting. They are earned by the ranks a squad reaches.
        </p>
      ) : (
        <p className="upgrade-intro">
          A squad that has made its name may be trained to something more. Choose one — the choice
          is made once and stands for the rest of the campaign.
        </p>
      )}

      {offering.map((squad) => {
        const chosen = picked[squad.id]
        return (
          <div className="raid-card" key={squad.id} data-testid={`upgrade-squad-${squad.id}`}>
            <strong>
              {squad.name} — {squad.upgradeOffer.rank}
            </strong>
            <p data-testid={`upgrade-slots-${squad.id}`}>
              {squad.upgradePicks} of {squad.upgradeSlots} honours unclaimed
            </p>
            <div className="upgrade-options">
              {squad.upgradeOffer.options.map((option) => (
                <label
                  className={`upgrade-option${chosen === option.id ? ' upgrade-option-chosen' : ''}`}
                  key={option.id}
                  data-testid={`upgrade-option-${squad.id}-${option.id}`}
                >
                  <input
                    type="radio"
                    name={`upgrade-${squad.id}`}
                    value={option.id}
                    checked={chosen === option.id}
                    disabled={busy}
                    onChange={() => setPicked((prev) => ({ ...prev, [squad.id]: option.id }))}
                  />
                  <span className="upgrade-option-name">{option.name}</span>
                  {/* A row may cost more than one honour (the Royal Guard costs
                      two, the second borrowed from the next rank). Saying so on
                      the card is the whole point: permanence is the cost, and a
                      player must never spend a future draft unknowingly. */}
                  {(option.slots ?? 1) > 1 && (
                    <span
                      className="upgrade-option-cost"
                      data-testid={`upgrade-option-cost-${squad.id}-${option.id}`}
                    >
                      Costs {option.slots} honours — this one and the next
                    </span>
                  )}
                  <span className="upgrade-option-blurb">{option.blurb}</span>
                </label>
              ))}
            </div>
            <button
              className="btn-primary"
              data-testid={`upgrade-submit-${squad.id}`}
              onClick={() => confirm(squad)}
              disabled={busy || !chosen}
              title={chosen ? 'This cannot be undone' : 'Choose an honour first'}
            >
              Take it — for good
            </button>
          </div>
        )
      })}

    </div>
  )
}

export default SquadUpgradePanel
