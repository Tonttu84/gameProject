import React from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY, availabilityOf } from '../stores/selectors'

// ONE CHARTER, in full (docs/CAMPAIGN_PLAN.md, decision 13-10): troop types as
// ROWS against their caps, the rank and what the next rung costs, the banner,
// the posted character, the honours held and unspent, availability, and
// tonight's refill.
//
// COMPOSITION IS COUNTS BY TYPE — only characters are individuals (13-10). A
// page per troop type (the engine's unit catalog surfacing to the player) and
// modelling every body as a named person were both considered and are slices of
// their own, not omissions here.
//
// EVERY NUMBER ON THIS PAGE IS THE SERVER'S. Caps, intake, rank, the next
// rung's threshold and the refill forecast all arrive resolved in the view; the
// client re-derives no campaign math. The forecast in particular IS
// `planAutoRefill` — the very function the end-of-turn pass runs — so what this
// page promises and what the turn does cannot drift apart.

// Why nobody joins tonight, in the player's words (13-6). The server sends the
// gate that closed; this is the one place that phrases it. `full` is the happy
// case and reads like one — a charter at strength is not a problem.
const BLOCKED = {
  full: 'At full strength — every rank the charter musters is filled.',
  pool: 'Nobody joins tonight: the loose ranks hold none of the men this charter takes.',
  cost: 'Nobody joins tonight: the treasury cannot pay for replacements.',
  space: 'Nobody joins tonight: the formation has no room left on its hex.',
  intake: 'Nobody joins tonight: this charter has taken its fill for the turn.',
  none: 'This charter musters no one — it has no roll to draft against.',
}

const listOf = (bag) =>
  Object.entries(bag ?? {})
    .map(([key, n]) => `${n} ${key}`)
    .join(', ')

const SquadCharterPage = ({ squadId }) => {
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const characters = useCampaignStore((s) => s.campaign?.characters ?? EMPTY_ARRAY)
  const raiding = useCampaignStore((s) => s.campaign?.raid?.squadAssignment ?? EMPTY_ARRAY)
  const showPage = useUiStore((s) => s.showSquadPage)
  const openItemStore = useUiStore((s) => s.openItemStore)

  const squad = squads.find((s) => s.id === squadId)
  // A charter that vanished under the screen (a fresh campaign, a 404 recovery)
  // is not an error worth a crash — the roll is one click away.
  if (!squad) return <p data-testid="charter-missing">That charter is no longer on the rolls.</p>

  const caps = squad.caps ?? {}
  const composition = squad.composition ?? {}
  const refill = squad.refill ?? { outputs: {}, cost: {}, bodies: 0, blocked: 'none' }
  const posted = characters.find((c) => c.alive && c.squadId === squad.id)
  // Types the charter musters, plus any it happens to hold and can never
  // replace (a type an old archetype named, or one an upgrade swapped away).
  // The second kind has no cap, and saying so is better than hiding bodies that
  // are really standing there.
  const rows = [...new Set([...Object.keys(caps), ...Object.keys(composition)])]

  return (
    <div className="charter-page" data-testid={`charter-page-${squad.id}`}>
      <h3>{squad.name}</h3>

      {/* 13-14: the rank word, the raw number, and the next rung's threshold —
          and NOTHING about what that rung will be worth. You learn that when the
          draft or the banner arrives; a page that named the grant would be a
          progress bar. */}
      <p data-testid={`charter-rank-${squad.id}`}>
        {squad.rank} — {squad.prestige} prestige
        {squad.nextRank
          ? `, next rung (${squad.nextRank.label}) at ${squad.nextRank.at}`
          : ', the top of the ladder'}
      </p>

      <p data-testid={`charter-availability-${squad.id}`}>
        {availabilityOf(squad, raiding, { long: true })}
      </p>

      <h4>Muster</h4>
      <table className="charter-muster">
        <tbody>
          {rows.map((type) => {
            const cap = caps[type]
            const joining = refill.outputs?.[type] ?? 0
            return (
              <tr key={type} data-testid={`charter-row-${squad.id}-${type}`}>
                <td>{type}</td>
                <td>
                  {composition[type] ?? 0}
                  {cap === undefined ? ' (no muster room — cannot be replaced)' : ` of ${cap}`}
                </td>
                <td data-testid={`charter-joining-${squad.id}-${type}`}>
                  {joining > 0 ? `+${joining} joining` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p data-testid={`charter-intake-${squad.id}`}>
        Takes on up to {squad.intake} replacements a turn.
      </p>

      {/* TONIGHT'S REFILL (13-6): what will join and what it will cost, before
          it happens. This is what turns the page from a scoreboard into a
          planning tool — it is how a player learns that raiding for gold this
          turn is what refills the line next turn.

          It is a PREDICTION and says so: it is computed against tonight's pool
          and purse, every charter ahead of this one in the roll spends first
          (13-4), and a raid fought this afternoon moves the money under it. A
          forecast rendered as a promise reads as a bug the first time a raid
          changes it. */}
      <h4>At the turn's end</h4>
      {refill.bodies > 0 ? (
        <>
          <p data-testid={`charter-refill-${squad.id}`}>
            {listOf(refill.outputs)} join{refill.bodies === 1 ? 's' : ''} —{' '}
            {listOf(refill.cost) || 'free'}.
          </p>
          <p className="charter-forecast-note" data-testid={`charter-forecast-note-${squad.id}`}>
            As things stand tonight. Charters higher on the roll draw first, and anything you
            spend or win before the turn ends changes this.
          </p>
        </>
      ) : (
        <p data-testid={`charter-refill-${squad.id}`}>{BLOCKED[refill.blocked] ?? BLOCKED.full}</p>
      )}

      {/* The banner (slice 6). `banner` is a TIER WORD — 'plain' is a banner
          every squad carries and one that does nothing, so it is stated rather
          than left blank, and never tested for truthiness. */}
      <h4>Standard</h4>
      {squad.banner === 'item' && squad.bannerItem ? (
        <p data-testid={`charter-banner-${squad.id}`}>
          <strong>{squad.bannerItem.name}</strong> — {squad.bannerItem.blurb}
        </p>
      ) : squad.banner === 'basic' ? (
        <>
          <p data-testid={`charter-banner-${squad.id}`}>Carries its own banner.</p>
          <button
            className="btn-secondary"
            data-testid={`charter-banner-slot-${squad.id}`}
            onClick={() =>
              openItemStore({ accepts: 'banner', squadId: squad.id, squadName: squad.name })
            }
          >
            Give them a standard
          </button>
        </>
      ) : (
        <p data-testid={`charter-banner-${squad.id}`}>
          A plain banner — earned standards come with the rank.
        </p>
      )}

      <h4>Honours</h4>
      <p data-testid={`charter-honours-${squad.id}`}>
        {squad.upgradePicks} of {squad.upgradeSlots} unclaimed
      </p>
      {(squad.upgrades ?? []).map((upgrade) => (
        <p key={upgrade.id} data-testid={`charter-upgrade-${squad.id}-${upgrade.id}`}>
          <strong>{upgrade.name}</strong> — {upgrade.blurb}
        </p>
      ))}
      {/* 13-15: the draft is claimed on its own screen, reached from here. */}
      {(squad.upgradeOffer?.options?.length ?? 0) > 0 && (
        <button
          className="btn-primary"
          data-testid={`charter-to-honours-${squad.id}`}
          onClick={() => showPage('honours', squad.id)}
        >
          An honour waits — choose it
        </button>
      )}

      <h4>Character</h4>
      <p data-testid={`charter-character-${squad.id}`}>
        {posted ? `${posted.name} — ${posted.type}, riding with them` : 'Nobody is posted here.'}
      </p>
      {/* 13-16: posting is done on the company screen, which is where the whole
          roll of the living and the fallen lives. One code path for the
          mutation, reached from the charter that wants it. */}
      <button
        className="btn-secondary"
        data-testid={`charter-to-company-${squad.id}`}
        onClick={() => showPage('company', squad.id)}
      >
        {posted ? 'Change the posting' : 'Post a character'}
      </button>
    </div>
  )
}

export default SquadCharterPage
