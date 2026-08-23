import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// The item store (docs/CAMPAIGN_PLAN.md, SLICE 6 and SLICE 17).
//
// ONE SCREEN, TWO MODES (17-4), branching on whether the request carries a slot:
//   - SLOT MODE — opened FROM a slot, as it always was: the request says what
//     the slot accepts, the store filters to that, clicking assigns, and the
//     permanence prompt guards the bind. Nothing here knows what a banner IS;
//     a character's typed head slot (5-4) opens this same panel with a
//     different `accepts` and needs no change to this file.
//   - BROWSE MODE — opened from the HUD's `The Stores` door: unfiltered, and
//     READ-ONLY. Clicking a row only opens its detail.
//
// Two modes rather than a second component beside this one, so the wording and
// the empty state cannot drift apart between the two doors a player can come in
// through.
//
// IT IS THE STORE, STRICTLY (17-2): what it renders is `campaign.items`, which
// is every item that is on NOTHING. A bound banner is not here — it is on its
// charter's page. And it never grows a target picker (17-3): assignment happens
// at the screen of the thing that wears it, so there is exactly one code path
// per mutation. When the first REVERSIBLE item arrives, "unassign" belongs on
// the holder's page, never here.
//
// THE CLIENT COMPOSES NO SENTENCES (17-5). `effect`/`where`/`binding` arrive
// phrased by the server's describeItem; this file has no copy of the catalog
// and never turns an ability word into English.
//
// PERMANENCE IS THE COST, and the confirm step exists for that reason — the
// same reason SquadUpgradePanel's does. A bound banner leaves the store and
// never comes back, and there is no undo endpoint to pair with the button.

// The server's three lines. `where` is worth saying while browsing (it is how a
// player learns where a thing they hold could go) and redundant in slot mode,
// where they arrived FROM the slot — but the wording itself comes from the one
// server function either way, which is the drift this shared render prevents.
const ItemLines = ({ item, showWhere }) => (
  <>
    <p className="item-blurb">{item.blurb}</p>
    <p data-testid={`store-effect-${item.id}`}>{item.effect}</p>
    {showWhere && <p data-testid={`store-where-${item.id}`}>{item.where}</p>}
    <p data-testid={`store-binding-${item.id}`}>{item.binding}</p>
  </>
)

const ItemStorePanel = ({ onBind }) => {
  const request = useUiStore((s) => s.storeRequest)
  const close = useUiStore((s) => s.closeItemStore)
  const items = useCampaignStore((s) => s.campaign?.items ?? EMPTY_ARRAY)
  const [confirming, setConfirming] = useState(null)
  const [opened, setOpened] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!request) return null

  const browsing = !!request.browse
  const offered = browsing ? items : items.filter((item) => item.kind === request.accepts)

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
        {browsing
          ? 'Everything you hold that is not yet on anything. What is carried is shown where it is carried.'
          : request.squadName
            ? `Choosing a banner for ${request.squadName}.`
            : 'Choosing an item.'}
      </p>

      {offered.length === 0 && (
        <p data-testid="item-store-empty">
          {browsing
            ? 'The stores are empty. Such things are won, not bought.'
            : 'Nothing here that would serve. Such things are won, not bought.'}
        </p>
      )}

      {offered.map((item) => (
        <div className="raid-card" key={item.id} data-testid={`store-item-${item.id}`}>
          {browsing ? (
            // No router, and 13-8 already settled that a page swap is UI state:
            // the detail is the clicked row expanding in place, not a sub-page.
            <>
              <button
                className="btn-secondary"
                data-testid={`store-open-${item.id}`}
                onClick={() => setOpened(opened === item.id ? null : item.id)}
              >
                {item.name}
              </button>
              {opened === item.id && (
                <div data-testid={`store-detail-${item.id}`}>
                  <ItemLines item={item} showWhere />
                </div>
              )}
            </>
          ) : (
            <>
              <strong>{item.name}</strong>
              <ItemLines item={item} showWhere={false} />
              {confirming === item.id ? (
                <>
                  {/* Naming the permanence is the point of the step. The server
                      refuses a second binding regardless — this is so the player
                      is never surprised by that refusal. */}
                  <p data-testid={`store-warn-${item.id}`}>
                    Given to this squad, it stays with them for the rest of the campaign. It cannot
                    be taken back, and no other squad will carry it.
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
            </>
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
