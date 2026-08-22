import React, { useState } from 'react'

// One line per squad: "40 Soldier" or "6 Cavalry, 6 LightCavalry".
const compositionSummary = (composition) =>
  Object.entries(composition).map(([type, n]) => `${n} ${type}`).join(', ')

const ReachMenu = ({
  hex, placements, roster, units, hexTerrain, hexCapacity, onPlace, onClose,
  squads = [], squadPlacements = {}, onPlaceSquad, onRemoveSquad,
  characters = [], characterPlacements = {}, onPlaceCharacter, onRemoveCharacter,
}) => {
  const stackCounts = Object.fromEntries(placements.map(p => [p.type, p.count]))

  const [counts, setCounts] = useState(() =>
    Object.fromEntries(units.map(u => [u.type, stackCounts[u.type] ?? 0]))
  )

  // Hold order is per-square, not per-type: every loose unit placed on this
  // hex shares one value (only a squad carries its own order). All existing
  // placement entries on this hex already agree, so any one of them seeds it.
  const [holdTurns, setHoldTurns] = useState(() => placements[0]?.holdTurns ?? 0)

  const isForbidden = (unit) => unit.forbiddenTerrain?.includes(hexTerrain)

  // A squad occupies real capacity on the hex exactly like loose troops —
  // both the loose "Troops" cap and a squad's own Place/Move buttons must
  // account for whatever squads already sit on THIS hex, or a hex can be
  // silently overstacked (the engine drops the overflow at battle time
  // instead of fighting with it).
  const sizeOf = (type) => units.find(u => u.type === type)?.placementSize ?? 1
  const squadSizePoints = (squad) =>
    Object.entries(squad.composition).reduce((sum, [type, n]) => sum + n * sizeOf(type), 0)
  const squadsHereExcluding = (excludeId) =>
    squads.filter(sq => sq.id !== excludeId
      && squadPlacements[sq.id]?.col === hex.col
      && squadPlacements[sq.id]?.row === hex.row)
  const squadSizeUsedHere = squadsHereExcluding(null)
    .reduce((sum, sq) => sum + squadSizePoints(sq), 0)

  // A lone character (13-18) occupies the hex exactly like anyone else — one
  // body of their type's size. They are outside a squad's CAPS (decision 3) but
  // emphatically not outside the hex, which is the same rule the server's
  // character reserve encodes.
  const charactersHere = characters.filter(c => characterPlacements[c.id]?.col === hex.col
    && characterPlacements[c.id]?.row === hex.row)
  const characterSizeUsedHere = charactersHere.reduce((sum, c) => sum + sizeOf(c.type), 0)

  const looseSizeUsed = units.reduce(
    (sum, u) => sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1), 0
  )

  const sizeUsedByOthers = (type) =>
    units.reduce((sum, u) => {
      if (u.type === type) return sum
      return sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1)
    }, 0) + squadSizeUsedHere + characterSizeUsedHere

  const maxCount = (unit) => {
    if (isForbidden(unit)) return 0
    const cap = Math.floor((hexCapacity - sizeUsedByOthers(unit.type)) / (unit.placementSize ?? 1))
    return Math.min(roster[unit.type] ?? 0, Math.max(0, cap))
  }

  const totalSizeUsed = looseSizeUsed + squadSizeUsedHere + characterSizeUsedHere

  // Remaining room for a squad NOT already counted as "here" — excludes its
  // own footprint so re-evaluating a squad already on this hex (moving it
  // to itself is a no-op) doesn't double-count it.
  const remainingCapacityFor = (squadId) =>
    hexCapacity - looseSizeUsed - characterSizeUsedHere
      - squadsHereExcluding(squadId).reduce((sum, sq) => sum + squadSizePoints(sq), 0)
  const squadFits = (squad) => squadSizePoints(squad) <= remainingCapacityFor(squad.id)
  // Same sum for a character, minus their own footprint if they are already
  // standing here (re-placing someone on their own hex is a no-op).
  const characterFits = (character) =>
    sizeOf(character.type)
      <= hexCapacity - totalSizeUsed
        + (charactersHere.some(c => c.id === character.id) ? sizeOf(character.type) : 0)

  const handleChange = (unit, rawVal) => {
    if (isForbidden(unit)) return
    const requested = parseInt(rawVal) || 0
    const cap = maxCount(unit)
    if (requested > cap)
      console.warn(`[placement] ${unit.type}: requested ${requested} but only ${cap} available; capping.`)
    setCounts(c => ({ ...c, [unit.type]: Math.min(Math.max(0, requested), cap) }))
  }

  const handleHoldChange = (rawVal) => {
    setHoldTurns(Math.max(0, parseInt(rawVal) || 0))
  }

  const commit = () => {
    units.forEach(u => {
      onPlace(
        hex.col, hex.row, u.type,
        isForbidden(u) ? 0 : (counts[u.type] ?? 0),
        isForbidden(u) ? 0 : holdTurns,
      )
    })
    onClose()
  }

  const clear = () => {
    units.forEach(u => onPlace(hex.col, hex.row, u.type, 0, 0))
    onClose()
  }

  // The order control only appears once something is actually going onto
  // this hex — an empty square has nothing to be ordered.
  const hasPlacedUnits = units.some(u => !isForbidden(u) && (counts[u.type] ?? 0) > 0)

  return (
    <div className="reach-menu">
      <div className="reach-menu-header">
        <span>({hex.col},{hex.row}) {hexTerrain}</span>
        <button className="reach-close" onClick={onClose}>×</button>
      </div>
      <div
        className={`reach-capacity${totalSizeUsed > hexCapacity ? ' reach-capacity-over' : ''}`}
        data-testid="reach-capacity"
      >
        {totalSizeUsed} / {hexCapacity}
      </div>

      {squads.length > 0 && (
        <>
          <div className="reach-section-title">Squads</div>
          {squads.map(squad => {
            const here = squadPlacements[squad.id]?.col === hex.col
              && squadPlacements[squad.id]?.row === hex.row
            const elsewhere = squadPlacements[squad.id] && !here
            return (
              <div key={squad.id} className="reach-squad-row" data-testid={`squad-row-${squad.id}`}>
                <span className="reach-squad-name">{squad.name}</span>
                <span className="reach-squad-composition">{compositionSummary(squad.composition)}</span>
                {here ? (
                  <>
                    <label className="reach-order-field">
                      Hold (turns)
                      <input
                        type="number"
                        min={0}
                        value={squadPlacements[squad.id]?.holdTurns ?? 0}
                        onChange={e => onPlaceSquad(
                          hex.col, hex.row, squad.id, squad.name,
                          Math.max(0, parseInt(e.target.value) || 0),
                        )}
                        className="reach-hold-input"
                        data-testid={`squad-hold-${squad.id}`}
                      />
                    </label>
                    <button
                      className="reach-squad-remove"
                      data-testid={`squad-remove-${squad.id}`}
                      onClick={() => onRemoveSquad(squad.id)}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <button
                    className="reach-squad-place"
                    data-testid={`squad-place-${squad.id}`}
                    onClick={() => onPlaceSquad(hex.col, hex.row, squad.id, squad.name, 0)}
                    disabled={!squadFits(squad)}
                    title={!squadFits(squad)
                      ? `Won't fit — needs ${squadSizePoints(squad)}, `
                        + `${Math.max(0, remainingCapacityFor(squad.id))} free on this hex`
                      : undefined}
                  >
                    {elsewhere ? 'Move here' : 'Place here'}
                  </button>
                )}
                {elsewhere && (
                  <span className="reach-squad-elsewhere">
                    at ({squadPlacements[squad.id].col},{squadPlacements[squad.id].row})
                  </span>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* 13-18: the last thing 5a left reachable only through the API. An
          unattached character is placed by hand, one body at a time — no
          quantity, only where — and posting them to a squad instead is what
          makes them ride along automatically. */}
      {characters.length > 0 && (
        <>
          <div className="reach-section-title">Characters</div>
          {characters.map(character => {
            const here = characterPlacements[character.id]?.col === hex.col
              && characterPlacements[character.id]?.row === hex.row
            const elsewhere = characterPlacements[character.id] && !here
            return (
              <div
                key={character.id}
                className="reach-squad-row"
                data-testid={`character-row-${character.id}`}
              >
                <span className="reach-squad-name">{character.name}</span>
                <span className="reach-squad-composition">{character.type}</span>
                {here ? (
                  <button
                    className="reach-squad-remove"
                    data-testid={`character-remove-${character.id}`}
                    onClick={() => onRemoveCharacter(character.id)}
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    className="reach-squad-place"
                    data-testid={`character-place-${character.id}`}
                    onClick={() => onPlaceCharacter(hex.col, hex.row, character.id)}
                    disabled={!characterFits(character)}
                    title={!characterFits(character) ? 'No room left on this hex' : undefined}
                  >
                    {elsewhere ? 'Move here' : 'Place here'}
                  </button>
                )}
                {elsewhere && (
                  <span className="reach-squad-elsewhere">
                    at ({characterPlacements[character.id].col},{characterPlacements[character.id].row})
                  </span>
                )}
              </div>
            )
          })}
        </>
      )}

      <div className="reach-section-title">Troops</div>
      {units.map(u => {
        const forbidden = isForbidden(u)
        return (
          <div key={u.type} className={`reach-row${forbidden ? ' reach-row-forbidden' : ''}`}>
            <span className="reach-symbol">{u.symbol}</span>
            <span className="reach-type">{u.type}</span>
            <span className="reach-avail">/{roster[u.type] ?? 0}</span>
            <input
              type="number"
              min={0}
              max={maxCount(u)}
              value={forbidden ? 0 : (counts[u.type] ?? 0)}
              onChange={e => handleChange(u, e.target.value)}
              className="reach-input"
              data-testid={`count-${u.type}`}
              disabled={forbidden}
            />
          </div>
        )
      })}

      <div className="reach-section-title">Orders</div>
      {!hasPlacedUnits ? (
        <div className="reach-orders-empty" data-testid="orders-empty">
          Place troops above to give them orders.
        </div>
      ) : (
        <div className="reach-order-row">
          {/* Hold is the only order today. Future order types (stance,
              target priority) add more labeled fields to this row. One
              order for the whole square — only a squad carries its own. */}
          <label className="reach-order-field">
            Hold (turns)
            <input
              type="number"
              min={0}
              value={holdTurns}
              onChange={e => handleHoldChange(e.target.value)}
              className="reach-hold-input"
              data-testid="hold-turns"
            />
          </label>
        </div>
      )}

      <button className="reach-commit" onClick={commit}>Place</button>
      <button className="reach-clear" onClick={clear}>Clear</button>
    </div>
  )
}

export default ReachMenu
