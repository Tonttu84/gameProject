import React, { useState } from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// The company's characters (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS"):
// named individuals rather than roster counts, each of whom can be posted to a
// squad, told to hang back, and lost for good.
//
// DELIBERATELY PLAIN, and it should stay that way — decision 13's squad screen
// will absorb this, so it is the minimum that makes the mechanic playable
// rather than a design of its own. List, attachment picker, hang-back toggle,
// and the roll of the dead.
//
// The dead are LISTED, not hidden. Their record survives with everything on it
// (5-9) because a later recovery — a mummification, a special spell — has to
// have something to work with, and a name that vanishes from the screen reads
// as a bug rather than as a loss.

const CharacterPanel = ({ onAttach, onSetHangBack }) => {
  const characters = useCampaignStore((s) => s.campaign?.characters ?? EMPTY_ARRAY)
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const [busy, setBusy] = useState(false)

  if (characters.length === 0) return null

  const living = characters.filter((c) => c.alive)
  const fallen = characters.filter((c) => !c.alive)

  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const squadName = (id) => squads.find((s) => s.id === id)?.name ?? `squad ${id}`

  return (
    <div className="character-panel" data-testid="character-panel">
      <h3>Your Company</h3>
      <p className="character-intro">
        Casters serve as individuals. Post one to a squad and they march, raid and fight with it —
        and can fall with it.
      </p>

      {living.map((character) => (
        <div className="raid-card" key={character.id} data-testid={`character-${character.id}`}>
          <strong>
            {character.name} — {character.type}
          </strong>
          <p data-testid={`character-posting-${character.id}`}>
            {character.squadId == null ? 'In camp' : `With ${squadName(character.squadId)}`}
          </p>

          <label htmlFor={`character-squad-${character.id}`}>
            Posting
            <select
              id={`character-squad-${character.id}`}
              data-testid={`character-squad-${character.id}`}
              value={character.squadId ?? ''}
              disabled={busy}
              onChange={(e) =>
                run(() => onAttach(character.id, e.target.value === '' ? null : Number(e.target.value)))
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
          <label htmlFor={`character-hangback-${character.id}`}>
            <input
              id={`character-hangback-${character.id}`}
              data-testid={`character-hangback-${character.id}`}
              type="checkbox"
              checked={character.hangBack}
              disabled={busy}
              onChange={(e) => run(() => onSetHangBack(character.id, e.target.checked))}
            />
            Hang back unless the line breaks
          </label>
        </div>
      ))}

      {fallen.length > 0 && (
        <div className="character-fallen" data-testid="character-fallen">
          <h4>The Fallen</h4>
          {fallen.map((character) => (
            <p key={character.id} data-testid={`character-dead-${character.id}`}>
              {character.name} — {character.type}, fell on day {character.diedDay}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export default CharacterPanel
