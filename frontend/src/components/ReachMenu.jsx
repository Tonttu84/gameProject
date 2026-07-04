import React, { useState } from 'react'

const ReachMenu = ({ hex, placements, roster, units, hexTerrain, hexCapacity, onPlace, onClose }) => {
  const stackCounts    = Object.fromEntries(placements.map(p => [p.type, p.count]))
  const stackHoldTurns = Object.fromEntries(placements.map(p => [p.type, p.holdTurns ?? 0]))

  const [counts, setCounts] = useState(() =>
    Object.fromEntries(units.map(u => [u.type, stackCounts[u.type] ?? 0]))
  )

  const [holdTurns, setHoldTurns] = useState(() =>
    Object.fromEntries(units.map(u => [u.type, stackHoldTurns[u.type] ?? 0]))
  )

  const isForbidden = (unit) => unit.forbiddenTerrain?.includes(hexTerrain)

  const sizeUsedByOthers = (type) =>
    units.reduce((sum, u) => {
      if (u.type === type) return sum
      return sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1)
    }, 0)

  const maxCount = (unit) => {
    if (isForbidden(unit)) return 0
    const cap = Math.floor((hexCapacity - sizeUsedByOthers(unit.type)) / (unit.placementSize ?? 1))
    return Math.min(roster[unit.type] ?? 0, Math.max(0, cap))
  }

  const totalSizeUsed = units.reduce(
    (sum, u) => sum + (counts[u.type] ?? 0) * (u.placementSize ?? 1), 0
  )

  const handleChange = (unit, rawVal) => {
    if (isForbidden(unit)) return
    const requested = parseInt(rawVal) || 0
    const cap = maxCount(unit)
    if (requested > cap)
      console.warn(`[placement] ${unit.type}: requested ${requested} but only ${cap} available; capping.`)
    setCounts(c => ({ ...c, [unit.type]: Math.min(Math.max(0, requested), cap) }))
  }

  const handleHoldChange = (type, rawVal) => {
    const v = Math.max(0, parseInt(rawVal) || 0)
    setHoldTurns(h => ({ ...h, [type]: v }))
  }

  const commit = () => {
    units.forEach(u => {
      onPlace(
        hex.col, hex.row, u.type,
        isForbidden(u) ? 0 : (counts[u.type] ?? 0),
        isForbidden(u) ? 0 : (holdTurns[u.type] ?? 0),
      )
    })
    onClose()
  }

  const clear = () => {
    units.forEach(u => onPlace(hex.col, hex.row, u.type, 0, 0))
    onClose()
  }

  // Orders are per-placement: only units actually going onto this hex have
  // anything to be ordered. An unplaced roster type shows no order controls.
  const orderedUnits = units.filter(u => !isForbidden(u) && (counts[u.type] ?? 0) > 0)

  return (
    <div className="reach-menu">
      <div className="reach-menu-header">
        <span>({hex.col},{hex.row}) {hexTerrain}</span>
        <button className="reach-close" onClick={onClose}>×</button>
      </div>
      <div className="reach-capacity">
        {totalSizeUsed} / {hexCapacity}
      </div>

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
      {orderedUnits.length === 0 ? (
        <div className="reach-orders-empty" data-testid="orders-empty">
          Place troops above to give them orders.
        </div>
      ) : (
        orderedUnits.map(u => (
          <div key={u.type} className="reach-order-row">
            <span className="reach-symbol">{u.symbol}</span>
            <span className="reach-type">{u.type}</span>
            {/* Hold is the only order today. Future order types (stance,
                target priority) add more labeled fields to this row. */}
            <label className="reach-order-field">
              Hold (turns)
              <input
                type="number"
                min={0}
                value={holdTurns[u.type] ?? 0}
                onChange={e => handleHoldChange(u.type, e.target.value)}
                className="reach-hold-input"
                data-testid={`hold-turns-${u.type}`}
              />
            </label>
          </div>
        ))
      )}

      <button className="reach-commit" onClick={commit}>Place</button>
      <button className="reach-clear" onClick={clear}>Clear</button>
    </div>
  )
}

export default ReachMenu
