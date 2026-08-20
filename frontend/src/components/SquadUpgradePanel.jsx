import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
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
// Deliberately NOT the squad inspection screen (decision 13, still last) — this
// is the minimum that makes the mechanic playable.

const SquadUpgradePanel = ({ onTakeUpgrade }) => {
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const openItemStore = useUiStore((s) => s.openItemStore)
  // {squadId: upgradeId} — which row the player has selected but not yet
  // confirmed. Local: nothing is real until the server says so.
  const [picked, setPicked] = useState({})
  const [busy, setBusy] = useState(false)

  const offering = squads.filter((squad) => (squad.upgradeOffer?.options?.length ?? 0) > 0)
  // `banner` is a TIER WORD now ('plain' | 'basic' | 'item'), so a truthiness
  // test would match every squad in the army — every one of them carries a
  // plain banner. What is worth showing is a banner the squad EARNED.
  const decorated = squads.filter(
    (squad) => (squad.upgrades?.length ?? 0) > 0 || squad.banner !== 'plain',
  )
  if (offering.length === 0 && decorated.length === 0) return null

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
      {offering.length > 0 && (
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

      {decorated.map((squad) => (
        <div className="raid-card" key={`held-${squad.id}`} data-testid={`upgrade-held-${squad.id}`}>
          <strong>{squad.name}</strong>
          {/* The BANNER SLOT (slice 6, 6-14). Reached at Seasoned, which grants
              the basic banner and opens the slot in the same breath. The basic
              banner carries NO bonus yet — deliberately deferred (decision 16),
              not missing, so this says what it is and promises nothing.

              Clicking the empty slot opens the store filtered to banners; a
              bound relic REPLACES the basic banner rather than stacking, which
              is why one line renders both states rather than two lines
              disagreeing about what the squad carries. */}
          {squad.banner === 'basic' && (
            <>
              <p data-testid={`upgrade-banner-${squad.id}`}>Carries its own banner.</p>
              <button
                className="btn-secondary"
                data-testid={`banner-slot-${squad.id}`}
                onClick={() =>
                  openItemStore({ accepts: 'banner', squadId: squad.id, squadName: squad.name })
                }
              >
                Give them a standard
              </button>
            </>
          )}
          {squad.banner === 'item' && squad.bannerItem && (
            <p data-testid={`upgrade-banner-${squad.id}`}>
              <strong>{squad.bannerItem.name}</strong> — {squad.bannerItem.blurb}
            </p>
          )}
          {(squad.upgrades ?? []).map((upgrade) => (
            <p key={upgrade.id} data-testid={`upgrade-held-${squad.id}-${upgrade.id}`}>
              <strong>{upgrade.name}</strong> — {upgrade.blurb}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

export default SquadUpgradePanel
