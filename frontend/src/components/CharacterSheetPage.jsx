import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// ONE CHARACTER, in full (docs/CAMPAIGN_PLAN.md, decision 9-16): the stats with
// their modifiers folded in, every slot their body has and what fills it,
// equip and unequip against the store, the posting, and the hang-back order.
//
// 13-8's ROLL-THEN-PAGE shape, one level further in — the company roll names
// everyone, this page is one of them. Chosen there on scaling grounds that
// apply identically here: the design target is a company of many, and cards
// side by side stop scaling at about five.
//
// IT ABSORBED THE ACTIONS, exactly as 13-1 had the charter page absorb its
// three panels. `CharacterPanel` kept the posting select and the hang-back
// checkbox while it was the only screen a character had; both are here now,
// because both want the context this page exists to show — what they carry,
// what it is worth, and whether they are even in camp to be given orders.
//
// EVERY NUMBER AND EVERY SENTENCE IS THE SERVER'S. `sheet` arrives as resolved
// rows (base, delta, value) in 9-5's vocabulary, `slots` arrive phrased, and
// each worn item carries the same lines the stores show (17-5). This file holds
// no catalog, folds no arithmetic and turns no ability word into English.
//
// ASSIGNMENT HAPPENS HERE, NOT AT THE STORE (17-3): an empty slot opens the
// store filtered to what it takes, and the store hands the choice back. Taking
// a piece OFF is this page's alone — the store never grows an unassign button,
// because the holder is the one thing that knows where the piece is worn.

// The three states this page renders, and what each forbids:
//   DEAD     — read-only, and still carrying whatever was not stripped from the
//              body (5-9). The record is the point: a later recovery has to
//              have something to find.
//   AWAY     — read-only, with the server's phrase for why (9-8/9-9). Equipping
//              AND posting are both refused while a bearer is out, so the page
//              greys out together rather than in halves.
//   IN CAMP  — everything is free, in any phase, at no cost (5-7).

const CharacterSheetPage = ({ characterId, onAttach, onSetHangBack, onUnequip }) => {
  const characters = useCampaignStore((s) => s.campaign?.characters ?? EMPTY_ARRAY)
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const openItemStore = useUiStore((s) => s.openItemStore)
  const [busy, setBusy] = useState(false)

  const character = characters.find((c) => c.id === characterId)
  // Somebody who vanished under the screen (a fresh campaign, a 404 recovery)
  // is not a crash — the company roll is one click away.
  if (!character)
    return <p data-testid="sheet-missing">That name is no longer on the company rolls.</p>

  const { awayBlocker, alive } = character
  const locked = !alive || !!awayBlocker
  const worn = character.items ?? EMPTY_ARRAY
  const wornAt = (slot, index) => worn.find((w) => w.slot === slot && w.index === index)
  const squadName = (id) => squads.find((s) => s.id === id)?.name ?? `squad ${id}`

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="character-sheet" data-testid={`character-sheet-${character.id}`}>
      <h3>
        {character.name} — {character.type}
      </h3>

      {/* Where they are, in one line. The dead keep their entry (5-9); saying
          when they fell is the whole of what the page can still tell you about
          them, beyond what they were carrying. */}
      <p data-testid={`sheet-standing-${character.id}`}>
        {!alive
          ? `Fell on day ${character.diedDay}.`
          : character.squadId == null
            ? 'In camp, posted to no charter.'
            : `Rides with ${squadName(character.squadId)}.`}
      </p>

      {/* The server's phrase, never the client's (17-5): "out raiding" and "away
          on a mission" read differently and only the server knows which. */}
      {awayBlocker && (
        <p className="sheet-away" data-testid={`sheet-away-${character.id}`}>
          {awayBlocker} — nothing can be changed until they are back.
        </p>
      )}

      {/* The paths they command (docs/CAMPAIGN_PLAN.md "▶ SLICE 2", S2-13) —
          the whole of slice 2's UI, and above the stats because it is the
          answer to what a caster IS. A Mage's are rolled at hire and a Priest's
          are the same for every Priest, so this is where the gamble pays off on
          the turn you take it.

          The rows arrive PHRASED and in order (17-5): this joins them and
          composes nothing. A caster with none says so in a sentence rather than
          showing an empty line, the same way an unknown sheet does below. */}
      <h4>Paths</h4>
      {character.paths?.length ? (
        <p data-testid={`sheet-paths-${character.id}`}>
          {character.paths.map((row) => `${row.label} ${row.level}`).join(' · ')}
        </p>
      ) : (
        <p data-testid={`sheet-nopaths-${character.id}`}>
          {character.name} commands no path of magic.
        </p>
      )}

      <h4>The Sheet</h4>
      {character.sheet ? (
        <table className="character-stats">
          <tbody>
            {character.sheet.map((row) => (
              <tr key={row.stat} data-testid={`sheet-stat-${character.id}-${row.stat}`}>
                <td>{row.label}</td>
                <td>{row.value}</td>
                {/* The delta is shown BESIDE the total rather than instead of
                    it: the question the sheet answers is "how good are they",
                    and "what is the kit worth" is the follow-up. A stat nothing
                    moved says nothing at all — a column of ±0 is noise. */}
                <td data-testid={`sheet-delta-${character.id}-${row.stat}`}>
                  {row.delta === 0
                    ? ''
                    : `${row.delta > 0 ? '+' : '−'}${Math.abs(row.delta)} from what they carry`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p data-testid={`sheet-unknown-${character.id}`}>
          Nothing is known about what a {character.type} can do.
        </p>
      )}

      <h4>What They Carry</h4>
      {character.slots ? (
        character.slots.flatMap((slot) =>
          // A slot with two positions is two rows — a man with two hands may
          // carry two blades (9-6), and one row per POSITION is what makes the
          // second one reachable.
          Array.from({ length: slot.count }, (_, index) => {
            const item = wornAt(slot.slot, index)
            const key = `${slot.slot}-${index}`
            const label = slot.count > 1 ? `${slot.label} ${index + 1}` : slot.label
            return (
              <div className="raid-card" key={key} data-testid={`sheet-slot-${character.id}-${key}`}>
                <strong>{label}</strong>
                {item ? (
                  <>
                    <p data-testid={`sheet-worn-${character.id}-${key}`}>{item.name}</p>
                    <p className="item-blurb">{item.blurb}</p>
                    <p data-testid={`sheet-effect-${character.id}-${key}`}>{item.effect}</p>
                    {/* A permanent piece has no button at all rather than a
                        button that can only be refused. Nothing in the catalog
                        is both worn and permanent today; the row declares it,
                        so the day one is, this page already tells the truth. */}
                    {item.permanent ? (
                      <p data-testid={`sheet-stuck-${character.id}-${key}`}>{item.binding}</p>
                    ) : (
                      <button
                        className="btn-secondary"
                        data-testid={`sheet-unequip-${character.id}-${key}`}
                        disabled={locked || busy}
                        onClick={() =>
                          run(() => onUnequip(character.id, { slot: slot.slot, index }))
                        }
                      >
                        Take it off
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p data-testid={`sheet-empty-${character.id}-${key}`}>Empty.</p>
                    <button
                      className="btn-primary"
                      data-testid={`sheet-fill-${character.id}-${key}`}
                      disabled={locked || busy}
                      onClick={() =>
                        openItemStore({
                          accepts: 'gear',
                          slot: slot.slot,
                          slotLabel: slot.label,
                          index,
                          characterId: character.id,
                          characterName: character.name,
                        })
                      }
                    >
                      Find something for it
                    </button>
                  </>
                )}
              </div>
            )
          }),
        )
      ) : (
        <p data-testid={`sheet-noslots-${character.id}`}>
          Nothing is known about where a {character.type} can wear things.
        </p>
      )}

      {/* The two orders, on the page that shows what they are worth. Hidden for
          the dead — they take no orders — and disabled while away, which is
          9-9's amendment to 5-7: attach/detach is refused out there too, or the
          equipment lock would be advisory (detach, re-kit, re-attach). */}
      {alive && (
        <>
          <h4>Orders</h4>
          <label htmlFor={`sheet-squad-${character.id}`}>
            Posting
            <select
              id={`sheet-squad-${character.id}`}
              data-testid={`sheet-squad-${character.id}`}
              value={character.squadId ?? ''}
              disabled={locked || busy}
              onChange={(e) =>
                run(() =>
                  onAttach(character.id, e.target.value === '' ? null : Number(e.target.value)),
                )
              }
            >
              <option value="">In camp</option>
              {squads.map((squad) => (
                <option value={squad.id} key={squad.id}>
                  {squad.name}
                </option>
              ))}
            </select>
          </label>

          {/* Every character carries the toggle whatever their type — a
              battle-mage can be told to hold the line. Only the default is
              derived from the unit (5-8). */}
          <label htmlFor={`sheet-hangback-${character.id}`}>
            <input
              id={`sheet-hangback-${character.id}`}
              data-testid={`sheet-hangback-${character.id}`}
              type="checkbox"
              checked={character.hangBack}
              disabled={locked || busy}
              onChange={(e) => run(() => onSetHangBack(character.id, e.target.checked))}
            />
            Hang back unless the line breaks
          </label>
        </>
      )}
    </div>
  )
}

export default CharacterSheetPage
