import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// The magic-item store (docs/CAMPAIGN_PLAN.md, SLICE 6 and decision 17).
//
// Opened FROM A SLOT, never browsed at large: the request carries what the slot
// accepts and the store filters to that. That is the whole shape of 6-14 — the
// slot declares, the store filters — and it is why nothing here knows what a
// banner IS. A character's typed head slot (5-4) opens this same panel with a
// different `accepts` and needs no change to this file.
//
// DELIBERATELY PLAIN, like CharacterPanel: decision 17's real storage page is
// its own slice, and this is the minimum that makes the mechanic playable.
// Do not grow a design here.
//
// PERMANENCE IS THE COST, and the confirm step exists for that reason — the
// same reason SquadUpgradePanel's does. A bound banner leaves the store and
// never comes back, and there is no undo endpoint to pair with the button.

const ItemStorePanel = ({ onBind }) => {
  const request = useUiStore((s) => s.storeRequest)
  const close = useUiStore((s) => s.closeItemStore)
  const items = useCampaignStore((s) => s.campaign?.items ?? EMPTY_ARRAY)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!request) return null

  const offered = items.filter((item) => item.kind === request.accepts)

  const bind = async (item) => {
    setBusy(true)
    try {
      await onBind(request.squadId, item.id)
      close()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="item-store" data-testid="item-store">
      <h3>The Stores</h3>
      <p className="item-store-intro">
        {request.squadName
          ? `Choosing a banner for ${request.squadName}.`
          : 'Choosing an item.'}
      </p>

      {offered.length === 0 && (
        <p data-testid="item-store-empty">
          Nothing here that would serve. Such things are won, not bought.
        </p>
      )}

      {offered.map((item) => (
        <div className="raid-card" key={item.id} data-testid={`store-item-${item.id}`}>
          <strong>{item.name}</strong>
          <p className="item-blurb">{item.blurb}</p>
          {confirming === item.id ? (
            <>
              {/* Naming the permanence is the point of the step. The server
                  refuses a second binding regardless — this is so the player is
                  never surprised by that refusal. */}
              <p data-testid={`store-warn-${item.id}`}>
                Given to this squad, it stays with them for the rest of the campaign. It cannot be
                taken back, and no other squad will carry it.
              </p>
              <button
                className="btn-primary"
                data-testid={`store-confirm-${item.id}`}
                onClick={() => bind(item)}
                disabled={busy}
              >
                Give it to them — for good
              </button>
              <button
                className="btn-secondary"
                data-testid={`store-cancel-${item.id}`}
                onClick={() => setConfirming(null)}
                disabled={busy}
              >
                Not yet
              </button>
            </>
          ) : (
            <button
              className="btn-primary"
              data-testid={`store-choose-${item.id}`}
              onClick={() => setConfirming(item.id)}
              disabled={busy}
            >
              Give it to them
            </button>
          )}
        </div>
      ))}

      <button className="btn-secondary" data-testid="item-store-back" onClick={close} disabled={busy}>
        Back
      </button>
    </div>
  )
}

export default ItemStorePanel
