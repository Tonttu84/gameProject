import React from 'react'
import useCampaignStore from '../stores/useCampaignStore'
import useUiStore from '../stores/useUiStore'
import { EMPTY_ARRAY } from '../stores/selectors'

// The company's characters (docs/CAMPAIGN_PLAN.md "SLICE 5 — CHARACTERS"):
// named individuals rather than roster counts, each of whom can be posted to a
// squad, told to hang back, kitted out, and lost for good.
//
// A SCREEN OF ITS OWN, reached from the squad screen (13-16). It was not folded
// into the charter page: 5-9's roll of the dead has nowhere to live there, and
// doing both would mean two code paths for one mutation. The charter page names
// who is posted and offers the way through to here.
//
// A ROLL, NOT A FORM, since 9b. It named everyone and carried the posting
// select and the hang-back checkbox while it was the only screen a character
// had; both moved to the sheet (9-16), which is 13-8's roll-then-page shape one
// level further in — and the same reason: a company of many wants a list that
// scales, and every order wants the context the sheet exists to show. What
// stays here is what a LIST is for: who they are, where they stand, and the way
// through to each of them.
//
// The dead are LISTED, not hidden. Their record survives with everything on it
// (5-9) because a later recovery — a mummification, a special spell — has to
// have something to work with, and a name that vanishes from the screen reads
// as a bug rather than as a loss. Their sheets open too: what a body was still
// carrying when it was left behind is exactly what such a recovery is for.

const CharacterPanel = () => {
  const characters = useCampaignStore((s) => s.campaign?.characters ?? EMPTY_ARRAY)
  const squads = useCampaignStore((s) => s.campaign?.squads ?? EMPTY_ARRAY)
  const showSheet = useUiStore((s) => s.showCharacterPage)

  if (characters.length === 0)
    return <p data-testid="character-panel-empty">No characters ride with this army.</p>

  const living = characters.filter((c) => c.alive)
  const fallen = characters.filter((c) => !c.alive)

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
          {/* The roll MARKS who cannot be given orders today and leaves the
              reason to the sheet, the way the squad roll marks a charter that
              is out. The phrase is the server's either way (17-5). */}
          {character.awayBlocker && (
            <p data-testid={`character-away-${character.id}`}>{character.awayBlocker}.</p>
          )}
          <button
            className="btn-primary"
            data-testid={`character-open-${character.id}`}
            onClick={() => showSheet(character.id)}
          >
            Their sheet
          </button>
        </div>
      ))}

      {fallen.length > 0 && (
        <div className="character-fallen" data-testid="character-fallen">
          <h4>The Fallen</h4>
          {fallen.map((character) => (
            <div className="raid-card" key={character.id}>
              <p data-testid={`character-dead-${character.id}`}>
                {character.name} — {character.type}, fell on day {character.diedDay}
              </p>
              <button
                className="btn-secondary"
                data-testid={`character-open-${character.id}`}
                onClick={() => showSheet(character.id)}
              >
                What they were carrying
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CharacterPanel
